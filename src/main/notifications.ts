/**
 * 原生通知：**纯逻辑** + 与 Electron 的解耦包装。
 *
 * 分层理由与 `backoff.ts` / `lifecycle.ts` / `reload.ts` / `menu-state.ts` 相同：
 * vitest 跑在 node 环境下，**不能 import 含 electron 的模块**（`require('electron')`
 * 会触发下载 Electron 二进制，测试直接挂起）。因此本模块**没有**任何 electron
 * 值导入——Electron 的 `Notification` 由调用方（`index.ts`）装配成一个
 * {@link NotificationPort} 传进来。这样「什么时候该弹通知」这个真正会出错的
 * 决策逻辑可以被单测完整覆盖，而 `import { Notification } from 'electron'`
 * 只出现在本来就无法测试的 `index.ts` 里。
 *
 * 触发信号来自 preload 的 DOM 观察器，但**是否真的打扰用户**由这里决定：
 * 审批必须被看到，消息只在窗口失焦时才值得提醒，且任何通知都不能在短时间内
 * 重复轰炸。
 */

/**
 * 同一信号的最小通知间隔（毫秒）。
 *
 * 5 秒来自规格 §5.4（「同一会话内 5 秒内的重复触发做去重，避免连续 chunk
 * 造成通知轰炸」）。preload 侧还有一层同窗口的 IPC 去重，两层互补：
 * 渲染侧省掉跨进程开销，这里守住跨信号的最终闸门。
 */
export const NOTIFY_DEDUPE_MS = 5000

/** {@link shouldNotify} 的输入。 */
export interface ShouldNotifyInput {
  /** 是否为必须让用户看到的信号（审批 = true，普通消息 = false）。 */
  readonly urgent: boolean
  /** 窗口当前是否聚焦（由主进程 `win.isFocused()` 提供，preload 不重复实现）。 */
  readonly windowFocused: boolean
  /** 上一次真正弹出通知的时间戳；从未弹过时为 undefined。 */
  readonly lastNotifiedAt: number | undefined
  /** 当前时间戳。 */
  readonly now: number
  /** 去重窗口（毫秒）。 */
  readonly dedupeMs: number
}

/**
 * 判断此刻是否应当弹出原生通知。
 *
 * 规则（顺序即优先级）：
 * 1. **去重优先**：距上次通知不足 `dedupeMs` → 不通知。**urgent 同样受约束**——
 *    否则审批与紧随其后的消息会各弹一条，反而是噪音；
 * 2. `urgent === true` → **无条件通知**（审批会阻塞用户的工作流，哪怕窗口
 *    正聚焦也必须让他看到；这是与普通消息唯一的区别）；
 * 3. `urgent === false` → **仅当窗口未聚焦时**通知（窗口聚焦说明用户正看着，
 *    再弹一条系统通知纯属打扰）；
 * 4. `lastNotifiedAt` 为 `undefined` → 不受去重约束（本次是首次通知）。
 *
 * 时钟回拨（`now < lastNotifiedAt`）时差值仍小于 `dedupeMs`，按「窗口内」处理——
 * 宁可少弹一条，也不要在时间源异常时退化成每次 DOM 变化都弹。
 *
 * @param input - 判定输入，见 {@link ShouldNotifyInput}。
 * @returns 应当通知时返回 true。
 */
export function shouldNotify(input: ShouldNotifyInput): boolean {
  const { urgent, windowFocused, lastNotifiedAt, now, dedupeMs } = input
  if (lastNotifiedAt !== undefined && now - lastNotifiedAt < dedupeMs) return false
  if (urgent) return true
  return !windowFocused
}

/** preload 通过 `shell:notify` 上报的内容（已校验）。 */
export interface NotifyRequest {
  /** 是否为必须让用户看到的信号。 */
  readonly urgent: boolean
  /**
   * 上报时的 `document.title`，形如 `会话名 — DeepSeek Harness`。
   * 仅作为**通知文案的线索**使用，不作为任何判定的依据；可能为空串。
   */
  readonly title: string
}

/**
 * 校验来自 IPC 的 `shell:notify` 负载。
 *
 * 远端主机页面是本项目明确认定的**不可信内容**，其上报必须当作外部输入处理：
 * 类型不符直接丢弃，绝不猜测或强转（`{ urgent: 'yes' }` 这种值一旦被当真，
 * 就会变成「不可信页面随意弹系统通知」）。
 *
 * @param raw - IPC 传进来的原始负载。
 * @returns 合法时返回规范化后的请求，否则返回 undefined。
 */
export function parseNotifyRequest(raw: unknown): NotifyRequest | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const { urgent, title } = raw as { urgent?: unknown, title?: unknown }
  if (typeof urgent !== 'boolean') return undefined
  return { urgent, title: typeof title === 'string' ? title : '' }
}

/** 通知正文的最大长度：系统通知气泡只显示一两行，超长会被截断且难读。 */
export const NOTIFY_BODY_MAX = 60

