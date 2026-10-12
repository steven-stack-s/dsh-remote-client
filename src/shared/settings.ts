/**
 * 客户端（壳）自身的行为偏好 —— **纯逻辑**，不 import electron。
 *
 * 分层理由与 `backoff.ts` / `lifecycle.ts` / `update-policy.ts` 相同：vitest 跑在
 * node 环境下，**import 了 electron 的模块在测试里加载不起来**。因此设置的
 * 类型、默认值与校验都落在 shared 层，界面的读写（`settings-store.ts`）与
 * 消费点（`index.ts`）各自只负责自己不 import electron 的那部分。
 *
 * ## 这里只放「壳的行为偏好」
 *
 * 刻意**不含**每台主机的连接参数（地址/显示名/token）——那些属于主机维度，
 * 存在 `hosts.json` 里，由「编辑主机」窗口管理。混进来的后果是「改的是哪台」
 * 出现歧义。
 *
 * 也刻意**不含** dsh 自身的偏好（搜索引擎、主题、模型）——那些由 dsh 前端的
 * 设置面板管理，已经存在且工作正常，客户端不该插手。
 */

/** 启动时打开什么。 */
export type StartupBehavior =
  /** 打开上次使用的主机（沿用 `resolveStartupHost` 的既有语义，也是默认）。 */
  | 'lastHost'
  /** 每次都开「添加主机」欢迎页。 */
  | 'welcome'

/** 壳的行为偏好。 */
export interface ClientSettings {
  /** 是否弹原生通知（审批与消息都受它管）。关闭后 `shell:notify` 直接丢弃上报。 */
  notifyEnabled: boolean
  /**
   * 消息通知的静默期时长（毫秒）：一轮流式输出结束后再等这么久没有新输出，
   * 才认为 agent 真的停下了（见 `notifications.ts` 的 `QUIET_PERIOD_MS`）。
   *
   * 只作用于**消息**通知；审批走立即判定，不受它影响——那是在等用户回应的
   * 阻塞信号，压后毫无意义。
   */
  notifyQuietMs: number
  /** 启动行为。 */
  startupBehavior: StartupBehavior
  /**
   * 关窗时是否收进托盘而非退出（仅非 macOS 生效，见 `lifecycle.ts`）。
   *
   * 关掉它意味着非 darwin 平台关窗即真关，`window-all-closed` 随之触发退出
   * 判定——这正是用户显式要求「关窗即退出」时应有的语义。
   */
  hideOnClose: boolean
  /** 是否在启动后后台检查更新（关掉则整个更新器都不装配）。 */
  updateCheckEnabled: boolean
  /**
   * 页面里指向**另一台已配置主机**的链接是否开成新窗口（多主机并行）。
   *
   * 站内链接（同一 origin 内部的跳转，例如切换会话）**不受它影响**，永远留在
   * 原窗口——否则在 dsh 里点任何一个会话都会弹出一个新窗口，那是用户明确不要的。
   *
   * 默认 `false`：沿用 task-18 起的既有行为（跨主机也替换当前窗口），升级后用户
   * 感觉不到变化；想要多窗口的人自己去打开。
   */
  openInNewWindow: boolean
}

/**
 * 静默期下限（毫秒）= 15 秒。
 *
 * **不能比它更低**：静默期的全部意义是「等 agent 真的停下来」，而下限直接决定
 * 误报率。dsh 没有暴露「整个会话是否在跑」的信号（见 `notifications.ts` 的
 * 勘察结论），所以只能靠观测安静来推断；把这段等待压得太短，一次慢工具调用就会
 * 被误判成结束，用户收到的提醒反而变成噪音。
 *
 * 15 秒正是既有 `QUIET_PERIOD_MS` 的取值——下限取它，等于「用户可以把静默期
 * 调长来减少误报，但不能调到比当前已验证的值更激进」。
 */
export const QUIET_MS_MIN = 15_000

/** 静默期上限（毫秒）= 5 分钟。再长通知就等于失效了。 */
export const QUIET_MS_MAX = 300_000

/**
 * 默认设置。
 *
 * **每一项都刻意等于改动前的硬编码行为**（静默期 15 秒 = `QUIET_PERIOD_MS`、
 * 关窗驻留开 = `lifecycle.ts` 在非 darwin 平台的行为、更新检查开 = 既有装配）。
 * 这样升级后用户感觉不到任何变化，「设置」只是把原本够不着的东西变得可调。
 */
