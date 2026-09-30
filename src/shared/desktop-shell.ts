/**
 * 桌面壳与 dsh web 前端之间的 DOM 契约。
 *
 * 这里只放**契约本身**（属性名 + 取值收窄），不 import electron、也不碰 `document`：
 * 两端都要用它——preload 跑在 `sandbox: true` 的隔离环境里，主进程则根本没有 DOM；
 * 放在 `shared/` 下让两边共用同一份定义，属性名才不会在两侧各写一遍后悄悄漂移。
 *
 * ## 为什么需要这个契约
 *
 * dsh 的 web 前端把「当前主题来源」公布在 `<html>` 上，并在源码里注明它是给**宿主壳**
 * 用的（`@deepseek-ai/dsh-client-ui-layout` 的 theme-presenter）：
 *
 * > Root attribute publishing the theme source (`light`, `dark`, or `system`) for host
 * > shells that mirror it into the native theme (the Electron preload forwards it to
 * > `nativeTheme.themeSource`, so native chrome, renderer `prefers-color-scheme` queries,
 * > and Platform login links follow the app palette on every platform).
 *
 * 也就是说：**让原生窗口装饰跟随应用主题是官方留给宿主壳的活**。壳不接这一棒，
 * 窗口标题栏与菜单栏就永远停在系统配色上——用户在客户端里换肤后，页面全变了、
 * 最上面那一条不变，正是这个缺口。
 *
 * ## 为什么转发 `nativeTheme.themeSource` 不会与页面互相触发
 *
 * 唯一可能成环的路径是 `prefers-color-scheme`：DSH 只在**主题偏好为 `system`** 时
 * 才去读那条媒体查询（`if (this.preference !== "system") return`）。而偏好为
 * `system` 时我们转发出去的也正是 `'system'`（不覆盖，交给 Electron 继续跟随
 * 操作系统），因此不存在「壳改媒体查询 → 页面改主题 → 壳再改」的回环。
 */

/**
 * `<html>` 上公布当前主题来源的属性名。
 *
 * 值域是 `light` / `dark` / `system`。
 */
export const THEME_SOURCE_ATTRIBUTE = 'data-ds-theme-source'

/**
 * 主题来源三态，与 Electron `nativeTheme.themeSource` 的取值域一致。
 *
 * `system` 表示「跟随操作系统」：转发后由 Electron 自己继续跟随系统主题变化，
 * 壳**不需要**（也不应该）代劳解析成具体明暗——代劳了，用户中途改系统主题时
 * 窗口装饰就不会跟着动了。
 */
export type ThemeSource = 'light' | 'dark' | 'system'

/**
 * 把页面公布的属性值收窄成三态。
 *
 * 刻意**不做**宽容处理（不 trim、不忽略大小写）：属性值只有三种合法写法，
 * 出现别的东西意味着前端换代或远端页面被篡改。此时返回 `undefined` 让调用方
 * 忽略这次上报——宁可维持现状，也不要把一个没看懂的值塞进 `nativeTheme`
 * 去驱动整个应用的配色。远端页面属于本项目认定的不可信内容，其上报按外部
 * 输入处理。
 *
 * @param raw - IPC 或 DOM 送来的原始值，类型未知。
 * @returns 合法时返回三态之一；其余情况返回 undefined。
 */
export function parseThemeSource(raw: unknown): ThemeSource | undefined {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : undefined
}

/**
 * 读属性所需的最小根元素形状。
 *
 * 只声明实际用到的那一个方法，使本函数能在 node 环境下用假对象测试，
 * 不必引入 jsdom。
 */
export interface ThemeSourceRoot {
  getAttribute(name: string): string | null
}

/**
 * 从页面根元素读当前主题来源。
 *
 * `root` 为 `null` 是**常态而非异常**：preload 在 document-start 时执行，那一刻
 * `<html>` 还没被解析出来。调用方应据此稍后再读（挂在 `DOMContentLoaded` 上），
 * 而不是把它当成错误。
 *
 * @param root - 页面根元素，或尚不存在时的 null。
 * @returns 读到的合法主题来源；读不到或非法时返回 undefined。
 */
export function readThemeSource(root: ThemeSourceRoot | null): ThemeSource | undefined {
  if (root === null) return undefined
  return parseThemeSource(root.getAttribute(THEME_SOURCE_ATTRIBUTE))
}

