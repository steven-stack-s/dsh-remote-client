/**
 * 通知信号的选择器 —— **全项目唯一来源**。
 *
 * 为什么单独成模块：这些选择器指向的是**远端 dsh 前端**的 DOM，属于
 * 「与远端实现耦合」的知识。单独放在一个文件里，dsh 上游改版时只需改这里。
 *
 * ─────────────────────────────────────────────────────────────
 * 现状：两条规则均已从上游组件源码勘察确认并启用
 * ─────────────────────────────────────────────────────────────
 *
 * dsh 前端的类名是构建期哈希化的（如 `.mna1RW_strip`），跨版本必变，**不可依赖**；
 * 判据只能取稳定的 `data-*` / `role` / `aria-*` 属性。这些属性可直接从 dsh 的
 * 客户端 UI 包里读出来（`@deepseek-ai/dsh-client-ui-…` 的 `lib/client.js`），
 * 不必依赖运行时勘察。
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
 * **触发方式：节点出现**（`trigger: 'appear'`）——新增节点命中本选择器即触发。
 *
 * **来源**：dsh 的审批卡片组件 `dsh-client-ui-approval`（0.1.7-rc.2）里：
 *
 * ```js
 * jsx("div", {
 *   className: ApprovalPanel_module_css_default.root,   // 哈希化，不可依赖
 *   "data-approval-key": pending.key,                   // ← 稳定
 *   "aria-busy": answered,                              // ← 稳定
 * })
 * ```
 *
 * `answered` 是 `useState(false)`：**初始 false = 等待用户回应**，用户点选后
 * 置 true（同一组件里 `disabled: answered`、状态点 `answered ? "ongoing" : "warning"`
 * 都印证了这个语义）。因此「未回答」即「需要提醒用户」。
 *
 * **为什么写 `:not([aria-busy="true"])` 而不是 `[aria-busy="false"]`**：
 * React 对 `aria-*` 的布尔值理论上会字符串化成 `"false"`，但这是框架细节；
 * 用「非 true」表达同一语义，无论上游渲染成 `"false"` 还是省略该属性都能命中，
 * 而「已回答」一侧（`"true"`）的排除效果完全相同。
 *
 * ⚠️ **这条规则已在真机验证可用（审批通知能弹出），不要改动它的选择器与 urgent。**
 */
export const APPROVAL_SELECTOR: string | null = '[data-approval-key]:not([aria-busy="true"])'

/**
 * 「一轮回复结束」信号所依赖的属性名。
 *
 * 单独提出来，是因为观察器需要**按属性名过滤**（`attributeFilter`），而属性名与
 * 选择器必须一致——{@link MESSAGE_SELECTOR} 直接由它拼出，两者无法漂移。
 */
export const MESSAGE_ATTRIBUTE = 'data-streaming'

/**
 * 「一轮回复结束」的信号选择器。
 *
 * ⚠️ **触发方式与审批规则不同：这是「属性消失」，不是「节点出现」**
 * （`trigger: 'attribute-removed'`）。命中本选择器的元素上，
 * {@link MESSAGE_ATTRIBUTE} 属性**被移除**时才触发；元素出现本身**不**触发。
 * 后人若把它当成 `appear` 规则处理，会得到「回复刚开始就通知」的反向行为。
 *
 * ⚠️ **它同时匹配两类元素**：`dsh-client-ui-chat` 里思考行（`ReasoningRow`）与
 * 正文（`AssistantMarkdown`）都带这个属性（分别是 `running` 与 `streaming`）。
 * 所以一轮之内它可能**反复触发**——这不是缺陷，而是选它的代价：两者用的是
 * 同一个属性名，前端没有更细的区分。真正把它压成「一次」的是主进程的**静默期**
 * （`notifications.ts` 的 `QUIET_PERIOD_MS`）：每次触发都重置计时，只有连续
 * 15 秒没有新输出才算这一轮真的停了。
 *
 * 上报 `urgent: false`，由主进程按 `win.isFocused()` 决定是否真正弹通知——
 * **窗口聚焦时用户正看着屏幕，不该再被打扰**（这是设计意图，不是缺陷）。
 *
 * **来源**：dsh 对话流组件 `dsh-client-ui-chat` 里
 * `"data-streaming": streaming || void 0`（值为 falsy 时 React 直接**移除**该属性）：
 * - 属性存在 → 正在流式输出；
 * - 属性消失 → **输出暂停或结束** ← 此刻上报，由主进程判是不是真的结束。
 *
 * 注意「消失」的判定很苛刻：**属性被改成别的值不算**（那说明流式仍在继续）。
 * 观察器里的具体判定见 `host.ts`。
 */
