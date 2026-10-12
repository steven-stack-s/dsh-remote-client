import { app, BrowserWindow, dialog, ipcMain, nativeTheme, Notification } from 'electron'
import { addHost, loadHosts, loadHostsSync, removeHost, replaceHost, resolveStartupHost, saveHosts, touchHost } from './hosts.js'
import { createEditWindow, createHostWindow, createOfflineWindow, createSettingsWindow, createWelcomeWindow, type HostWindowHandle } from './windows.js'
import { createTray, type TrayDeps, type TrayHandle } from './tray.js'
import { installAppMenu, type AppMenuHandle } from './menu.js'
import { clearHostLoginState } from './host-menu.js'
import {
  hostAfterEditEffect,
  shouldCloseWindowAfterRemove,
  shouldQuitOnAllWindowsClosed,
} from './menu-state.js'
import {
  findHostWindowByWebContents,
  focusTargetFor,
  isKnownHostWebContents,
  type OpenHostWindowRef,
} from './window-registry.js'
import { hostIdFromOrigin } from './partitions.js'
import { applyHostEdit } from '../shared/host-edit.js'
import { needsRestartFor } from './restart.js'
import { insecureOriginsSwitchValue, normalizeOrigin } from '../shared/origin.js'
import { parseHostInput } from '../shared/host-input.js'
import { parseThemeSource } from '../shared/desktop-shell.js'
import { createNotifier, createQuietGate, parseNotifyRequest, type NotifyContext } from './notifications.js'
import { loadSettings, loadSettingsSync, saveSettings } from './settings-store.js'
import { DEFAULT_SETTINGS, normalizeSettings, type ClientSettings } from '../shared/settings.js'
import {
  installUpdater,
  updaterDeps,
  RESTART_DIALOG_CONFIRM_ID,
  RESTART_DIALOG_DEFAULT_ID,
} from './updater.js'
import type { HostEntry, HostsFile } from '../shared/types.js'

/**
 * 单实例锁：**一个用户桌面上只允许跑一个客户端**。
 *
 * 用户真机反馈「多次点击桌面图标会打开多个实例、冒出多个托盘」。Electron
 * **不会**自动做这件事——不显式请求锁，每点一次图标就是一个全新进程，各自建窗口、
 * 各自建托盘；而这些实例还会争抢同一份 `hosts.json` 与同一个 partition，
 * 属于会真正损坏状态的冲突，不只是"多了几个图标"。
 *
 * 必须在 `app.whenReady()` **之前**调用，所以放在模块顶层（也是文件里最早的
 * 可执行语句，先于读配置、注册 IPC 等一切副作用）。
 *
 * 拿不到锁时用 `app.exit()` 而不是 `app.quit()`：`quit()` 是**异步**的，会让下面
 * 的模块级语句继续执行一遍——包括后面 `whenReady().then(boot)` 那条链，于是第二个
 * 实例照样把托盘加上去，正是要修的症状。`exit()` 立即开始退出且不触发 before-quit。
 * （顶层剩下的几条同步语句无害：只读配置与注册事件监听，进程随即消失。）
 */
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.exit(0)
}

const dataDir = app.getPath('userData')

// 安全上下文豁免必须在 app.whenReady() 之前设置，因此这里同步读配置。
// 只对已配置的 http origin 放行，绝不通配。
const earlyHosts = loadHostsSync(dataDir)
const insecureValue = insecureOriginsSwitchValue(earlyHosts.hosts.map(h => h.origin))
if (insecureValue !== '') {
  app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', insecureValue)
}

/**
 * 启动时**已生效**的 origin 列表。开关只能在 whenReady 之前设置，
 * 因此这份列表在整个进程生命周期内是冻结的——运行时新增的 http 主机
 * 不在其中，需要重启才能成为安全上下文（规格 §5.3）。
 */
const startupEffectiveOrigins: readonly string[] = earlyHosts.hosts.map(h => h.origin)

/**
 * 已打开的主机窗口，**按 host id 索引**。
 *
 * task-19 之前这里是两个标量（`currentWindow` / `currentHostId`），语义是
 * 「同一时刻只有一台主机窗口」。放开「跨主机跳转开新窗口」后，同一时刻可能有
 * 多台，于是改成 Map。
 *
 * 保留的不变量：**同一个 host 至多一个窗口**（`openHost` 命中既有窗口时只
 * update + show）。这条不变量是必要的——同一个 origin 并存两个窗口会有两份
 * WebSocket 连到同一台 dsh，既浪费又会让页面状态互相打架。
 */
const hostWindows = new Map<string, HostWindowHandle>()

/**
 * 最后聚焦过的主机 id —— 多窗口下「当前主机」的定义。
 *
 * 菜单的 ● 标记、托盘与菜单栏的「重新加载/立即重试/编辑主机…」都以它为目标。
 * 多窗口下本就没有唯一的「当前」，取**最后聚焦**的那台是最符合直觉的近似：
 * 用户刚操作过哪个窗口，哪个就是他要操作的对象。
 *
 * 它可能指向一个**已关闭**的窗口（窗口关闭时不做清理），因此每处使用都必须
 * 容忍「这台已经不在 `hostWindows` 里」。刻意不清空：清空会让「关掉 B 但
 * A 还开着」时丢掉用户上次的落点，而容忍一个失效 id 的成本只是一次 find 落空。
 */
let lastFocusedHostId: string | undefined

/**
 * 内存中的配置镜像，托盘与窗口共用；写盘后同步更新。
 */
let hostsData: HostsFile = { version: 1, hosts: [] }

/** 兼容别名：多数调用点只关心「上次的主机」，语义见 `lastFocusedHostId`。 */
function getCurrentHostId(): string | undefined {
  return lastFocusedHostId
}
let tray: TrayHandle | undefined

/**
 * 内存中的设置镜像。
 *
 * 与 `hostsData` 同一套做法：启动时读一次，之后写盘即同步更新内存。设置窗口
 * 的 `load` 读的是它而不是重新读盘，因此界面拿到的必然是最后一次成功保存的值。
 *
 * 初值用 `DEFAULT_SETTINGS` 的**副本**：模块顶层的 `boot()` 之前也可能有读取
 * （见 `hideOnClose` 的消费点），而直接引用那个常量会让「谁改了它」难以追查。
 */
let settingsData: ClientSettings = { ...DEFAULT_SETTINGS }

/**
 * Windows 的「应用用户模型 ID」（AppUserModelID）。
 *
 * **必须与 `electron-builder.yml` 的 `appId` 完全一致**：Windows 靠它把通知
 * 归属到某个已安装的应用，对不上时系统会**静默丢弃**通知——不报错、不显示，
 * 表现为「功能没做」。不一致比不设置更难排查，因此这里显式写下并标注来源。
 */
const APP_USER_MODEL_ID = 'com.stevenstack.dshremoteclient'

/**
 * 已创建但尚未关闭的通知对象。
 *
 * **必须持有引用**：Windows 上若 `Notification` 实例被垃圾回收，尚未真正显示
 * 出来的通知会**直接消失**（Electron 的已知行为）。而 `notify()` 里创建它的是
 * 一个局部变量，函数一返回就没人引用了——GC 何时跑是**不确定的**，所以症状
 * 恰好是"有时弹、有时不弹"：探针那次弹出来了，真实场景那次没有。
 *
 * 这是用户真机日志定位到的：`notifier.notify` 返回 `true`（说明 `show()` 确实
 * 被调用了），但屏幕上什么都没有——逻辑层已无路可走，只可能是对象在显示前
 * 就被回收了。
 *
 * 用进程级 Set 而不是单个变量：同时可能有多条通知（审批 + 消息）。在 `close`
 * 事件里移除，避免长期持有。
 */
