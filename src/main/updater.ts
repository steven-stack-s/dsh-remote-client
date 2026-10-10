/**
 * 应用内自动更新器：把 `electron-updater` 的事件流翻译成「后台下载 → 下好再问」。
 *
 * 分层理由与 `notifications.ts` / `lifecycle.ts` / `update-policy.ts` 相同：本模块
 * import 了 electron 与 electron-updater，在 vitest 的 node 环境下**加载不起来**
 * （`require('electron')` 会触发下载 Electron 二进制，测试直接挂起）。因此凡是能
 * 做成纯决策的部分都已被抽走：
 *
 * - 「该不该提示这个版本」→ `update-policy.ts` 的 `shouldPromptForUpdate`（有单测）；
 * - 「上次提示过哪个版本」→ `update-state.ts` 的读写（有单测）；
 * - 更新时机常量 → `update-policy.ts`。
 *
 * 留在这里的只有**不可能单测**的那部分：事件接线与时机调度。它的形态由
 * `tests/build-artifacts.test.ts` 按产物守一道（与托盘双击、单实例锁同理）。
 *
 * ## 四条硬性约束（设计规格 §3.3）
 *
 * 1. **只在打包版启用**——开发模式下没有 `app-update.yml`，`autoUpdater` 一碰就报错；
 * 2. **任何失败都静默**——网络不通、解析失败、写状态失败一律只 `console.error`，
 *    **绝不弹框**。用户没在等更新，打扰就是负收益；
 * 3. **不自动安装**——必须用户点「立即重启」才 `quitAndInstall()`；
 * 4. **同一版本只提示一次**——状态存 `userData/update-state.json`。
 *
 * ## 与「关窗驻留」的集成（规格 §3.4(a)）
 *
 * 规格说「`quitAndInstall()` 内部走 `app.quit()`，会先触发 `before-quit`，
 * 因此这条路径本就通」——**该前提与 Electron 的实际行为相反**，详见
 * {@link handleDownloaded}。这个缺陷只在打包版 + 真的下载完更新后才暴露，
 * 单测与产物断言都够不着，因此修法与理由都写在了代码注释里。
 */

import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { createUpdateLog, type UpdateLog } from './update-log.js'
import {
  UPDATE_CHECK_DELAY_MS,
  UPDATE_CHECK_INTERVAL_MS,
  shouldPromptForUpdate,
} from './update-policy.js'
import { readPromptedVersion, writePromptedVersion } from './update-state.js'

/**
 * 更新器的外部依赖。
 *
 * 全部由调用方注入而**不是**在这里直接读 electron：这样「只在打包版启用」这件事
 * 有唯一一个可读的判据（`isPackaged`），而不是散落在模块内部的 `app.isPackaged`
 * 调用里；`promptRestart` 也因此能被换成一个立即返回的实现，便于将来接测试。
 */
export interface UpdaterDeps {
  /**
   * 是否为打包版（主进程传 `app.isPackaged`）。
   *
   * 为 `false` 时**整个更新器都不启动**：开发模式没有 app-update.yml，
   * 任何 `checkForUpdates()` 都会走进错误路径刷日志。
   */
  readonly isPackaged: boolean
  /** 状态目录（主进程传 `app.getPath('userData')`）。 */
  readonly dataDir: string
  /**
   * 询问用户「已下载完成，现在重启安装吗？」。
   *
   * @param version - 已下载好的版本号，用于文案。
   * @returns 用户是否选择立即重启；「稍后」或询问失败都是 `false`。
   */
  readonly promptRestart: (version: string) => Promise<boolean>
  /**
   * 安装前的收尾钩子，**在 `quitAndInstall()` 之前调用**。
   *
   * 存在理由见 {@link handleDownloaded} 里 `quitAndInstall()` 那段说明：由更新器
   * 发起的退出，窗口 `close` 早于 `before-quit`（Electron 官方文档明确说明），
   * 而主机窗口的 `close` 被拦截为「隐藏到托盘」，只有 `quitting === true` 才放行。
   * 因此必须在调用 `quitAndInstall()` **之前**让应用进入「正在退出」状态，否则
   * `preventDefault()` 会让 Electron 取消整个退出流程（表现为「点了立即重启，
   * 窗口消失了但版本没变」）。
   *
   * 之所以做成必须提供的回调而不是继续写在 `promptRestart` 的注释里：那是**类型上
   * 表达不出来**的隐式契约，换一个 `promptRestart` 实现极易漏掉——本项正是因为
   * 漏掉它而变成过一个 B 级缺陷。放进 `UpdaterDeps` 后，少做这一步会直接编译失败。
   *
   * 实现方（`index.ts`）在这里置位 `quitting`；调用时机由本模块保证。
   */
  readonly beforeInstall: () => void
}

