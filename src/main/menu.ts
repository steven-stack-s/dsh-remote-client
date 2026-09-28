import { Menu, app, type MenuItemConstructorOptions } from 'electron'
import { canEditHost, emptyHostsPlaceholder } from './menu-state.js'
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
  /** 打开「编辑主机」窗口（作用于当前主机）。 */
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
 * 装配应用菜单栏。
 *
 * 这是**不依赖 Tray 的兜底入口**：Windows/Linux 上显示在窗口顶部，
 * macOS 上显示在屏幕顶部菜单栏。用户真机反馈托盘图标未出现，而托盘
 * 原本是主机管理的唯一入口，因此菜单栏必须独立可用。
 *
 * 菜单只放必要项：删除主机等破坏性操作刻意**不**放入（那是托盘的职责），
 * 菜单是兜底通道而非托盘的完整复制。
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
        submenu: [
          {
            label: '添加主机…',
            accelerator: 'CmdOrCtrl+N',
            click: () => { deps.onAddHost() },
          },
          { type: 'separator' },
          {
            label: '编辑主机…',
            // 与「主机(H)」里每台主机的「重新加载」不同，这两项作用于
            // 当前主机，没有当前主机时无从下手，故禁用。
            enabled: canEditHost(currentId),
            click: () => { deps.onEditCurrentHost() },
          },
          {
            label: '删除主机…',
            // 第二删除入口：与主机子菜单里的「删除…」共用同一套确认框逻辑。
            enabled: canEditHost(currentId),
            click: () => { deps.onRemoveCurrentHost() },
          },
          { type: 'separator' },
          {
            label: '退出',
            accelerator: 'CmdOrCtrl+Q',
            click: () => { deps.onQuit() },
          },
        ],
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
