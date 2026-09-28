/** 首次重试延迟（毫秒）。 */
export const RETRY_BASE_MS = 1000

/** 重试延迟上限（毫秒），规格 §8 要求。 */
export const RETRY_MAX_MS = 30_000

/**
 * 计算第 `attempt` 次重试的延迟：1s → 2s → 4s → 8s → …，上限 30s。
 *
 * 单独成模块（而非留在 `windows.ts` 里）是为了可测：该文件 import 了
 * electron，在 vitest 的 node 环境下无法加载。退避曲线是规格承诺的行为，
 * 必须有测试覆盖。
 *
 * @param attempt - 从 0 开始的失败次数。
 * @returns 延迟毫秒数。
 */
export function backoffDelay(attempt: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS)
}
