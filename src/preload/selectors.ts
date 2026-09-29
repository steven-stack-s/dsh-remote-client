/**
 * 通知信号的选择器 —— **全项目唯一来源**。
 *
 * 为什么单独成模块：这些选择器指向的是**远端 dsh 前端**的 DOM，属于
 * 「与远端实现耦合」的知识。单独放在一个文件里，dsh 上游改版时只需改这里。
 *
 * ─────────────────────────────────────────────────────────────
 * ⚠️ 现状：两个选择器都还是 `null`，**尚未经过真机勘察**
 * ─────────────────────────────────────────────────────────────
 *
 * dsh 前端的类名是构建期哈希化的（如 `.mna1RW_strip`），跨版本必变，**不可依赖**。
 * 必须从真实运行的前端里找出稳定的 `data-*` / `role` / `aria-*` 属性。
 * 本项目的维护环境没有图形界面、也没有运行中的 dsh，无法自行勘察；
 * 勘察脚本见 `docs/dom-勘察脚本.js`（在客户端窗口的 DevTools Console 里粘贴运行）。
 *
 * **`null` 的语义是「该规则尚未启用」，而不是「没有信号」。**
 * 消费方（`host.ts` 的观察器）必须跳过它：不能把 `null` 交给 `querySelector`
 * （会抛 `SyntaxError`），也不能因为拿不到信号就报错或产生噪音通知。
 * 也就是说，选择器没填时功能只是「不触发」，而不是「坏掉」。
 */

/**
 * 「审批请求出现」的信号选择器。
 *
 * 命中它 → 上报 `urgent: true`。审批是**阻塞用户工作流**的信号，无论窗口是否
 * 聚焦都必须让用户看到（由 `notifications.ts` 的 `shouldNotify` 保证）。
 *
 * TODO(待真机勘察)：dsh 前端的类名是哈希化的（如 .mna1RW_strip），不可依赖；
 * 需要从真实运行的前端里找出稳定的 data-* / role / aria-* 属性。
 * 在拿到勘察结果前，此值为 null —— 观察器应据此跳过该规则而不是报错。
 */
export const APPROVAL_SELECTOR: string | null = null

/**
 * 「新增助手消息」的信号选择器。
 *
 * 命中它 → 上报 `urgent: false`，由主进程按 `win.isFocused()` 决定是否真正弹
 * 通知（窗口已聚焦时用户正看着屏幕，再弹一条通知纯属打扰）。
 *
 * TODO(待真机勘察)：同 {@link APPROVAL_SELECTOR}。注意这条是**兜底规则**，
 * 即使它一直填不出来，审批通知（主规则）仍能独立工作。
 */
export const MESSAGE_SELECTOR: string | null = null

/** 一条可以真正投入使用的通知规则。 */
export interface NotifyRule {
  /** 已勘察确认的选择器；保证非空且非空白。 */
  readonly selector: string
  /** 该信号是否紧急（审批 = 必须通知，消息 = 看窗口是否聚焦）。 */
  readonly urgent: boolean
}

/**
 * 选择器是否可用于 `querySelector`。
 *
 * `null` 之外的空白串同样要剔除：`querySelector('  ')` 会抛 `SyntaxError`，
 * 而占位期的手误（例如填了个空串）应当表现为「该规则不生效」而非崩溃。
 *
 * @param selector - 待检查的选择器。
 * @returns 可用时返回 true，并把类型收窄为 string。
 */
function isUsableSelector(selector: string | null): selector is string {
  return selector !== null && selector.trim() !== ''
}

/**
 * 当前**已启用**的通知规则。
 *
 * 未勘察（`null`）或空白的条目被跳过——这正是「占位期完全静默」的实现点：
 * 两个常量都是 `null` 时返回**空数组**，调用方据此完全不安装 DOM 观察器。
 *
 * 返回顺序即**优先级**：审批（urgent）排在消息之前。同一处 DOM 变化同时命中
 * 两条规则时，观察器只上报第一条，因此审批通知绝不会被同时出现的消息通知挤掉。
 *
 * 参数可覆盖（默认取本模块的两个常量）是为了让「null → 空规则」这条契约
 * 可以被单测直接覆盖，而不必依赖两个常量当时填没填。
 *
 * @param approvalSelector - 审批信号选择器，默认取 {@link APPROVAL_SELECTOR}。
 * @param messageSelector - 消息信号选择器，默认取 {@link MESSAGE_SELECTOR}。
 * @returns 已启用规则的列表；没有任何可用选择器时为空数组。
 */
export function notifyRules(
  approvalSelector: string | null = APPROVAL_SELECTOR,
  messageSelector: string | null = MESSAGE_SELECTOR,
): readonly NotifyRule[] {
  const rules: NotifyRule[] = []
  if (isUsableSelector(approvalSelector)) rules.push({ selector: approvalSelector, urgent: true })
  if (isUsableSelector(messageSelector)) rules.push({ selector: messageSelector, urgent: false })
  return rules
}