export const DEFAULT_SETTINGS: ClientSettings = {
  notifyEnabled: true,
  notifyQuietMs: QUIET_MS_MIN,
  startupBehavior: 'lastHost',
  hideOnClose: true,
  updateCheckEnabled: true,
  openInNewWindow: false,
}

/**
 * 把静默期钳制到合法区间。
 *
 * 非有限值（`NaN` / `±Infinity`）**不走钳制而回退到默认**：钳制的语义是「用户给了
 * 一个数，只是越界了」，而 `NaN` 说明输入根本不是个数（例如输入框被清空后
 * `Number('')` 之外的解析路径）。把两类混为一谈，会让「输入框空了」表现为
 * 「静默期变成 15 秒」这种猜不透的行为。
 *
 * @param value - 原始毫秒数。
 * @returns 区间内的毫秒数；非有限值时返回默认值。
 */
export function clampQuietMs(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.notifyQuietMs
  if (value < QUIET_MS_MIN) return QUIET_MS_MIN
  if (value > QUIET_MS_MAX) return QUIET_MS_MAX
  return value
}

/**
 * 从任意输入得到一份可用的设置。
 *
 * **逐字段回退，绝不整体丢弃**：用户改了一个值、却在另一个字段上（因为手抖或
 * 版本差异）写出了非法内容时，整体丢弃等于把他所有偏好一起抹掉。每个字段独立
 * 校验、独立回退，坏的那一个退回默认，其余原样保留。
 *
 * 缺字段视为「用默认值」而非「损坏」——设置项会随版本增删，旧文件缺字段是
 * **常态**（这也是本函数与 `hosts.ts` 的 `parseHosts` 判据不同的原因：那里结构
 * 不符就是损坏，这里只要有对象就尽力还原）。
 *
 * @param raw - `JSON.parse` 的结果，类型未知。
 * @returns 一份字段齐全的合法设置。
 */
export function normalizeSettings(raw: unknown): ClientSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS }
  const source = raw as Record<string, unknown>

  return {
    notifyEnabled: typeof source.notifyEnabled === 'boolean'
      ? source.notifyEnabled
      : DEFAULT_SETTINGS.notifyEnabled,
    notifyQuietMs: typeof source.notifyQuietMs === 'number'
      ? clampQuietMs(source.notifyQuietMs)
      : DEFAULT_SETTINGS.notifyQuietMs,
    startupBehavior: source.startupBehavior === 'lastHost' || source.startupBehavior === 'welcome'
      ? source.startupBehavior
      : DEFAULT_SETTINGS.startupBehavior,
    hideOnClose: typeof source.hideOnClose === 'boolean'
      ? source.hideOnClose
      : DEFAULT_SETTINGS.hideOnClose,
    updateCheckEnabled: typeof source.updateCheckEnabled === 'boolean'
      ? source.updateCheckEnabled
      : DEFAULT_SETTINGS.updateCheckEnabled,
    openInNewWindow: typeof source.openInNewWindow === 'boolean'
      ? source.openInNewWindow
      : DEFAULT_SETTINGS.openInNewWindow,
  }
}

/**
 * 判断一个值是否为**字段齐全且类型正确**的设置。
 *
 * 与 {@link normalizeSettings} 的分工：那个负责「把不完整的还原成完整的」，
 * 本函数负责「回答它本身完不完整」。`settings-store.ts` 用它区分
 * 「文件损坏（要备份留证）」与「文件旧了（缺字段，正常还原即可）」。
 *
 * 刻意不做区间钳制：`notifyQuietMs` 只要是个数字就算通过，越界由
 * `normalizeSettings` 去钳。否则「用户填了 0」会被判成文件损坏并产生备份，
 * 那是把一个正常输入当成了事故。
 *
 * @param value - 待判定的值。
 * @returns 合法时返回 true。
 */
export function isClientSettings(value: unknown): value is ClientSettings {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.notifyEnabled === 'boolean'
    && typeof candidate.notifyQuietMs === 'number'
    && (candidate.startupBehavior === 'lastHost' || candidate.startupBehavior === 'welcome')
    && typeof candidate.hideOnClose === 'boolean'
    && typeof candidate.updateCheckEnabled === 'boolean'
    && typeof candidate.openInNewWindow === 'boolean'
}
