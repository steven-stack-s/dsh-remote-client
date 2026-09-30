import { session, type MenuItemConstructorOptions } from 'electron'
import { partitionNameFor } from './partitions.js'
import { emptyHostsPlaceholder } from './menu-state.js'
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
 * 构造整份主机列表所需的输入。
 *
 * 与 `HostMenuActions` 的区别：那个描述「对**一台**主机能做哪些操作」，
 * 本接口描述「列表本身长什么样」（有哪些主机、当前是哪台、离线与否）。
 */
export interface HostListInput {
  /** 已配置的主机。 */
  hosts: readonly HostEntry[]
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
 * 构造「每台主机一个子菜单」的完整列表（含无主机时的占位项）。
 *
 * 菜单栏的「主机(H)」与托盘的「主机」**必须**共用本函数：两处各写一遍，
 * 迟早出现「托盘能重置登录态、菜单栏不能」这类漂移。它们本来就共用
 * `buildHostMenuItems`，本函数把外面那层「列表 + 占位项」也一并收敛进来。
 *
 * @param input - 主机列表与动作集合。
 * @returns 菜单项数组（可直接作为某个菜单项的子菜单）。
 */
export function buildHostListItems(input: HostListInput): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = input.hosts.map(host => ({
    label: hostMenuLabel(host, input.currentId, input.offline),
    submenu: buildHostMenuItems(host, {
      currentId: input.currentId,
      offline: input.offline,
      openHost: input.openHost,
      onReload: input.onReload,
      onRetryNow: input.onRetryNow,
      onResetLogin: input.onResetLogin,
      onRemove: input.onRemove,
    }),
  }))

  // 一台主机都没有时给一条禁用占位项：否则子菜单是一片空白，
  // 用户分不清「没有主机」还是「菜单坏了」。
  const placeholder = emptyHostsPlaceholder(input.hosts.length)
  if (placeholder !== undefined) items.push({ label: placeholder, enabled: false })

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