/**
 * 落盘日志句柄。装配时创建（{@link installUpdater}），在那之前为 undefined。
 *
 * 为 undefined 的两种情况都无害：开发模式下装配直接 return（`isPackaged` 为 false），
 * 以及装配前的极早期调用——此时只剩 `console` 这一路输出。
 */
let updateLog: UpdateLog | undefined

/** 把未知值描述成一行可读文本。 */
function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

/**
 * 当前应用版本号，用于日志。
 *
 * 取自 `autoUpdater.currentVersion`（它由 electron-updater 从 `app.getVersion()` 填好），
 * 而不是自己 import `app` —— 本模块只在装配处用到 `app`，能少一处耦合就少一处。
 * 取不到时返回 `未知`：日志里出现「未知」比抛异常或出现字符串 `undefined` 都好。
 */
function currentVersionText(): string {
  try {
    const text = String(autoUpdater.currentVersion)
    return text === '' || text === 'undefined' ? '未知' : text
  } catch {
    return '未知'
  }
}

/**
 * 记一条更新相关的**失败**日志。
 *
 * 两路输出，缺一不可：
 * - `console.error` —— 开发模式（`pnpm dev`）下开发者要有终端输出；
 * - {@link updateLog} —— **打包版 Windows 没有控制台**，只有落盘才看得见。
 *
 * 落盘这一路之前是缺的，而它正是「更新在真机上什么都没发生」唯一能自证的渠道：
 * 用户报「没提示更新」时，日志能区分「确实没有新版」与「静默失败了」。
 *
 * @param message - 前缀说明（统一带 `[dsh-remote-client]` 便于筛选）。
 * @param error - 原始错误；会被压成一行。
 */
function logError(message: string, error: unknown): void {
  console.error(`[dsh-remote-client] ${message}`, error)
  updateLog?.record(`${message}${describeError(error)}`)
}

/**
 * 记一条更新相关的**过程**日志（成功路径）。
 *
 * 与 {@link logError} 分开是因为两者的默认去向不同：过程日志只落盘、不进
 * `console`——开发模式下的正常更新流程没必要刷终端。而失败必须两路都有。
 *
 * @param message - 记录文本。
 */
function logStep(message: string): void {
  updateLog?.record(message)
}

