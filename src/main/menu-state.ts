/**
 * 壳层（菜单栏 / 托盘 / 窗口）的动态状态判定。
 *
 * 单独成模块的理由与 `backoff.ts` / `restart.ts` / `lifecycle.ts` / `reload.ts`
 * 相同：调用方 `menu.ts` / `tray.ts` / `windows.ts` / `index.ts` 都 import 了
 * electron，在 vitest 的 node 环境下无法加载。凡是不需要 electron 的判定都
 * 落在本模块里，才能被单测守护。
 *
 * 背景：Windows 上托盘图标未能显示（用户真机反馈），而托盘原本是主机管理的
 * 唯一入口。应用菜单栏是三平台都可见、且**不依赖 Tray** 的兜底通道。
 *
 * 本模块按用途分三节：菜单栏（含编辑窗口的目标判定）、托盘、窗口。
 * 名称保留 `menu-state` 是历史原因（它最初只服务菜单栏）；`shouldCloseWindowAfterRemove`
 * 这类窗口判定早已在这里，新增判定沿用同一落点，避免为此另开一个模块。
 */

// ─────────────────────────── 一、菜单栏 ───────────────────────────

/**
 * 「重新加载当前主机」是否可用（没有当前主机时该项应禁用）。
 *
 * @param currentHostId - 当前打开的主机 id；无主机时为 undefined。
 * @returns 可重载时返回 true。
 */
export function canReloadHost(currentHostId: string | undefined): boolean {
  return currentHostId !== undefined && currentHostId !== ''
}

/**
 * 「编辑主机…」/「删除主机…」是否可用。
 *
 * 这两个菜单项都作用于**当前主机**，因此与 {@link canReloadHost} 同条件：
 * 没有当前主机时无从下手，应禁用而不是点了没反应。
 *
 * 与 `canReloadHost` 分开命名而非复用，是为了让调用点表达意图——
 * 日后若「可重载」与「可编辑」的条件分化（例如未加载完时不允许编辑），
 * 改动点集中在这里，不会牵连重载逻辑。
 *
 * @param currentHostId - 当前打开的主机 id；无主机时为 undefined。
 * @returns 可用时返回 true。
 */
export function canEditHost(currentHostId: string | undefined): boolean {
  return currentHostId !== undefined && currentHostId !== ''
}

/**
 * 「打开主机」子项是否可用：任何已配置主机都可被打开。
 *
 * 目前恒为 true，但保留为纯函数以便日后加入「离线不可开」之类规则时
 * 有单点可测，而不是把判断散落在菜单模板里。
 *
 * @returns 恒为 true。
 */
export function canOpenHost(): boolean {
  return true
}

/**
 * 主机列表菜单在没有任何主机时的占位项文案。
 *
 * Electron 的菜单不支持「空菜单」的原生灰字提示，用一个禁用的占位项
 * 避免用户看到一片空白而以为功能坏了。
 *
 * @param hostCount - 已配置主机数量。
 * @returns 有主机时返回 undefined（不渲染占位项），否则返回占位文案。
 */
export function emptyHostsPlaceholder(hostCount: number): string | undefined {
  return hostCount === 0 ? '（尚未添加主机）' : undefined
}

/**
 * 「重置登录态」是否可用：必须存在该主机。
 *
 * 目前恒为 true（菜单项本就只对已存在的主机渲染），保留为纯函数是为了
 * 把「菜单项的可用性只取决于主机是否存在」这条约定固化下来——若日后
 * 出现「主机未打开时不允许重置」之类的规则，改动点集中在这里。
 *
 * @param hostExists - 目标主机是否仍存在于配置中。
 * @returns 可用时返回 true。
 */
export function canResetLoginState(hostExists: boolean): boolean {
  return hostExists
}

/**
 * 「删除」是否可用。
 *
 * **刻意允许删除最后一台主机**：用户可能就是想清空重来（例如把所有主机
 * 都换成新的部署）。托盘菜单底部有「添加主机…」，应用菜单栏的「文件」
 * 菜单同样有「添加主机…」，因此删光之后**不会**陷入无法恢复的状态。
 * 这条判定被显式固化，是为了防止日后有人「好心」禁用它而把用户困住。
 *
 * @param hostExists - 目标主机是否仍存在于配置中。
 * @returns 可用时返回 true。
 */
