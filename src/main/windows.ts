import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { partitionNameFor } from './partitions.js'
import { backoffDelay } from './backoff.js'
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
 * @returns 窗口句柄，调用方据此控制重试与查询状态。
 */
export function createHostWindow(
  host: HostEntry,
  onTitle: (title: string) => void,
  onOfflineChange: (offline: boolean) => void = () => undefined,
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

  /** 安排下一次重试，并把倒计时写进标题。 */
  const scheduleRetry = (detail: string): void => {
    if (disposed || win.isDestroyed()) return
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

  win.on('closed', () => {
    disposed = true
    stopTimer()
  })

  void win.loadURL(host.origin)
  return { win, isOffline: () => offline, retryNow }
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
