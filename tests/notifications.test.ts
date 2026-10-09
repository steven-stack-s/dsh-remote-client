import { describe, expect, it } from 'vitest'
import {
  NOTIFY_BODY_MAX,
  NOTIFY_DEDUPE_MS,
  QUIET_PERIOD_MS,
  createNotifier,
  createQuietGate,
  notifyBody,
  parseNotifyRequest,
  sessionNameFromDocumentTitle,
  shouldNotify,
  type NotificationPort,
} from '../src/main/notifications.js'

/**
 * `shouldNotify` 的判定表。
 *
 * 这组断言存在的理由：通知是**唯一会打断用户**的能力，误报（窗口正聚焦还弹）
 * 与漏报（审批到了却不提醒）都是真实缺陷，而它们全部收敛在这个纯函数里。
 * 本模块刻意不 import electron，因此可以被直接加载测试（见文件头说明）。
 */
describe('shouldNotify', () => {
  /** 基准输入：非紧急、窗口未聚焦、从未通知过。各用例只覆盖自己关心的字段。 */
  const base = {
    urgent: false,
    windowFocused: false,
    lastNotifiedAt: undefined as number | undefined,
    now: 10_000,
    dedupeMs: NOTIFY_DEDUPE_MS,
  }

  it('urgent + 未聚焦 → 通知', () => {
    expect(shouldNotify({ ...base, urgent: true })).toBe(true)
  })

  it('urgent + 已聚焦 → 仍然通知（审批无条件，必须被用户看到）', () => {
    expect(shouldNotify({ ...base, urgent: true, windowFocused: true })).toBe(true)
  })

  it('非 urgent + 未聚焦 → 通知', () => {
    expect(shouldNotify(base)).toBe(true)
  })

  it('非 urgent + 已聚焦 → 不通知（用户正看着屏幕）', () => {
    expect(shouldNotify({ ...base, windowFocused: true })).toBe(false)
  })

  it('距上次通知不足 dedupeMs → 不通知', () => {
    expect(shouldNotify({ ...base, lastNotifiedAt: 6000 })).toBe(false)  // 相隔 4000ms
  })

  it('urgent 同样受去重约束（否则审批 + 紧随的消息会各弹一条）', () => {
    expect(shouldNotify({ ...base, urgent: true, lastNotifiedAt: 9_999 })).toBe(false)
  })

  it('距上次通知恰好等于 dedupeMs → 通知（边界取不到等号）', () => {
    expect(shouldNotify({ ...base, lastNotifiedAt: 10_000 - NOTIFY_DEDUPE_MS })).toBe(true)
  })

  it('距上次通知超过 dedupeMs → 通知', () => {
    expect(shouldNotify({ ...base, lastNotifiedAt: 1 })).toBe(true)
  })

  it('lastNotifiedAt 为 undefined → 不受去重约束', () => {
    expect(shouldNotify({ ...base, lastNotifiedAt: undefined })).toBe(true)
  })

  it('时钟回拨（now < lastNotifiedAt）按窗口内处理，不重复轰炸', () => {
    expect(shouldNotify({ ...base, lastNotifiedAt: 20_000 })).toBe(false)
  })

  it('dedupeMs 为 0 时不设防（全部放行）', () => {
    expect(shouldNotify({ ...base, dedupeMs: 0, lastNotifiedAt: 10_000 })).toBe(true)
  })
})

/** 假的 Electron 通知记录，用于验证「通知器」而不碰真实系统通知。 */
interface FakeNotification {
  title: string
  body: string
  shown: boolean
  clickHandlers: (() => void)[]
}

/**
 * 造一个可观测的通知端口。
 *
 * @returns 端口、被创建的通知列表，以及可切换的「平台是否支持」开关。
 */
function fakePort(): {
  port: NotificationPort
  created: FakeNotification[]
  setSupported: (value: boolean) => void
} {
  const created: FakeNotification[] = []
  let supported = true
  return {
    created,
    setSupported: (value: boolean) => { supported = value },
    port: {
      isSupported: () => supported,
      create: options => {
        const record: FakeNotification = { ...options, shown: false, clickHandlers: [] }
        created.push(record)
        return {
          show: () => { record.shown = true },
          onClick: handler => { record.clickHandlers.push(handler) },
        }
      },
    },
  }
}

