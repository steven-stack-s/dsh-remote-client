/**
 * 「某次窗口 close 是否应该隐藏而非真正关闭」的判定。
 *
 * 单独成模块的理由与 `backoff.ts` / `restart.ts` 相同：调用方 `index.ts`
 * import 了 electron，在 vitest 的 node 环境下无法加载，而这是用户可见的
 * 行为契约，必须有测试守护。
 *
 * 背景：用户在能力选择里勾了「系统托盘 + 原生通知」，其描述包含
 * 「关窗后仍能被唤起」。Windows 上若不拦截 close，关掉主机窗口就会触发
 * `window-all-closed` → 应用退出 → 托盘消失，与该承诺直接冲突。
 */

/** 窗口种类。欢迎页是壳自有工具窗口，语义与主机窗口不同。 */
export type WindowKind = 'host' | 'welcome'

/** 判定输入。 */
export interface CloseDecisionInput {
  /** 触发 close 的窗口种类。 */
  kind: WindowKind
  /** 当前平台（`process.platform`）。 */
  platform: string
  /** 应用是否正在真正退出（由 `before-quit` 置位）。 */
  quitting: boolean
  /**
   * 用户设置：关窗时是否收进托盘（`ClientSettings.hideOnClose`）。
   *
   * **必填**（无默认值）：漏传会静默退回旧行为，而旧行为恰恰是「关窗不退出」——
   * 一个想关掉它的用户会以为设置没生效。宁可让类型检查逼调用方显式表态。
   */
  hideOnClose: boolean
}

/**
 * 判断这次 close 是否应该被拦截并改为隐藏。
 *
 * - 非 darwin 平台（Windows/Linux）：主机窗口在非退出状态下关窗 → 隐藏，
 *   使托盘与其管理入口继续存活；
 * - darwin：保持既有语义（关窗即真关，应用不退出，`activate` 时重开），
 *   不改变 macOS 现状；
 * - 欢迎窗口：任何平台都放行，它是壳自有工具窗口，用户关它就该关掉；
 * - 应用正在退出：任何情况都放行，否则会卡住退出流程；
 * - **`hideOnClose` 为 false（task-19 起的用户设置）**：任何平台都放行，
 *   于是非 darwin 上关窗即真关，`window-all-closed` 随之触发退出判定——
 *   这正是用户显式要求「关窗即退出」时应有的语义。
 *
 * `hideOnClose` 只对**主机窗口**有意义（欢迎窗口本来就放行），因此它与 darwin
 * 一样是「提前放行」的条件，而不是与平台判定并列的开关。
 *
 * @param input - 判定输入。
 * @returns 应该隐藏（true）还是放行关闭（false）。
 */
export function shouldHideOnClose(input: CloseDecisionInput): boolean {
  if (input.quitting) return false
  if (input.kind === 'welcome') return false
  if (!input.hideOnClose) return false
  return input.platform !== 'darwin'
}