export function canRemoveHost(hostExists: boolean): boolean {
  return hostExists
}

/**
 * 删除某主机后，是否应关闭当前主机窗口。
 *
 * 仅当被删主机**正是当前打开的那台**时才需要处理——窗口承载的是该主机的
 * 会话，配置里已经没有它，继续留在屏幕上会让托盘/菜单里的主机列表与
 * 实际窗口不一致（用户会以为没删掉）。删其他主机时当前窗口不受影响。
 *
 * @param removedId - 被删除的主机 id。
 * @param currentHostId - 当前打开的主机 id。
 * @returns 应关闭当前窗口时返回 true。
 */
export function shouldCloseWindowAfterRemove(
  removedId: string,
  currentHostId: string | undefined,
): boolean {
  return currentHostId !== undefined && removedId === currentHostId
}

/** 「编辑(E)」菜单里的一项（分隔符也是一种项，顺序即显示顺序）。 */
export type EditMenuItemKind =
  | 'addHost'
  | 'editHost'
  | 'removeHost'
  | 'separator'
  | 'quit'

/**
 * 「编辑(E)」菜单的项布局。
 *
 * **「添加主机…」与「编辑主机…/删除主机…」之间刻意没有分隔线**（用户明确要求）：
 * 三者都是同一层级的「主机管理」操作，加线反而把它们割裂成两组。
 * 「退出」前的那条分隔线**保留**——退出与前四项不是一类东西，混在一起容易误点。
 *
 * 把它做成纯函数是为了让这条布局契约有测试守护：日后有人「顺手」补一条分隔线回去，
 * 测试会立刻变红。
 *
 * @returns 按显示顺序排列的项种类。
 */
export function editMenuLayout(): readonly EditMenuItemKind[] {
  return ['addHost', 'editHost', 'removeHost', 'separator', 'quit']
}

/**
 * 「编辑主机…」菜单项是否可用。
 *
 * 与 {@link canEditHost} 的区别：那个函数还用在「删除主机…」上（作用于当前主机，
 * 没有当前主机就无从下手）。而编辑窗口自 task-14 起**内部可以切换编辑对象**，
 * 因此只要配置里还有主机就应当能打开它——否则「删掉当前主机后只剩别的几台」
 * 这种情形下，用户会彻底没有编辑入口。
 *
 * @param hostCount - 已配置主机数量。
 * @returns 可用时返回 true。
 */
export function canOpenEditWindow(hostCount: number): boolean {
  return hostCount > 0
}

/** 保存编辑结果后应对当前窗口做的事。 */
export type HostAfterEditEffect =
  /** 地址没变且正在展示这台主机 → 让窗口重新加载（重放 token 握手）。 */
  | 'reload'
  /** 需要打开（或重新打开）这台主机的窗口。 */
  | 'reopen'
  /** 什么都不用做。 */
  | 'none'

/**
 * 保存编辑结果后该如何处理主机窗口。
 *
 * 这里是 **task-14 那个「改地址保存后客户端会退出」缺陷的修复点**。
 * 缺陷成因：改地址时旧窗口被 `destroy()`，此时只剩编辑窗口；用户关掉编辑窗口后
 * 一个窗口都不剩，`window-all-closed` 便把客户端退掉了（所以用户说的是「有时候」——
 * 只有改地址才走到这条路径）。
 *
 * 规则：
 * - 地址没变且编辑的正是当前窗口承载的主机 → `reload`（令牌可能刚更新，需重放握手）；
 * - 地址变了且编辑的正是当前主机 → `reopen`：旧窗口承载的是**旧 partition**（`id`
 *   与 partition 名都由 origin 派生，改地址等于换主机），必须销毁并立即打开新地址，
 *   这样窗口始终存在，不会出现「所有窗口都没了」的空窗期；
 * - 地址变了但编辑的不是当前主机 → 正常情况什么都不做（别把用户从正在用的主机上
 *   强行切走）；**除非此刻根本没有主机窗口**（例如当前主机刚被删掉），那就打开它，
 *   否则用户改完地址后可能一个窗口都没有，只能从托盘回来。
 *
 * @param input - 判定输入。
 * @returns 应执行的动作。
 */
