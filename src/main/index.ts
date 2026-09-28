import { app, BrowserWindow, ipcMain } from 'electron'
import { addHost, loadHosts, loadHostsSync, resolveStartupHost, saveHosts, touchHost } from './hosts.js'
import { createHostWindow, createOfflineWindow, createWelcomeWindow, type HostWindowHandle } from './windows.js'
import { createTray, type TrayDeps } from './tray.js'
import { installAppMenu, type AppMenuHandle } from './menu.js'
import { needsRestartFor } from './restart.js'
import { insecureOriginsSwitchValue } from '../shared/origin.js'
import { parseHostInput } from '../shared/host-input.js'
import type { HostEntry, HostsFile } from '../shared/types.js'

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

/** 当前打开的主机窗口；切换主机时关闭旧的，避免并存两份 WebSocket。 */
let currentWindow: HostWindowHandle | undefined

/** 内存中的配置镜像，托盘与窗口共用；写盘后同步更新。 */
let hostsData: HostsFile = { version: 1, hosts: [] }
let currentHostId: string | undefined
let tray: Electron.Tray | undefined

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

/**
 * 同时重建托盘菜单与应用菜单。
 *
 * 主机增删/切换后必须两条通道都刷新，否则菜单栏会显示过期的主机列表。
 */
function refreshMenus(): void {
  ;(tray as unknown as { rebuildMenu?: () => void } | undefined)?.rebuildMenu?.()
  appMenu?.rebuild()
}

/**
 * 应用是否正在真正退出。由 `before-quit` 置位，供窗口 `close` 判定放行——
 * 否则非 darwin 平台的关窗拦截会把退出流程卡死。
 */
let quitting = false

/**
 * 打开一台主机。若该主机窗口已存在（可能被隐藏），直接唤起而不重建，
 * 避免同一 origin 并存两份 WebSocket；切换主机时才销毁旧窗口。
 *
 * @param host - 目标主机。
 */
function openHost(host: HostEntry): void {
  if (currentWindow !== undefined && currentHostId === host.id && !currentWindow.win.isDestroyed()) {
    currentWindow.show()
    return
  }
  // destroy() 不触发 close 事件，因此这里的销毁不会被隐藏拦截挡住。
  currentWindow?.win.destroy()
  currentHostId = host.id
  currentWindow = createHostWindow(
    host,
    title => {
      // 离线期间标题由重试倒计时接管，不让页面标题覆盖掉状态提示。
      if (title !== '' && currentWindow?.isOffline() === false) {
        currentWindow?.win.setTitle(`${host.label} — ${title}`)
      }
    },
    () => { refreshMenus() },
    () => quitting,
  )
  currentWindow.win.on('closed', () => { currentWindow = undefined })
}

/**
 * 更新内存配置并落盘。
 *
 * @param next - 新配置。
 */
async function persist(next: HostsFile): Promise<void> {
  hostsData = next
  await saveHosts(dataDir, next)
  refreshMenus()
}

/** 装配托盘；只装配一次。失败被捕获并记录，绝不因此中断启动。 */
function installTray(): void {
  if (tray !== undefined) return
  try {
    const deps: TrayDeps = {
      getData: () => hostsData,
      setData: next => { void persist(next) },
      getCurrentId: () => currentHostId,
      openHost: host => { void persist(touchHost(hostsData, host.id)); openHost(host) },
      onAddHost: () => { openWelcomeWindow() },
      isOffline: () => currentWindow?.isOffline() ?? false,
      onRetryNow: () => { currentWindow?.retryNow() },
      onReload: () => { currentWindow?.reload() },
      onQuit: () => { app.quit() },
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
      getCurrentId: () => currentHostId,
      openHost: host => { void persist(touchHost(hostsData, host.id)); openHost(host) },
      onAddHost: () => { openWelcomeWindow() },
      onReload: () => { currentWindow?.reload() },
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
  // 先装配入口，再做任何可能失败的事（读/写配置、开窗），并整体兜底。
  installShellChrome()

  try {
    const data = await loadHosts(dataDir)
    const host = resolveStartupHost(data)

    if (host === undefined) {
      // 无主机：打开欢迎页让用户添加第一台。
      hostsData = data
      refreshMenus()
      openWelcomeWindow()
      return
    }

    hostsData = data
    currentHostId = host.id
    await saveHosts(dataDir, touchHost(data, host.id))
    openHost(host)
    refreshMenus()
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
  }
}

// 标题走 windows.ts 的 page-title-updated 原生事件这一条路径；
// 早期版本的 shell:title IPC 与它互相覆盖，且由 MutationObserver 高频触发，
// 已删除，这里不再注册对应 handler。

ipcMain.on('shell:network', (_event, online: unknown) => {
  // 网络恢复时立刻重试一次，不必等退避耗尽；离线事件交给 did-fail-load 处理。
  if (online === true) currentWindow?.retryNow()
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

// boot() 内部已 try/catch，但这里仍补一个 catch：早先版本是裸的
// `whenReady().then(boot)`，boot 里任何未捕获异常都会变成**静默的**
// unhandled rejection——这正是用户真机上「托盘不出现却毫无线索」的原因。
void app.whenReady().then(boot).catch(error => {
  console.error('[dsh-remote-client] 启动失败：', error)
})

app.on('activate', () => {
  // macOS 语义：点 Dock 图标时，若窗口被隐藏则唤起，若都关掉了则重开。
  if (currentWindow !== undefined && !currentWindow.win.isDestroyed()) {
    currentWindow.show()
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
// 真正销毁（如 macOS 关窗、或主机被删除/切换）。保留 quit 以维持
// 「关掉 macOS 最后一个窗口后应用退出」以外的既有语义不变。
app.on('window-all-closed', () => {
  if (quitting) return
  if (process.platform !== 'darwin') app.quit()
})