const liveNotifications = new Set<Notification>()

/**
 * 原生通知器。
 *
 * 判定逻辑（去重、聚焦判定、文案）都在 `notifications.ts` 里，是可单测的纯逻辑；
 * 这里只负责把 Electron 的 `Notification` 适配成端口——`notifications.ts`
 * 因此不 import electron，能被 vitest 直接加载（见该文件头部的说明）。
 */
const notifier = createNotifier({
  isSupported: () => Notification.isSupported(),
  create: options => {
    const notification = new Notification(options)
    // 防 GC（见 liveNotifications 的说明）。
    liveNotifications.add(notification)
    // 显示失败是**真实异常**（比如系统禁用了通知），必须留下痕迹：用户报
    // 「没收到通知」时，这是唯一能自证的线索。成功路径不记日志——那是噪音。
    notification.on('failed', (_event, error) => {
      console.error('[dsh-remote-client] 通知显示失败：', error)
    })
    // 关闭后释放引用，避免长期持有。
    notification.on('close', () => { liveNotifications.delete(notification) })
    return {
      show: () => { notification.show() },
      onClick: handler => { notification.on('click', handler) },
    }
  },
})

/**
 * 所有存活的主机窗口的 `{ hostId, webContentsId }` 快照。
 *
 * **每次现取、并顺手剔除已销毁的窗口**：窗口的 `closed` 事件与 Map 的清理之间
 * 可能存在极短的空窗（事件在下一个 tick 才跑），而过期的 id 会让 sender 校验
 * 放行一个已经不存在的窗口。现取 + 过滤比维护一套精确的订阅更不容易漏。
 *
 * @returns 当前有效的主机窗口引用。
 */
function liveHostWindowRefs(): OpenHostWindowRef[] {
  const refs: OpenHostWindowRef[] = []
  for (const [hostId, handle] of hostWindows) {
    if (handle.win.isDestroyed()) continue
    refs.push({ hostId, webContentsId: handle.win.webContents.id })
  }
  return refs
}

/**
 * 某个 sender 是否属于任一已登记的主机窗口。
 *
 * 取代了 task-19 之前的 `hostWebContentsId()`：那个实现只认**单个**窗口，
 * 而多窗口下 B 窗口的所有上报（网络恢复、主题、通知）都会被静默丢弃——
 * 不报错、不提示，只是「功能在第二台主机上不工作」。
 *
 * @param senderId - IPC 事件的 `event.sender.id`。
 * @returns 属于任一已登记主机窗口时返回 true。
 */
function isHostSender(senderId: number): boolean {
  return isKnownHostWebContents(liveHostWindowRefs(), senderId)
}

/**
 * 由 sender id 找出它属于哪台主机窗口。
 *
 * `shell:notify` 用它把「发送方那一台」找出来：通知标题要用**那一台**的主机名、
 * 点击要唤起**那一台**——取「当前主机」会让 B 窗口的通知显示 A 的名字、点了跳到 A。
 *
 * @param senderId - IPC 事件的 `event.sender.id`。
 * @returns 对应的主机窗口句柄；不属于任何主机窗口时 undefined。
 */
function hostWindowOf(senderId: number): HostWindowHandle | undefined {
  const ref = findHostWindowByWebContents(liveHostWindowRefs(), senderId)
  return ref === undefined ? undefined : hostWindows.get(ref.hostId)
}

/**
 * 「当前主机窗口」——最后聚焦的那一台。
 *
 * 多窗口下这是一个**近似**（见 `lastFocusedHostId` 的说明），只用于那些
 * 天生「作用于当前那台」的入口：托盘的重载/重试、菜单的 ● 标记。
 * **它可能是 undefined**（那台已关、或从未打开），所有调用方都必须容忍。
 *
 * @returns 当前主机窗口句柄，无则 undefined。
 */
function currentHostWindow(): HostWindowHandle | undefined {
  const id = lastFocusedHostId
  if (id === undefined) return undefined
  const handle = hostWindows.get(id)
  if (handle === undefined || handle.win.isDestroyed()) return undefined
  return handle
}

/**
 * 壳自有欢迎页的 webContents id 集合。
 *
 * `shell:restart` 只允许这些上下文调用：远端主机页面是本项目明确认定的
 * **不可信内容**，绝不能让它触发重启。用 id 集合而非窗口引用，是因为窗口
 * 关闭后引用会失效，而 id 可以精确增删。
 */
const welcomeWebContentsIds = new Set<number>()

/**
 * 打开欢迎窗口并登记其 webContents，供 `shell:restart` 校验 sender。
 */
function openWelcomeWindow(): void {
  const win = createWelcomeWindow()
  const id = win.webContents.id
  welcomeWebContentsIds.add(id)
  win.on('closed', () => { welcomeWebContentsIds.delete(id) })
}

/** 应用菜单句柄；装配后据此重建。 */
let appMenu: AppMenuHandle | undefined

/** 当前被编辑的主机 id；编辑窗口通过 IPC 读取/保存它。 */
let editingHostId: string | undefined

/** 编辑窗口的 webContents id 集合，用于校验 IPC sender。 */
const editWebContentsIds = new Set<number>()

/** 设置窗口的 webContents id 集合，用于校验 IPC sender。 */
const settingsWebContentsIds = new Set<number>()

/**
 * 打开「客户端设置」窗口。
 *
 * 只允许同时存在一个：这是**全局**设置的编辑界面（不是每台主机一份），重复打开
 * 会得到两个各自加载了同一份文件的窗口，两边分别保存会互相覆盖——与编辑窗口
 * 同一考虑（那里的成对保存还会指向同一条记录）。
 *
 * 已打开时把它唤到前台，而不是直接 return：用户点「客户端设置」却什么都没发生，
 * 比看到一个已经开着的窗口更让人困惑（窗口可能被别的窗口盖住了）。
 */
function openSettingsWindow(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    if (!settingsWebContentsIds.has(win.webContents.id)) continue
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return
  }

  const win = createSettingsWindow()
  const id = win.webContents.id
  settingsWebContentsIds.add(id)
  win.on('closed', () => { settingsWebContentsIds.delete(id) })
}

/**
 * 打开「编辑主机」窗口。
 *
 * 只允许同时存在一个编辑窗口：重复打开会指向同一个被编辑对象，
 * 两个窗口各自保存会互相覆盖，徒增困惑。
 *
 * @param host - 初始要编辑的主机（窗口内部可以切换到别的主机）。
 */
function openEditWindow(host: HostEntry): void {
  if (editWebContentsIds.size > 0) return
  editingHostId = host.id
  const win = createEditWindow()
  const id = win.webContents.id
  editWebContentsIds.add(id)
  win.on('closed', () => {
    editWebContentsIds.delete(id)
    editingHostId = undefined
  })
}

/**
 * 打开编辑窗口：优先编辑当前主机。
 *
 * 当前主机不存在（例如刚被删掉）时退回列表里的第一台：编辑窗口内部本就可以
 * 切换编辑对象，为了「没有当前主机」而把入口整个禁掉没有道理——那会让用户
 * 在还剩好几台主机时完全没有编辑入口。
 */
