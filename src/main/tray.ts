import { Menu, Tray, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron'
import { buildHostMenuItems, clearHostLoginState, hostMenuLabel } from './host-menu.js'
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
  /** 删除主机（实现侧负责弹确认框与善后）。 */
  onRemoveHost: (host: HostEntry) => void
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
 * 16×16 版本，供 Windows 的小图标槽位使用。
 *
 * Windows 托盘在 100% 缩放下取 16×16、在高 DPI 下取 32×32。只提供 32×32
 * 时系统会自行缩放，边缘容易发虚；同时给出两档可让 Windows 直接选用。
 */
const TRAY_ICON_COLOR_16 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAdklEQVR42mPw6f7KgAVL+HR/jfLp/loNxVFQMQy12DTO9en++h8HnotuELJmS5/ur0/waIbhJ1C1KAZIEKkZ2RAJZAPmkqAZ2TsMMNv/k4klGKAhTK4BUQzQaCLXgGqqGECxFygORIqjkSoJieKkTJXMRFZ2BgBX0HyXdU5YNgAAAABJRU5ErkJggg=='
const TRAY_ICON_GRAY_16 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAdUlEQVR42q2Tuw3AMAhEGYNVsopX8Qi0tDCd93AaLOHEiRJwcQ3iHuIHxAoLIbEWYq2mYrFb7sooxNofJFeQNx/E2l7MQ81yJwB+NHsIeoD8MPt2YFTvQSHYhKOAAramKKBuAaRbSA8xvcYth5Q+5S3PFHrnE2yObZc3fkp9AAAAAElFTkSuQmCC'

/**
 * 从 data URL 解析图标，失败时给出可诊断的日志。
 *
 * `createFromDataURL` 在解析失败时**返回空图而非抛异常**（Electron 行为），
 * 而空图在 Windows 上正是导致托盘项不可见的原因之一。因此这里显式检查
 * `isEmpty()` 并报错——绝不能让图标问题再次以「静默不显示」的形式出现。
 *
 * @param dataUrl - 内联 PNG 的 data URL。
 * @param name - 图标名，用于日志。
 * @returns 解析出的图像（可能为空图，调用方需自行决定如何处理）。
 */
function iconFromDataUrl(dataUrl: string, name: string): NativeImage {
  const image = nativeImage.createFromDataURL(dataUrl)
  if (image.isEmpty()) {
    console.error(`[dsh-remote-client] 托盘图标解析为空图（${name}）：Windows 上会导致托盘项不可见。`)
  }
  return image
}

/**
 * 组合 16×16 与 32×32 两档表示，供 Windows 按 DPI 选用。
 *
 * `addRepresentation` 让同一个 NativeImage 携带多个尺寸；Windows 在
 * 100% 缩放下取 16×16、高 DPI 下取 32×32。只给 32×32 时系统会自行
 * 缩放，小图标槽位下边缘会发虚。
 *
 * @param smallDataUrl - 16×16 的 data URL。
 * @param largeDataUrl - 32×32 的 data URL。
 * @param name - 图标名，用于日志。
 * @returns 带两档表示的图像。
 */
function multiSizeIcon(smallDataUrl: string, largeDataUrl: string, name: string): NativeImage {
  const image = iconFromDataUrl(largeDataUrl, `${name}(32)`)
  const small = iconFromDataUrl(smallDataUrl, `${name}(16)`)
  if (!small.isEmpty()) {
    // 用 dataURL 而非 buffer：类型定义里 buffer 明确是「raw image data」，
    // 而 dataURL 才是有文档保证的「base64 编码 PNG/JPEG」路径。
    image.addRepresentation({ scaleFactor: 1, dataURL: smallDataUrl })
  }
  return image
}

/**
 * 创建托盘。菜单每次弹出前重建，因此始终反映最新配置。
 *
 * @param deps - 主进程注入的依赖。
 * @returns 托盘实例（调用方需保留引用，否则会被回收导致图标消失）。
 */
export function createTray(deps: TrayDeps): Tray {
  const colorIcon = multiSizeIcon(TRAY_ICON_COLOR_16, TRAY_ICON_COLOR, 'color')
  const grayIcon = multiSizeIcon(TRAY_ICON_GRAY_16, TRAY_ICON_GRAY, 'gray')
  const tray = new Tray(colorIcon)

  const rebuild = (): void => {
    const data = deps.getData()
    const currentId = deps.getCurrentId()
    const offline = deps.isOffline()

    // 规格 §8：离线时托盘图标变灰，并辅以 tooltip 文案。
    tray.setImage(offline ? grayIcon : colorIcon)
    tray.setToolTip(offline ? 'dsh-remote-client（离线，正在重试）' : 'dsh-remote-client')

    const hostItems: MenuItemConstructorOptions[] = data.hosts.map(host => ({
      label: hostMenuLabel(host, currentId, offline),
      // 子菜单内容由共享构造器生成，与应用菜单栏完全同源，避免两边漂移。
      submenu: buildHostMenuItems(host, {
        currentId,
        offline,
        openHost: h => { deps.openHost(h) },
        onReload: () => { deps.onReload() },
        onRetryNow: () => { deps.onRetryNow() },
        onResetLogin: h => {
          void clearHostLoginState(h).then(() => { rebuild() })
        },
        onRemove: h => { deps.onRemoveHost(h) },
      }),
    }))

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
