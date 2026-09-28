import { normalizeOrigin } from './origin.js'

/** 主机输入的解析结果。 */
export interface ParsedHostInput {
  /** 规范化后的 origin（不含 token，保持纯净——它同时是 cookie authority 的输入）。 */
  origin: string
  /** dsh web 的 launch token；输入未提供或为空时省略。 */
  launchToken?: string
}

/**
 * 从用户填写的地址中拆出 origin 与 launch token。
 *
 * **为什么必须单独拆**：`URL.origin` 属性**不包含 query**，因此
 * `normalizeOrigin('http://localhost:3080/?token=abc')` 会把 token 静默丢掉。
 * 而未安装认证插件的 dsh 部署**只能**通过 `?token=` 换取 cookie，
 * 丢 token 就等于完全无法接入。
 *
 * 注意：其余 query 参数一律忽略——它们不是本项目的语义，混进 origin
 * 会污染 cookie authority 并破坏 partition 的稳定性。
 *
 * @param input - 用户填写的地址，可省略协议，可带 `?token=`。
 * @returns 规范化 origin 与可选的 launch token。
 * @throws 输入为空、协议非 http(s)、内嵌凭据或无法解析时抛出（同 {@link normalizeOrigin}）。
 */
export function parseHostInput(input: string): ParsedHostInput {
  // 先按 normalizeOrigin 的语义校验并规范化 origin，非法输入在此抛出。
  const origin = normalizeOrigin(input)

  const token = extractLaunchToken(input)
  return token === undefined ? { origin } : { origin, launchToken: token }
}

/**
 * 构造「带 token 的首次加载 URL」，用于换取 cookie。
 *
 * dsh 只在 `GET /` 且 token 匹配时才下发 Set-Cookie，因此这个 URL 必须
 * 精确指向根路径。token 用 `encodeURIComponent` 编码，避免 `/` `+` `=` 等
 * 字符破坏 URL 结构。
 *
 * @param origin - 规范化后的 origin。
 * @param launchToken - launch token。
 * @returns 用于首次握手的完整 URL。
 */
export function tokenHandshakeUrl(origin: string, launchToken: string): string {
  return `${origin}/?token=${encodeURIComponent(launchToken)}`
}

/**
 * 从输入中提取 `token` 查询参数。
 *
 * 手工解析 query 而非用 `new URL(...).searchParams`，是因为
 * `normalizeOrigin` 对不含 `://` 的输入会自动补 `http://`；直接构造 URL
 * 会在此处重复那份补全逻辑。这里复刻同样的补全，保证两者对同一输入的
 * 理解一致。
 *
 * @param input - 用户填写的原始地址。
 * @returns trim 后非空的 token；无 token 或为空时返回 undefined。
 */
function extractLaunchToken(input: string): string | undefined {
  const trimmed = input.trim()
  if (trimmed === '') return undefined

  const candidate = trimmed.includes('://') ? trimmed : `http://${trimmed}`

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    // 解析失败的情况已由 normalizeOrigin 抛出更贴切的错误，这里静默返回。
    return undefined
  }

  const raw = url.searchParams.get('token')
  if (raw === null) return undefined

  const token = raw.trim()
  // 空串视为「没有 token」：`?token=` 与 `?token=%20%20` 都是用户误操作，
  // 把它们当成有效令牌只会换来一次必然失败的握手。
  return token === '' ? undefined : token
}