function openEditCurrentHost(): void {
  const host = hostsData.hosts.find(h => h.id === getCurrentHostId()) ?? hostsData.hosts[0]
  if (host === undefined) return
  openEditWindow(host)
}

/** 删除当前主机（复用与托盘一致的确认框路径）。 */
function removeCurrentHost(): void {
  const host = hostsData.hosts.find(h => h.id === getCurrentHostId())
  if (host === undefined) return
  void requestRemoveHost(host)
}

/**
 * 刷新壳层外观：托盘（图标 + 提示 + 菜单）+ 应用菜单栏。
 *
 * 主机增删/切换/离线状态变化后必须刷新，否则两处都会显示过期的主机列表。
 * 这里是**唯一**的刷新入口：`refresh()` 内部会重建托盘菜单，`rebuild()` 重建
 * 应用菜单栏，调用方不必（也不该）知道其中细节——曾经托盘菜单与配置无关、
 * 只需刷图标，那条例外已随主机管理回到托盘而消失。
 */
function refreshChrome(): void {
  tray?.refresh()
  appMenu?.rebuild()
}

/**
 * 「打开客户端」（托盘菜单项）。
 *
 * 顺序：先唤起任何已存在的窗口（主机窗口在非 darwin 平台关窗后只是被**隐藏**，
 * 所以正常情况都能唤醒）；一个窗口都没有时才按上次的主机重开；连主机都没有
 * （例如刚删光主机）则打开欢迎页——绝不能出现「点了没反应」。
 *
 * 该做什么由 `window-registry.ts` 的 `focusTargetFor` 纯函数判定（有单测），
 * 这里只负责执行。task-19 换掉了原来基于 `trayOpenAction` 的判定：多窗口下
 * 多出「记得的那台可能已经关了」这个情况，它的失败形态正是「什么都不做」——
 * 因此新判定的每个分支都被测试钉住。
 */
function openClient(): void {
  const windows = BrowserWindow.getAllWindows().filter(win => !win.isDestroyed())

  const target = focusTargetFor({
    openHostIds: [...hostWindows.keys()],
    lastFocusedId: lastFocusedHostId,
    fallbackWindowExists: windows.length > 0,
  })

  if (target.kind === 'host') {
    const handle = hostWindows.get(target.hostId)
    // 判定时还在、执行时已被关掉（用户可能刚好点了关闭）→ 退到任意窗口，
    // 而不是静默 return。这一层兜底是必要的：`focusTargetFor` 拿到的是快照。
    if (handle !== undefined && !handle.win.isDestroyed()) {
      showWindow(handle.win)
      return
    }
    if (windows[0] !== undefined) showWindow(windows[0])
    return
  }

  if (target.kind === 'any') {
    if (windows[0] !== undefined) showWindow(windows[0])
    return
  }

  if (target.kind === 'reopen') {
    const host = hostsData.hosts.find(h => h.id === target.hostId)
    if (host !== undefined) {
      openHost(host)
      return
    }
    // 上次的主机已被删除 → 落到欢迎页（用户能据此重新添加）。
  }

  openWelcomeWindow()
}

/**
 * 唤起并聚焦一个窗口。
 *
 * 最小化的窗口 `show()` 不一定能还原，因此显式 `restore()` 一次——这是既有
 * `openClient` 里就有的处理，抽出来供多窗口的各个分支共用。
 *
 * @param win - 目标窗口。
 */
function showWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** 当前是否有可用的主机窗口。 */
function hasHostWindow(): boolean {
  return liveHostWindowRefs().length > 0
}

/**
 * 应用是否正在真正退出。由 `before-quit` 置位，供窗口 `close` 判定放行——
 * 否则非 darwin 平台的关窗拦截会把退出流程卡死。
 */
let quitting = false

/**
 * 打开一台主机。若该主机窗口已存在（可能被隐藏），直接唤起而不重建，
 * 避免同一 origin 并存两份 WebSocket。
 *
 * @param host - 目标主机。**必须是当前配置里的那份**（调用方从 `hostsData` 取），
 *   因为这里会把它交给窗口作为最新配置。
 */
function openHost(host: HostEntry): void {
  // 该 host 已开 → 只更新配置并唤起，**绝不再建第二个窗口**。
  //
  // 这条不变量（同一 host 至多一个窗口）是必须的：同一个 origin 并存两个窗口
  // 会有两份 WebSocket 连到同一台 dsh，既浪费又会让页面状态互相打架——这正是
  // 原实现「切换主机时销毁旧窗口」想避免的事，多窗口化之后由它来保证。
  const existing = hostWindows.get(host.id)
  if (existing !== undefined && !existing.win.isDestroyed()) {
    // 窗口已存在时也要把最新配置交进去：它可能停在旧 token / 旧显示名上
    // （窗口持有的是创建时那份快照，见 windows.ts 的 updateHost 说明）。
    existing.updateHost(host)
    lastFocusedHostId = host.id
    existing.show()
    refreshChrome()
    return
  }

  lastFocusedHostId = host.id
  const handle = createHostWindow(
    host,
    // 链接分流用的已知主机列表**从这里注入**：`hostsData` 属于主进程，
    // `windows.ts` 不该反向依赖 index.ts（见 createHostWindow 的说明）。
    // 每次判定现取，因此增删主机后立刻生效。
    () => hostsData.hosts.map(entry => entry.origin),
    title => {
      // 离线期间标题由重试倒计时接管，不让页面标题覆盖掉状态提示。
      //
      // 读的是**这个窗口自己**的句柄（而不是「当前窗口」）：多窗口下拿当前窗口
      // 会让 B 窗口的标题被 A 的离线状态决定——张冠李戴。
      const self = hostWindows.get(host.id)
      if (title !== '' && self?.isOffline() === false) {
        // 读**当前**配置而不是闭包里的快照：主机被重命名后，页面标题一变
        // 就应该带上新名字（否则窗口标题会一直停在旧显示名）。
        const label = hostsData.hosts.find(h => h.id === host.id)?.label ?? host.label
        self?.win.setTitle(`${label} — ${title}`)
      }
    },
    () => { refreshChrome() },
    () => quitting,
    // 关窗行为取**当前**设置（现取），因此用户在设置里改完立刻对已开的窗口生效。
    () => settingsData.hideOnClose,
    // 窗口内的 Ctrl+, 入口（Windows 上菜单栏不显示，只靠 application menu 会没反应）。
    () => { openSettingsWindow() },
    // 跨主机跳转是否开新窗口——同样是现取的用户设置。
    () => settingsData.openInNewWindow,
    // 跨主机跳转的目标 URL → 开/唤起那台主机的窗口。
    url => { openHostByUrl(url) },
  )

  hostWindows.set(host.id, handle)

  // 聚焦时把它记为「当前主机」：菜单的 ● 标记、托盘的「重新加载/立即重试」
  // 都以它为目标。这是多窗口下「当前主机」这个概念的**唯一定义处**。
  handle.win.on('focus', () => {
    lastFocusedHostId = host.id
    refreshChrome()
  })

  handle.win.on('closed', () => {
    // 用 `host.id` 而不是遍历查找：注册时就知道是哪个 id，没有理由事后再猜。
    // 只在 Map 里仍是自己时才删——极端情况下（改地址重建）可能已被新窗口顶替。
    if (hostWindows.get(host.id) === handle) hostWindows.delete(host.id)
    // `lastFocusedHostId` **刻意不清**：见它的说明（容忍一个失效 id 的成本很低，
    // 而清空会让「关掉 B 但 A 还开着」时丢掉用户上次的落点）。
    refreshChrome()
  })
}

