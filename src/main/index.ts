import { app, BrowserWindow, ipcMain } from 'electron'
import { addHost, loadHosts, loadHostsSync, resolveStartupHost, saveHosts, touchHost } from './hosts.js'
import { createHostWindow, createOfflineWindow, createWelcomeWindow } from './windows.js'
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
let currentWindow: BrowserWindow | undefined

/** 内存中的配置镜像，托盘与窗口共用；写盘后同步更新。 */
let hostsData: HostsFile = { version: 1, hosts: [] }
let currentHostId: string | undefined
let tray: Electron.Tray | undefined

/**
 * 打开一台主机，并关闭此前的主机窗口。
 *
 * @param host - 目标主机。
 */
function openHost(host: HostEntry): void {
  currentWindow?.destroy()
  currentHostId = host.id
  currentWindow = createHostWindow(host, title => {
    if (title !== '') currentWindow?.setTitle(`${host.label} — ${title}`)
  })
  currentWindow.on('closed', () => { currentWindow = undefined })
}

/**
 * 更新内存配置并落盘。
 *
 * @param next - 新配置。
 */
async function persist(next: HostsFile): Promise<void> {
  hostsData = next
  await saveHosts(dataDir, next)
  ;(tray as unknown as { rebuildMenu?: () => void } | undefined)?.rebuildMenu?.()
}

/** 装配托盘；只装配一次。 */
function installTray(): void {
  if (tray !== undefined) return
  const deps: TrayDeps = {
    getData: () => hostsData,
    setData: next => { void persist(next) },
    getCurrentId: () => currentHostId,
    openHost: host => { void persist(touchHost(hostsData, host.id)); openHost(host) },
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

ipcMain.on('shell:title', (event, title: unknown) => {
  if (typeof title !== 'string') return
  // Electron 44 起 fromWebContents 返回 `BrowserWindow | null`（旧版为 undefined）。
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win !== null && !win.isDestroyed()) win.setTitle(title)
})

ipcMain.on('shell:network', (_event, _online: unknown) => {
  // 阶段 1 仅记录；离线覆盖页已由 did-fail-load 负责。
})

ipcMain.handle('shell:welcome:add', async (_event, input: unknown) => {
  if (typeof input !== 'object' || input === null) return { ok: false as const, message: '参数不合法' }
  const { origin, label } = input as { origin?: unknown, label?: unknown }
  if (typeof origin !== 'string') return { ok: false as const, message: '请输入主机地址' }
  try {
    const data = await loadHosts(dataDir)
    const next = addHost(data, origin, typeof label === 'string' && label !== '' ? label : undefined)
    await saveHosts(dataDir, next)
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
