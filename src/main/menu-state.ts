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

import { partitionNameFor } from './partitions.js'
// 规范化 origin 的唯一实现（shared 层，无 electron 依赖），用于「已配置主机 /
// 当前站点」的比较——两边必须用同一套规范化，否则大小写与默认端口会误判。
import { normalizeOrigin } from '../shared/origin.js'

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
 * 应用菜单栏与托盘共用的快捷键。
 *
 * **集中在这里而不是散在 `menu.ts` / `tray.ts`**：两处都要列同一批项，各写一遍
 * 迟早漂移（托盘提示 Ctrl+E、菜单栏却是别的键）；而且它是纯数据，可以被单测钉住，
 * 避免日后有人"顺手"改掉一个用户已经形成肌肉记忆的键。
 *
 * `editHost` 的 `Ctrl+E` 是补上的：它此前**没有任何快捷键**（不是有意为之，
 * 只是当初漏了）。补它之前先确认过没有冲突——本项目已占用的是
 * `Ctrl+N`（添加主机）、`Ctrl+Q`（退出）、`Ctrl+R`（刷新）、
 * `Ctrl+Shift+I`/`F12`（DevTools）、`Ctrl+W`（内容窗口关闭）。
 * 选 `E` 是为了与 `Ctrl+N`（New）对称，Edit 同样取首字母。
 *
 * **「删除主机…」刻意不设快捷键**：它是不可撤销的破坏性操作（虽然弹确认框，
 * 但默认按钮是「取消」，多按一次回车就前功尽弃）。给一个容易误触的组合键，
 * 收益远小于风险——它留在菜单里点，本来就是更合适的手感。
 */
export const MENU_ACCELERATORS = {
  addHost: 'CmdOrCtrl+N',
  editHost: 'CmdOrCtrl+E',
  quit: 'CmdOrCtrl+Q',
} as const

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

/**
 * 托盘菜单里的可点击项。
 *
 * 这里**曾经只有** `open` / `quit` 两项（task-14 的精简）。`hosts` / `addHost` /
 * `editHost` 是后加回来的，原因见 `trayMenuLayout()`——不是推翻时判断错了，
 * 而是那条判断赖以成立的前提消失了。
 */
export type TrayMenuItemKind = 'open' | 'hosts' | 'addHost' | 'editHost' | 'quit'

/** 托盘菜单文案。 */
export const TRAY_MENU_LABELS: Record<TrayMenuItemKind, string> = {
  open: '打开客户端',
  // 「主机列表」而非「主机」：这一项下面挂的是**每台主机一个子菜单**，
  // 叫「主机」容易被读成「当前主机」这个动作；"列表" 才说明点开是列表。
  hosts: '主机列表',
  addHost: '添加主机…',
  editHost: '编辑主机…',
  quit: '关闭客户端',
}

/** 托盘菜单的一项：可点击项，或一条分隔线。 */
export type TrayMenuEntry = TrayMenuItemKind | 'separator'

/**
 * 托盘菜单的布局（顺序 + 分隔线位置）。
 *
 * ## 为什么托盘又把主机管理收了回来
 *
 * task-14 把托盘精简成「打开客户端 / 关闭客户端」，理由是主机管理**已经全部在
 * 菜单栏的「主机(H)」里**，而「菜单栏才是三平台都可见的兜底入口」——托盘在
 * Windows 上甚至可能根本不显示，把管理入口放那儿本就是错的。**那条判断在当时
 * 是对的**，本函数注释里保留这段历史，是为了让后来者看到的是「前提变了」，
 * 而不是「有人把删掉的东西又加回来了」。
 *
 * 前提是怎么没的：Windows 上主机窗口改为无边框窗口，好让顶部那一条由 dsh 自绘、
 * 从而跟随应用主题（见 `shared/desktop-shell.ts`）。而 Electron 官方对 frameless
 * 的定义就是 **no chrome**，chrome 明确包含 **toolbars**——菜单栏随系统标题栏
 * 一起消失，`win.setMenuBarVisibility(false)` 只是把这件事写死下来。
 *
 * 于是「主机管理在菜单栏里」不再成立，而 `editMenuLayout()` 中的
 * 「编辑主机…」「删除主机…」**没有快捷键**——不搬回托盘就等于彻底失去入口。
 * 托盘因此重新成为主机管理的可视入口；菜单栏那套保留原样，在非 Windows 平台
 * （macOS / Linux 仍是有边框窗口）继续作为兜底。
 *
 * 做成纯函数是为了让布局可测：顺序、分隔线位置、以及「不再只有两项」这件事
 * 都能被断言钉住，而不是靠读代码确认。
 *
 * @returns 按显示顺序排列的菜单项与分隔线。
 */