/** 把库日志的任意参数拼成一段可读文本。 */
function formatLibraryLogArg(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return `${value.name}: ${value.message}`
  if (value === null || value === undefined) return ''
  try {
    // 库常用 `log.info({ file }, "message")` 这种「对象在前、文案在后」的调用形式，
    // 所以对象也要能落进日志，而不是变成 [object Object]。
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * 创建写给 electron-updater 的日志适配器：把库的内部日志接进我们的落盘日志。
 *
 * 为什么不是 `autoUpdater.logger = null`（那是最初的写法）：置 null 会把库内部
 * **唯一**报告「差分下载失败、回退全量」的渠道一起丢掉。那条消息只从
 * `AppUpdater.differentialDownloadInstaller` 的 catch 里发出，没有任何公开事件或
 * 返回值暴露给调用方（对调用方只返回一个布尔）。丢掉它就等于丢掉
 * 「这次更新为什么下了 106MB 而不是几 MB」的答案。
 *
 * 为什么仍不保留库的默认实现：默认那套写 **stdout**，而打包版没有控制台。
 *
 * `debug` 刻意不接：那是逐块级别的细节，会把 200 行上限冲掉，反而埋掉关键行。
 *
 * @returns 符合库要求（`{ info, warn, error }`）的日志器。
 */
function createLibraryLogger(): {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
} {
  const write = (prefix: string, args: unknown[]): void => {
    const text = args.map(formatLibraryLogArg).filter(part => part !== '').join(' ')
    logStep(`${prefix}${text}`)
  }
  return {
    info: (...args) => { write('[库] ', args) },
    warn: (...args) => { write('[库·警告] ', args) },
    error: (...args) => { write('[库·错误] ', args) },
  }
}

/**
 * 装配是否已完成。**幂等守卫**（I2）。
 *
 * `installUpdater` 唯一的调用方是 `boot()`，而 `boot()` 是可重入的：macOS 上
 * `activate`（点 Dock 图标）在「窗口都关掉了」时会再调一次 `boot()`。没有这个
 * 标志的话，`autoUpdater.on(...)` 会被再注册一份——一次 `update-downloaded` 会
 * 触发两遍 {@link handleDownloaded}（进而可能弹出两个对话框），并多出一个
 * `setInterval` 与一个 `setTimeout`（旧的那个没有 `clear`，也拿不到句柄）。
 *
 * 直接守卫「注册」这个动作，而不是守卫 `boot()`：需要幂等的是注册，`boot()` 里
 * 其余步骤（如重开窗口）本就该能重复执行。
 */
let installed = false

/**
 * **正在进行中**的「询问是否重启」流程所对应的版本号。
 *
 * **重入占位**（I3）。{@link handleDownloaded} 从读状态到弹框之间全是 await 让点
 * （读盘 → 判定 → 写盘 → 弹框），若只有 I2 的守卫而没有这一层，两条并发的
 * `handleDownloaded` 可以在**都读到「未提示过」之后**各自走到弹框，弹出两个一模一样的
 * 对话框——那正是 spec §3.3 约束 4 要防的体验。
 *
 * 在第一次 `readPromptedVersion` **之前**就占位（而不是写盘之后），因为让点从
 * 读盘就已经存在。用 `Set` 而不是单个布尔：不同版本号应当能各自走一遍。
 *
 * ## 这个 Set **只负责进程内并发去重**，不是「已提示过」的记录（B2 的教训）
 *
 * 别把它的语义扩大到「记住提示过谁」——那是 `update-state.json` 的职责，且必须
 * 跨进程存活。本 Set 的生命周期严格等于**一次询问过程**：进入时 `add`，退出时
 * 由 `finally` `delete`（见 {@link handleDownloaded}）。
 *
 * 曾经漏掉那个 `delete`，后果比它要修的问题严重得多：占位与进程同寿，于是用户
 * 点过「稍后」之后，**同一版本在本次进程剩余的整个生命周期里再也不会被询问**
 * ——常驻托盘时就是「更新永远装不上」。而「每个版本号只提示一次」的正确载体是
 * 持久化的 `update-state.json`。
 *
 * 判据：**占位必须活到流程结束，但绝不能活过流程结束。**
 */
const prompting = new Set<string>()

/**
 * 装配自动更新。**启动期只做一件事：定时器**，真正的检查在 30 秒之后。
 *
 * 全部失败路径都只记日志、绝不抛出：更新是锦上添花的能力，它挂掉绝不能
 * 影响窗口、托盘、主机连接这些主链路。因此本函数没有返回值，也不抛。
 *
 * @param deps - 外部依赖，见 {@link UpdaterDeps}。
 */
export function installUpdater(deps: UpdaterDeps): void {
  // 约束 1：开发模式下 electron-updater 会因缺 app-update.yml 报错。
  if (!deps.isPackaged) return

  // I2：幂等。boot() 可重入（macOS 的 activate 路径），重复注册会让一次
  // update-downloaded 触发两遍处理、并多出重复的定时器。
  if (installed) return
  installed = true

  try {
    // 落盘日志在第一行就建好：它必须能记录**后面每一步**，包括装配失败。
    // 失败一律吞掉（见 update-log.ts），所以这里不需要 try。
    updateLog = createUpdateLog({ dir: deps.dataDir })
    logStep(`更新器启动（当前版本 ${currentVersionText()}，日志位于 update.log）`)

    // electron-updater 默认自带一个往 **stdout** 刷的日志器；打包版没有控制台，
    // 那些输出等于丢掉。所以不保留它的默认实现——但也**不再置为 null**：直接置 null
    // 会把库内部最有价值的一条线索一起丢掉：
    //
    //   "Cannot download differentially, fallback to full download: …"
    //
    // 差分下载失败时库只通过它自己的 logger 报告（`AppUpdater.differentialDownloadInstaller`
    // 的 catch 里），没有任何公开事件或返回值暴露这件事——`differentialDownloadInstaller`
    // 对调用方只返回一个布尔。换句话说：**不上报这条，用户就无从知道「这次更新为什么
    // 下了 106MB 而不是几 MB」**。
    //
    // 改成一个把消息写进我们落盘日志的适配器：既保留「不刷 stdout」这个初衷，
    // 又让这些线索可查。debug 级刻意不接——那是逐块级别的细节，会把 200 行上限冲掉。
    autoUpdater.logger = createLibraryLogger()

    // 约束 3：不自动安装。`autoInstallOnAppQuit` 默认为 true——它会在**用户从
    // 托盘退出应用时**顺手把已下载的更新装上。那正是「静默重启会丢掉界面状态」
    // 的同一类风险，而且更隐蔽（用户以为只是退出）。必须显式关掉：装不装只由
    // 用户点「立即重启」决定。
    autoUpdater.autoInstallOnAppQuit = false

    // 顺序是 checkForUpdates() → update-available → downloadUpdate()
    //      → update-downloaded → 询问。
    //
    // **必须显式关掉 `autoDownload`**（库默认 true）。它不是可有可无的开关，
    // 关掉它才让「下载由我们发起、失败由我们记日志」真正成立。库里的时序是：
    //
    //   AppUpdater.js:414  this.onUpdateAvailable(updateInfo)
    //   AppUpdater.js:429    └─ this.emit("update-available", …)   ← 同步回调我们
    //   AppUpdater.js:422  downloadPromise: this.autoDownload ? this.downloadUpdate(…) : null
    //
    // 注意 422 在 429 **之后**才求值。而 `downloadPromise` 直到
    // `downloadUpdate()` 内部（L461）才被赋值，所以我们的 handler 在 emit 里调用
    // `downloadUpdate()` 时读到的 `downloadPromise` 还是 null → **真正启动下载的是
    // 我们这一次调用**；随后 L422 的调用撞上 L442 的 `if (this.downloadPromise != null)`
    // 被去重。
    //
    // 也就是说：不改这一行，下载**表面上照跑**，但我们其实是靠时序巧合在赢——
    // 而且库在 L422 那条分支上的 rejection 走 `.catch(e => { throw errorHandler(e) })`
    // 且**无人 await**（L416 的 `//noinspection ES6MissingAwait`），一旦下载失败，
    // 它会产生一个**不经过我们 `console.error`** 的 unhandled rejection，
    // 违反 spec §3.3 约束 2「任何失败都静默**且留日志**」。置为 false 后 L422 恒为
    // null，链路上只剩我们这一个可观测的失败出口。
    autoUpdater.autoDownload = false

    autoUpdater.on('update-available', event => {
      // 记下「确实发现了新版」——它把「没提示更新」的两种可能分开了：
      // 日志里有这行却后面没有下文，说明问题在下载或提示；完全没有这行，
      // 说明检查阶段就没发现新版（或检查本身失败了）。
      logStep(`发现新版本 ${event.version}，开始后台下载`)
      // 这里**只下载，不询问**：此刻还没有下载，问用户等于逼他等着下载完成。
      void autoUpdater.downloadUpdate().catch(error => {
        logError('更新下载失败（已忽略，不影响使用）：', error)
      })
    })

    autoUpdater.on('update-downloaded', event => {
      logStep(`新版本 ${event.version} 已下载完成，准备询问用户`)
      void handleDownloaded(deps, event.version)
    })

    // 约束 2：任何失败都静默。网络不通、latest.yml 解析失败、差分块对不上，
    // 全部只留日志——用户没在等更新，弹框打扰是负收益。
    autoUpdater.on('error', error => {
      logError('检查或下载更新失败（已忽略，不影响使用）：', error)
    })

    // 启动高峰（窗口加载、托盘初始化、首个会话连接）之后再检查第一次。
    // 用 setTimeout 而不是等到某处 await：这里不该阻塞 boot() 的后续步骤。
    const startupTimer = setTimeout(() => {
      void checkNow()
    }, UPDATE_CHECK_DELAY_MS)
    // 定时器不阻止进程退出：否则用户从托盘退出时会被这个待触发的定时器吊住。
    startupTimer.unref()

    // 用户可能长期不关客户端（托盘常驻），因此按 6 小时兜底复查。
    const interval = setInterval(() => {
      void checkNow()
    }, UPDATE_CHECK_INTERVAL_MS)
    // 同上：进程退出时无需清理，主进程单例随进程消亡；unref 只是让定时器
    // 不成为「进程还活着」的理由。
    interval.unref()
  } catch (error) {
    // 装配本身失败（例如 electron-updater 在某个平台上不支持）同样静默：
    // 没有更新器，应用照常可用。
    logError('自动更新装配失败（已忽略，不影响使用）：', error)
  }
}

/**
 * 发起一次检查。
 *
 * `checkForUpdates()` 在「没有新版本」时是正常 resolve 的（`isUpdateAvailable`
 * 为 false），因此只有异常才需要记日志。**失败不再重试排程**：6 小时的周期
 * 检查本身就是重试。
 */
async function checkNow(): Promise<void> {
  try {
    logStep(`开始检查更新（当前版本 ${currentVersionText()}）`)
    const result = await autoUpdater.checkForUpdates()
    // 明确记下「确实没有新版」这个**成功**结局。
    //
    // 缺这一行时，日志里只有「开始检查更新」而没有任何后续，读者无法区分
    // 「检查成功、只是没有新版」与「进程在检查中途没了」——这正是本日志要消除的
    // 那类歧义。另外两种结局各有自己的行：有新版本走 update-available，
    // 失败走下面的 catch。
    if (result?.isUpdateAvailable === false) {
      logStep('检查完成：当前已是最新版本')
    }
  } catch (error) {
    logError('检查更新失败（已忽略，不影响使用）：', error)
  }
}

/**
 * 更新已下载完成 → 询问用户是否立即重启安装。
 *
 * 约束 4 在这里落地：先读「上次提示过的版本」，只在这个版本还没问过时才弹。
 * 用户点「稍后」之后同样写入状态，因此**同一个版本只问一次**；等出现另一个
 * 版本号时会再次询问。
 *
 * @param deps - 外部依赖。
 * @param version - 已下载完成的版本号。
 */
async function handleDownloaded(deps: UpdaterDeps, version: string): Promise<void> {
  // I3：先占位再读盘。让点从第一次 await 就存在，因此占位必须在这里、而不是
  // 判定之后——否则两条并发调用会各自读到「未提示过」然后弹两个框。
  //
  // 并发为什么仍被挡住：第二条调用走到这里时，第一条还没执行到 `finally` 的
  // `delete`（它卡在某个 await 上），因此 `has()` 命中并直接返回。
  if (prompting.has(version)) return
  prompting.add(version)

  try {
    const promptedVersion = await readPromptedVersion(deps.dataDir)
    // 决策交给纯函数（有单测），这里只执行。
    if (!shouldPromptForUpdate({ availableVersion: version, promptedVersion })) {
      // 分离「静默跳过」与「静默失败」——这正是本日志存在的理由。用户报
      // 「有新版本却没提示」时，这行能说明是设计如此（只提示一次），而不是坏了。
      logStep(`版本 ${version} 已经提示过（上次 ${promptedVersion ?? '无记录'}），不再重复打扰`)
      return
    }

    // 先记状态再问：用户点「立即重启」后进程马上就要退出，那时再写盘可能来不及。
    // 反过来说，如果用户其实是点了「稍后」，状态也已经写好了——这正是我们要的语义。
    //
    // 写失败只记日志、**不中断流程**（约束 2：记不住状态不该让更新失败）。注意
    // 释放占位后若再次触发会**重新询问**，这是刻意的——状态没记住就该重问，
    // 而不是像 B2 那样永久闭嘴。
    try {
      await writePromptedVersion(deps.dataDir, version)
    } catch (error) {
      logError('更新状态写入失败（下次可能重复提示）：', error)
    }

    const restart = await deps.promptRestart(version)
    if (!restart) {
      logStep(`用户选择了「稍后」（版本 ${version}），本次不安装`)
      return
    }
    logStep(`用户选择了「立即重启」，开始安装版本 ${version}`)
    // **必须先把日志刷盘**：下一行 `quitAndInstall()` 会立即走应用退出流程，
    // 而日志写入是在队列里异步进行的——不在这里等一下，这条最关键的记录
    // （「用户确实点了重启」）很可能还没落盘进程就没了，于是真机上排查时看到的
    // 日志恰好缺了最后一环。flush 不抛，失败也只是少一条记录。
    await updateLog?.flush()

    // 约束 3：到这一步才是用户明确要求安装。
    //
    // ⚠️ `quitAndInstall()` 的退出时序**与直觉相反**：
    // Electron 官方文档说得很明确——由 `quitAndInstall()` 发起的退出，
    // `before-quit` 是在**所有窗口的 `close` 事件之后**才 emit 的（普通
    // `app.quit()` 则相反）。而本应用的主机窗口 `close` 被拦截为「隐藏到托盘」，
    // 只有 `quitting === true` 才放行。
    //
    // 所以若等到 `before-quit` 才置位 `quitting`，`close` 到达拦截时它还是 false
    // → `preventDefault()` → **Electron 取消整个退出流程**，表现为「点了立即重启，
    // 窗口消失了但版本没变」。
    //
    // 因此必须在下面这行之前调用 `deps.beforeInstall()`。它由 `index.ts` 提供
    // （置位 `quitting`），且是 `UpdaterDeps` 的**必填**字段——类型系统会强制
    // 每个调用方提供，不再是只靠注释维系的隐式契约。
    deps.beforeInstall()
    autoUpdater.quitAndInstall()
  } catch (error) {
    // 约束 2：询问本身失败也不能弹框（弹框失败再弹一个框毫无意义）。
    logError('更新提示失败（已忽略，不影响使用）：', error)
  } finally {
    // **必须释放占位**（B2）。上面的 `return` 有很多条（判定不通过、用户点稍后、
    // 安装完成、以及任何抛出），只有 `finally` 能保证每条路径都清理。
    //
    // 漏掉它时占位会与进程同寿：用户点过「稍后」之后，同一版本在本次进程剩余的
    // 全部生命周期内再也不会被询问——常驻托盘时就是「更新永远装不上」。
    // 注意这个 Set 只做**进程内并发去重**，「每个版本号只提示一次」由持久化的
    // `update-state.json` 负责（见 `prompting` 的说明）。
    //
    // 放在 `finally` 而不是各 `return` 之前：`quitAndInstall()` 之后进程即将退出，
    // 补一句清理既不必要也容易漏；统一在 `finally` 收口更不容易被后续改动破坏。
    prompting.delete(version)
  }
}

/**
 * 供 `index.ts` 组装「询问是否重启」对话框时复用的默认按钮位置。
 *
 * 导出常量而不是在 `index.ts` 里写字面量：默认选中「稍后」是**行为契约**
 * （误按回车绝不能重启应用），把它和判定逻辑放在一起，改文案时不容易漏掉。
 */
export const RESTART_DIALOG_DEFAULT_ID = 1

/**
 * 「立即重启」在对话框按钮数组里的下标。
 *
 * 与 {@link RESTART_DIALOG_DEFAULT_ID} 一样属于契约的一部分：`index.ts` 的
 * 回调靠它判断用户选了什么，两处必须一致。
 */
export const RESTART_DIALOG_CONFIRM_ID = 0

/**
 * 把主进程的 `app` 适配成 {@link UpdaterDeps}，供 `index.ts` 一行调用。
 *
 * 存在的意义只有一个：让 `index.ts` 不必重复书写 `app.isPackaged` /
 * `app.getPath('userData')` 这两个取值——它们都是「约束 1」的判据，散落多处
 * 就容易出现「一处加了门、另一处没加」。
 *
 * @param deps - 由调用方提供的两个回调：询问是否重启、安装前收尾。
 * @returns 组装好的依赖。
 */
export function updaterDeps(deps: {
  promptRestart: UpdaterDeps['promptRestart']
  beforeInstall: UpdaterDeps['beforeInstall']
}): UpdaterDeps {
  return {
    isPackaged: app.isPackaged,
    dataDir: app.getPath('userData'),
    promptRestart: deps.promptRestart,
    beforeInstall: deps.beforeInstall,
  }
}
