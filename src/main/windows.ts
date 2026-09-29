import { BrowserWindow, shell, type WebContents } from 'electron'
import { join } from 'node:path'
import { backoffDelay } from './backoff.js'
import { shouldHideOnClose } from './lifecycle.js'
import { reloadTargetFor } from './reload.js'
import {
  contentWindowWebPreferences,
  isSameAddress,
  matchesCloseChord,
  matchesDevToolsChord,
  matchesReloadChord,
  navigationOutcome,
  shouldRemoveWindowMenuBar,
  windowOpenDecision,
  windowTitleFor,
  type KeyChord,
} from './menu-state.js'
import { tokenHandshakeUrl } from '../shared/host-input.js'
import type { HostEntry } from '../shared/types.js'

/**
 * 本模块所在目录。package.json 声明了 `"type": "module"`，electron-vite
 * 因此产出 ESM，`__dirname` 不可用。
 */
const here = import.meta.dirname

/** 离线页与欢迎页路径（electron-vite 会把 renderer 打进 out/renderer）。 */
const OFFLINE_PAGE = join(here, '../renderer/offline.html')
const WELCOME_PAGE = join(here, '../renderer/welcome.html')
const EDIT_PAGE = join(here, '../renderer/edit.html')

/** 与站点无关的窗口默认项：隔离、无 Node、沙箱。 */
const BASE_WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
} as const

/** 主机 preload 的绝对路径（主机窗口与它打开的子窗口共用同一个）。 */
const HOST_PRELOAD = join(here, '../preload/host.cjs')

/**
 * 给某个 webContents 挂上窗口快捷键：`Ctrl/Cmd+R` 重新加载、
 * `Ctrl+Shift+I`（macOS `Cmd+Option+I`）/ `F12` 开关 DevTools，
 * 以及（仅内容窗口）`Ctrl/Cmd+W` 关闭。
 *
 * 主机窗口与「页面自己打开的内容窗口」共用这一份实现：两处行为必须一致，
 * 否则子窗口里按 F12 没反应会显得像 bug。快捷键的匹配逻辑在 `menu-state.ts`
 * 的纯函数里（那里没有 electron 依赖，可被单测覆盖），这里只负责把 Electron
 * 的 `input` 翻译成 `KeyChord` 并执行。
 *
 * @param contents - 目标 webContents。
 * @param onReload - 命中「重新加载」时执行的动作。
 * @param onClose - 命中「关闭窗口」时执行的动作；**只有内容窗口传**，
 *   主机窗口的关窗语义是「隐藏到托盘」，不该被一个浏览器习惯触发。
 */
function installWindowShortcuts(
  contents: WebContents,
  onReload: () => void,
  onClose?: () => void,
): void {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    // 按住不放会连续触发；这两个操作都是重操作，忽略重复事件。
    if (input.isAutoRepeat) return

    const chord: KeyChord = {
      key: input.key,
      control: input.control,
      meta: input.meta,
      alt: input.alt,
      shift: input.shift,
      platform: process.platform,
    }

    if (matchesDevToolsChord(chord)) {
      event.preventDefault()
      // 用 toggle 而非 open：再按一次要能关掉（Chrome 的习惯行为）。
      contents.toggleDevTools()
      return
    }

    if (onClose !== undefined && matchesCloseChord(chord)) {
      event.preventDefault()
      onClose()
      return
    }

    if (matchesReloadChord(chord)) {
      event.preventDefault()
      onReload()
    }
  })
}