export function trayMenuLayout(): readonly TrayMenuEntry[] {
  // 顺序：日常操作（打开）→ 主机的集合与管理 → 退出。
  // 分隔线把「打开客户端」「主机管理」「关闭客户端」三段分开，避免误点退出。
  return ['open', 'separator', 'hosts', 'addHost', 'editHost', 'separator', 'quit']
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
 * 运行 `docs/dom-recon-script.js`（为通知功能找选择器）的唯一入口。
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
 * 是否为「关闭当前窗口」（Ctrl/Cmd+W）。
 *
 * 只用于**内容窗口**（页面自己打开的 dsh 窗口）：那是浏览器的通行习惯，
 * 用户按 Ctrl+W 时期待的是「关掉这个窗口」。
 *
 * 主机窗口刻意不接：它的关窗是「隐藏到托盘」（见 `lifecycle.ts`），
 * 一个误触就让人以为应用没了；而且它是应用的主窗口，不该被一个浏览器习惯关掉。
 *
 * @param chord - 按键组合。
 * @returns 匹配时返回 true。
 */
export function matchesCloseChord(chord: KeyChord): boolean {
  if (chord.key.toLowerCase() !== 'w') return false
  // 不吞 Shift/Alt 组合（`Ctrl+Shift+W` 在浏览器里是「关闭所有标签页」，语义不同）。
  if (chord.shift || chord.alt) return false
  return primaryModifierPressed(chord)
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

/**
 * 拼一个窗口的标题：`主机名 — 页面标题`。
 *
 * 「主机名」前缀的作用是让用户一眼看出**这个窗口属于哪台主机**（多主机、多窗口时
 * 尤其重要：内容窗口的页面标题往往完全看不出是哪台机器）。
 *
 * 页面标题为空时退化为纯主机名——窗口标题宁可信息少，也不能是 `主机名 — ` 这种
 * 带悬挂分隔符的残缺样子。
 *
 * @param hostLabel - 主机显示名（配置保证非空）。
 * @param pageTitle - 页面 `document.title`，可能为空。
 * @returns 窗口标题。
 */
export function windowTitleFor(hostLabel: string, pageTitle: string): string {
  const title = pageTitle.trim()
  return title === '' ? hostLabel : `${hostLabel} — ${title}`
}

/**
 * 是否移除某个非主机窗口的菜单栏。
 *
 * **macOS 例外是硬约束**：macOS 的菜单栏属于**应用**（`Menu.setApplicationMenu`），
 * 没有「按窗口设置/移除」这回事——`BrowserWindow.setMenu()` / `removeMenu()` 在
 * Electron 里都标注为 `@platform linux,win32`，在 darwin 上调用没有效果。
 * 若在 macOS 上强行动应用级菜单，会连带把主机窗口的菜单也弄掉，那是得不偿失的。
 *
 * 于是 macOS 上保留了「窗口在看着 A、菜单在操作主机窗口」这个已知差异；这是平台
 * 限制，不是可以靠代码消除的缺陷。真正的消除办法是按焦点窗口动态启用/禁用菜单项
 * （需要改 `menu.ts`），不在本次范围内。
 *
 * @param platform - `process.platform`。
 * @returns 应移除菜单栏时返回 true（即 Windows/Linux）。
 */
export function shouldRemoveWindowMenuBar(platform: string): boolean {
  return platform !== 'darwin'
}

/** 页面发起打开新窗口时，该怎么处理。 */
export type WindowOpenDecision = 'navigate-self' | 'external'

/**
 * 安全地解析 URL。
 *
 * `new URL()` 对非法输入会抛错，而这里需要的是「解析不出来就当作不可用」，
 * 不是让异常冒到 Electron 的事件回调里。
 *
 * @param url - 待解析的字符串。
 * @returns 解析结果；非法时 undefined。
 */
function safeUrl(url: string): URL | undefined {
  try {
    return new URL(url)
  } catch {
    return undefined
  }
}

/**
 * 把 URL 或 origin 字符串规范化成**可比较**的 origin；不可用时 undefined。
 *
 * 复用 `shared/origin.ts` 的 `normalizeOrigin()`（它内部就是 WHATWG `URL`：
 * 小写化主机名、补全/剥离默认端口、丢弃路径与查询），使两边的比较基准完全一致。
 * `knownHostOrigins` 本来就是规范化过的，而 URL 里的 origin 没有——不统一的话
 * `https://GitHub.com` 与 `https://github.com` 会被判成两个不同的地方；用户点
 * 门户上的 dsh 图标时，只要地址的大小写/默认端口写法与配置里不一致，就会被
 * 错判成外链而丢给系统浏览器。
 *
 * 规范化失败（非 http(s)、内嵌凭据、无法解析）时返回 undefined：拿不到可靠身份
 * 就**不认为它匹配**任何已知主机，宁可交给系统浏览器，也不要在应用内导航到一个
 * 我们没看懂的目标。
 *
 * @param value - URL 或 origin。
 * @returns 规范化后的 origin；不可用时 undefined。
 */
function comparableOrigin(value: string): string | undefined {
  try {
    return normalizeOrigin(value)
  } catch {
    return undefined
  }
}

/**
 * 页面自己发起的 `window.open()` / `<a target="_blank">` 该怎么处理。
 *
 * 判据不是「同源」——门户 → dsh 天然是**跨域**的（门户在花生壳域名下，dsh 在
 * 自己的地址上），用同源判定会把用户想留在客户端里的那个链接判成外链。
 * 正确判据是「**这个地址是不是我们认识的**」：已配置的主机，或当前正待着的站点。
 *
 * 判定顺序（先排除不可能的情况，再依次放行）：
 * 1. 非法 URL → `external`（不抛错；交给系统也只会失败，调用方会吞掉）；
 * 2. 非 `http:`/`https:`（`mailto:`、`tel:`、自定义 scheme、`file:`、`javascript:`）
 *    → `external`。**`file:`/`javascript:` 属于安全边界**：远端页面不该借我们的手
 *    在应用内打开本地文件或执行脚本；
 * 3. 目标 origin ∈ `knownHostOrigins` → **`navigate-self`**：这就是用户在门户里点
 *    dsh 图标的情形，要在**当前窗口**里打开（替换原窗口，而不是再开一个）；
 * 4. 目标 origin === `currentOrigin` → **`navigate-self`**：站点内部跳转，跑到系统
 *    浏览器去会让「在客户端里用 dsh」在点第二个链接时断掉；
 * 5. 其余 → `external`：真正的外链（GitHub 等）交给默认浏览器。
 *
 * `currentOrigin` 传空串表示**取不到当前页面 origin**（还没提交任何导航、或者当前
 * 是壳自有的 `file://` 页面如离线页）。此时第 4 条不参与判定——不能因为「取不到」
 * 就把所有链接都当成站内链接。
 *
 * @param input - 判定输入。
 * @returns `'navigate-self'` 表示在当前窗口导航，`'external'` 表示交给系统浏览器。
 */
export function windowOpenDecision(input: {
  /** 页面请求打开的地址。 */
  url: string
  /** 当前页面所在 origin；取不到时传空串。 */
  currentOrigin: string
  /** 已配置主机的 origin 列表（由主进程注入，见 `createHostWindow`）。 */
  knownHostOrigins: readonly string[]
}): WindowOpenDecision {
  const parsed = safeUrl(input.url)
  if (parsed === undefined) return 'external'
  // 协议大小写不敏感：`new URL()` 已把 protocol 规范化为小写。
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'external'

  const target = comparableOrigin(parsed.origin)
  if (target === undefined) return 'external'

  for (const origin of input.knownHostOrigins) {
    if (comparableOrigin(origin) === target) return 'navigate-self'
  }

  if (input.currentOrigin !== '' && comparableOrigin(input.currentOrigin) === target) {
    return 'navigate-self'
  }

  return 'external'
}

/**
 * 两个地址是否指向同一处（规范化后比较）。
 *
 * 用途：`deny` 之后我们自己导航之前，先判断「是不是已经在目标地址上了」——
 * 页面把当前地址当作新窗口打开（`window.open(location.href)` 之类）时，
 * 重载一次毫无意义，而 dsh 是 SPA，重载会丢掉当前会话的界面状态。
 *
 * 字符串直接相等是最常见的情况；不等时再按 `URL` 规范化后的 `href` 比一次，
 * 以吃掉大小写、默认端口、`https://a.com` 与 `https://a.com/` 这类写法差异。
 * 都解析不了就退回字符串比较。
 *
 * @param a - 地址一。
 * @param b - 地址二。
 * @returns 指向同一处时返回 true。
 */
export function isSameAddress(a: string, b: string): boolean {
  if (a === b) return true
  const left = safeUrl(a)
  const right = safeUrl(b)
  if (left === undefined || right === undefined) return false
  return left.href === right.href
}

/** 一次导航结束后该对它做什么。 */
export type NavigationOutcome =
  /** 与认证无关，忽略这次导航。 */
  | 'ignore'
  /** 补一次带（当前）token 的握手。 */
  | 'replay-token'
  /** 无法回放或已回放过 → 显示离线页说明原因。 */
  | 'offline'

/**
 * `did-navigate` 之后该做什么。
 *
 * 场景：dsh 鉴权失败时返回 **401 + 一段提示文本**，对 Electron 而言这是一次
 * **成功**的导航（`did-fail-load` 不触发，页面停在纯文本错误上），只能在这里补救。
 *
 * 规则：
 * - 非 401 → `ignore`（与认证无关）；
 * - 401 且**没配 token** → `offline`：无从下手，交给离线页提示用户更新令牌；
 * - 401 且配了 token、**当前这份 token 尚未回放过** → `replay-token`；
 * - 401 且**已经回放过** → `offline`：无限回放既是无效流量，也会掩盖真正的问题
 *   （例如令牌本身就是错的）。
 *
 * 这条判定值得单测，是因为 `alreadyReplayed` 的生命周期**正是真机缺陷的所在**：
 * 只有在「令牌被更新」时把它归零（`HostWindowHandle.updateHost()` 做的事），
 * 用户更新 token 后点「重新加载」才可能重新走上 `replay-token` 分支；否则窗口会
 * **永远**停在 `offline`，症状与「token 明明更新了却依然进不去」完全一致。
 *
 * @param input - 判定输入。
 * @returns 应对该次导航执行的动作。
 */
export function navigationOutcome(input: {
  /** 本次导航的 HTTP 状态码。 */
  statusCode: number
  /** 该主机是否配置了 launch token。 */
  hasLaunchToken: boolean
  /** **当前这份** token 是否已经回放过一次。 */
  alreadyReplayed: boolean
}): NavigationOutcome {
  if (input.statusCode !== 401) return 'ignore'
  if (!input.hasLaunchToken) return 'offline'
  return input.alreadyReplayed ? 'offline' : 'replay-token'
}

/** 一个承载远端页面的窗口应有的 webPreferences。 */
export interface ContentWindowWebPreferences {
  /** 隔离渲染进程与 preload 的上下文。 */
  contextIsolation: boolean
  /** 页面**不得**拿到 Node（远端页面是不可信内容）。 */
  nodeIntegration: boolean
  /** 渲染进程运行在沙箱中。 */
  sandbox: boolean
  /** Electron partition 名，决定 cookie/登录态归属。 */
  partition: string
  /** preload 脚本绝对路径。 */
  preload: string
}

/**
 * 承载远端 dsh 页面的窗口所用的 webPreferences。
 *
 * **存在这个函数的理由**：把「一个承载远端页面的窗口该有什么配置」收敛到一处，
 * 使得 `partition` 只能从 origin 派生一次、沙箱开关无法被逐个窗口放宽。
 * task-18 起 `window.open` 一律 `deny`（内部链接改为在**当前窗口**导航），
 * 因此目前只有主机窗口在用；而「替换当前窗口」这条策略恰恰意味着**同一个窗口
 * 会承载不同 origin 的页面**，配置来自创建它的那台主机——若要恢复「新窗口打开」，
 * 子窗口也必须由本函数产出，才不会重演「新窗口丢登录态」的缺陷。
 *
 * 三项沙箱开关也在这里固定：远端页面是不可信内容，`sandbox: true` +
 * `contextIsolation: true` + `nodeIntegration: false` 是本项目安全模型的基础，
 * 不允许因为「窗口要能用某个功能」而被放宽。
 *
 * @param input - origin（决定 partition）与 preload 路径。
 * @returns 可直接交给 `webPreferences` 的对象。
 */
export function contentWindowWebPreferences(input: {
  /** 主机 origin。 */
  origin: string
  /** preload 脚本绝对路径。 */
  preload: string
}): ContentWindowWebPreferences {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    // 由 origin 派生：同一个主机（含它打开的子窗口）必然拿到同一个 partition。
    partition: partitionNameFor(input.origin),
    preload: input.preload,
  }
}
