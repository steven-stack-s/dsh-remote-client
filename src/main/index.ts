import { app, BrowserWindow, ipcMain } from 'electron'
import { addHost, loadHosts, loadHostsSync, resolveStartupHost, saveHosts, touchHost } from './hosts.js'
import { createHostWindow, createOfflineWindow, createWelcomeWindow, type HostWindowHandle } from './windows.js'
import { createTray, type TrayDeps } from './tray.js'
import { insecureOriginsSwitchValue } from '../shared/origin.js'
import type { HostEntry, HostsFile } from '../shared/types.js'

const dataDir = app.getPath('userData')

// 安全上下文豁免必须在 app.whenReady() 之前设置，因此这里同步读配置。
// 只对已配置的 http origin 放行，绝不通配。
const earlyHosts = loadHostsSync(dataDir)
const insecureValue = insecureOriginsSwitchValue(earlyHosts.hosts.map(h => h.origin))
if (insecureValue !== '') {
  app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', insecureValue)
}

/** 当前打开的主机窗口；切换主机时关闭旧的，避免并存两份 WebSocket。 */
let currentWindow: HostWindowHandle | undefined

/** 内存中的配置镜像，托盘与窗口共用；写盘后同步更新。 */
let hostsData: HostsFile = { version: 1, hosts: [] }
let currentHostId: string | undefined
let tray: Electron.Tray | undefined

/** 重建托盘菜单（若托盘已装配）。 */
function refreshTrayMenu(): void {
  ;(tray as unknown as { rebuildMenu?: () => void } | undefined)?.rebuildMenu?.()
}

/**
 * 打开一台主机，并关闭此前的主机窗口。
 *
 * @param host - 目标主机。
 */
function openHost(host: HostEntry): void {
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
    () => { refreshTrayMenu() },
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
  refreshTrayMenu()
}

/** 装配托盘；只装配一次。 */
function installTray(): void {
  if (tray !== undefined) return
  const deps: TrayDeps = {
    getData: () => hostsData,
    setData: next => { void persist(next) },
    getCurrentId: () => currentHostId,
    openHost: host => { void persist(touchHost(hostsData, host.id)); openHost(host) },
    onAddHost: () => { createWelcomeWindow() },
    isOffline: () => currentWindow?.isOffline() ?? false,
    onRetryNow: () => { currentWindow?.retryNow() },
    onQuit: () => { app.quit() },
  }
  tray = createTray(deps)
}

async function boot(): Promise<void> {
  const data = await loadHosts(dataDir)
  const host = resolveStartupHost(data)

  if (host === undefined) {
    // 无主机：先装配托盘（否则用户无法管理主机），再开欢迎页。
    hostsData = data
    installTray()
    createWelcomeWindow()
    return
  }

  hostsData = data
  currentHostId = host.id
  await saveHosts(dataDir, touchHost(data, host.id))
  openHost(host)
  installTray()
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
    const data = await loadHosts(dataDir)
    const next = addHost(data, origin, typeof label === 'string' && label !== '' ? label : undefined)
    // 必须走 persist：托盘菜单读的是内存镜像 hostsData，
    // 只 saveHosts 的话新主机不会出现在菜单里。
    await persist(next)
    const created = next.hosts.find(h => h.id === next.lastHostId)
    if (created !== undefined) openHost(created)
    return { ok: true as const }
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : String(error) }
  }
})

void app.whenReady().then(boot)

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void boot()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
