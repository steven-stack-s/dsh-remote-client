/**
 * 多主机窗口注册表的**判定逻辑**。
 *
 * 单独成模块的理由与 `menu-state.ts` / `backoff.ts` / `lifecycle.ts` 相同：
 * 调用方 `index.ts` import 了 electron，在 vitest 的 node 环境下加载不起来。
 * 本模块**不 import electron**，因此「该唤起哪一台」「这个 sender 认不认」
 * 这类真正会出错的判定可以被单测完整覆盖；持有窗口引用的 Map 留在 `index.ts`。
 *
 * ## 背景：task-19 之前只有一台主机窗口
 *
 * 原实现用 `currentWindow` / `currentHostId` 两个**标量**，其语义是「同一时刻
 * 只有一台主机窗口」（当时的理由：避免同一 origin 并存两份 WebSocket）。那个
 * 模型被 46 处引用，其中三处是 IPC 的 sender 校验（`shell:network` /
 * `shell:theme` / `shell:notify`），它们只认**那一个** webContents id。
 *
 * task-19 起允许跨主机跳转开新窗口，于是同一时刻可能有多台主机窗口：
 * - sender 校验必须放宽成「属于**任一**已登记主机窗口」，否则 B 窗口的审批
 *   上报会被静默丢弃——用户收不到提醒，而 agent 正卡在等他回应；
 * - 「当前主机」退化为「**最后聚焦**的那一台」（菜单的 ● 标记、托盘的重载/
 *   重试项都以它为目标）。这是一个**有意的降级**：多窗口下本就没有唯一的
 *   「当前」，取最后聚焦的那台是最符合直觉的近似。
 */

/** 一个已登记的主机窗口对外暴露的最小信息。 */
export interface OpenHostWindowRef {
  /** 该窗口所属主机的 id（`hostIdFromOrigin(origin)`）。 */
  hostId: string
  /** 该窗口 webContents 的 id，用于 IPC sender 校验。 */
  webContentsId: number
}

/**
 * 该 webContents 是否属于任一已登记的主机窗口。
 *
 * **这是 task-19 修掉的那条最危险的缺陷**：旧实现是
 * `event.sender.id !== hostWebContentsId()`，只认单个窗口。多窗口下第二个
 * 窗口的所有上报（网络恢复、主题、通知）都会被静默丢弃——不报错、不提示，
 * 只是「功能在另一台主机上不工作」。
 *
 * @param entries - 当前已登记的主机窗口。
 * @param webContentsId - 待判定的 sender id。
 * @returns 属于任一已登记窗口时返回 true。
 */
export function isKnownHostWebContents(
  entries: readonly OpenHostWindowRef[],
  webContentsId: number,
): boolean {
  return entries.some(entry => entry.webContentsId === webContentsId)
}

/**
 * 按 webContents id 找出对应的主机窗口。
 *
 * `shell:notify` 用它把「发送方那一台」找出来：通知的标题要用**那一台**的主机名、
 * 点击要唤起**那一台**——取「当前主机」会让 B 窗口的通知显示 A 的名字、点了跳到 A。
 *
 * @param entries - 当前已登记的主机窗口。
 * @param webContentsId - sender id。
 * @returns 对应窗口；不属于任何已登记窗口时返回 undefined。
 */
export function findHostWindowByWebContents(
  entries: readonly OpenHostWindowRef[],
  webContentsId: number,
): OpenHostWindowRef | undefined {
  return entries.find(entry => entry.webContentsId === webContentsId)
}

/** 「打开客户端」时该对谁下手。 */
export type FocusTarget =
  /** 唤起某一台主机窗口。 */
  | { kind: 'host', hostId: string }
  /** 一台主机窗口都没有，但存在别的窗口 → 唤起任意一个。 */
  | { kind: 'any' }
  /** 一个窗口都没有，但有上次的主机 → 重开它。 */
  | { kind: 'reopen', hostId: string }
  /** 连主机都没有 → 打开欢迎页。 */
  | { kind: 'welcome' }