/**
 * 给「页面自己打开的内容窗口」补上与主机窗口一致的基础能力。
 *
 * ⚠️ **当前不可达（dead code，有意保留）**
 * 自 task-18 起，`installWindowOpenPolicy` 对 `window.open` **一律 `deny`**：
 * 指向已知主机/当前站点的链接在**当前窗口**内导航，其余交给系统浏览器。既然
 * 从不返回 `allow`，Electron 就不会再为我们的 webContents 创建窗口，
 * `did-create-window` 也就不会触发——下面这段因此没有调用者。
 *
 * 保留的理由（而不是删掉）：
 * - 用户在「新窗口 / 替换原窗口」这条策略上已经改过一次主意（task-15 → task-18），
 *   将来若再改回「新窗口打开」，子窗口的标题、菜单栏、快捷键、递归接管都已就位，
 *   不会重演 task-17 里「子窗口带菜单栏 / 标题缺前缀」那两个缺陷；
 * - 保留成本只是这段代码本身，没有运行时开销。
 * 代价是它现在处于不可达状态——**如实标注在此，避免读者误以为它还在生效**。
 *
 * 与主机窗口有三点**刻意的不同**：
 * - **不挂 `close` 拦截**：它是内容窗口，关掉就该关掉，不驻留托盘（那套
 *   「关窗后仍能被唤起」的语义只属于主机窗口）；
 * - **不进 `currentWindow` / `currentHostId`**：那套「同一时刻只有一台主机窗口」
 *   的模型只属于主机窗口，把子窗口塞进去会让重试、离线页、菜单项全部指错对象；
 * - **不要菜单栏**：菜单项全部作用于主机窗口，在内容窗口上点它们会去操作
 *   另一个窗口（见下方 `removeMenu()` 处的说明）。
 *
 * 子窗口里再开窗口（孙窗口）同样会被接管：不这样，第二层弹窗又会丢掉登录态、
 * 又会长出菜单栏。
 *
 * @param child - 新建的内容窗口。
 * @param getHost - **取当前主机配置**的函数（不是值）。用取值函数而非快照，
 *   是为了让子窗口的标题前缀始终跟随主机配置的最新值（主机被重命名后仍显示旧
 *   名字，与 task-16 修掉的那类快照缺陷同源）。
 * @param getKnownHostOrigins - 取「已配置主机 origin 列表」的函数，透传给孙窗口的
 *   链接策略（见 `installWindowOpenPolicy`）。
 */
function installContentWindowBehavior(
  child: BrowserWindow,
  getHost: () => HostEntry,
  getKnownHostOrigins: () => readonly string[],
): void {
  // 菜单栏只该长在主机窗口上：菜单项（打开/重新加载/立即重试/重置登录态/删除…）
  // 全部作用于 `currentWindow` / `currentHostId`。内容窗口若继承菜单栏，用户在
  // 这里点「重新加载」，被重载的却是**另一个窗口**——操作与所见不符。
  // macOS 上菜单栏是应用级的，`removeMenu()` 无效（见 shouldRemoveWindowMenuBar）。
  if (shouldRemoveWindowMenuBar(process.platform)) child.removeMenu()

  // 初始标题：此刻页面标题还没解析出来（`getTitle()` 只会给出占位值），
  // 所以先用主机名兜底，随后由 page-title-updated 补成「主机名 — 页面标题」。
  child.setTitle(windowTitleFor(getHost().label, ''))

  child.on('page-title-updated', (event, title) => {
    // **必须 preventDefault**：Electron 的默认行为是在本事件之后把原生标题设成
    // 文档标题（官方类型定义：「calling event.preventDefault() will prevent the
    // native window's title from changing」），那会把我们刚拼好的
    // 「主机名 — 页面标题」立刻覆盖成裸的页面标题——用户截图里子窗口标题只剩
    // `DeepSeek Harness` 正是这个原因（不只是事件时序）。
    event.preventDefault()
    child.setTitle(windowTitleFor(getHost().label, title))
  })

  // 兜底：子窗口由 Electron 代为创建，`page-title-updated` 有可能在本监听挂上
  // **之前**就已触发。页面加载完成后再用真实的文档标题拼一次，任何时序下都对。
  child.webContents.on('did-finish-load', () => {
    if (child.isDestroyed()) return
    child.setTitle(windowTitleFor(getHost().label, child.webContents.getTitle()))
  })

  // 子窗口的「重新加载」是**普通重载**，而不是主机窗口的「重新请求 host.origin」：
  // 子窗口里显示的往往已是别的站点（门户、文档），把它换回 dsh 不是用户要的。
  // `Ctrl+W` 关闭是浏览器的通行习惯，只在这里（内容窗口）提供。
  installWindowShortcuts(
    child.webContents,
    () => {
      if (!child.isDestroyed()) child.webContents.reload()
    },
    () => {
      if (!child.isDestroyed()) child.close()
    },
  )

  // 递归接管：孙窗口同样共享 partition 与 preload、同样不接管菜单栏。
  installWindowOpenPolicy(child.webContents, getKnownHostOrigins)
  child.webContents.on('did-create-window', grandchild => {
    installContentWindowBehavior(grandchild, getHost, getKnownHostOrigins)
  })
}