export function hostAfterEditEffect(input: {
  /** 本次保存是否改变了地址。 */
  originChanged: boolean
  /** 被编辑的主机是否正是当前窗口承载的那台。 */
  editedIsOpenHost: boolean
  /** 当前是否存在可用的主机窗口。 */
  hasHostWindow: boolean
}): HostAfterEditEffect {
  const { originChanged, editedIsOpenHost, hasHostWindow } = input
  if (!originChanged) return editedIsOpenHost ? 'reload' : 'none'
  if (editedIsOpenHost) return 'reopen'
  return hasHostWindow ? 'none' : 'reopen'
}

// ─────────────────────────── 二、托盘 ───────────────────────────

/** 托盘菜单里的项。刻意**只有两项**（用户明确要求）。 */
export type TrayMenuItemKind = 'open' | 'quit'

/** 托盘菜单文案。 */
export const TRAY_MENU_LABELS: Record<TrayMenuItemKind, string> = {
  open: '打开客户端',
  quit: '关闭客户端',
}

/**
 * 托盘菜单的项集合。
 *
 * 用户要求托盘**只保留**「打开客户端 / 关闭客户端」。原先的每主机子菜单
 * （打开/重新加载/立即重试/重置登录态/删除…）全部移除——它们**已经全部在
 * 菜单栏的「主机(H)」里**，因此不是功能丢失。托盘在 Windows 上还可能不显示，
 * 把主机管理放在那里本就是错的：菜单栏才是三平台都可见的兜底入口。
 *
 * 做成纯函数是为了守住「只有两项」这条契约：日后有人往托盘里加回主机管理项，
 * 测试会立刻变红。
 *
 * @returns 按显示顺序排列的项种类。
 */
export function trayMenuItemKinds(): readonly TrayMenuItemKind[] {
  return ['open', 'quit']
}

/** 「打开客户端」时应对哪个窗口下手。 */
export type TrayOpenAction =
  /** 唤起已存在的窗口（可能是隐藏/最小化的主机窗口）。 */
  | 'show'
  /** 一个窗口都没有，但还有当前主机 → 重新打开它。 */
  | 'reopen'
  /** 连当前主机都没有（例如刚删光主机）→ 打开欢迎页。 */
  | 'welcome'

/**
 * 点击托盘「打开客户端」时该做什么。
 *
 * 托盘是「关窗后驻留」这条语义的出口：主机窗口在非 darwin 平台关窗时只是被
 * **隐藏**（见 `lifecycle.ts`），所以正常情况总能 `show` 回来；只有窗口真的被
 * 销毁过（改地址、删主机、macOS 关窗）才会走 `reopen` / `welcome`。
 *
 * @param input - 判定输入。
 * @returns 应执行的动作。
 */
export function trayOpenAction(input: {
  /** 当前是否存在任何应用窗口（含隐藏的）。 */
  hasWindow: boolean
  /** 配置里是否还有「当前主机」。 */
  hasCurrentHost: boolean
}): TrayOpenAction {
  if (input.hasWindow) return 'show'
  return input.hasCurrentHost ? 'reopen' : 'welcome'
}

/** 托盘图标变体。 */
export type TrayIconVariant = 'light' | 'dark' | 'offline'

/**
 * 该用哪套托盘图标。
 *
 * **离线优先于主题**：离线是「必须让用户看见的状态」（规格 §8 要求托盘变灰），
 * 而主题只是配色偏好；灰色的鲸鱼在深浅两种背景上都看得清，因此离线时不必也不应
 * 再按主题分色。主题只在正常态下决定用黑鲸鱼（浅色主题）还是白鲸鱼（深色主题）——
 * Windows 任务栏默认深色，只给黑色图标会几乎看不见。
 *
 * @param input - 判定输入。
 * @returns 图标变体。
 */