/**
 * 决定「打开客户端」该唤起/打开什么。
 *
 * 顺序即优先级（先排除「没有」的情况，再选目标）：
 * 1. 有已登记的主机窗口 → 优先唤起**最后聚焦**的那台；记不住（或那台已关）
 *    就退到任意一台——**绝不因为「记不住」而什么都不做**；
 * 2. 没有主机窗口但有别的窗口（欢迎页/编辑页/设置页）→ 唤起任意一个；
 * 3. 一个窗口都没有但有上次的主机 → 重开它；
 * 4. 什么都没有 → 欢迎页。
 *
 * 存在本函数的理由与既有的 `trayOpenAction` 相同：托盘「打开客户端」是
 * 「关窗后驻留」这条语义的出口，**任何分支都不能出现「点了没反应」**。
 * 多窗口化引入了「记得的那台可能已经关了」这个新情况，正是它最容易退化成
 * 「什么都不做」——所以这条判定必须有单测。
 *
 * @param input - 判定输入。
 * @returns 该执行的动作。
 */
export function focusTargetFor(input: {
  /** 当前已打开的主机窗口的 host id。 */
  openHostIds: readonly string[]
  /** 最后聚焦过的主机 id（「当前主机」的新定义）。 */
  lastFocusedId: string | undefined
  /** 是否存在任何应用窗口（含隐藏的、非主机的）。 */
  fallbackWindowExists: boolean
}): FocusTarget {
  const { openHostIds, lastFocusedId, fallbackWindowExists } = input

  if (openHostIds.length > 0) {
    if (lastFocusedId !== undefined && openHostIds.includes(lastFocusedId)) {
      return { kind: 'host', hostId: lastFocusedId }
    }
    // 记不住 / 那台已关 → 退到任意一台。取第一个而不是排序：主机窗口的
    // 打开顺序本身没有语义，排序只会引入一个需要维护的规则。
    const first = openHostIds[0]
    if (first !== undefined) return { kind: 'host', hostId: first }
  }

  if (fallbackWindowExists) return { kind: 'any' }

  if (lastFocusedId !== undefined) return { kind: 'reopen', hostId: lastFocusedId }

  return { kind: 'welcome' }
}

/** 「打开某台主机」时对窗口做的事。 */
export type HostOpenEffect =
  /** 该主机已开着 → 只唤起它（**不新建窗口**）。 */
  | 'focus'
  /** 新建/唤起目标主机的窗口，**保留**当前主机窗口（多窗口并行）。 */
  | 'keep-open'
  /** 新建目标主机的窗口，并**销毁**当前主机窗口（替换）。 */
  | 'replace'

/**
 * 打开一台主机时该怎么处理当前窗口。
 *
 * 这是用户从托盘的「主机列表」（或菜单栏的「主机(H)」）切换主机时走的判定。
 *
 * **`openInNewWindow` 设置对这条路径同样必须生效**——它最初只接在「页面里跨主机
 * 跳转」上（`windowOpenDecision`），但用户实际用得最多的入口恰恰是托盘的
 * 主机列表。真机反馈：勾与不勾都是开新窗口，因为这条路径此前根本没读该设置。
 *
 * 规则（顺序即优先级）：
 * 1. **目标已开着 → `focus`**：无论设置如何都不新建。「同一 host 至多一个窗口」
 *    是硬不变量——同一个 origin 并存两份 WebSocket 连同一台 dsh，既浪费又会
 *    让页面状态互相打架；
 * 2. 没有当前主机 → `keep-open`：没有「替换」的对象，直接开；
 * 3. 设置**开** → `keep-open`（保留当前窗口，多窗口并行）；
 * 4. 设置**关** → `replace`（替换当前窗口，即升级前的既有行为）。
 *
 * @param input - 判定输入。
 * @returns 该执行的动作。
 */
export function hostOpenEffect(input: {
  /** 目标主机当前是否已有打开的窗口。 */
  targetAlreadyOpen: boolean
  /** 当前主机（最后聚焦的那台）的 id；没有时为 undefined。 */
  currentHostId: string | undefined
  /** 用户设置：跨主机是否开新窗口。 */
  openInNewWindow: boolean
}): HostOpenEffect {
  if (input.targetAlreadyOpen) return 'focus'
  if (input.currentHostId === undefined) return 'keep-open'
  return input.openInNewWindow ? 'keep-open' : 'replace'
}
