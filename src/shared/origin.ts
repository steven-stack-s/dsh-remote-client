/**
 * 把用户填写的地址规范化为 origin（`协议://主机[:端口]`）。
 *
 * 规范化结果同时用作 cookie authority 的输入，因此必须稳定：
 * WHATWG URL 的 `origin` 已负责小写化主机名、补全/剥离默认端口、
 * 丢弃路径与查询，这里只做协议与凭据的白名单校验。
 *
 * @param input - 用户填写的地址，可省略协议。
 * @returns 规范化后的 origin。
 * @throws 输入为空、协议非 http(s)、内嵌凭据或无法解析时抛出。
 */
export function normalizeOrigin(input: string): string {
  const trimmed = input.trim()
  if (trimmed === '') throw new Error('地址不能为空')

  const candidate = trimmed.includes('://') ? trimmed : `http://${trimmed}`

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new Error(`无法解析的地址：${input}`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`只支持 http/https 协议，收到 ${url.protocol}`)
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('地址中不能包含用户名或密码')
  }
  if (url.hostname === '') throw new Error(`地址缺少主机名：${input}`)

  return url.origin
}

/**
 * 拼出 `unsafely-treat-insecure-origin-as-secure` 开关的值。
 *
 * 只对用户显式配置的 `http://` origin 放行，绝不通配——该开关会让
 * Chromium 把明文源当作安全上下文，范围必须最小。
 *
 * @param origins - 已配置的 origin 列表。
 * @returns 逗号分隔的 http origin；无匹配项时返回空串。
 */
export function insecureOriginsSwitchValue(origins: string[]): string {
  return origins.filter(origin => origin.startsWith('http://')).join(',')
}