export function trayIconVariant(input: {
  /** 当前主机是否处于离线重试中。 */
  offline: boolean
  /** 系统当前是否使用深色主题（`nativeTheme.shouldUseDarkColors`）。 */
  dark: boolean
}): TrayIconVariant {
  if (input.offline) return 'offline'
  return input.dark ? 'dark' : 'light'
}

// ─────────────────────────── 三、窗口 ───────────────────────────

/** 按键组合（已从 Electron 的 `input` 事件里抽出的最小信息）。 */
export interface KeyChord {
  /** 按键名，大小写不敏感（如 `r` / `I` / `F12`）。 */
  key: string
  /** Ctrl 是否按下。 */
  control: boolean
  /** Command（macOS）/ Windows 键是否按下。 */
  meta: boolean
  /** Alt / Option 是否按下。 */
  alt: boolean
  /** Shift 是否按下。 */
  shift: boolean
  /** `process.platform`。 */
  platform: string
}

/**
 * 主修饰键是否按下：macOS 上是 Command，其余平台是 Ctrl。
 *
 * @param chord - 按键组合。
 * @returns 按下时返回 true。
 */
function primaryModifierPressed(chord: KeyChord): boolean {
  return chord.platform === 'darwin' ? chord.meta : chord.control
}

/**
 * 是否为「重新加载当前主机」（Ctrl/Cmd+R）。
 *
 * 刻意排除 Shift/Alt 组合：`Ctrl+Shift+R` 在浏览器里是「强制重载」，语义不同，
 * 不应被我们吞掉（远端页面可能自己要用）。
 *
 * @param chord - 按键组合。
 * @returns 匹配时返回 true。
 */
export function matchesReloadChord(chord: KeyChord): boolean {
  if (chord.key.toLowerCase() !== 'r') return false
  if (chord.shift || chord.alt) return false
  return primaryModifierPressed(chord)
}

/**
 * 是否为「开关 DevTools」。
 *
 * Electron **默认不提供** DevTools 快捷键（那是 Chrome 的行为，不是 Electron 的），
 * 所以用户在客户端里按 `Ctrl+Shift+I` 一直没有反应——而 DevTools 的 Console 正是
 * 运行 `docs/dom-勘察脚本.js`（为通知功能找选择器）的唯一入口。
 *
 * 支持三种按法：
 * - `Ctrl+Shift+I`（Windows/Linux 惯例）；
 * - `Cmd+Option+I`（macOS 惯例，是 Chrome 的键位）；
 * - `F12`（Windows/Linux 上更常见的习惯，用户没要求，但成本为零且不冲突）。
 *
 * @param chord - 按键组合。
 * @returns 匹配时返回 true。
 */
export function matchesDevToolsChord(chord: KeyChord): boolean {
  const key = chord.key.toLowerCase()
  // F12 不要求修饰键：Windows 用户的肌肉记忆就是直接按它。
  if (key === 'f12') return true
  if (key !== 'i') return false
  if (!primaryModifierPressed(chord)) return false
  return chord.platform === 'darwin' ? chord.alt : chord.shift
}

/**
 * 所有窗口都关闭后，是否应当退出应用。
 *
 * 规则（顺序即优先级）：
 * - 正在退出 → 不重复退出（该事件在退出流程中也会触发）；
 * - **托盘可用 → 常驻不退出**：托盘有「打开客户端」，用户能自己回来；这也是
 *   「关窗后仍能被唤起」这条既有能力的语义基础；
 * - 托盘不可用（例如创建失败）→ 非 macOS 退出：否则应用会变成一个**既看不见
 *   也无法退出的幽灵进程**（没有窗口、没有托盘、没有任何入口）。
 *   macOS 保持既有语义（关掉最后一个窗口不退出，符合平台惯例）。
 *
 * @param input - 判定输入。
 * @returns 应退出时返回 true。
 */
export function shouldQuitOnAllWindowsClosed(input: {
  /** 托盘是否已装配成功。 */
  trayAvailable: boolean
  /** `process.platform`。 */
  platform: string
  /** 应用是否正在真正退出。 */
  quitting: boolean
}): boolean {
  if (input.quitting) return false
  if (input.trayAvailable) return false
  return input.platform !== 'darwin'
}
