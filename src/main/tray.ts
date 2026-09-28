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
  /** 重新加载当前主机（丢弃被门户重定向后的页面，重新请求 host.origin）。 */
  onReload: () => void
  /** 退出应用。 */
  onQuit: () => void
}

/**
 * 托盘图标：32×32 品牌蓝（#4c8bf5）实心圆。
 *
 * 内联 base64 而非引用资源文件，是为避免打包时资源路径解析的复杂度——
 * 阶段 1 尚未引入 electron-builder，任何 `resources/` 目录在 dev 与打包
 * 两种形态下路径不同，容易再次踩到「产物里缺文件」的坑。
 *
 * 注意：**Windows 托盘需要有效图像**，`nativeImage.createEmpty()` 会导致
 * 托盘项完全不出现；而托盘是主机管理的唯一入口，因此这不是外观问题。
 */
const TRAY_ICON_COLOR =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAyklEQVR42s2XsQ3FIAwFMwGTuWEFZqFz7RUyC7u4donyG5BQRKTwCdjFNVHQOwUH7ANQDk1GF3hAIUBJgMKAkgtcnlF551MBByixhFwv4bLGzQqEweCeSPhXgCaC79CowPlheOV8K0ALwh+/RG/Pr8WEJwE3WXAjhel6AnFDeCX2BHijAN8F/Mbwim8FSEGAWoGkIJBaAVYQ4FYgKwhkUwLqW6BehOq/ofpBpH4Um7iM1K9j9YbEREtmoik10ZabGExMjGYmhtOl/ABRzvBAa2onSgAAAABJRU5ErkJggg=='

/**
 * 离线态图标：同几何形状的灰色（#8b949e）版本。
 *
 * 有了真实图标后，规格 §8 的「离线时托盘图标变灰」才真正可做：
 * 切换两个不同的图像，而不是像早先那样只能降级为 tooltip 文案。
 */
const TRAY_ICON_GRAY =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAyUlEQVR42s2XsQ3FIAwFMwG7sQKz0Lm1W5eZhV08A8pvQEIRkcInYBfXREHvFBywD0A+NBld4AGZADkBsgByLkh5RuWdTwUcIMcScr1Eyho3KxAGg3si4V8Bmgi+Q6MC54fhlfOtAC0If/wSvT2/FhOeBNxkwY0UpusJxA3hldgTkI0CchfwG8MrvhUgBQFqBZKCQGoFREFAWoGsIJBNCahvgXoRqv+G6geR+lFs4jJSv47VGxITLZmJptREW25iMDExmpkYTpfyA6+QtEDFdUpOAAAAAElFTkSuQmCC'

/**
 * 创建托盘。菜单每次弹出前重建，因此始终反映最新配置。
 *
 * @param deps - 主进程注入的依赖。
 * @returns 托盘实例（调用方需保留引用，否则会被回收导致图标消失）。
 */
export function createTray(deps: TrayDeps): Tray {
  const colorIcon = nativeImage.createFromDataURL(TRAY_ICON_COLOR)
  const grayIcon = nativeImage.createFromDataURL(TRAY_ICON_GRAY)
  const tray = new Tray(colorIcon)

  const rebuild = (): void => {
    const data = deps.getData()
    const currentId = deps.getCurrentId()
    const offline = deps.isOffline()

    // 规格 §8：离线时托盘图标变灰，并辅以 tooltip 文案。
    tray.setImage(offline ? grayIcon : colorIcon)
    tray.setToolTip(offline ? 'dsh-remote-client（离线，正在重试）' : 'dsh-remote-client')

    const hostItems: MenuItemConstructorOptions[] = data.hosts.map(host => {
      const isCurrent = host.id === currentId
      const submenu: MenuItemConstructorOptions[] = [
        { label: '打开', click: () => { deps.openHost(host) } },
      ]
      // 「重新加载」只对当前已打开的主机有意义（要重新请求它的 origin），
      // 与下面「立即重试」保持一致：非当前主机不显示，避免无意义操作。
      if (isCurrent) {
        submenu.push({ label: '重新加载', click: () => { deps.onReload() } })
      }
      // 仅当前主机且离线时提供「立即重试」，避免对未打开的窗口做无意义操作。
      if (isCurrent && offline) {
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
