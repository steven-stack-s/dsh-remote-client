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
  canOpenEditWindow,
  trayIconVariant,
  trayMenuLayout,
  type TrayIconVariant,
  type TrayMenuItemKind,
} from './menu-state.js'
import { buildHostListItems } from './host-menu.js'
import type { HostEntry, HostsFile } from '../shared/types.js'

/**
 * 托盘依赖，全部由主进程注入，便于隔离与测试。
 *
 * task-14 曾把托盘精简为「打开客户端 / 关闭客户端」两项，依赖里因此没有任何
 * 主机管理回调；现在主机管理回到了托盘（原因见 `menu-state.ts` 的
 * `trayMenuLayout()`：Windows 上主机窗口无边框 → 菜单栏不再显示），
 * 这些回调也随之回来。
 *
 * `getData` 取的是**取值函数**而非配置快照：托盘存活期间主机随时可能被增删改，
 * 拿快照会让菜单停在过期状态——那正是当年托盘菜单被砍掉时列出的理由之一。
 * 现在每次 `refresh()` 都重建菜单，读的都是当下值。
 */
export interface TrayDeps {
  /** 当前主机是否处于离线重试中（用于图标变灰与 tooltip）。 */
  isOffline: () => boolean
  /** 打开客户端（唤起已有窗口；没有窗口时按当前主机重开，再没有则开欢迎页）。 */
  onOpen: () => void
  /** 关闭客户端（真正退出）。 */
  onQuit: () => void
  /** 读取当前配置。 */
  getData: () => HostsFile
  /** 当前打开的主机 id。 */
  getCurrentId: () => string | undefined
  /** 打开指定主机。 */
  openHost: (host: HostEntry) => void
  /** 打开「添加主机」欢迎页。 */
  onAddHost: () => void
  /** 打开「编辑主机」窗口（初始目标取当前主机；窗口内可切换到别的主机）。 */
  onEditCurrentHost: () => void
  /** 重新加载当前主机。 */
  onReload: () => void
  /** 立即重试当前主机。 */
  onRetryNow: () => void
  /** 清除指定主机的登录态。 */
  onResetLogin: (host: HostEntry) => void
  /** 删除指定主机（实现侧负责弹确认框与善后）。 */
  onRemoveHost: (host: HostEntry) => void
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
    case 'hosts':
      return { label: TRAY_MENU_LABELS.hosts, submenu: hostSubmenu(deps) }
    case 'addHost':
      // 快捷键与菜单栏的「添加主机…」保持一致（accelerator 由 application menu
      // 提供，这里写出来是为了让托盘里也能看到提示）。
      return {
        label: TRAY_MENU_LABELS.addHost,
        accelerator: 'CmdOrCtrl+N',
        click: () => { deps.onAddHost() },
      }
    case 'editHost':
      // 与 `menu.ts` 的同名项一样：编辑窗口内部可以切换编辑对象，
      // 因此只要还有主机就能打开它（「删除主机…」不同，它作用于当前主机）。
      return {
        label: TRAY_MENU_LABELS.editHost,
        enabled: canOpenEditWindow(deps.getData().hosts.length),
        click: () => { deps.onEditCurrentHost() },
      }
    case 'quit':
      return { label: TRAY_MENU_LABELS.quit, click: () => { deps.onQuit() } }
  }
}

/**
 * 「主机」子菜单的内容。
 *
 * 与菜单栏的「主机(H)」共用 `buildHostListItems()`——两处各写一遍，迟早出现
 * 「托盘能重置登录态、菜单栏不能」这类漂移。Windows 上菜单栏根本不显示，
 * 托盘是主机管理的**唯一可视入口**，此时两处一致就是可用性本身。
 *
 * @param deps - 主进程注入的依赖。
 * @returns 子菜单项数组。
 */
function hostSubmenu(deps: TrayDeps): MenuItemConstructorOptions[] {
  return buildHostListItems({
    hosts: deps.getData().hosts,
    currentId: deps.getCurrentId(),
    offline: deps.isOffline(),
    openHost: host => { deps.openHost(host) },
    onReload: () => { deps.onReload() },
    onRetryNow: () => { deps.onRetryNow() },
    onResetLogin: host => { deps.onResetLogin(host) },
    onRemove: host => { deps.onRemoveHost(host) },
  })
}

/**
 * 创建托盘。
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

  /**
   * 按当前配置装配菜单。
   *
   * 布局（含分隔线位置）与文案都由 `menu-state.ts` 的纯函数决定，这里只做翻译；
   * `hosts` 一项的子菜单每次现取主机列表，因此不存在「菜单停在旧配置上」。
   */
  const buildMenu = (): Menu =>
    Menu.buildFromTemplate(
      trayMenuLayout().map(entry =>
        entry === 'separator'
          ? { type: 'separator' as const }
          : toMenuItem(entry, deps),
      ),
    )

  /**
   * 刷新图标、提示与菜单。
   *
   * **菜单在这里重建**（而不是装配一次）：它现在挂着主机列表、当前主机标记与
   * 离线相关的可用性，这些都会变。`refresh()` 本就是所有这些变化后的统一回调
   * （见 `index.ts` 的 `refreshChrome()`），在这里重建既够用又不会漏。
   */
  const refresh = (): void => {
    const offline = deps.isOffline()
    tray.setImage(icons[currentVariant()])
    // 规格 §8：离线时图标变灰，并辅以 tooltip 文案。
    tray.setToolTip(offline ? 'dsh-remote-client（离线，正在重试）' : 'dsh-remote-client')
    tray.setContextMenu(buildMenu())
  }

  refresh()

  // 系统主题切换后立刻换色（用户改了 Windows 深色模式却要重启才生效是不能接受的）。
  // 托盘是本进程单例，监听器随进程存活，无需在退出时摘除。
  nativeTheme.on('updated', () => { refresh() })

  return { tray, refresh }
}