/**
 * 从页面标题里取出会话名。
 *
 * dsh 的 `document.title` 形如 `会话名 — DeepSeek Harness`。取**最后一个**
 * 破折号之前的部分：会话名自身可能含破折号（`修复 — 登录 — DeepSeek Harness`
 * 应得到 `修复 — 登录`），而产品名固定在末尾。
 *
 * @param documentTitle - preload 上报的 `document.title`。
 * @param hostLabel - 主机显示名，标题取不出会话名时的兜底。
 * @returns 会话名；取不出时返回主机显示名。
 */
export function sessionNameFromDocumentTitle(documentTitle: string, hostLabel: string): string {
  const trimmed = documentTitle.trim()
  const index = trimmed.lastIndexOf('—')
  const name = index > 0 ? trimmed.slice(0, index).trim() : trimmed
  return name === '' ? hostLabel : name
}

/**
 * 生成通知正文。
 *
 * 刻意**不**放消息内容：既拿不到（preload 零侵入，不读页面文本），也不该放
 * （长正文会被系统截断，且把远端内容整条搬进系统通知没有意义）。用户点开
 * 通知就能看到真实内容。
 *
 * @param urgent - 是否为审批信号。
 * @param sessionName - 会话名（见 {@link sessionNameFromDocumentTitle}）。
 * @returns 简短正文，长度不超过 {@link NOTIFY_BODY_MAX}。
 */
export function notifyBody(urgent: boolean, sessionName: string): string {
  const head = urgent ? '有审批请求等待处理' : '收到新消息'
  const body = sessionName === '' ? head : `${head}（${sessionName}）`
  return body.length > NOTIFY_BODY_MAX ? `${body.slice(0, NOTIFY_BODY_MAX - 1)}…` : body
}

/** 一条已弹出的通知句柄（`electron.Notification` 的最小投影）。 */
export interface NativeNotificationHandle {
  /** 显示通知。 */
  show: () => void
  /** 注册点击回调（点击通知应唤起窗口）。 */
  onClick: (handler: () => void) => void
}

/**
 * 原生通知端口。
 *
 * 把 `electron.Notification` 抽象成接口，使本模块可以被 vitest 直接加载
 * （见文件头说明）。实现放在 `index.ts`。
 */
export interface NotificationPort {
  /** 当前平台/环境是否支持原生通知（对应 `Notification.isSupported()`）。 */
  isSupported: () => boolean
  /** 创建一条待显示的通知。 */
  create: (options: { title: string, body: string }) => NativeNotificationHandle
}

/** {@link Notifier.notify} 的输入。 */
export interface NotifyContext {
  /** 是否为必须让用户看到的信号。 */
  readonly urgent: boolean
  /** 窗口当前是否聚焦。 */
  readonly windowFocused: boolean
  /** 主机显示名，用作通知标题。 */
  readonly hostLabel: string
  /** preload 上报的 `document.title` 线索。 */
  readonly titleHint: string
  /** 点击通知时执行的动作（唤起并聚焦对应窗口）。 */
  readonly onActivate: () => void
}

/** 通知器。 */
export interface Notifier {
  /**
   * 按 {@link shouldNotify} 的规则决定是否弹出通知。
   *
   * @param context - 判定与文案所需的全部输入。
   * @returns 真的弹出了通知时返回 true；因平台不支持或去重/聚焦而抑制时返回 false。
   */
  notify: (context: NotifyContext) => boolean
  /** 遗忘去重时间戳（下一次通知不受本次约束）。 */
  reset: () => void
}

/**
 * 创建通知器。
 *
 * 去重时间戳记在闭包里，且**只在真的弹出通知时**更新——被聚焦判定或平台
 * 不支持抑制掉的那次不该占用去重窗口，否则「抑制一次」会让紧随其后的
 * 真正该通知的信号也被吃掉。
 *
 * 注意去重是**全局单时间戳**（对应规格 §5.4 的单一 5 秒窗口）：一条消息通知
 * 之后的 5 秒内到达的审批通知也会被抑制。这是有意的取舍——防轰炸优先于
 * 逐条送达；若日后要按信号分别计时，改动点集中在本函数与 `shouldNotify`。
 *
 * @param port - 原生通知端口。
 * @param now - 取当前时间的函数，默认 `Date.now`（便于测试注入）。
 * @returns 通知器。
 */
export function createNotifier(port: NotificationPort, now: () => number = Date.now): Notifier {
  let lastNotifiedAt: number | undefined

  return {
    notify: (context: NotifyContext): boolean => {
      // 平台不支持时直接放弃：`Notification.isSupported()` 为 false 的平台
      // （如缺少通知守护进程的 Linux）构造 Notification 也不会显示。
      if (!port.isSupported()) return false

      const at = now()
      const allowed = shouldNotify({
        urgent: context.urgent,
        windowFocused: context.windowFocused,
        lastNotifiedAt,
        now: at,
        dedupeMs: NOTIFY_DEDUPE_MS,
      })
      if (!allowed) return false

      lastNotifiedAt = at
      const sessionName = sessionNameFromDocumentTitle(context.titleHint, context.hostLabel)
      const notification = port.create({
        title: context.hostLabel,
        body: notifyBody(context.urgent, sessionName),
      })
      // 先挂点击回调再 show：show() 之后用户可能立刻点击，回调必须已经在位。
      notification.onClick(() => { context.onActivate() })
      notification.show()
      return true
    },
    reset: (): void => { lastNotifiedAt = undefined },
  }
}