/**
 * 按 URL 打开它对应的那台已配置主机（task-19：「跨主机跳转开新窗口」的落点）。
 *
 * 由 `windows.ts` 的 `openNewWindow` 回调传入，触发时机是「页面 `window.open` 了
 * 一个指向**另一台已配置主机**的地址，且用户开了新窗口选项」。
 *
 * **只认已配置主机的 origin**：URL 的路径与查询被丢弃（窗口总是从 `host.origin`
 * 干净加载）。这是刻意的——token 之类的凭据不该经 URL 传递（见 `hosts.ts` 关于
 * origin 必须纯净的说明），而 dsh 是 SPA，具体到哪个会话由它自己恢复。
 *
 * 找不到对应主机时**什么都不做**：判定层（`windowOpenDecision`）已经保证只有
 * 「∈ 已知主机」的地址才会走到这里；真找不到说明配置在两次判定之间被改了，
 * 此时静默忽略比硬开一个未配置的窗口安全。
 *
 * @param url - 页面请求打开的地址。
 */
function openHostByUrl(url: string): void {
  let origin: string
  try {
    origin = normalizeOrigin(url)
  } catch {
    // 非法地址：判定层不会放它过来，这里只是不让异常冒到 Electron 的事件回调里。
    return
  }

  const host = hostsData.hosts.find(h => h.origin === origin)
  if (host === undefined) return

  // 复用 `openHost` 而不是自己建窗口：这样自动命中「同一 host 至多一个窗口」
  // 这条不变量——那台主机若已经开着，这里只会把它唤到前台，而不是并存两个窗口
  // （两份 WebSocket 连同一台 dsh）。这也正是本路径不用 Electron `allow` 的原因。
  openHost(host)
}

/**
 * 更新内存配置并落盘。
 *
 * @param next - 新配置。
 */
async function persist(next: HostsFile): Promise<void> {
  hostsData = next
  await saveHosts(dataDir, next)
  refreshChrome()
}

/**
 * 更新内存中的设置并落盘。
 *
 * **刻意不调用 `refreshChrome()`**：设置项目前不影响菜单或托盘的形态（不像主机
 * 增删会改列表），因此没有需要重建的界面。日后若加了会影响菜单的设置项
 * （例如「显示托盘图标」），记得在这里补一次刷新。
 *
 * @param next - 新设置。
 */
async function persistSettings(next: ClientSettings): Promise<void> {
  settingsData = next
  await saveSettings(dataDir, next)
}

/**
 * 请求删除一台主机：先弹确认框，确认后才真正移除。
 *
 * 删除是不可撤销的（该主机的登录态 partition 会变成孤儿数据），因此必须
 * 二次确认。默认按钮刻意设为「取消」——误按回车不应造成破坏。
 *
 * 菜单/托盘的点击回调是同步的，而 `showMessageBox` 返回 Promise，
 * 故用 `void (async () => …)()` 包装，并把本函数设计成 async。
 *
 * @param host - 待删除的主机。
 */
async function requestRemoveHost(host: HostEntry): Promise<void> {
  try {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['取消', '删除'],
      defaultId: 0,      // 默认「取消」：回车不会误删
      cancelId: 0,       // Esc 亦视为取消
      title: '删除主机',
      message: `确定要删除「${host.label}」吗？`,
      detail: `将从配置中移除该主机（${host.origin}）。\n`
        + '其登录态数据（cookie 等）不再被使用，但不会立即从磁盘清除。\n'
        + '此操作无法撤销。',
      noLink: true,
    })
    // defaultId/cancelId 都是 0，因此只有显式点「删除」(index 1) 才继续。
    if (response !== 1) return
  } catch (error) {
    // 确认框本身失败时不应静默删除：宁可什么都不做，也不能在没有用户
    // 确认的情况下执行不可逆操作。
    console.error('[dsh-remote-client] 删除确认框失败，已取消删除：', error)
    return
  }

  const removedId = host.id
  await persist(removeHost(hostsData, removedId))

  // 被删的那台**自己**有窗口 → 关闭它：配置里已无此主机，继续留着
  // 会让主机列表与实际窗口不一致（用户会以为没删掉）。
  //
  // 判据是「它自己有没有窗口」而不是「它是不是当前那台」：多窗口下用户可能删掉
  // 一台没开着的主机，按「当前」判会误关他正在看的那台。
  if (shouldCloseWindowAfterRemove(removedId, [...hostWindows.keys()])) {
    hostWindows.get(removedId)?.win.destroy()
  }
  refreshChrome()
}

/** 清除一台主机的登录态。 */
function resetHostLoginState(host: HostEntry): void {
  void clearHostLoginState(host)
    .then(() => { refreshChrome() })
    .catch(error => {
      console.error('[dsh-remote-client] 重置登录态失败：', error)
    })
}

/**
 * 询问用户「新版本已下载完成，现在重启安装吗？」。
 *
 * 由 `updater.ts` 在 `update-downloaded` 之后调用——**必须等下载完成再问**：
 * 在 `update-available` 时就问，等于让用户对着一个还没开始下载的进度条等待。
 *
 * 默认按钮刻意设为「稍后」（与 `requestRemoveHost` 同一考虑）：用户可能正在
 * 等一个长任务，误按回车绝不能把应用重启掉。
 *
 * 更新是**应用级**行为，与当前打开哪台主机无关，因此这里不需要窗口存在，
 * `showMessageBox` 无窗口时也会正常显示（规格 §3.4(c)）。
 *
 * 注意：这里**不再**负责置位 `quitting`。那件事改由下面 `markQuittingForUpdate`
 * 承担——原因见它的说明（要让类型系统强制它发生，而不是靠本函数的注释维系）。
 *
 * @param version - 已下载完成的版本号。
 * @returns 用户是否选择了「立即重启」。
 */
async function promptRestart(version: string): Promise<boolean> {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    buttons: ['立即重启', '稍后'],
    defaultId: RESTART_DIALOG_DEFAULT_ID, // 默认「稍后」：回车不重启
    cancelId: RESTART_DIALOG_DEFAULT_ID,  // Esc 亦视为「稍后」
    title: '更新已就绪',
    message: `新版本 ${version} 已下载完成，现在重启安装吗？`,
    detail: '选择「稍后」也可以，下次启动时会再次检查。',
    noLink: true,
  })
  return response === RESTART_DIALOG_CONFIRM_ID
}

