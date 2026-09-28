import { Menu, Tray, nativeImage, session, type MenuItemConstructorOptions } from 'electron'
import { partitionNameFor } from './partitions.js'
import { removeHost } from './hosts.js'
import type { HostEntry, HostsFile } from '../shared/types.js'

/** 托盘依赖，全部由主进程注入，便于隔离与测试。 */
export interface TrayDeps {
  /** 读取当前配置。 */
  getData: () => HostsFile
  /** 写回配置。 */
  setData: (data: HostsFile) => void
  /** 当前打开的主机 id。 */
  getCurrentId: () => string | undefined
  /** 打开指定主机。 */
  openHost: (host: HostEntry) => void
  /** 退出应用。 */
  onQuit: () => void
}

/**
 * 创建托盘。菜单每次弹出前重建，因此始终反映最新配置。
 *
 * @param deps - 主进程注入的依赖。
 * @returns 托盘实例（调用方需保留引用，否则会被回收导致图标消失）。
 */
export function createTray(deps: TrayDeps): Tray {
  // 用一个 1×1 空图占位；正式图标在阶段 2 补齐资源文件。
  const tray = new Tray(nativeImage.createEmpty())
  tray.setToolTip('dsh-remote-client')

  const rebuild = (): void => {
    const data = deps.getData()
    const currentId = deps.getCurrentId()

    const hostItems: MenuItemConstructorOptions[] = data.hosts.map(host => ({
      label: `${host.id === currentId ? '● ' : '　'}${host.label}`,
      submenu: [
        { label: '打开', click: () => { deps.openHost(host) } },
        {
          label: '重置登录态',
          click: () => {
            void session.fromPartition(partitionNameFor(host.origin))
              .clearStorageData()
              .then(() => { rebuild() })
          },
        },
        { type: 'separator' },
        {
          label: '删除',
          click: () => {
            deps.setData(removeHost(data, host.id))
            rebuild()
          },
        },
      ],
    }))

    const menu = Menu.buildFromTemplate([
      ...hostItems,
      { type: 'separator' },
      { label: '退出', click: () => { deps.onQuit() } },
    ])
    tray.setContextMenu(menu)
  }

  rebuild()
  // 提供一个触发重建的入口，供主进程在切换主机后调用。
  ;(tray as Tray & { rebuildMenu?: () => void }).rebuildMenu = rebuild
  return tray
}
