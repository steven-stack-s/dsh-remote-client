/**
 * 「重新加载主机」的目标 URL 判定。
 *
 * 单独成模块的理由与 `backoff.ts` / `restart.ts` / `lifecycle.ts` 相同：
 * 调用方 `windows.ts` import 了 electron，在 vitest 的 node 环境下无法加载。
 *
 * 这个约束来自真实故障：UGOS 等容器远程地址的第一跳会 302 到 SSO 门户
 * （如 `http://shitaixi.cn72.ug.link/desktop/#/login/account`），登录完成后
 * 门户 SPA 不提供 return-URL 回跳，客户端就永远停在门户桌面上。此时
 * `webContents.reload()` 只会再加载门户桌面——**必须重新加载配置里的
 * `host.origin`**，让已带上登录态的 partition 重新请求真正的目标地址。
 */

/**
 * 计算「重新加载」应加载的 URL。
 *
 * 恒为配置中的 `host.origin`，**与当前 URL 无关**——这正是本函数存在的意义：
 * 把「不能用当前 URL」这条约束固化成可测的契约，避免日后有人图省事改成
 * `reload()` 而悄悄退回门户桌面。
 *
 * @param hostOrigin - 主机配置里的 origin（规范化后）。
 * @param currentUrl - 窗口当前实际 URL，仅供审计/日志；不参与决策。
 * @returns 应当加载的 URL。
 */
export function reloadTargetFor(hostOrigin: string, currentUrl: string | undefined): string {
  // currentUrl 刻意不参与计算。保留该参数是为了让调用点显式暴露
  // 「当前已重定向到别处」这一事实，并在测试中断言它不被采纳。
  void currentUrl
  return hostOrigin
}
