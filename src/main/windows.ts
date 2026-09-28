import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { partitionNameFor } from './partitions.js'
import { backoffDelay } from './backoff.js'
import { shouldHideOnClose } from './lifecycle.js'
import { reloadTargetFor } from './reload.js'
import type { HostEntry } from '../shared/types.js'

/**
 * 本模块所在目录。package.json 声明了 `"type": "module"`，electron-vite
 * 因此产出 ESM，`__dirname` 不可用。
 */
const here = import.meta.dirname

/** 离线页与欢迎页路径（electron-vite 会把 renderer 打进 out/renderer）。 */
const OFFLINE_PAGE = join(here, '../renderer/offline.html')
const WELCOME_PAGE = join(here, '../renderer/welcome.html')

/** 与站点无关的窗口默认项：隔离、无 Node、沙箱。 */
const BASE_WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
} as const

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
  /** 显示并聚焦窗口（供托盘「打开」在窗口被隐藏时唤起）。 */
  show: () => void
}

/**
 * 为某主机创建直载窗口。窗口不做任何请求代理，页面资源全部来自远端，
 * 因此客户端插件与 Host 永远同版。
 *
 * 网络失败时进入指数退避重试（规格 §8），期间显示离线页并把倒计时写进标题。
 *
 * @param host - 目标主机。
 * @param onTitle - 页面标题变化回调，供窗口标题与托盘显示当前会话。
 * @param onOfflineChange - 离线状态变化回调，供托盘更新提示。
 * @param isQuitting - 应用是否正在真正退出；退出时放行 close，其余情况隐藏。
 * @returns 窗口句柄，调用方据此控制重试与查询状态。
 */
export function createHostWindow(
  host: HostEntry,
  onTitle: (title: string) => void,
  onOfflineChange: (offline: boolean) => void = () => undefined,
  isQuitting: () => boolean = () => false,
): HostWindowHandle {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: host.label,
    webPreferences: {
      ...BASE_WEB_PREFERENCES,
      partition: partitionNameFor(host.origin),
      preload: join(here, '../preload/host.cjs'),
    },
  })

  win.on('page-title-updated', (_event, title) => { onTitle(title) })

  // Windows/Linux 上拦截关窗并改为隐藏，使托盘与其管理入口继续存活——
  // 用户在能力选择里勾的「关窗后仍能被唤起」依赖这一点。应用真正退出时
  // 放行，避免卡住退出流程；darwin 保持既有语义（见 lifecycle.ts）。
  win.on('close', event => {
    if (!shouldHideOnClose({ kind: 'host', platform: process.platform, quitting: isQuitting() })) return
    event.preventDefault()
    win.hide()
  })

  // 外部链接交给系统浏览器，绝不在壳内开新窗口。
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
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

  // Ctrl+R / Cmd+R 重新加载。Electron 默认不启用该快捷键，需显式注册；
  // 只挂在主机窗口上，欢迎页等壳自有窗口不受影响。
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    // 按住不放会连续触发；重新加载本就是重操作，忽略重复事件。
    if (input.isAutoRepeat) return
    if (input.key.toLowerCase() !== 'r') return
    const acceleratorPressed = process.platform === 'darwin' ? input.meta : input.control
    if (!acceleratorPressed) return
    // 不拦截 Shift+Ctrl+R（强制重载语义不同）与 Alt 组合，避免意外吞键。
    if (input.shift || input.alt) return
    event.preventDefault()
    reload()
  })

  win.on('closed', () => {
    disposed = true
    stopTimer()
  })

  void win.loadURL(host.origin)
  return {
    win,
    isOffline: () => offline,
    retryNow,
    reload,
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
  void win.loadFile(WELCOME_PAGE)
  return win
}
