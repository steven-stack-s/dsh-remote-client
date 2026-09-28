import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { partitionNameFor } from './partitions.js'
import type { HostEntry } from '../shared/types.js'

/**
 * 本模块所在目录。package.json 声明了 `"type": "module"`，electron-vite
 * 因此产出 ESM，`__dirname` 不可用。
 */
const here = import.meta.dirname

/** 离线页路径（electron-vite 会把 renderer 打进 out/renderer）。 */
function offlinePageUrl(detail: string): string {
  const page = join(here, '../renderer/offline.html')
  return `file://${page}?detail=${encodeURIComponent(detail)}`
}

/** 欢迎页 URL。 */
function welcomePageUrl(): string {
  return `file://${join(here, '../renderer/welcome.html')}`
}

/** 与站点无关的窗口默认项：隔离、无 Node、沙箱。 */
const BASE_WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
} as const

/**
 * 为某主机创建直载窗口。窗口不做任何请求代理，页面资源全部来自远端，
 * 因此客户端插件与 Host 永远同版。
 *
 * @param host - 目标主机。
 * @param onTitle - 页面标题变化回调，供托盘菜单显示当前会话。
 * @returns 已开始加载的窗口。
 */
export function createHostWindow(host: HostEntry, onTitle: (title: string) => void): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: host.label,
    webPreferences: {
      ...BASE_WEB_PREFERENCES,
      partition: partitionNameFor(host.origin),
      preload: join(here, '../preload/host.js'),
    },
  })

  win.on('page-title-updated', (_event, title) => { onTitle(title) })

  // 外部链接交给系统浏览器，绝不在壳内开新窗口。
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 连不上时切到离线页，而不是让 Chromium 显示自己的错误页。
  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return  // -3 是主动中止，忽略
    void win.loadURL(offlinePageUrl(`${errorDescription}（${validatedURL}）`))
  })

  void win.loadURL(host.origin)
  return win
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
  void win.loadURL(offlinePageUrl(reason))
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
      preload: join(here, '../preload/welcome.js'),
    },
  })
  void win.loadURL(welcomePageUrl())
  return win
}