/**
 * 安装更新前的收尾：把应用标记为「正在退出」。
 *
 * 由 `updater.ts` 在 `quitAndInstall()` **之前**调用（作为 `UpdaterDeps.beforeInstall`
 * 传入）。这一步是必须的，否则「立即重启」100% 失效：
 *
 * spec §3.4(a) 与计划都写着「`quitAndInstall()` 内部走 `app.quit()`，会先触发
 * `before-quit`，因此这条路径本就通」——**该前提与 Electron 的实际行为相反**。
 * 官方文档（app 的 `before-quit` 事件）明确写着：
 *
 * > If application quit was initiated by `autoUpdater.quitAndInstall()`, then
 * > `before-quit` is emitted **after** emitting `close` event on all windows
 * > and closing them.
 *
 * 我核对了 electron-updater 6.8.9 源码，确认这条文档不是空话：
 * `BaseUpdater.quitAndInstall()` → `this.app.quit()` →
 * `ElectronAppAdapter.quit()` 就是一句裸的 `app.quit()`，没有任何关闭窗口的预处理。
 *
 * 因此实际的时序是 `close` **先于** `before-quit`。而 `close` 到达
 * `windows.ts` 的拦截时 `quitting` 仍是 `false`（`before-quit` 还没 emit），
 * `shouldHideOnClose` 在非 darwin 平台对主机窗口一律返回 true → `preventDefault()`
 * → **Electron 取消整个退出流程**。症状正是 spec 预言的「点了立即重启，窗口消失了
 * 但版本没变」，而且是必然发生、不是偶发。窗口先被隐藏，然后退出被撤销，应用
 * 变成一个还活着的幽灵进程。
 *
 * 这条路径只在打包版 + 真的下载完更新后才走到，单测与产物断言都够不着，所以
 * 在这里显式置位是最直接的修法：让 `quitting` 在**安装退出发起之前**就为 true，
 * 后续 `close` 自然放行（`before-quit` 稍后照常 emit，置位是幂等的）。
 *
 * 注意这与「注册顺序」无关——`before-quit` 确实早于更新器注册，但问题出在
 * **触发顺序**上。只检查注册顺序是查不出这个缺陷的。
 */
function markQuittingForUpdate(): void {
  quitting = true
}

/**
 * 装配托盘；只装配一次。失败被捕获并记录，绝不因此中断启动。
 *
 * 依赖与 `installAppMenuBar` 几乎同形，因为两者提供的是同一套主机管理动作。
 * 这一点是**有意的**：Windows 上主机窗口是无边框的，菜单栏不显示，托盘是
 * 主机管理的唯一可视入口；在 macOS / Linux 上菜单栏仍在，两者并存。
 * 无论哪种情况，两边都必须给出同样的能力，故共用同一批回调。
 */
function installTray(): void {
  if (tray !== undefined) return
  try {
    const deps: TrayDeps = {
      isOffline: () => currentHostWindow()?.isOffline() ?? false,
      onOpen: () => { openClient() },
      onQuit: () => { app.quit() },
      getData: () => hostsData,
      getCurrentId: () => getCurrentHostId(),
      openHost: host => { void persist(touchHost(hostsData, host.id)); openHost(host) },
      onAddHost: () => { openWelcomeWindow() },
      onEditCurrentHost: () => { openEditCurrentHost() },
      onReload: () => { currentHostWindow()?.reload() },
      onRetryNow: () => { currentHostWindow()?.retryNow() },
      onResetLogin: host => { resetHostLoginState(host) },
      onRemoveHost: host => { void requestRemoveHost(host) },
      onOpenSettings: () => { openSettingsWindow() },
    }
    tray = createTray(deps)
  } catch (error) {
    // 托盘可能因平台限制、图标无效等原因创建失败。绝不能静默吞掉：
    // 用户真机上「托盘不出现」曾因此完全无法诊断。应用菜单栏是兜底入口，
    // 因此这里失败不应影响后续启动流程。
    console.error('[dsh-remote-client] 托盘创建失败，将仅提供应用菜单栏：', error)
  }
}

/** 装配应用菜单栏；只装配一次。这是不依赖托盘的兜底入口。 */
function installAppMenuBar(): void {
  if (appMenu !== undefined) return
  try {
    appMenu = installAppMenu({
      getData: () => hostsData,
      getCurrentId: () => getCurrentHostId(),
      openHost: host => { void persist(touchHost(hostsData, host.id)); openHost(host) },
      onAddHost: () => { openWelcomeWindow() },
      onReload: () => { currentHostWindow()?.reload() },
      isOffline: () => currentHostWindow()?.isOffline() ?? false,
      onRetryNow: () => { currentHostWindow()?.retryNow() },
      onResetLogin: host => { resetHostLoginState(host) },
      onRemoveHost: host => { void requestRemoveHost(host) },
      onEditCurrentHost: () => { openEditCurrentHost() },
      onRemoveCurrentHost: () => { removeCurrentHost() },
      onOpenSettings: () => { openSettingsWindow() },
      onQuit: () => { app.quit() },
    })
  } catch (error) {
    console.error('[dsh-remote-client] 应用菜单装配失败：', error)
  }
}

/**
 * 装配所有「入口」UI（应用菜单栏 + 托盘）。
 *
 * **必须在 boot() 的最前面调用**：这两者是用户管理主机的通道，其中应用
 * 菜单栏还承担「托盘不可见时」的兜底职责。早先版本把托盘装配放在
 * openHost() 之后，一旦前面的读配置/写配置/开窗任何一步抛异常，入口就
 * 永远不会出现——用户会看到窗口打开了却没有任何管理入口（真机反馈正是如此）。
 */
function installShellChrome(): void {
  installAppMenuBar()
  installTray()
}

async function boot(): Promise<void> {
  // 双保险：没拿到单实例锁就什么都不做。上面的 `app.exit(0)` 已经会让进程退出，
  // 但它是异步的——万一在它生效前 `whenReady` 就 resolve 了，这里能确保第二个
  // 实例**不会**建托盘、开窗口、写配置文件（那正是「多个托盘」的来源）。
  if (!hasSingleInstanceLock) return

  // Windows 上必须在 app.whenReady() 之后、发通知之前设置 AppUserModelID，
  // 否则系统原生通知**根本不显示**（静默失败，不报错也不抛异常）。
  // boot() 正是在 whenReady 之后被调用，这里是唯一且最早的时机。
  // 平台不支持时只降级通知能力，绝不能因此影响启动。
  try {
    app.setAppUserModelId(APP_USER_MODEL_ID)
  } catch (error) {
    console.error('[dsh-remote-client] 设置 AppUserModelID 失败，通知可能不显示：', error)
  }

  // 先装配入口，再做任何可能失败的事（读/写配置、开窗），并整体兜底。
  installShellChrome()

  try {
    // 设置必须在读主机之前载入：主机窗口的创建会读 `settingsData`（例如关窗
    // 行为与链接分流开关），先读设置才能保证窗口一出生就用对配置。
    settingsData = await loadSettings(dataDir)

    const data = await loadHosts(dataDir)
    const host = resolveStartupHost(data)

    if (host === undefined) {
      // 无主机：打开欢迎页让用户添加第一台。
      hostsData = data
      refreshChrome()
      openWelcomeWindow()
      return
    }

    // 「每次显示『添加主机』页」：用户选了它就不自动开主机窗口，但仍然要把
    // 主机数据与「上次使用的主机」记好——他从欢迎页添加/打开主机时用得到。
    if (settingsData.startupBehavior === 'welcome') {
      hostsData = data
      lastFocusedHostId = host.id
      await saveHosts(dataDir, touchHost(data, host.id))
      refreshChrome()
      openWelcomeWindow()
      return
    }

    hostsData = data
    lastFocusedHostId = host.id
    await saveHosts(dataDir, touchHost(data, host.id))
    openHost(host)
    refreshChrome()
  } catch (error) {
    // 启动过程中任何一步失败都不应让用户面对一个「什么都没有」的应用：
    // 入口已装配，这里把原因显式呈现出来并记录。
    console.error('[dsh-remote-client] 启动流程失败：', error)
    try {
      createOfflineWindow(
        'dsh-remote-client',
        `启动失败：${error instanceof Error ? error.message : String(error)}`,
      )
    } catch (fallbackError) {
      console.error('[dsh-remote-client] 离线窗口亦无法打开：', fallbackError)
    }
  } finally {
    // 自动更新放在最后装配，且**在 try/catch 之外也照做**（finally 里）：
    // 上面任何一步失败都不该让用户失去更新能力——恰恰相反，启动就出问题的
    // 用户最需要能升到修复版。installUpdater 自己不抛（只在失败时记日志），
    // 因此这里不需要再包一层 try。
    //
    // 只在打包版生效（`updaterDeps` 读 `app.isPackaged`），开发模式下
    // electron-updater 会因缺 app-update.yml 报错。
    //
    // `beforeInstall` 必须是**必填**的：它负责在 `quitAndInstall()` 之前置位
    // `quitting`，漏掉就会让「立即重启」被关窗拦截吞掉（详见
    // `markQuittingForUpdate` 的说明）。`UpdaterDeps` 把它声明成必填字段，
    // 因此这里少传一个会直接编译失败，而不是等到真机才发现。
    // 用户在设置里关掉了「检查更新」→ 整个更新器都不装配。
    //
    // 放在 `finally` 里的这一步**依然不受上面 try 的成败影响**，因此「启动就
    // 出问题的用户最需要能升到修复版」这条既有考虑仍然成立——除非用户自己
    // 显式关掉了它，那是他的选择。
    if (settingsData.updateCheckEnabled) {
      installUpdater(updaterDeps({
        promptRestart,
        beforeInstall: markQuittingForUpdate,
      }))
    }
  }
}

