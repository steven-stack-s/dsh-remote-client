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

/**
 * 「重置登录态」是否可用：必须存在该主机。
 *
 * 目前恒为 true（菜单项本就只对已存在的主机渲染），保留为纯函数是为了
 * 把「菜单项的可用性只取决于主机是否存在」这条约定固化下来——若日后
 * 出现「主机未打开时不允许重置」之类的规则，改动点集中在这里。
 *
 * @param hostExists - 目标主机是否仍存在于配置中。
 * @returns 可用时返回 true。
 */
export function canResetLoginState(hostExists: boolean): boolean {
  return hostExists
}

/**
 * 「删除」是否可用。
 *
 * **刻意允许删除最后一台主机**：用户可能就是想清空重来（例如把所有主机
 * 都换成新的部署）。托盘菜单底部有「添加主机…」，应用菜单栏的「文件」
 * 菜单同样有「添加主机…」，因此删光之后**不会**陷入无法恢复的状态。
 * 这条判定被显式固化，是为了防止日后有人「好心」禁用它而把用户困住。
 *
 * @param hostExists - 目标主机是否仍存在于配置中。
 * @returns 可用时返回 true。
 */
export function canRemoveHost(hostExists: boolean): boolean {
  return hostExists
}

/**
 * 删除某主机后，是否应关闭当前主机窗口。
 *
 * 仅当被删主机**正是当前打开的那台**时才需要处理——窗口承载的是该主机的
 * 会话，配置里已经没有它，继续留在屏幕上会让托盘/菜单里的主机列表与
 * 实际窗口不一致（用户会以为没删掉）。删其他主机时当前窗口不受影响。
 *
 * @param removedId - 被删除的主机 id。
 * @param currentHostId - 当前打开的主机 id。
 * @returns 应关闭当前窗口时返回 true。
 */
export function shouldCloseWindowAfterRemove(
  removedId: string,
  currentHostId: string | undefined,
): boolean {
  return currentHostId !== undefined && removedId === currentHostId
}
