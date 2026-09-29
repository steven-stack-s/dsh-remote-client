import { ipcRenderer } from 'electron'
import {
  notifyRules,
  type AppearRule,
  type AttributeRemovedRule,
  type NotifyRule,
} from './selectors.js'

/**
 * 渲染侧观察器：只上报网络连通性与**通知信号**。
 *
 * 这里刻意不调用 contextBridge.exposeInMainWorld——远端页面无需知道
 * 自己被壳承载，保持零侵入。
 *
 * 标题**不**在这里上报：`windows.ts` 已监听 Electron 原生的
 * `page-title-updated` 事件，那是零跨进程开销的唯一正路。
 * 早期版本用 MutationObserver 观察整个文档并逐次 send，在 dsh 流式输出
 * 时 DOM 每秒变化上百次，会造成 IPC 风暴，且与原生事件抢着 setTitle。
 * 下面的通知观察器刻意避开了那个坑：**只在命中规则时才发 IPC**。
 */
window.addEventListener('online', () => { ipcRenderer.send('shell:network', true) })
window.addEventListener('offline', () => { ipcRenderer.send('shell:network', false) })

/**
 * 通知信号的渲染侧去重窗口（毫秒）。
 *
 * 主进程还有一层去重（`notifications.ts` 的 `NOTIFY_DEDUPE_MS`），两层互补：
 * 这一层挡在**跨进程之前**，把同一信号的高频重复压成 5 秒一条 IPC；主进程那层
 * 是最终闸门，负责跨信号（审批 vs 消息）的防轰炸。
 * 只靠主进程那层是不够的——IPC 本身有成本，而观察器回调会在每批 DOM 变化时被唤醒。
 */
const REPORT_DEDUPE_MS = 5000

/**
 * 安装通知观察器。
 *
 * **没有任何已启用的选择器时完全不安装**（见 `selectors.ts`）：这里在第一行就
 * 返回，既不创建 MutationObserver 也不触碰 `document.body`——功能只是「不触发」，
 * 而不是空转、报错或产生噪音。
 *
 * 两种触发方式**共存于同一个观察器**：
 * - `childList`（节点出现）+ `appear` 规则 → 审批卡片出现；
 * - `attributeFilter`（属性变化）+ `attribute-removed` 规则 → 流式结束。
 * 观察配置里**两者都必须在**：只留 `childList` 看不到属性变化（消息通知永不触发），
 * 只留属性则看不到新增节点（会弄坏已验证可用的审批通知）。
 */
