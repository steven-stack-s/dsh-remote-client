/**
 * 「新增 http 主机后是否需重启客户端」的判定。
 *
 * 单独成模块（而非留在 `index.ts` 里）的理由与 `backoff.ts` 相同：
 * `index.ts` import 了 electron，在 vitest 的 node 环境下无法加载，
 * 而这是规格 §5.3 承诺的行为，必须有测试守护。
 *
 * 背景：`unsafely-treat-insecure-origin-as-secure` 只能在 `app.whenReady()`
 * 之前设置，因此启动时生效的 origin 列表是**冻结**的。运行时新增的 `http://`
 * 主机不在其中，其页面不是安全上下文，`navigator.clipboard` 等特性会静默失效——
 * 必须显式提示用户重启，否则用户会误以为功能是坏的。
 */

/**
 * 判断新添加的主机是否必须重启客户端才能获得完整的浏览器安全特性。
 *
 * @param origin - 新添加主机的规范化 origin。
 * @param effectiveAtStartup - 启动时已写入安全上下文开关的 origin 列表。
 * @returns 需要重启时返回 true。
 */
export function needsRestartFor(origin: string, effectiveAtStartup: readonly string[]): boolean {
  // 只有明文 http origin 受此开关影响；https 天生就是安全上下文。
  if (!origin.startsWith('http://')) return false
  return !effectiveAtStartup.includes(origin)
}
