import { Menu, app, type MenuItemConstructorOptions } from 'electron'
import {
  canEditHost,
  canOpenEditWindow,
  editMenuLayout,
  emptyHostsPlaceholder,
  type EditMenuItemKind,
} from './menu-state.js'
import { buildHostMenuItems, hostMenuLabel } from './host-menu.js'
import type { HostEntry, HostsFile } from '../shared/types.js'

/**
 * 应用菜单栏依赖，全部由主进程注入，便于隔离与测试。
 *
 * 与 `TrayDeps` 同样采用依赖注入，使本模块不需要 import `windows.ts`。
 */
export interface AppMenuDeps {
  /** 读取当前配置。 */
  getData: () => HostsFile
  /** 当前打开的主机 id。 */
  getCurrentId: () => string | undefined
  /** 打开指定主机。 */
  openHost: (host: HostEntry) => void
  /** 打开「添加主机」欢迎页。 */
  onAddHost: () => void
  /** 重新加载当前主机（供主机子菜单与 Ctrl+R 使用；「编辑(E)」中已无重复入口）。 */
  onReload: () => void
  /** 当前主机是否离线（用于标签提示）。 */
  isOffline: () => boolean
  /** 立即重试当前主机。 */
  onRetryNow: () => void
  /** 清除指定主机的登录态。 */
  onResetLogin: (host: HostEntry) => void
  /** 删除指定主机（实现侧负责弹确认框与善后）。 */
  onRemoveHost: (host: HostEntry) => void
  /** 打开「编辑主机」窗口（初始目标取当前主机；窗口内可切换到别的主机）。 */
  onEditCurrentHost: () => void
  /** 删除当前主机（作用于当前主机，复用同一套确认框）。 */
  onRemoveCurrentHost: () => void
  /** 退出应用。 */
  onQuit: () => void
}

/** 支持动态重建的应用菜单句柄。 */
export interface AppMenuHandle {
  /** 重建菜单（主机增删/切换后调用）。 */
  rebuild: () => void
}

/** macOS 上应用菜单需要的第一项（惯例：应用名 → 关于/退出）。 */
function darwinAppMenu(): MenuItemConstructorOptions {
  return {
    label: app.name,
    submenu: [
      { role: 'about', label: `关于 ${app.name}` },
      { type: 'separator' },
      { role: 'services', label: '服务' },
      { type: 'separator' },
      { role: 'hide', label: `隐藏 ${app.name}` },
      { role: 'hideOthers', label: '隐藏其他' },
      { role: 'unhide', label: '全部显示' },
      { type: 'separator' },
      { role: 'quit', label: `退出 ${app.name}` },
    ],
  }
}

/**
 * 把「编辑(E)」菜单的项种类翻译成 Electron 菜单项。
 *
 * 顺序与分隔线位置由 `editMenuLayout()` 决定（纯函数，有单测守护）；
 * 本函数只负责填文案、快捷键与可用性。
 *
 * @param kind - 项种类。
 * @param deps - 主进程注入的依赖。
 * @returns 菜单项。
 */
function toEditMenuItem(kind: EditMenuItemKind, deps: AppMenuDeps): MenuItemConstructorOptions {
  const currentId = deps.getCurrentId()
  switch (kind) {
    case 'addHost':
      return {
        label: '添加主机…',
        accelerator: 'CmdOrCtrl+N',
        click: () => { deps.onAddHost() },
      }
    case 'editHost':
      // 编辑窗口内部可以切换编辑对象，因此只要还有主机就能打开它
      // （「删除主机…」不同，它作用于当前主机，仍要求有当前主机）。
      return {
        label: '编辑主机…',
        enabled: canOpenEditWindow(deps.getData().hosts.length),
        click: () => { deps.onEditCurrentHost() },
      }
    case 'removeHost':
      return {
        label: '删除主机…',
        // 第二删除入口：与主机子菜单里的「删除…」共用同一套确认框逻辑。
        enabled: canEditHost(currentId),
        click: () => { deps.onRemoveCurrentHost() },
      }
    case 'separator':
      return { type: 'separator' }
    case 'quit':
      return {
        label: '退出',
        accelerator: 'CmdOrCtrl+Q',
        click: () => { deps.onQuit() },
      }
  }
}

/**
 * 装配应用菜单栏。
 *
 * 这是**不依赖 Tray 的兜底入口**：Windows/Linux 上显示在窗口顶部，
 * macOS 上显示在屏幕顶部菜单栏。用户真机反馈托盘图标未出现，而托盘
 * 原本是主机管理的唯一入口，因此菜单栏必须独立可用。
 *
 * task-14 起托盘精简为「打开客户端 / 关闭客户端」两项，**主机管理（打开/重加载/
 * 重试/重置登录态/删除/编辑）因此只有菜单栏这一个入口**——它的完整性比以往更关键。
 *
 * @param deps - 主进程注入的依赖。
 * @returns 菜单句柄，调用方可据此重建。
 */
export function installAppMenu(deps: AppMenuDeps): AppMenuHandle {
  const rebuild = (): void => {
    const data = deps.getData()
    const currentId = deps.getCurrentId()
    const offline = deps.isOffline()

    // 主机列表：当前主机带 ●，与托盘菜单的标记保持一致。
    const hostItems: MenuItemConstructorOptions[] = data.hosts.map(host => ({
      label: hostMenuLabel(host, currentId, offline),
      // 子菜单内容与托盘共用同一个构造器——托盘在 Windows 上可能不显示，
      // 菜单栏是唯一入口，两者能力必须一致、不得各自漂移。
      submenu: buildHostMenuItems(host, {
        currentId,
        offline,
        openHost: h => { deps.openHost(h) },
        onReload: () => { deps.onReload() },
        onRetryNow: () => { deps.onRetryNow() },
        onResetLogin: h => { deps.onResetLogin(h) },
        onRemove: h => { deps.onRemoveHost(h) },
      }),
    }))

    const placeholder = emptyHostsPlaceholder(data.hosts.length)
    if (placeholder !== undefined) {
      hostItems.push({ label: placeholder, enabled: false })
    }

    const template: MenuItemConstructorOptions[] = [
      // macOS 惯例：首个菜单必须是应用菜单。
      ...(process.platform === 'darwin' ? [darwinAppMenu()] : []),
      {
        label: '编辑(E)',
        // 项集合与顺序（含分隔线位置）由 editMenuLayout() 决定：
        // 「添加/编辑/删除主机」三者同级、之间**不设**分隔线；「退出」前保留一条。
        submenu: editMenuLayout().map(kind => toEditMenuItem(kind, deps)),
      },
      {
        label: '主机(H)',
        submenu: hostItems,
      },
    ]

    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  rebuild()
  return { rebuild }
}