function installNotifyObserver(): void {
  const rules = notifyRules()
  // 一条规则都没有（例如两个选择器都还是 null）→ 连观察器都不创建。
  // 这一点很重要：没有规则的观察器仍会在每次 DOM 变化时被唤醒，
  // 而 dsh 流式输出时 DOM 每秒变化上百次，纯属浪费。
  if (rules.length === 0) return

  // 选择器写错时 `querySelector` 会抛 SyntaxError——那会让观察器的**每一次**
  // 回调都抛错。这里先校验一遍并剔除非法规则：宁可漏报一条通知，也不能让
  // 观察器变成错误的源头。
  const usable = rules.filter((rule: NotifyRule): boolean => {
    try {
      document.querySelector(rule.selector)
      return true
    } catch {
      console.error('[dsh-remote-client] 通知选择器非法，已跳过：', rule.selector)
      return false
    }
  })
  if (usable.length === 0) return

  // 按触发方式分流。`appear` 走 childList，`attribute-removed` 走属性回调。
  const appearRules: readonly AppearRule[] = usable.filter(
    (rule): rule is AppearRule => rule.trigger === 'appear',
  )
  const attributeRules: readonly AttributeRemovedRule[] = usable.filter(
    (rule): rule is AttributeRemovedRule => rule.trigger === 'attribute-removed',
  )

  /**
   * 需要观察的属性名（去重）。
   *
   * 从规则本身取，而不是把 `'data-streaming'` 写死在观察配置里——那样改选择器时
   * 还得记得改这里，漏改就变成静默失效。
   */
  const observedAttributes = [...new Set(attributeRules.map(rule => rule.attribute))]

  /** 规则的选择器 → 上次上报时间；同一规则在去重窗口内只发一次 IPC。 */
  const lastReportedAt = new Map<string, number>()

  /**
   * 上报一条信号。
   *
   * 标题线索取自 `document.title`（形如 `会话名 — DeepSeek Harness`），
   * 供主进程拼通知正文；它**不是**判定依据，主进程只把它当文案素材。
   *
   * @param rule - 命中的规则。
   */
  const report = (rule: NotifyRule): void => {
    const at = Date.now()
    const previous = lastReportedAt.get(rule.selector)
    if (previous !== undefined && at - previous < REPORT_DEDUPE_MS) return
    lastReportedAt.set(rule.selector, at)
    ipcRenderer.send('shell:notify', { urgent: rule.urgent, title: document.title })
  }

  /**
   * 判定一条「属性被移除」规则是否真的命中。
   *
   * 三个条件缺一不可：
   * 1. `mutation.attributeName` 等于规则关心的属性；
   * 2. 变化后该属性**确实不存在**——「被改成别的值」不算（那说明流式仍在继续）。
   *    这里用 `hasAttribute()` 表达「`getAttribute()` 为 null」，两者是同一个判据；
   * 3. 目标必须还是元素（属性变更的 target 一定是 Element，这里只是稳妥收窄）。
   *
   * ⚠️ **这里刻意不用 `target.matches(rule.selector)` 复核**：属性规则的典型选择器
   * 就是 `[data-streaming]`，而属性此刻**已经被移除**，元素必然不再匹配它——
   * 拿它复核等于永远不触发。选择器在这类规则里的作用，是声明「信号挂在哪些元素上」
   * 以及在安装时做一次语法校验；运行时的判据就是「规则关心的属性确实消失了」。
   *
   * @param mutation - 属性变更记录。
   * @param rule - 待判定的规则。
   * @returns 命中时返回 true。
   */
  const isAttributeRemoved = (mutation: MutationRecord, rule: AttributeRemovedRule): boolean => {
    if (mutation.attributeName !== rule.attribute) return false
    const target = mutation.target
    if (!(target instanceof Element)) return false
    return !target.hasAttribute(rule.attribute)
  }

  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') {
        for (const rule of attributeRules) {
          if (isAttributeRemoved(record, rule)) report(rule)
        }
        continue
      }

      // 剩余的都是 childList：只看新增节点（审批卡片出现）。
      for (const node of record.addedNodes) {
        // 只看元素：新增的文本节点不可能是审批卡片或消息气泡的根节点。
        if (!(node instanceof Element)) continue
        // 顺序即优先级（审批在消息之前，见 selectors.ts 的 notifyRules）：
        // 同一节点同时命中多条规则时**只上报优先级最高的一条**，避免同一处
        // DOM 变化弹出两条通知，也避免审批通知被消息通知抢先。
        const matched = appearRules.find(
          rule => node.matches(rule.selector) || node.querySelector(rule.selector) !== null,
        )
        if (matched !== undefined) report(matched)
      }
    }
  })

  /**
   * 开始观察。`document.body` 尚不存在时不能观察，否则 observe 会抛错。
   *
   * **`childList` 与属性观察必须同时存在**（见本函数说明）。
   * 属性这一路是 task-19 新增的性能关键项：不过滤的话，dsh 流式输出期间每一次
   * class/style 变化都会把回调唤醒一次，而我们只关心 `data-streaming`。
   */
  const start = (): void => {
    if (document.body === null) return
    const options: MutationObserverInit = { childList: true, subtree: true }
    if (observedAttributes.length > 0) {
      // `attributes: true` 与 `attributeFilter` 一起给出：规范里 attributeFilter
      // 本身就隐含「观察属性」，但显式写出来更不容易被后人误读成「忘了开属性观察」
      // 而好心补上通配的 `attributes: true`。
      //
      // **只有真要观察属性时才开**：单独开 `attributes: true` 会变成观察**所有**
      // 属性，流式输出期间每一次 class/style 变化都会唤醒回调——那正是本任务要
      // 避免的风暴。
      options.attributes = true
      options.attributeFilter = observedAttributes
    }
    observer.observe(document.body, options)
  }

  // preload 早于 DOM 就绪执行，`document.body` 此时通常还是 null。
  if (document.body !== null) start()
  else document.addEventListener('DOMContentLoaded', start, { once: true })
}

installNotifyObserver()