export const MESSAGE_SELECTOR: string | null = `[${MESSAGE_ATTRIBUTE}]`

/** 规则的触发方式。 */
export type NotifyTrigger =
  /** 新增节点命中选择器即触发（审批卡片出现）。 */
  | 'appear'
  /** 命中选择器的元素上，指定属性**被移除**时触发（流式结束）。 */
  | 'attribute-removed'

/** 「节点出现」类规则。 */
export interface AppearRule {
  /** 触发方式。 */
  readonly trigger: 'appear'
  /** 已勘察确认的选择器；保证非空且非空白。 */
  readonly selector: string
  /** 该信号是否紧急（审批 = 必须通知，消息 = 看窗口是否聚焦）。 */
  readonly urgent: boolean
}

/** 「属性被移除」类规则。 */
export interface AttributeRemovedRule {
  /** 触发方式。 */
  readonly trigger: 'attribute-removed'
  /** 已勘察确认的选择器；保证非空且非空白。 */
  readonly selector: string
  /** 该信号是否紧急。 */
  readonly urgent: boolean
  /**
   * 要观察的属性名（它的**消失**代表信号）。
   *
   * 做成必填字段、而不是让观察器写死 `'data-streaming'`：观察器的 `attributeFilter`
   * 由它推导；写死等于把同一个知识存了两份，改选择器时漏改一处会**静默失效**。
   */
  readonly attribute: string
}

/** 一条可以真正投入使用的通知规则。 */
export type NotifyRule = AppearRule | AttributeRemovedRule

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
 * 返回顺序即**优先级**：审批（urgent）排在消息之前。同一次 DOM 变化同时命中
 * 两条 `appear` 规则时，观察器只上报第一条，因此审批通知绝不会被同时出现的
 * 消息通知挤掉。
 *
 * 参数可覆盖（默认取本模块的三个常量）是为了让「null → 空规则」这条契约可以
 * 被单测直接覆盖，而不必依赖常量当时填没填。
 *
 * @param approvalSelector - 审批信号选择器，默认取 {@link APPROVAL_SELECTOR}。
 * @param messageSelector - 消息信号选择器，默认取 {@link MESSAGE_SELECTOR}。
 * @param messageAttribute - 消息信号依赖的属性名，默认取 {@link MESSAGE_ATTRIBUTE}。
 * @returns 已启用规则的列表；没有任何可用选择器时为空数组。
 */
export function notifyRules(
  approvalSelector: string | null = APPROVAL_SELECTOR,
  messageSelector: string | null = MESSAGE_SELECTOR,
  messageAttribute: string = MESSAGE_ATTRIBUTE,
): readonly NotifyRule[] {
  const rules: NotifyRule[] = []
  if (isUsableSelector(approvalSelector)) {
    rules.push({ trigger: 'appear', selector: approvalSelector, urgent: true })
  }
  // 属性名为空时这条规则无从观察，视同未启用（否则 attributeFilter 里会出现空串）。
  if (isUsableSelector(messageSelector) && messageAttribute.trim() !== '') {
    rules.push({
      trigger: 'attribute-removed',
      selector: messageSelector,
      urgent: false,
      attribute: messageAttribute,
    })
  }
  return rules
}