/**
 * 给一个 webContents 装上「新窗口」策略。
 *
 * 一律 `deny`，然后由我们自己做该做的事：
 * - 目标是**已知主机**或**当前站点** → 在当前窗口 `loadURL`，即用户要的
 *   「替换原窗口」（门户桌面上的 dsh 图标正是这种情况）；
 * - 其余（真外链、`mailto:`、自定义 scheme）→ 交给系统浏览器。
 *
 * 为什么用 `deny` 而不是 `allow`：`allow` 只会让 Electron 另开一个窗口，做不到
 * 「替换当前窗口」；而且 task-15 那套「子窗口继承 partition」的复杂度（重挂标题、
 * 菜单栏、快捷键、递归接管）也就随之而来。
 *
 * **`deny` 的代价（已逐条评估）**：`window.open()` 会返回 `null`。
 * - 页面若写成 `const w = window.open(url); if (!w) location.href = url`，那么除
 *   我们的 `loadURL` 之外，页面还会自己再导航一次——**两次导航指向同一个地址**。
 *   后果：Chromium 用后发起的那次取代前一次，最终**只加载一次**、落在正确地址上；
 *   被取代的那次以 `ERR_ABORTED` 结束，`loadURL` 的 Promise 因此会**拒绝**
 *   （所以下面必须 `.catch()`，否则是未处理的 rejection），而 `did-fail-load`
 *   那边早已忽略错误码 -3，不会误判成离线页；页面的降级是**顶层导航**，不会再
 *   进入本处理器——**不存在导航循环**。净代价只是一次可能被中止的幂等 GET。
 * - 页面若紧接着使用返回值（如 `w.focus()`），会抛 TypeError。这是 `deny` 无法
 *   避免的代价——Electron 没有「不开窗口但仍返回 WindowProxy」的接口；影响面仅
 *   限于该页面自身的一个 JS 报错，而窗口的导航已经由我们完成。
 * 两条都不足以推翻「必须替换当前窗口」这个用户要求，故采用 `deny`。
 *
 * 刻意**不做**「延迟一拍再导航」之类的规避：那会让最终生效的变成**页面**自己那次
 * 导航，时序反而更难预测；立即导航的结果是确定的。
 *
 * 主机窗口与（当前不可达的）内容窗口共用这一份实现，避免两处策略漂移。
 *
 * @param contents - 目标 webContents。
 * @param getKnownHostOrigins - 取「已配置主机 origin 列表」的函数（主进程注入）。
 */
