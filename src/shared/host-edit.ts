import { parseHostInput } from './host-input.js'
import type { HostEntry } from './types.js'

/** 编辑窗口提交的原始输入。 */
export interface HostEditInput {
  /** 显示名输入框内容；空白表示保持原值。 */
  label: string
  /** 主机地址输入框内容。 */
  origin: string
  /**
   * launch token 输入框内容。
   *
   * 与显示名不同：**空值表示清除 token**（用户可能就是来清掉一个失效令牌的），
   * 而不是「保持原值」。两者语义不同是刻意的。
   */
  launchToken: string
}

/** 编辑结果。 */
export interface HostEditResult {
  /** 合并后的主机条目（`id` 已按新 origin 重算）。 */
  host: HostEntry
  /** origin 是否发生了变化（变化即意味着原登录态不再被使用）。 */
  originChanged: boolean
}

/**
 * 把编辑窗口的输入合并进一条主机记录。
 *
 * **关于 origin 变化**：`HostEntry.id` 与 Electron partition 名都是
 * `hostIdFromOrigin(origin)` 的派生，因此改地址会换到一个全新的 partition，
 * 原有的登录态（cookie）不会再被使用——调用方必须在此之前警告用户。
 *
 * `id` 由调用方以 `deriveId` 注入（通常是 `hostIdFromOrigin`），因为
 * `hostIdFromOrigin` 位于 main 层，而本模块属于 shared 层，不应反向依赖。
 * 强制注入也保证了「origin 变了就必须重算 id」这件事无法被忘记——
 * 函数签名里没有可选的默认值可绕过。
 *
 * @param host - 原主机条目。
 * @param input - 编辑窗口的输入。
 * @param deriveId - 由 origin 派生稳定 id 的函数。
 * @returns 合并后的条目与 origin 是否变化。
 * @throws 地址非法时抛出（同 {@link parseHostInput}）。
 */
export function applyHostEdit(
  host: HostEntry,
  input: HostEditInput,
  deriveId: (origin: string) => string,
): HostEditResult {
  const parsed = parseHostInput(input.origin)

  // 显示名空白 → 保持原值（不静默清空用户已有的命名）。
  const trimmedLabel = input.label.trim()
  const label = trimmedLabel === '' ? host.label : trimmedLabel

  // token 空白 → 清除（与显示名相反的语义，见 HostEditInput 的说明）。
  const trimmedToken = input.launchToken.trim()
  const tokenFromField = trimmedToken === '' ? undefined : trimmedToken

  // 地址里若带了 token，以地址中的为准（用户直接粘贴了完整 URL）；
  // 否则用输入框的值（可能是 undefined，表示清除）。
  const effectiveToken = parsed.launchToken ?? tokenFromField

  const originChanged = parsed.origin !== host.origin

  const next: HostEntry = {
    // origin 变了就必须重算 id，否则会与 partition 名不一致。
    id: originChanged ? deriveId(parsed.origin) : host.id,
    origin: parsed.origin,
    ...(effectiveToken !== undefined ? { launchToken: effectiveToken } : {}),
    label,
    addedAt: host.addedAt,
    lastUsedAt: Date.now(),
  }

  return { host: next, originChanged }
}
