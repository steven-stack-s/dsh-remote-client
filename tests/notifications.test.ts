import { describe, expect, it } from 'vitest'
import {
  NOTIFY_BODY_MAX,
  NOTIFY_DEDUPE_MS,
  createNotifier,
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

  it('5 秒内第二次上报被抑制，不产生第二条通知', () => {
    const { port, created } = fakePort()
    let now = 1000
    const notifier = createNotifier(port, () => now)
    expect(notifier.notify(context)).toBe(true)
    now = 4000  // 相隔 3s
    expect(notifier.notify({ ...context, urgent: true })).toBe(false)
    expect(created).toHaveLength(1)
    now = 6000  // 距首次 5s，正好脱离窗口
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
