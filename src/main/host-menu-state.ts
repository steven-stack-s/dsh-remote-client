import type { HostEntry } from '../shared/types.js'

/**
 * 主机菜单里可出现的动作种类。
 *
 * 这是**纯数据**定义：真正的菜单项由 `host-menu.ts` 依据它构造。
 * 之所以单独成模块，是因为 `host-menu.ts` 需要 import electron（用于
 * `session` 与菜单类型），而 electron 在 vitest 的 node 环境下无法加载
 * （`require('electron')` 会尝试下载二进制）。把「哪些项该出现」这条
 * 会漂移的契约留在无依赖的纯模块里，才能真正被测试守护。
 */
export type HostMenuItemKind =
  | 'open'
  | 'reload'
  | 'retryNow'
  | 'resetLogin'
  | 'remove'

/**
 * 计算某台主机在菜单里应包含的动作项（不含分隔符的位置细节）。
 *
 * 规则：
 * - 「打开」恒定存在；
 * - 「重新加载」只对**当前打开**的主机有意义（要重新请求它的 origin）；
 * - 「立即重试」只在当前主机**且离线**时出现，避免对未打开窗口做无意义操作；
 * - 「重置登录态」与「删除」**恒定存在**——这两项正是本次补齐的核心：
 *   Windows 上托盘不显示时，菜单栏是它们唯一的入口。
 *
 * @param isCurrent - 该主机是否当前打开的主机。
 * @param offline - 当前主机是否处于离线重试中。
 * @returns 按显示顺序排列的动作种类。
 */
export function hostMenuItemKinds(isCurrent: boolean, offline: boolean): HostMenuItemKind[] {
  const kinds: HostMenuItemKind[] = ['open']
  if (isCurrent) kinds.push('reload')
  if (isCurrent && offline) kinds.push('retryNow')
  kinds.push('resetLogin', 'remove')
  return kinds
}

/**
 * 构造单台主机的菜单标签。
 *
 * @param host - 目标主机。
 * @param currentId - 当前主机 id。
 * @param offline - 当前主机是否离线。
 * @returns 形如「● 家里 NAS（离线）」的标签。
 */
export function hostMenuLabel(
  host: HostEntry,
  currentId: string | undefined,
  offline: boolean,
): string {
  const isCurrent = currentId !== undefined && host.id === currentId
  const marker = isCurrent ? '● ' : '　'
  const suffix = isCurrent && offline ? '（离线）' : ''
  return `${marker}${host.label}${suffix}`
}

/** 各动作对应的菜单文案。 */
export const HOST_MENU_LABELS: Record<HostMenuItemKind, string> = {
  open: '打开',
  reload: '重新加载',
  retryNow: '立即重试',
  resetLogin: '重置登录态',
  remove: '删除…',
}
