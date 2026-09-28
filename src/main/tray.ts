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
  /** 打开「添加主机」欢迎页。 */
  onAddHost: () => void
  /** 当前主机是否处于离线重试中，用于提示与手动重试。 */
  isOffline: () => boolean
  /** 立即重试当前主机。 */
  onRetryNow: () => void
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

  const rebuild = (): void => {
    const data = deps.getData()
    const currentId = deps.getCurrentId()
    const offline = deps.isOffline()

    // 规格 §8 要求离线时托盘图标变灰。阶段 1 用的是空图占位，
    // 无法真正改变外观，故降级为 tooltip 文案提示（见下面 setToolTip）。
    tray.setToolTip(offline ? 'dsh-remote-client（离线，正在重试）' : 'dsh-remote-client')

    const hostItems: MenuItemConstructorOptions[] = data.hosts.map(host => {
      const submenu: MenuItemConstructorOptions[] = [
        { label: '打开', click: () => { deps.openHost(host) } },
      ]
      // 仅当前主机且离线时提供「立即重试」，避免对未打开的窗口做无意义操作。
      if (host.id === currentId && offline) {
        submenu.push({ label: '立即重试', click: () => { deps.onRetryNow() } })
      }
      submenu.push(
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
      )
      return {
        label: `${host.id === currentId ? '● ' : '　'}${host.label}${host.id === currentId && offline ? '（离线）' : ''}`,
        submenu,
      }
    })

    const menu = Menu.buildFromTemplate([
      ...hostItems,
      { type: 'separator' },
      // 没有它，用户删光全部主机后菜单会变空、再无入口添加主机。
      { label: '添加主机…', click: () => { deps.onAddHost() } },
      { label: '退出', click: () => { deps.onQuit() } },
    ])
    tray.setContextMenu(menu)
  }

  rebuild()
  // 提供一个触发重建的入口，供主进程在切换主机或离线状态变化后调用。
  ;(tray as Tray & { rebuildMenu?: () => void }).rebuildMenu = rebuild
  return tray
}
