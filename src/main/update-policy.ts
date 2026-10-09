/**
 * 更新提示策略：**纯逻辑**，不 import electron。
 *
 * 分层理由与 `notifications.ts` / `backoff.ts` / `lifecycle.ts` 相同：vitest 跑在
 * node 环境下，**不能 import 含 electron 的模块**（`require('electron')` 会触发下载
 * Electron 二进制，测试直接挂起）。本模块没有任何 electron 值导入，因此「该不该向
 * 用户提示有新版本」这个真正会出错的决策可以被单测完整覆盖；`autoUpdater` 的事件
 * 接线留在本来就无法测试的 `index.ts` / `updater.ts` 里。
 *
 * **只做字符串相等比较，不引入 semver 依赖**：`electron-updater` 自己已经判断过
 * 「确实有更新」才会把版本号交给我们，这里只需回答「这个版本我提示过没有」。用相等
 * 比较还顺带免疫了预发布版本号的解析问题（本仓真出现过 `0.1.4-diagnostic.1`，它不是
 * 标准 semver 的比较对象）。
 */

/** 启动后多久做第一次检查（毫秒）。避开启动高峰，别和首屏抢资源。 */
export const UPDATE_CHECK_DELAY_MS = 30_000

/** 之后每隔多久再查一次（毫秒）。用于长期驻留托盘时的兜底检查。 */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export interface PromptDecisionInput {
  readonly availableVersion: string
  readonly promptedVersion: string | undefined
}

/**
 * 是否应该就 `availableVersion` 向用户弹出「是否重启安装」的询问。
 *
 * 同一版本只问一次：用户点过「稍后」之后不再重复打扰，直到出现**另一个**版本号。
 */
export function shouldPromptForUpdate(input: PromptDecisionInput): boolean {
  const available = input.availableVersion.trim()
  if (available === '') return false
  return available !== input.promptedVersion
}