// 标题走 windows.ts 的 page-title-updated 原生事件这一条路径；
// 早期版本的 shell:title IPC 与它互相覆盖，且由 MutationObserver 高频触发，
// 已删除，这里不再注册对应 handler。

ipcMain.on('shell:network', (event, online: unknown) => {
  // 只接受**主机窗口**的上报：自 task-15 起，页面自己打开的窗口也带同一个
  // preload（为了让它们共享登录态与离线检测），不校验 sender 的话，子窗口的
  // 网络事件会去驱动主机窗口重载——张冠李戴。
  //
  // task-19 起放宽成「属于**任一**已登记主机窗口」：多窗口下只认单个 id 会让
  // 第二台主机的网络上报被静默丢弃。但**重试必须作用在发送方那一台**——
  // 用「当前窗口」会让 B 窗口的网络恢复去重载 A 的页面。
  const handle = hostWindowOf(event.sender.id)
  if (handle === undefined) return
  // 网络恢复时立刻重试一次，不必等退避耗尽；离线事件交给 did-fail-load 处理。
  if (online === true) handle.retryNow()
})

/**
 * 主题来源上报：让**原生窗口装饰**跟随应用主题。
 *
 * 远端页面换肤只改得到网页内部（CSS 变量、自有样式表），窗口自身的标题栏与
 * 菜单栏由 Electron / 操作系统绘制，网页 CSS 够不着——用户切主题后「上面那一
 * 条没变」就是这个缺口。dsh 前端为此在 `<html>` 上公布了 `data-ds-theme-source`，
 * 并注明该属性就是给宿主壳转发进 `nativeTheme.themeSource` 用的（详见
 * `shared/desktop-shell.ts` 的文件头说明）。
 *
 * 与 `shell:network` 同样校验 sender 必须是**当前主机窗口**：`nativeTheme` 是
 * 全进程单例，放任欢迎页/编辑页/已销毁的旧窗口上报会让窗口装饰跟着错误的来源
 * 变。远端页面本就是不可信内容，其上报按外部输入处理（`parseThemeSource` 只认
 * 三个合法字面量）。
 *
 * 刻意**不做**「窗口关闭时复位为 `system`」：切换主机的语义是关旧窗 + 立刻开新窗，
 * 中途复位会让窗口装饰闪一下系统配色，而新窗口挂载后马上又会上报真实来源。
 */
ipcMain.on('shell:theme', (event, raw: unknown) => {
  // task-19 起放宽成「属于任一已登记主机窗口」：多窗口下只认单个 id 会让第二台
  // 主机的主题上报被静默丢弃，顶部那条就跟不上皮肤的切换。
  if (!isHostSender(event.sender.id)) return
  const source = parseThemeSource(raw)
  if (source === undefined) return
  // ⚠️ **多窗口下的已知取舍**：`nativeTheme` 是**进程级单例**，因此谁后上报谁赢。
  // 两个窗口若用了不同皮肤，会互相覆盖（表现为顶部那条在两者间来回跳）。
  //
  // 按「可接受」处理而非加仲裁：宿主壳与 dsh 前端之间只有「当前主题来源」这一个
  // 契约（见 desktop-shell.ts），没有「哪个窗口的主题优先」的概念；而两个窗口
  // 同属一个用户、一套 dsh 部署，皮肤本就应当一致——不一致是用户的刻意选择，
  // 此时「最后操作的那个说了算」也是最不意外的行为。
  nativeTheme.themeSource = source
})

/**
 * 通知上报。preload 的 DOM 观察器只在命中选择器时才会发这条 IPC
 * （见 `src/preload/host.ts`），因此这里不必再防高频。
 *
 * 校验 sender 必须是**当前主机窗口**：通知会抢占用户的注意力，绝不能让
 * 其他上下文（欢迎页/编辑页/已销毁的旧主机窗口）或远端页面注入的脚本
 * 随意触发。远端页面本就是本项目认定的不可信内容，其上报按外部输入处理
 * （`parseNotifyRequest` 只接受严格合法的负载）。
 */
/**
 * 静默期闸门：消息通知先攒着，等「真的安静下来」再弹。
 *
 * 用户反馈「每轮回复都提醒太频繁」，要求只在 agent 真正停下来时提醒。而 dsh
 * 没有暴露「整个会话是否在跑」的信号（见 `notifications.ts` 的 `QUIET_PERIOD_MS`
 * 说明），所以只能靠**观测到安静**来推断：最后一轮流式输出结束后再等 15 秒，
 * 期间没有任何新输出，才认为它真的停了。
 *
 * **只作用于消息通知**：审批走另一条路（立即判定）——它阻塞用户的工作流，
 * 压后 15 秒既无意义、又会让 agent 白等。
 */
const quietGate = createQuietGate({
  schedule: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs)
    return () => { clearTimeout(timer) }
  },
  // **传取值函数而非当前的数字**：静默期是用户可改的设置，而这个闸门是模块级
  // 单例、随进程存活。传数字会让「在设置里改完静默期却不生效」，直到重启客户端
  // 才偶然对上——典型的「存下来了却没人读」。
  quietMs: () => settingsData.notifyQuietMs,
})