/**
 * 「自绘标题栏」高度（CSS px）。
 *
 * **三处必须同源，任何一处单独改都会让系统窗口按钮与自绘标题栏错位**：
 * 1. 注入页面的 `--dsh-windows-titlebar-height`（前端据此留出顶部空间并铺 drag 区）；
 * 2. Electron `titleBarOverlay.height`（系统按钮画在这个高度里并垂直居中）；
 * 3. preload 从命令行参数取到的值（它必须等于第 1 项）。
 * 因此这里只留**一个**常量，由主进程同时供给自己与 preload。
 *
 * 取 40 而非系统默认值：Windows 在 100% 缩放下标准标题栏约 32px，高 DPI 下更宽。
 * 40 在两种情况里都能容下按钮，也与前端那套 `--dsh-frame-*` 的留白量级一致。
 */
export const TITLEBAR_HEIGHT = 40

/**
 * `<html>` 上声明「本窗口用自绘标题栏」的属性。
 *
 * **只需存在，值无意义**：前端的样式与逻辑都用 `[data-windows-titlebar]` /
 * `hasAttribute()` 判定（见 `@deepseek-ai/dsh-client-ui-layout` 的样式表与
 * `lib/client.js`）。值写成 `''` 而不是 `'true'`，与官方 preload 的写法一致。
 */
export const TITLEBAR_ATTRIBUTE = 'data-windows-titlebar'

/** `<html>` 内联样式上承载自绘标题栏高度的 CSS 变量名。 */
export const TITLEBAR_HEIGHT_VARIABLE = '--dsh-windows-titlebar-height'

/**
 * 主进程用这个参数把标题栏高度交给 preload。
 *
 * 走 `webPreferences.additionalArguments` 而不是让 preload 自己按平台判断：
 * 「什么时候该用自绘标题栏」只能有**一处**判定（`usesCustomTitlebar`），
 * 两边各判一次必然漂移——preload 认为该注入、窗口却没做无边框，页面上就会
 * 凭空多出一条 40px 的空白。
 */
export const TITLEBAR_ARGUMENT = '--dsh-custom-titlebar'

/**
 * 是否用「自绘标题栏」替代系统标题栏。
 *
 * 只认 Windows。Electron 官方把 `titleBarStyle` 的适用范围写成
 * 「Apply custom title bar styles _macOS_ _Windows_」，Linux 不在其中；
 * 而 macOS 有自己的一整套（交通灯 + `data-platform="darwin"`），
 * 拿 Windows 这套契约去套会得到没有窗口按钮的窗口。
 *
 * @param platform - `process.platform`。
 * @returns 应使用自绘标题栏时返回 true。
 */
export function usesCustomTitlebar(platform: string): boolean {
  return platform === 'win32'
}

/**
 * 注入契约所需的最小根元素形状（只用到这两个成员，便于在 node 下测试）。
 */
export interface TitlebarContractRoot {
  setAttribute(name: string, value: string): void
  style: { setProperty(name: string, value: string): void }
}

/**
 * 把自绘标题栏契约写进页面根元素。
 *
 * 前端据此给内容区留出 `height` 的顶部空间、铺一条 `-webkit-app-region: drag`
 * 的可拖拽带，并用皮肤 token 给它上色——**顶部跟随应用主题正是靠这一步**。
 *
 * 幂等：重复调用写入相同的值，因此可以安全地在 DOM 就绪、页面导航等多种时机重放。
 *
 * @param root - 页面根元素（`document.documentElement`）。
 * @param height - 标题栏高度（px），应与 `titleBarOverlay.height` 相同。
 */
export function applyTitlebarContract(root: TitlebarContractRoot, height: number): void {
  root.setAttribute(TITLEBAR_ATTRIBUTE, '')
  root.style.setProperty(TITLEBAR_HEIGHT_VARIABLE, `${String(height)}px`)
}

/**
 * 从命令行参数解析标题栏高度。
 *
 * 参数缺失或畸形都返回 `undefined`（由调用方决定不注入），**不做兜底默认值**：
 * 悄悄用一个与 `titleBarOverlay.height` 不同的高度，换来的是一条错位的、
 * 比不生效更难排查的界面。宁可完全不注入。
 *
 * @param argv - 形如 `process.argv` 的参数数组。
 * @returns 合法高度；未提供或非法时 undefined。
 */
export function titlebarHeightFromArguments(argv: readonly string[]): number | undefined {
  const prefix = `${TITLEBAR_ARGUMENT}=`
  const matched = argv.find(argument => argument.startsWith(prefix))
  if (matched === undefined) return undefined
  const height = Number(matched.slice(prefix.length))
  return Number.isFinite(height) && height > 0 ? height : undefined
}

