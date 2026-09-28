import { session, type MenuItemConstructorOptions } from 'electron'
import { partitionNameFor } from './partitions.js'
import {
  HOST_MENU_LABELS,
  hostMenuItemKinds,
  hostMenuLabel,
  type HostMenuItemKind,
} from './host-menu-state.js'
import type { HostEntry } from '../shared/types.js'

// 纯逻辑（标签、项集合）位于 host-menu-state.ts，可在 node 下测试；
// 本模块只负责把它翻译成 Electron 的菜单项，因此 import 了 electron。
export { hostMenuLabel }

/**
 * 主机相关菜单项的动作集合。
 *
 * 托盘与应用菜单栏的「主机」子菜单复用同一份构造逻辑，避免两边
 * 各自漂移——托盘在 Windows 上不显示时，菜单栏就是唯一入口，
 * 两者能力必须一致。
 */
export interface HostMenuActions {
  /** 当前打开的主机 id。 */
  currentId: string | undefined
  /** 当前主机是否离线。 */
  offline: boolean
  /** 打开该主机。 */
  openHost: (host: HostEntry) => void
  /** 重新加载当前主机。 */
  onReload: () => void
  /** 立即重试当前主机。 */
  onRetryNow: () => void
  /** 清除该主机的登录态（partition）。 */
  onResetLogin: (host: HostEntry) => void
  /** 请求删除该主机（实现侧应自行弹确认框）。 */
  onRemove: (host: HostEntry) => void
}

/**
 * 把动作种类翻译成可点击的菜单项。
 *
 * @param kind - 动作种类。
 * @param host - 目标主机。
 * @param actions - 动作集合。
 * @returns 菜单项。
 */
function toMenuItem(
  kind: HostMenuItemKind,
  host: HostEntry,
  actions: HostMenuActions,
): MenuItemConstructorOptions {
  const label = HOST_MENU_LABELS[kind]
  switch (kind) {
    case 'open':
      return { label, click: () => { actions.openHost(host) } }
    case 'reload':
      return { label, click: () => { actions.onReload() } }
    case 'retryNow':
      return { label, click: () => { actions.onRetryNow() } }
    case 'resetLogin':
      return { label, click: () => { actions.onResetLogin(host) } }
    case 'remove':
      return { label, click: () => { actions.onRemove(host) } }
  }
}

/**
 * 构造单台主机的子菜单内容。
 *
 * @param host - 目标主机。
 * @param actions - 动作集合。
 * @returns 菜单项数组。
 */
export function buildHostMenuItems(
  host: HostEntry,
  actions: HostMenuActions,
): MenuItemConstructorOptions[] {
  const isCurrent = actions.currentId !== undefined && host.id === actions.currentId
  const kinds = hostMenuItemKinds(isCurrent, actions.offline)

  const items: MenuItemConstructorOptions[] = []
  for (const kind of kinds) {
    // 破坏性/凭据类操作前加分隔符，与「打开/重载」这类日常操作区分开。
    if (kind === 'resetLogin') items.push({ type: 'separator' })
    items.push(toMenuItem(kind, host, actions))
  }
  return items
}

/**
 * 清空某主机的登录态。
 *
 * 托盘与菜单栏共用，保证「重置登录态」在两处的语义完全一致。
 *
 * @param host - 目标主机。
 * @returns 清除完成的 Promise。
 */
export async function clearHostLoginState(host: HostEntry): Promise<void> {
  await session.fromPartition(partitionNameFor(host.origin)).clearStorageData()
}