describe('createNotifier', () => {
  /** 基准上下文：普通消息、窗口未聚焦、当前主机叫「家里的 NAS」。 */
  const context = {
    urgent: false,
    windowFocused: false,
    hostLabel: '家里的 NAS',
    titleHint: '修复登录 — DeepSeek Harness',
    onActivate: (): void => undefined,
  }

  it('未聚焦的普通消息 → 弹出通知，标题为主机名、正文含会话名', () => {
    const { port, created } = fakePort()
    const notifier = createNotifier(port, () => 1000)
    expect(notifier.notify(context)).toBe(true)
    expect(created).toHaveLength(1)
    expect(created[0]!.title).toBe('家里的 NAS')
    expect(created[0]!.body).toContain('收到新消息')
    expect(created[0]!.body).toContain('修复登录')
    expect(created[0]!.shown).toBe(true)
  })

  it('已聚焦的普通消息 → 不创建通知', () => {
    const { port, created } = fakePort()
    const notifier = createNotifier(port, () => 1000)
    expect(notifier.notify({ ...context, windowFocused: true })).toBe(false)
    expect(created).toHaveLength(0)
  })

  it('已聚焦的审批 → 仍然弹出，正文标明审批', () => {
    const { port, created } = fakePort()
    const notifier = createNotifier(port, () => 1000)
    expect(notifier.notify({ ...context, urgent: true, windowFocused: true })).toBe(true)
    expect(created).toHaveLength(1)
    expect(created[0]!.body).toContain('审批')
  })

  it('同类型的 5 秒内第二次上报被抑制，不产生第二条通知', () => {
    const { port, created } = fakePort()
    let now = 1000
    const notifier = createNotifier(port, () => now)
    expect(notifier.notify(context)).toBe(true)
    now = 4000  // 相隔 3s，仍是「消息」类型
    expect(notifier.notify(context)).toBe(false)
    expect(created).toHaveLength(1)
    now = 6000  // 距首次 5s，正好脱离窗口
    expect(notifier.notify(context)).toBe(true)
    expect(created).toHaveLength(2)
  })

  it('消息通知不会抑制紧随其后的审批（两类信号独立计时）', () => {
    // 这条曾经是反的：早先去重共用一个时间戳，于是"消息通知后 5 秒内
    // 到达的审批"会被一并吃掉。审批是必须被用户看到的信号——agent 正卡在
    // 那里等回应，漏报的代价是任务停摆，因此两类必须各自计时。
    const { port, created } = fakePort()
    let now = 1000
    const notifier = createNotifier(port, () => now)
    expect(notifier.notify(context)).toBe(true)         // 消息通知
    now = 4000                                           // 仅相隔 3s
    expect(notifier.notify({ ...context, urgent: true, windowFocused: true })).toBe(true)
    expect(created).toHaveLength(2)
    expect(created[1]!.body).toContain('审批')
  })

  it('审批通知也不会抑制紧随其后的消息（反向同样独立）', () => {
    const { port, created } = fakePort()
    let now = 1000
    const notifier = createNotifier(port, () => now)
    expect(notifier.notify({ ...context, urgent: true })).toBe(true)
    now = 4000
    expect(notifier.notify(context)).toBe(true)
    expect(created).toHaveLength(2)
  })

  it('平台不支持时不弹出，且不占用去重窗口', () => {
    const { port, created, setSupported } = fakePort()
    setSupported(false)
    const notifier = createNotifier(port, () => 1000)
    expect(notifier.notify(context)).toBe(false)
    expect(created).toHaveLength(0)

    // 支持能力恢复后，刚才那次被抑制的上报不应把去重窗口吃掉。
    setSupported(true)
    expect(notifier.notify(context)).toBe(true)
    expect(created).toHaveLength(1)
  })

  it('被聚焦判定抑制的上报同样不占用去重窗口', () => {
    const { port, created } = fakePort()
    const notifier = createNotifier(port, () => 1000)
    expect(notifier.notify({ ...context, windowFocused: true })).toBe(false)
    // 同一个时间戳下窗口失焦，应当立刻能弹。
    expect(notifier.notify({ ...context, windowFocused: false })).toBe(true)
    expect(created).toHaveLength(1)
  })

  it('点击通知 → 执行唤起动作', () => {
    const { port, created } = fakePort()
    let activated = 0
    const notifier = createNotifier(port, () => 1000)
    notifier.notify({ ...context, onActivate: () => { activated += 1 } })
    // 点击回调必须在 show() 之前挂好，这里断言它确实被注册了。
    expect(created[0]!.clickHandlers).toHaveLength(1)
    created[0]!.clickHandlers[0]!()
    expect(activated).toBe(1)
  })

  it('reset() 后下一次上报不受去重约束', () => {
    const { port, created } = fakePort()
    const notifier = createNotifier(port, () => 1000)
    expect(notifier.notify(context)).toBe(true)
    expect(notifier.notify(context)).toBe(false)
    notifier.reset()
    expect(notifier.notify(context)).toBe(true)
    expect(created).toHaveLength(2)
  })

  it('标题线索为空时用主机名兜底（取不出会话名也不产生空正文）', () => {
    const { port, created } = fakePort()
    const notifier = createNotifier(port, () => 1000)
    notifier.notify({ ...context, titleHint: '' })
    expect(created[0]!.body).toBe('收到新消息（家里的 NAS）')
  })
})

