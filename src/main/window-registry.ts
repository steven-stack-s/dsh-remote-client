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