ipcMain.on('shell:notify', (event, raw: unknown) => {
  // **按发送方解析出「是哪一台主机窗口」**，而不是取「当前主机」。
  //
  // 这是多窗口下最要紧的一处：若用 `currentHostWindow()`，B 窗口的审批通知会
  // 显示 A 的主机名、点击后唤起 A 的窗口——用户被引到完全无关的会话上，而真正
  // 卡住等他回应的那个 agent 仍被晾着。
  const source = findHostWindowByWebContents(liveHostWindowRefs(), event.sender.id)
  if (source === undefined) return
  const senderHandle = hostWindows.get(source.hostId)
  if (senderHandle === undefined) return

  // 用户在设置里关掉了通知 → 直接丢弃上报。
  //
  // 刻意在**最前面**判掉（而不是在 notifier 内部抑制）：关掉通知意味着这个功能
  // 整体不工作，连静默期计时器都不该起——否则用户以为关干净了，后台仍有定时器
  // 在空转并在 15 秒后走一遍组装上下文的逻辑。
  if (!settingsData.notifyEnabled) return
  const request = parseNotifyRequest(raw)
  if (request === undefined) return

  /**
   * 组装通知上下文。
   *
   * **焦点现取**，不是上报时取一次存着：静默期到期时用户可能已经切回窗口看
   * 结果了，那样就不该再弹——判据必须是「我准备弹的这一刻他到底在不在看」。
   *
   * 两处都读**发送方那一台**（`senderHandle`）而非当前窗口：焦点判定若看的是
   * 当前窗口，用户正盯着 B 看时，A 的审批通知会被误判成「他正在看」而不弹——
   * 而那恰恰是最需要弹的一条。
   */
  const buildContext = (): NotifyContext => ({
    urgent: request.urgent,
    // 焦点判定只在主进程做（preload 不重复实现）——它才是那个知道窗口
    // 是否被隐藏/最小化/被别的应用盖住的地方。
    windowFocused: senderHandle.win.isDestroyed() ? false : senderHandle.win.isFocused(),
    hostLabel: hostsData.hosts.find(h => h.id === source.hostId)?.label ?? 'dsh',
    titleHint: request.title,
    // 点击通知 → 唤起并聚焦**那一台**窗口。窗口可能是被收进托盘的隐藏态
    // （隐藏 ≠ 关闭），`show()` 内部已处理 show + focus。
    onActivate: () => { senderHandle.show() },
  })

  const fire = (context: NotifyContext): void => {
    try {
      notifier.notify(context)
    } catch (error) {
      // 通知失败绝不能牵连页面本身：它是锦上添花的能力，不是主链路。
      console.error('[dsh-remote-client] 原生通知失败：', error)
    }
  }

  // 审批：立即判定并弹（无条件可见，不受静默期影响）。
  if (request.urgent) {
    fire(buildContext())
    return
  }

  // 消息：起/重置静默期；到期时才取出**那一刻**的上下文做判定。
  quietGate.pulse(() => { fire(buildContext()) })
})

ipcMain.handle('shell:welcome:add', async (_event, input: unknown) => {
  if (typeof input !== 'object' || input === null) return { ok: false as const, message: '参数不合法' }
  const { origin, label } = input as { origin?: unknown, label?: unknown }
  if (typeof origin !== 'string') return { ok: false as const, message: '请输入主机地址' }
  try {
    // 用户可能直接粘贴 `dsh web` 打印的带 token 地址。必须在这里拆出 token：
    // URL.origin 不含 query，交给 addHost 会被静默丢弃，而未装认证插件的
    // 部署只能靠该 token 换取 cookie。
    const parsed = parseHostInput(origin)
    const data = await loadHosts(dataDir)
    const next = addHost(
      data,
      parsed.origin,
      typeof label === 'string' && label !== '' ? label : undefined,
      parsed.launchToken,
    )
    // 必须走 persist：托盘菜单读的是内存镜像 hostsData，
    // 只 saveHosts 的话新主机不会出现在菜单里。
    await persist(next)
    const created = next.hosts.find(h => h.id === next.lastHostId)
    if (created !== undefined) openHost(created)
    // 新增的明文 http 主机不在启动时生效的列表里 → 它不是安全上下文，
    // navigator.clipboard 等特性会静默失效，必须提示用户重启（规格 §5.3）。
    const needsRestart = created !== undefined
      && needsRestartFor(created.origin, startupEffectiveOrigins)
    return { ok: true as const, needsRestart }
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : String(error) }
  }
})

// 编辑窗口的 IPC。同样校验 sender 必须是壳自有的编辑页——远端主机页面
// 是不可信内容，不得读改主机配置。

/**
 * 列出可编辑的主机（供编辑页的主机选择器）。
 *
 * 刻意**只返回 label 与 origin**：令牌（launchToken）是凭据，只在该主机被
 * 选中时由 `shell:edit:load` 单独给出，不做批量下发。
 */
ipcMain.handle('shell:edit:list', event => {
  if (!editWebContentsIds.has(event.sender.id)) return []
  return hostsData.hosts.map(host => ({ id: host.id, label: host.label, origin: host.origin }))
})

/**
 * 读取待编辑主机。
 *
 * @param requestedId - 编辑页选中的主机 id；缺省时用窗口的初始目标
 *   （打开编辑窗口时的那台）。**保存不再依赖这个闭包变量**——见 `shell:edit:save`。
 */
ipcMain.handle('shell:edit:load', (event, requestedId: unknown) => {
  if (!editWebContentsIds.has(event.sender.id)) return null
  const id = typeof requestedId === 'string' && requestedId !== '' ? requestedId : editingHostId
  const host = hostsData.hosts.find(h => h.id === id)
  if (host === undefined) return null
  // 编辑目标跟随界面选择，后续无参 load 与保存后的善后都以它为准。
  editingHostId = host.id
  return {
    id: host.id,
    label: host.label,
    origin: host.origin,
    launchToken: host.launchToken ?? '',
  }
})