describe('parseNotifyRequest', () => {
  it('接受合法负载并保留标题线索', () => {
    expect(parseNotifyRequest({ urgent: true, title: '会话 — DeepSeek Harness' }))
      .toEqual({ urgent: true, title: '会话 — DeepSeek Harness' })
  })

  it('缺 title 时补空串（标题只是文案素材，不该让上报失败）', () => {
    expect(parseNotifyRequest({ urgent: false })).toEqual({ urgent: false, title: '' })
  })

  it('忽略多余字段', () => {
    expect(parseNotifyRequest({ urgent: false, title: 'x', evil: 'drop table' }))
      .toEqual({ urgent: false, title: 'x' })
  })

  it('拒绝非法负载（不可信页面可能发任何东西）', () => {
    for (const raw of [
      undefined,
      null,
      0,
      'urgent',
      [],
      {},
      { urgent: 'yes' },
      { urgent: 1 },
      { urgent: null },
    ]) {
      expect(parseNotifyRequest(raw), `应当拒绝：${JSON.stringify(raw)}`).toBeUndefined()
    }
  })

  it('title 类型不符时退化为空串而不是整条拒绝', () => {
    expect(parseNotifyRequest({ urgent: true, title: { text: 'x' } }))
      .toEqual({ urgent: true, title: '' })
  })
})

describe('sessionNameFromDocumentTitle', () => {
  it('取出「会话名 — 产品名」里的会话名', () => {
    expect(sessionNameFromDocumentTitle('修复登录 — DeepSeek Harness', 'NAS')).toBe('修复登录')
  })

  it('会话名自身含破折号时取最后一个分隔符之前的部分', () => {
    expect(sessionNameFromDocumentTitle('修复 — 登录 — DeepSeek Harness', 'NAS')).toBe('修复 — 登录')
  })

  it('没有分隔符时原样返回', () => {
    expect(sessionNameFromDocumentTitle('DeepSeek Harness', 'NAS')).toBe('DeepSeek Harness')
  })

  it('空标题退回主机显示名', () => {
    expect(sessionNameFromDocumentTitle('', 'NAS')).toBe('NAS')
    expect(sessionNameFromDocumentTitle('   ', 'NAS')).toBe('NAS')
  })

  it('分隔符位于开头时不产生空会话名', () => {
    expect(sessionNameFromDocumentTitle('— DeepSeek Harness', 'NAS')).toBe('— DeepSeek Harness')
  })
})

describe('notifyBody', () => {
  it('审批与消息文案可区分', () => {
    expect(notifyBody(true, '会话')).toContain('审批')
    expect(notifyBody(false, '会话')).toContain('新消息')
  })

  it('会话名为空时不带括号', () => {
    expect(notifyBody(false, '')).toBe('收到新消息')
  })

  it('超长会话名被截断，正文不超过上限', () => {
    const body = notifyBody(true, '会'.repeat(200))
    expect(body.length).toBeLessThanOrEqual(NOTIFY_BODY_MAX)
    expect(body.endsWith('…')).toBe(true)
  })
})

/**
 * 静默期的行为契约。
 *
 * 存在的理由：dsh 没有「整个会话是否在跑」的信号（`data-state` 只挂在思考行、
 * 「停止生成」按钮在输入框非空时不渲染），所以「agent 真的停下来了」只能靠
 * **观测到安静**来推断。而这个推断的精度直接决定用户会不会被中途打扰——
 * 判错一次就是一条多余的系统通知。
 */