function installWindowOpenPolicy(
  contents: WebContents,
  getKnownHostOrigins: () => readonly string[],
): void {
  contents.setWindowOpenHandler(({ url }) => {
    const decision = windowOpenDecision({
      url,
      // **实时**取当前页面的 origin：窗口导航到门户之后，当前页已经不是创建时
      // 那台主机的地址了，用 `host.origin` 会把站点内跳转全判成外链。
      currentOrigin: currentOriginOf(contents),
      knownHostOrigins: getKnownHostOrigins(),
    })

    if (decision === 'navigate-self') {
      // 已经在目标地址上就不必再载一次：页面把当前地址当新窗口打开时，
      // 重载纯属浪费，而 dsh 是 SPA，重载会丢掉当前会话的界面状态。
      if (!isSameAddress(contents.getURL(), url)) {
        // `.catch` 是必需的，不是保险：这次导航可能被页面自己紧接着发起的导航
        // 取代（见上面 `deny` 代价里的降级写法），此时 Promise 以 ERR_ABORTED
        // 拒绝——那不是错误，只是「页面自己已经导航过去了」。
        void contents.loadURL(url).catch(() => undefined)
      }
      return { action: 'deny' }
    }

    // 真外链与 mailto:/tel:/自定义 scheme：交给系统。
    void shell.openExternal(url).catch(() => undefined)
    return { action: 'deny' }
  })
}

/**
 * 取某个 webContents **当前**页面所在 origin（已规范化）。
 *
 * 取不到时返回空串，由 `windowOpenDecision` 判定第 4 条不参与——还没提交任何导航、
 * 或者当前是壳自有的 `file://` 页面（离线页）时都属于这种情况。
 *
 * @param contents - 目标 webContents。
 * @returns 规范化后的 origin；取不到时为空串。
 */
