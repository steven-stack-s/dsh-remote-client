import { Menu, Tray, nativeImage, nativeTheme, type MenuItemConstructorOptions, type NativeImage } from 'electron'
import {
  TRAY_ICON_DARK_16,
  TRAY_ICON_DARK_32,
  TRAY_ICON_LIGHT_16,
  TRAY_ICON_LIGHT_32,
  TRAY_ICON_OFFLINE_16,
  TRAY_ICON_OFFLINE_32,
} from './tray-icons.js'
import {
  TRAY_MENU_LABELS,
  trayIconVariant,
  trayMenuItemKinds,
  type TrayIconVariant,
  type TrayMenuItemKind,
} from './menu-state.js'

/**
 * 托盘依赖，全部由主进程注入，便于隔离与测试。
 *
 * task-14 起托盘精简为「打开客户端 / 关闭客户端」两项，因此这里不再需要
 * 主机列表、切换、删除、重置登录态等回调——那些功能全部在菜单栏的「主机(H)」
 * 里，不是被删掉了。依赖瘦身本身也是这次精简的一部分：托盘不再读写配置，
 * 因此不可能再出现「托盘菜单与配置不同步」这类缺陷。
 */
export interface TrayDeps {
  /** 当前主机是否处于离线重试中（用于图标变灰与 tooltip）。 */
  isOffline: () => boolean
  /** 打开客户端（唤起已有窗口；没有窗口时按当前主机重开，再没有则开欢迎页）。 */
  onOpen: () => void
  /** 关闭客户端（真正退出）。 */
  onQuit: () => void
}

/** 托盘句柄。 */
export interface TrayHandle {
  /** 底层托盘实例；调用方必须保留引用，否则托盘图标会被回收消失。 */
  tray: Tray
  /** 刷新图标与提示（离线状态或系统主题变化后调用）。 */
  refresh: () => void
}

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
 * 把托盘菜单项种类翻译成 Electron 菜单项。
 *
 * 返回类型是必填的 `MenuItemConstructorOptions` 而非可选：日后若
 * `TrayMenuItemKind` 新增了成员而这里忘了处理，TypeScript 会直接报
 * 「并非所有代码路径都返回值」，而不是悄悄少一项。
 *
 * @param kind - 项种类。
 * @param deps - 主进程注入的依赖。
 * @returns 菜单项。
 */
function toMenuItem(kind: TrayMenuItemKind, deps: TrayDeps): MenuItemConstructorOptions {
  switch (kind) {
    case 'open':
      return { label: TRAY_MENU_LABELS.open, click: () => { deps.onOpen() } }
    case 'quit':
      return { label: TRAY_MENU_LABELS.quit, click: () => { deps.onQuit() } }
  }
}

/**
 * 创建托盘。
 *
 * 菜单固定为「打开客户端 / 关闭客户端」两项，与主机配置无关，因此**只装配一次**，
 * 之后不再重建；`refresh()` 只负责图标与提示（离线状态、系统主题变化）。
 *
 * 图标按系统主题选色：浅色主题用黑鲸鱼、深色主题用白鲸鱼（Windows 任务栏默认
 * 深色，只给黑色会几乎看不见），离线时一律用灰鲸鱼（离线优先，见
 * `menu-state.ts` 的 `trayIconVariant`）。`nativeTheme` 的 `updated` 事件让图标
 * 在用户切换系统主题时立刻跟随。
 *
 * @param deps - 主进程注入的依赖。
 * @returns 托盘句柄（调用方需保留引用，否则图标会被回收导致托盘消失）。
 */
export function createTray(deps: TrayDeps): TrayHandle {
  const icons: Record<TrayIconVariant, NativeImage> = {
    light: multiSizeIcon(TRAY_ICON_LIGHT_16, TRAY_ICON_LIGHT_32, 'light'),
    dark: multiSizeIcon(TRAY_ICON_DARK_16, TRAY_ICON_DARK_32, 'dark'),
    offline: multiSizeIcon(TRAY_ICON_OFFLINE_16, TRAY_ICON_OFFLINE_32, 'offline'),
  }

  /** 当前该用的图标变体（离线优先于主题）。 */
  const currentVariant = (): TrayIconVariant =>
    trayIconVariant({ offline: deps.isOffline(), dark: nativeTheme.shouldUseDarkColors })

  const tray = new Tray(icons[currentVariant()])

  const refresh = (): void => {
    const offline = deps.isOffline()
    tray.setImage(icons[currentVariant()])
    // 规格 §8：离线时图标变灰，并辅以 tooltip 文案。
    tray.setToolTip(offline ? 'dsh-remote-client（离线，正在重试）' : 'dsh-remote-client')
  }

  const menu = Menu.buildFromTemplate(trayMenuItemKinds().map(kind => toMenuItem(kind, deps)))
  tray.setContextMenu(menu)
  refresh()

  // 系统主题切换后立刻换色（用户改了 Windows 深色模式却要重启才生效是不能接受的）。
  // 托盘是本进程单例，监听器随进程存活，无需在退出时摘除。
  nativeTheme.on('updated', () => { refresh() })

  return { tray, refresh }
}