describe('createQuietGate', () => {
  /** 假定时器：记录被调度的任务，由用例手动触发（不依赖真实计时）。 */
  function fakeTimers(): {
    schedule: (callback: () => void, delayMs: number) => () => void
    /** 触发最近一个尚未被取消的任务。 */
    fireLatest: () => void
    /**
     * 触发**所有未被取消**的任务。
     *
     * 这是唯一能抓住「忘记取消上一个任务」这类缺陷的手段：只触发最后一个的话，
     * 漏取消的前序任务永远不会被执行，测试照样绿——而真实世界里它们到点就会跑，
     * 结果是连弹多条通知验证（本用例的第一次变异验证正是栽在这里）。
     */
    fireAll: () => void
    /** 最近一个任务是否已被取消。 */
    latestCancelled: () => boolean
    /** 已调度任务的延时列表（每次读取时现算，不能是快照）。 */
    readonly delays: number[]
  } {
    const tasks: { callback: () => void, cancelled: boolean, delayMs: number }[] = []
    return {
      schedule: (callback, delayMs) => {
        const task = { callback, cancelled: false, delayMs }
        tasks.push(task)
        return () => { task.cancelled = true }
      },
      fireLatest: () => {
        const task = tasks[tasks.length - 1]
        if (task === undefined) throw new Error('没有任何被调度的任务')
        task.callback()
      },
      fireAll: () => {
        for (const task of tasks) if (!task.cancelled) task.callback()
      },
      latestCancelled: () => tasks[tasks.length - 1]?.cancelled ?? false,
      get delays(): number[] {
        return tasks.map(task => task.delayMs)
      },
    }
  }

  it('收到一次「一轮结束」后，按静默时长调度一次', () => {
    const timer = fakeTimers()
    const gate = createQuietGate({ schedule: timer.schedule })

    gate.pulse(() => undefined)

    expect(timer.delays).toEqual([QUIET_PERIOD_MS])
  })

  it('静默期走完才回调——这是「真的停下来了」的判定时刻', () => {
    const timer = fakeTimers()
    const gate = createQuietGate({ schedule: timer.schedule })
    let fired = 0

    gate.pulse(() => { fired += 1 })
    expect(fired).toBe(0)   // 尚未走完，不该触发

    timer.fireLatest()
    expect(fired).toBe(1)
  })

  it('静默期内又收到一次结束 → 前一次作废，只回调一次（不累积）', () => {
    const timer = fakeTimers()
    const gate = createQuietGate({ schedule: timer.schedule })
    let fired = 0

    gate.pulse(() => { fired += 1 })     // 第一次
    gate.pulse(() => { fired += 1 })     // 中途又结束一次 → 重置
    gate.pulse(() => { fired += 1 })     // 再来一次 → 再重置

    expect(timer.delays).toEqual([QUIET_PERIOD_MS, QUIET_PERIOD_MS, QUIET_PERIOD_MS])

    // 触发**全部未被取消**的任务：只有最后一个还活着，所以只该回调一次。
    // （若实现漏了取消前序任务，这里会变成 3——这正是本用例要守的东西。）
    timer.fireAll()
    expect(fired).toBe(1)
  })

  it('cancel 之后即便任务被触发也不回调（窗口销毁等场景）', () => {
    const timer = fakeTimers()
    const gate = createQuietGate({ schedule: timer.schedule })
    let fired = 0

    gate.pulse(() => { fired += 1 })
    gate.cancel()
    expect(timer.latestCancelled()).toBe(true)

    timer.fireLatest()
    expect(fired).toBe(0)
  })

  it('一次静默期结束后还能再来一轮（可重入，不是一次性）', () => {
    const timer = fakeTimers()
    const gate = createQuietGate({ schedule: timer.schedule })
    let fired = 0

    gate.pulse(() => { fired += 1 })
    timer.fireLatest()
    gate.pulse(() => { fired += 1 })
    timer.fireLatest()

    expect(fired).toBe(2)
  })

  it('取消后再 pulse 能恢复正常（cancel 不把门永久关上）', () => {
    const timer = fakeTimers()
    const gate = createQuietGate({ schedule: timer.schedule })
    let fired = 0

    gate.pulse(() => { fired += 1 })
    gate.cancel()
    gate.pulse(() => { fired += 1 })
    timer.fireLatest()

    expect(fired).toBe(1)
  })

  it('静默时长可覆盖', () => {
    const timer = fakeTimers()
    const gate = createQuietGate({ schedule: timer.schedule, quietMs: 30_000 })

    gate.pulse(() => undefined)

    expect(timer.delays).toEqual([30_000])
  })
})
