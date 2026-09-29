import { ipcRenderer } from 'electron'
import { notifyRules, type NotifyRule } from './selectors.js'

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
 * 下面的通知观察器刻意避开了那个坑：**只在新节点命中选择器时**才发 IPC。
 */
window.addEventListener('online', () => { ipcRenderer.send('shell:network', true) })
window.addEventListener('offline', () => { ipcRenderer.send('shell:network', false) })

/**
 * 通知信号的渲染侧去重窗口（毫秒）。
 *
 * 主进程还有一层去重（`notifications.ts` 的 `NOTIFY_DEDUPE_MS`），两层互补：
 * 这一层挡在**跨进程之前**，把 dsh 流式输出期间同一信号的高频重复压成 5 秒
 * 一条 IPC；主进程那层是最终闸门，负责跨信号（审批 vs 消息）的防轰炸。
 * 只靠主进程那层是不够的——IPC 本身有成本，而观察器回调会在每批 DOM 变化
 * 时被唤醒。
 */
const REPORT_DEDUPE_MS = 5000

/**
 * 安装通知观察器。
 *
 * **没有任何已启用的选择器时完全不安装**（见 `selectors.ts`）：两个选择器都
 * 还是 `null` 的占位期，这里在第一行就返回，既不创建 MutationObserver 也不
 * 触碰 `document.body`——功能只是「不触发」，而不是空转、报错或产生噪音。
 */
function installNotifyObserver(): void {
  const rules = notifyRules()
  // 占位期（两个选择器均为 null）→ 空规则数组 → 连观察器都不创建。
  // 这一点很重要：没有规则的观察器仍会在每次 DOM 变化时被唤醒，
  // 而 dsh 流式输出时 DOM 每秒变化上百次，纯属浪费。
  if (rules.length === 0) return

  // 选择器来自真机勘察，写错时 `querySelector` 会抛 SyntaxError——那会让
  // 观察器的**每一次**回调都抛错。这里先校验一遍并剔除非法规则：宁可漏报
  // 一条通知，也不能让观察器变成错误的源头。
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

  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        // 只看元素：新增的文本节点不可能是审批卡片或消息气泡的根节点。
        if (!(node instanceof Element)) continue
        // 顺序即优先级（审批在消息之前，见 selectors.ts 的 notifyRules）：
        // 同一节点同时命中两条规则时**只上报优先级最高的一条**，避免同一处
        // DOM 变化弹出两条通知，也避免审批通知被消息通知抢先。
        const matched = usable.find(
          rule => node.matches(rule.selector) || node.querySelector(rule.selector) !== null,
        )
        if (matched !== undefined) report(matched)
      }
    }
  })

  /** 开始观察。`document.body` 尚不存在时不能观察，否则 observe 会抛错。 */
  const start = (): void => {
    if (document.body === null) return
    observer.observe(document.body, { childList: true, subtree: true })
  }

  // preload 早于 DOM 就绪执行，`document.body` 此时通常还是 null。
  if (document.body !== null) start()
  else document.addEventListener('DOMContentLoaded', start, { once: true })
}

installNotifyObserver()