function currentOriginOf(contents: WebContents): string {
  const url = contents.getURL()
  if (url === '') return ''
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

/** 主机窗口句柄，供主进程控制重试与状态查询。 */
export interface HostWindowHandle {
  /** 底层窗口。 */
  win: BrowserWindow
  /** 是否处于离线重试中。 */
  isOffline: () => boolean
  /** 立即重试（供「网络恢复」或托盘手动触发）。 */
  retryNow: () => void
  /** 重新加载 host.origin（供托盘「重新加载」与 Ctrl+R）。 */
  reload: () => void
  /**
   * 用当前的（可能刚更新的）token 重新发起握手并加载。
   *
   * 与 `reload` 的区别：`reload` 加载干净 origin（假设 cookie 已在），
   * 而本方法会重放 token 握手——编辑主机保存后 token 可能刚被更换，
   * 必须重放才能拿到新的 cookie。
   */
  reloadWithToken: () => void
  /**
   * 交入该主机**最新**的配置（令牌/显示名/地址可能刚被编辑窗口改过）。
   *
   * 必须由主进程在配置变化后调用：窗口内部读的是自己持有的那份配置，
   * 不更新它就会一直用创建时的快照——用户更新 token 后点「重新加载」仍带着
   * 旧 token 去握手，必然 401（这正是真机上「更新 token 后重新加载进不去、
   * 而『打开』能进」的原因）。
   */
  updateHost: (next: HostEntry) => void
  /** 显示并聚焦窗口（供托盘「打开」在窗口被隐藏时唤起）。 */
  show: () => void
}

/**
 * 为某主机创建直载窗口。窗口不做任何请求代理，页面资源全部来自远端，
 * 因此客户端插件与 Host 永远同版。
 *
 * 网络失败时进入指数退避重试（规格 §8），期间显示离线页并把倒计时写进标题。
 *
 * @param initialHost - 初始主机配置。**只是初始值**：之后可用句柄的
 *   `updateHost()` 更新（窗口内部持有可变状态，不会停在创建时的快照）。
 * @param getKnownHostOrigins - 取「已配置主机 origin 列表」的函数，用于判定页面
 *   里的链接该不该在**本窗口**打开（见 `windowOpenDecision`）。**由主进程注入**：
 *   主机配置存在 `index.ts` 的 `hostsData` 里，`windows.ts` 不该反向依赖它。
 *   传函数而不是数组快照，是因为窗口存活期间主机可能被增删改。
 *   刻意放在必填位置（无默认值）：漏注入不会报错，只会静默地把所有跨站链接
 *   判成外链——那正是用户抱怨的症状之一，宁可让类型检查逼调用方显式给出。
 * @param onTitle - 页面标题变化回调，供窗口标题与托盘显示当前会话。
 * @param onOfflineChange - 离线状态变化回调，供托盘更新提示。
 * @param isQuitting - 应用是否正在真正退出；退出时放行 close，其余情况隐藏。
 * @returns 窗口句柄，调用方据此控制重试与查询状态。
 */
export function createHostWindow(
  initialHost: HostEntry,
  getKnownHostOrigins: () => readonly string[],
  onTitle: (title: string) => void,
  onOfflineChange: (offline: boolean) => void = () => undefined,
  isQuitting: () => boolean = () => false,
): HostWindowHandle {
  // 主机配置是**可变状态**，不是闭包里的快照。下面所有 `host.*` 读取的都是
  // 这个变量，因此 `updateHost()` 之后立即生效。
  let host = initialHost

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: host.label,
    // 与子窗口**同一个函数**产出（见 menu-state.ts 的 contentWindowWebPreferences），
    // 保证两者 partition 与沙箱开关永远一致。
    webPreferences: contentWindowWebPreferences({ origin: host.origin, preload: HOST_PRELOAD }),
  })

  win.on('page-title-updated', (event, title) => {
    // **必须 preventDefault**：Electron 会在这个事件之后把原生标题设成文档
    // 标题，不拦住的话，下面 onTitle 里拼好的「主机名 — 会话名」会被覆盖回
    // 裸的页面标题（用户真机截图里窗口标题只有 DXP4800-16DE、没有主机名前缀，
    // 就是这个原因）。子窗口那边同样是这么处理的。
    //
    // 这里不需要 `did-finish-load` 兜底：本监听是在 `loadURL` 之前挂上的，
    // 不存在「事件先于监听触发」的时序问题（子窗口由 Electron 代管，才有）。
    event.preventDefault()
    onTitle(title)
  })

  // Windows/Linux 上拦截关窗并改为隐藏，使托盘与其管理入口继续存活——
  // 用户在能力选择里勾的「关窗后仍能被唤起」依赖这一点。应用真正退出时
  // 放行，避免卡住退出流程；darwin 保持既有语义（见 lifecycle.ts）。
  win.on('close', event => {
    if (!shouldHideOnClose({ kind: 'host', platform: process.platform, quitting: isQuitting() })) return
    event.preventDefault()
    win.hide()
  })

  // 页面自己发起的 `window.open()` / `<a target="_blank">`。
  //
  // 策略（task-18 起）：**指向已知主机或当前站点的链接在本窗口内导航**（用户要的
  // 「替换原窗口」，门户桌面上的 dsh 图标正是这种），**其余交给系统浏览器**
  // （GitHub 之类真外链不该困在客户端里）。
  //
  // 历史（三次策略变更，都源于真机反馈）：
  // 1. 阶段 1：一律 `deny` + `openExternal` —— 后果是**页面里每个链接都被扔出
  //    应用**，用户根本点不开门户里的 dsh 图标；
  // 2. task-15：改成一律 `allow` 并让子窗口继承 partition —— 能开了，但开成了
  //    **新窗口**，且外链也被留在客户端里；
  // 3. task-18（当前）：按「是不是我们认识的地址」分流，内部链接替换当前窗口。
  installWindowOpenPolicy(win.webContents, getKnownHostOrigins)

  // ⚠️ 当前不可达：上面的策略一律返回 `deny`，Electron 不会再替我们创建窗口，
  // 因此这个事件不会触发（详见 `installContentWindowBehavior` 的说明）。
  // 保留是为了「将来改回新窗口策略」时行为已就位。
  //
  // 传取值函数而不是当前的 host 值：子窗口存活期间主机可能被重命名。
  win.webContents.on('did-create-window', child => {
    installContentWindowBehavior(child, () => host, getKnownHostOrigins)
  })

  let attempt = 0
  let timer: NodeJS.Timeout | undefined
  let ticker: NodeJS.Timeout | undefined
  let offline = false
  let disposed = false
  /** 最近一次失败的描述，用于窗口被重新唤起时恢复重试。 */
  let lastFailureDetail = ''

  /** 停止待执行的重试与倒计时，避免窗口销毁后仍有幽灵请求或标题残留。 */
  const stopTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    if (ticker !== undefined) {
      clearInterval(ticker)
      ticker = undefined
    }
  }

  const setOffline = (next: boolean): void => {
    if (offline === next) return
    offline = next
    onOfflineChange(next)
  }

  /**
   * 安排下一次重试，并把倒计时写进标题。
   *
   * 窗口处于隐藏态（用户关窗后驻留托盘）时不安排重试：隐藏 ≠ 关闭，
   * 否则一个被收进托盘、目标又不可达的窗口会永远在后台空转。
   * 重新 show 时由下方 show 事件恢复重试。
   */
  const scheduleRetry = (detail: string): void => {
    if (disposed || win.isDestroyed()) return
    lastFailureDetail = detail
    if (!win.isVisible()) {
      // 仍显示离线页让用户唤起时能看到原因，但不启动定时器。
      void win.loadFile(OFFLINE_PAGE, { query: { detail } })
      win.setTitle(`${host.label} — 离线`)
      return
    }
    // 上一次重试的倒计时必须先停，否则每失败一轮就多一个永不停止的
    // interval 在改写标题（子串匹配的旧值残留）。
    stopTimer()
    const delay = backoffDelay(attempt)
    attempt += 1

    void win.loadFile(OFFLINE_PAGE, { query: { detail } })

    let remaining = Math.ceil(delay / 1000)
    win.setTitle(`${host.label} — 离线，${String(remaining)} 秒后重试`)
    ticker = setInterval(() => {
      remaining -= 1
      if (remaining > 0 && !disposed && !win.isDestroyed()) {
        win.setTitle(`${host.label} — 离线，${String(remaining)} 秒后重试`)
      }
    }, 1000)

    timer = setTimeout(() => {
      stopTimer()
      if (disposed || win.isDestroyed()) return
      void win.loadURL(host.origin)
    }, delay)
  }

  // 重新唤起时，若仍处于离线态则恢复重试（隐藏期间被暂停了）。
  win.on('show', () => {
    if (disposed || !offline || timer !== undefined) return
    scheduleRetry(lastFailureDetail)
  })

  // 连不上时切到离线页并进入退避重试，而不是让 Chromium 显示自己的错误页。
  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return
    if (errorCode === -3) return  // -3 是主动中止（含我们自己切离线页），忽略
    setOffline(true)
    scheduleRetry(`${errorDescription}（${validatedURL}）`)
  })

  // 加载成功即视为恢复：重置退避，取消待执行的重试。
  win.webContents.on('did-finish-load', () => {
    stopTimer()
    attempt = 0
    setOffline(false)
  })

  /**
   * token 失效检测：dsh 鉴权失败时返回 401 + 一段提示文本
   * （`writeUnauthorized`），对 Electron 而言这是一次**成功**的导航，
   * 因此 `did-fail-load` 不会触发、页面会停在纯文本错误上。
   *
   * 「这次导航该做什么」由纯函数 `navigationOutcome()` 判定（在 menu-state.ts，
   * 有单测）：只在「配置了 token 且**这一份** token 尚未回放过」时补一次带 token
   * 的握手，用来覆盖 dsh 重启导致 token 轮换、但用户手动更新前的灰色窗口期。
   * 若回放后仍 401，就不再重试，交由离线页提示用户重新添加主机——
   * 无限回放既是无效流量，也会掩盖真正的问题。
   *
   * 注意这里读的是**可变的 `host`**（不是创建时的快照）：token 被更新后，
   * 回放用的必须是新值，否则会拿着旧 token 再撞一次 401。
   */
  let handshakeReplayed = false
  win.webContents.on('did-navigate', (_event, _url, httpResponseCode) => {
    const token = host.launchToken
    const outcome = navigationOutcome({
      statusCode: httpResponseCode,
      hasLaunchToken: token !== undefined,
      alreadyReplayed: handshakeReplayed,
    })
    if (outcome === 'ignore') return

    if (outcome === 'replay-token' && token !== undefined) {
      handshakeReplayed = true
      void win.loadURL(tokenHandshakeUrl(host.origin, token))
      return
    }

    void win.loadFile(OFFLINE_PAGE, {
      query: {
        detail: 'dsh 要求认证（401）。若该部署使用 launch token，'
          + '请到「文件 → 添加主机…」重新粘贴 dsh web 打印的带 token 地址以更新令牌。',
      },
    })
  })

  const retryNow = (): void => {
    stopTimer()
    attempt = 0
    void win.loadURL(host.origin)
  }

  /**
   * 重新加载主机：丢弃当前页面并重新请求 `host.origin`。
   *
   * 必须加载 host.origin 而非当前 URL——SSO 门户地址（如 UGOS 容器远程地址）
   * 第一跳会 302 到门户登录页，登录完成后门户不提供 return-URL 回跳，页面会
   * 停在门户桌面。此时 `webContents.reload()` 只会再加载门户桌面，只有重新
   * 请求原始 origin 才能带着已获得的登录态进到 dsh。
   */
  const reload = (): void => {
    if (win.isDestroyed()) return
    // 隐藏态下先唤起：用户在托盘点「重新加载」时应当看到结果，而不是
    // 让页面在一个看不见的窗口里悄悄切换。
    if (!win.isVisible()) win.show()
    // 目标由纯函数决定并断言其与当前 URL 无关（见 reload.ts）。
    void win.loadURL(reloadTargetFor(host.origin, win.webContents.getURL()))
    stopTimer()
    attempt = 0
    setOffline(false)
  }

  /**
   * 窗口级快捷键：重新加载（Ctrl/Cmd+R）与 DevTools（Ctrl+Shift+I、
   * macOS 的 Cmd+Option+I、以及 F12）。
   *
   * 主机窗口与它打开的内容窗口都挂（后者见 `installContentWindowBehavior`）；
   * 欢迎页/编辑页是壳自有页面，不需要 DevTools 与「重新请求 host.origin」。
   *
   * 这里重载走 `reload()`（重新请求 `host.origin`），而不是普通 `webContents.reload()`
   * ——原因见上面 `reload` 的说明。
   */
  installWindowShortcuts(win.webContents, reload)

  win.on('closed', () => {
    disposed = true
    stopTimer()
  })

  // 首次加载：若配置了 launch token，必须先访问带 token 的 URL 换取
  // authority 绑定的签名 cookie（未装认证插件的 dsh 部署**只能**这样接入）。
  //
  // 之后的 reload/重试一律加载**干净的 origin**：cookie 已在 partition 里，带 token
  // 反而不安全——当 cookie 仍有效而 token 已失效时，dsh 见到 token 参数但校验不过
  // 会直接 401，**不会回退去看 cookie**。所以正确链路是「干净 origin → 命中 cookie
  // 就成功；真的 401 时，再由 did-navigate 用**当前**token 回放一次握手」。
  void win.loadURL(
    host.launchToken !== undefined
      ? tokenHandshakeUrl(host.origin, host.launchToken)
      : reloadTargetFor(host.origin, undefined),
  )
  return {
    win,
    isOffline: () => offline,
    retryNow,
    reload,
    // 用（可能刚更新的）token 重新发起握手。编辑主机保存后调用：
    // token 可能刚被更换，此时必须重放握手才能换取新的 cookie。
    reloadWithToken: () => {
      if (win.isDestroyed()) return
      const url = host.launchToken !== undefined
        ? tokenHandshakeUrl(host.origin, host.launchToken)
        : reloadTargetFor(host.origin, win.webContents.getURL())
      void win.loadURL(url)
      stopTimer()
      attempt = 0
      setOffline(false)
    },
    /**
     * 交入最新配置，并**重新武装 token 回放**。
     *
     * `handshakeReplayed` 的语义是「**当前这份 token** 已经回放过一次」。它必须
     * 在这里归零：配置被更新往往正是因为令牌换了（旧的回放早已发生并被置位），
     * 若不在此时重新武装，窗口将**永远不再回放**——用户更新 token 后点「重新
     * 加载」仍会 401，然后被 401 处理器直接丢到离线页，症状与缺陷本身一模一样。
     *
     * 地址变更不走这里（`shell:edit:save` 在 origin 变化时销毁并重建窗口）。
     */
    updateHost: (next: HostEntry): void => {
      host = next
      handshakeReplayed = false
    },
    // 窗口可能处于隐藏态（用户关窗后驻留），唤起时必须先 show 再 focus。
    show: () => {
      if (win.isDestroyed()) return
      win.show()
      win.focus()
    },
  }
}

