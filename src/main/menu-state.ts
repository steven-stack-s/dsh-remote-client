/**
 * 应用菜单栏的动态状态判定。
 *
 * 单独成模块的理由与 `backoff.ts` / `restart.ts` / `lifecycle.ts` / `reload.ts`
 * 相同：调用方 `menu.ts` import 了 electron，在 vitest 的 node 环境下无法加载。
 *
 * 背景：Windows 上托盘图标未能显示（用户真机反馈），而托盘原本是主机管理的
 * 唯一入口。应用菜单栏是三平台都可见、且**不依赖 Tray** 的兜底通道。
 */

/**
 * 「重新加载当前主机」是否可用（没有当前主机时该项应禁用）。
 *
 * @param currentHostId - 当前打开的主机 id；无主机时为 undefined。
 * @returns 可重载时返回 true。
 */
export function canReloadHost(currentHostId: string | undefined): boolean {
  return currentHostId !== undefined && currentHostId !== ''
}

/**
 * 「打开主机」子项是否可用：任何已配置主机都可被打开。
 *
 * 目前恒为 true，但保留为纯函数以便日后加入「离线不可开」之类规则时
 * 有单点可测，而不是把判断散落在菜单模板里。
 *
 * @returns 恒为 true。
 */
export function canOpenHost(): boolean {
  return true
}

/**
 * 主机列表菜单在没有任何主机时的占位项文案。
 *
 * Electron 的菜单不支持「空菜单」的原生灰字提示，用一个禁用的占位项
 * 避免用户看到一片空白而以为功能坏了。
 *
 * @param hostCount - 已配置主机数量。
 * @returns 有主机时返回 undefined（不渲染占位项），否则返回占位文案。
 */
export function emptyHostsPlaceholder(hostCount: number): string | undefined {
  return hostCount === 0 ? '（尚未添加主机）' : undefined
}