ipcMain.handle('shell:edit:save', async (event, input: unknown) => {
  if (!editWebContentsIds.has(event.sender.id)) {
    return { ok: false as const, message: '无权修改主机配置' }
  }
  if (typeof input !== 'object' || input === null) {
    return { ok: false as const, message: '参数不合法' }
  }
  const { id, label, origin, launchToken } = input as Record<string, unknown>
  // id 必填：编辑窗口可以在多台主机间切换，目标必须以**本次提交的负载**为准，
  // 否则「切到 B 编辑，却改了 A」这种错位迟早会发生。
  if (
    typeof id !== 'string' || id === ''
    || typeof label !== 'string' || typeof origin !== 'string' || typeof launchToken !== 'string'
  ) {
    return { ok: false as const, message: '参数不合法' }
  }

  const current = hostsData.hosts.find(h => h.id === id)
  if (current === undefined) return { ok: false as const, message: '该主机已不存在' }

  try {
    const { host: edited, originChanged } = applyHostEdit(
      current,
      { label, origin, launchToken },
      hostIdFromOrigin,
    )

    // 改为与另一台已存在主机相同的地址会导致 id 冲突（partition 也相同），
    // 必须拒绝，否则配置里会出现两条指向同一 partition 的记录。
    const clash = hostsData.hosts.find(h => h.id === edited.id && h.id !== current.id)
    if (clash !== undefined) {
      return { ok: false as const, message: `该地址已被「${clash.label}」使用，请先删除或改用其他地址。` }
    }

    // 「被编辑的那台是否开着窗口」——多窗口下的判据是**它自己**在不在注册表里，
    // 而不是「它是不是当前那台」。用户完全可能编辑一台没开着的主机。
    const editedIsOpenHost = hostWindows.has(current.id)
    await persist(replaceHost(hostsData, current.id, edited))
    // 改地址会重算 id（id 与 partition 名都由 origin 派生），编辑目标必须跟着换，
    // 否则下一次保存会指向一条已经不存在的记录。
    editingHostId = edited.id

    // 「保存后该怎么处理主机窗口」由纯函数判定（有单测）。
    //
    // `hostAfterEditEffect` 的三个输入的**语义不变**，只是 `editedIsOpenHost` 的
    // 算法从「等于 currentHostId」换成了「在注册表里」——判定本身没有被削弱：
    // 它要回答的仍然是「这台主机此刻有没有窗口」，与哪台是「当前」无关。
    const effect = hostAfterEditEffect({
      originChanged,
      editedIsOpenHost,
      hasHostWindow: hasHostWindow(),
    })

    if (effect === 'reopen') {
      // 换地址等于换主机：旧窗口承载的是旧 partition 的会话，必须销毁。
      // 但**紧接着就要打开新地址的窗口**——否则此刻只剩编辑窗口，用户一关它
      // 就一个窗口都不剩，`window-all-closed` 会把客户端退掉（用户报的
      // 「改地址保存后客户端退出」正是这条路径）。
      //
      // 只销毁**被编辑的那台**的窗口（多窗口下其它主机的窗口不该受影响）。
      if (editedIsOpenHost) hostWindows.get(current.id)?.win.destroy()
      // 若被编辑的正是「当前主机」，它的 id 已经变了，焦点落点要跟着换。
      if (lastFocusedHostId === current.id) lastFocusedHostId = edited.id
      openHost(edited)
    } else if (effect === 'reload') {
      // 地址没变 → 让窗口生效。**必须先把最新配置交给窗口**，再重放 token 握手：
      // 窗口持有的是创建时那份快照，不更新它就会拿旧 token 去握手（必然 401，
      // 随后被 401 处理器丢到离线页）——这正是真机上「更新 token 后点『重新加载』
      // 进不去、而『打开』（新建窗口、从配置读）能进」的原因。
      // updateHost 同时会重新武装 token 回放，见 windows.ts。
      //
      // 作用在**被编辑的那台**窗口上（若它开着），而不是「当前窗口」。
      const editedWindow = hostWindows.get(current.id)
      editedWindow?.updateHost(edited)
      editedWindow?.reloadWithToken()
    }

    refreshChrome()
    // 把新的 id 回给编辑页：改地址后 id 变了，它要据此刷新选择器与自身状态。
    return { ok: true as const, id: edited.id }
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.on('shell:edit:close', event => {
  if (!editWebContentsIds.has(event.sender.id)) return
  BrowserWindow.fromWebContents(event.sender)?.close()
})

// 设置窗口的 IPC。与编辑窗口同一道 sender 校验：远端主机页面是本项目明确
// 认定的不可信内容，绝不能让它读写壳的偏好（例如把通知关掉、把更新检查关掉）。

/**
 * 读取当前设置。
 *
 * 返回的是**内存镜像**（`settingsData`）而不是重新读盘：它与设置窗口的保存
 * 走同一条路，因此界面看到的必然是最后一次成功保存的值。
 */
ipcMain.handle('shell:settings:load', event => {
  if (!settingsWebContentsIds.has(event.sender.id)) return settingsData
  return settingsData
})

ipcMain.handle('shell:settings:save', async (event, input: unknown) => {
  if (!settingsWebContentsIds.has(event.sender.id)) {
    return { ok: false as const, message: '无权修改客户端设置' }
  }
  // 界面送来的值按**外部输入**处理：逐字段校验并钳制（normalizeSettings），
  // 而不是信任渲染进程。界面层也钳了一次，但那是为了即时反馈，不是安全边界。
  const next = normalizeSettings(input)
  try {
    await persistSettings(next)
    return { ok: true as const }
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.on('shell:settings:close', event => {
  if (!settingsWebContentsIds.has(event.sender.id)) return
  BrowserWindow.fromWebContents(event.sender)?.close()
})

// 只允许壳自有的欢迎页触发重启。远端主机页面是不可信内容——若不加这道校验，
// 任意远端页面（或其注入的脚本）都能让客户端重启，等于一个拒绝服务入口。
ipcMain.handle('shell:restart', event => {
  if (!welcomeWebContentsIds.has(event.sender.id)) return { ok: false as const }
  app.relaunch()
  app.exit(0)
  return { ok: true as const }
})

// 标记真正退出：窗口 close 拦截据此放行，否则退出会被隐藏逻辑卡死。
// 托盘「退出」与系统退出都会经过这里。
app.on('before-quit', () => { quitting = true })

/**
 * 第二个实例被启动时（用户又点了一次桌面图标）。
 *
 * 光让后来者退出还不够：已经在跑的那个必须**响应**，否则用户双击图标会
 * 「什么都没发生」——那比开出多个窗口更让人困惑（窗口明明在托盘里藏着，
 * 用户却以为程序没启动）。这里复用托盘「打开客户端」的同一个入口
 * （`openClient`：唤起已有窗口 / 按当前主机重开 / 没主机则开欢迎页），
 * 不另造一套语义。
 *
 * 与 `hasSingleInstanceLock` 一样只在拿到锁的实例上注册——注册在第二个实例里
 * 没有意义，它马上就要退出了。
 */
if (hasSingleInstanceLock) {
  app.on('second-instance', () => { openClient() })
}

// boot() 内部已 try/catch，但这里仍补一个 catch：早先版本是裸的
// `whenReady().then(boot)`，boot 里任何未捕获异常都会变成**静默的**
// unhandled rejection——这正是用户真机上「托盘不出现却毫无线索」的原因。
void app.whenReady().then(boot).catch(error => {
  console.error('[dsh-remote-client] 启动失败：', error)
})

app.on('activate', () => {
  // macOS 语义：点 Dock 图标时，若窗口被隐藏则唤起，若都关掉了则重开。
  //
  // 多窗口下优先唤起**最后聚焦的那一台**（用户离开时正在看的那台）；它若已被
  // 关掉或从未打开，就退到任意一个主机窗口。判定复用 `openClient` 的
  // `focusTargetFor` 会太重（那个会开欢迎页、重开主机），而 `activate` 的语义
  // 更窄：**只唤醒已经存在的窗口**，不主动新建（`boot()` 那条分支负责新建）。
  const current = currentHostWindow()
  if (current !== undefined) {
    current.show()
    return
  }
  // 没有「当前主机窗口」但还有别的主机窗口开着 → 唤起其中一台。
  const anyHost = hostWindows.values().next()
  if (anyHost.done !== true && !anyHost.value.win.isDestroyed()) {
    showWindow(anyHost.value.win)
    return
  }
  if (BrowserWindow.getAllWindows().length === 0) {
    void boot().catch(error => {
      console.error('[dsh-remote-client] 重新启动窗口失败：', error)
    })
  }
})

// 主机窗口在非 darwin 平台关窗时只会被隐藏，因此本事件在那条路径上不会触发；
// 真正触发只有两种情况——应用正在退出（quitting，无需再 quit），或窗口被
// 真正销毁（如 macOS 关窗、或主机被删除/切换）。
//
// task-14 起：**托盘可用时常驻不退出**——托盘有「打开客户端」，用户能自己回来；
// 只有托盘也没装配成功时才退出，否则应用会变成一个既看不见也无法退出的幽灵进程。
app.on('window-all-closed', () => {
  const quit = shouldQuitOnAllWindowsClosed({
    trayAvailable: tray !== undefined,
    platform: process.platform,
    quitting,
  })
  if (quit) app.quit()
})