/**
 * 创建离线覆盖窗口，用于启动时无法打开目标主机的情况。
 *
 * @param title - 窗口标题。
 * @param reason - 展示给用户的失败原因。
 * @returns 已开始加载的窗口。
 */
export function createOfflineWindow(title: string, reason: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 720,
    height: 480,
    title,
    webPreferences: { ...BASE_WEB_PREFERENCES },
  })
  // 用 loadFile 而非手工拼 `file://`：后者在 Windows 上得到
  // `file://C:\...` 这种无效 URL。query 交给 Electron 编码。
  void win.loadFile(OFFLINE_PAGE, { query: { detail: reason } })
  return win
}

/**
 * 创建「添加主机」欢迎窗口。
 *
 * 移除窗口菜单栏：这张表上唯一还有意义的项是「添加主机…」，而它打开的正是本窗口
 * 的另一个副本（`openWelcomeWindow` 不做去重）；其余菜单项都作用于主机窗口，
 * 在这里点它们同样属于「操作与所见不符」。规则统一为**菜单栏只长在主机窗口上**。
 *
 * @returns 已开始加载的窗口。
 */
export function createWelcomeWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 560,
    height: 420,
    title: '添加 dsh 主机',
    webPreferences: {
      ...BASE_WEB_PREFERENCES,
      preload: join(here, '../preload/welcome.cjs'),
    },
  })
  if (shouldRemoveWindowMenuBar(process.platform)) win.removeMenu()
  void win.loadFile(WELCOME_PAGE)
  return win
}

/**
 * 创建「编辑主机」窗口。
 *
 * 窗口自身不承载主机数据——渲染进程通过 `shell:edit:load` 从主进程读取，
 * 主进程用「当前被编辑的主机 id」而非 URL 参数来定位对象，避免把令牌
 * 之类敏感值写进 URL（URL 会留在历史与日志里）。
 *
 * 移除窗口菜单栏：菜单里的「删除主机…」作用于**当前主机**，而本窗口正在编辑的
 * 可能是**另一台**（task-14 起窗口内可切换编辑对象）——菜单栏留在这里会让人
 * 在编辑 B 的时候删掉 A。编辑对象请用窗口内的主机选择器。
 *
 * @returns 已开始加载的窗口。
 */
export function createEditWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 560,
    height: 620,
    title: '编辑主机',
    parent: undefined,
    webPreferences: {
      ...BASE_WEB_PREFERENCES,
      preload: join(here, '../preload/edit.cjs'),
    },
  })
  if (shouldRemoveWindowMenuBar(process.platform)) win.removeMenu()
  void win.loadFile(EDIT_PAGE)
  return win
}
