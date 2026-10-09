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
 */

import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
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
}

/**
 * 记一条更新相关的日志。
 *
 * 统一前缀，便于用户在真机日志里筛。**成功路径不记**（那是噪音），只记失败——
 * 更新是后台行为，用户看不到它，出问题时日志是唯一线索。
 */
function logError(message: string, error: unknown): void {
  console.error(`[dsh-remote-client] ${message}`, error)
}

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

  try {
    // electron-updater 默认自带一个往 stdout 刷的日志器。这里关掉它，改用
    // console.error 只记错误——更新过程正常与否用户无从干预，刷屏的进度日志
    // 只会淹没真正的错误。
    autoUpdater.logger = null

    // 约束 3：不自动安装。`autoInstallOnAppQuit` 默认为 true——它会在**用户从
    // 托盘退出应用时**顺手把已下载的更新装上。那正是「静默重启会丢掉界面状态」
    // 的同一类风险，而且更隐蔽（用户以为只是退出）。必须显式关掉：装不装只由
    // 用户点「立即重启」决定。
    autoUpdater.autoInstallOnAppQuit = false

    // 顺序是 checkForUpdates() → update-available → downloadUpdate()
    //      → update-downloaded → 询问。
    //
    // 刻意**不用** `autoDownload = true` 的默认值：那样下载由库内部发起，我们就
    // 失去了「下载失败时静默、不弹框」的控制点。手动接这一步，链路上每个环节都
    // 在自己手里。
    autoUpdater.on('update-available', () => {
      // 这里**只下载，不询问**：此刻还没有下载，问用户等于逼他等着下载完成。
      void autoUpdater.downloadUpdate().catch(error => {
        logError('更新下载失败（已忽略，不影响使用）：', error)
      })
    })

    autoUpdater.on('update-downloaded', event => {
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
    await autoUpdater.checkForUpdates()
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
  try {
    const promptedVersion = await readPromptedVersion(deps.dataDir)
    // 决策交给纯函数（有单测），这里只执行。
    if (!shouldPromptForUpdate({ availableVersion: version, promptedVersion })) return

    // 先记状态再问：用户点「立即重启」后进程马上就要退出，那时再写盘可能来不及。
    // 反过来说，如果用户其实是点了「稍后」，状态也已经写好了——这正是我们要的语义。
    // 写失败只记日志：记不住状态最坏是下次多问一遍，不该因此中断更新。
    try {
      await writePromptedVersion(deps.dataDir, version)
    } catch (error) {
      logError('更新状态写入失败（下次可能重复提示）：', error)
    }

    const restart = await deps.promptRestart(version)
    if (!restart) return

    // 约束 3：到这一步才是用户明确要求安装。
    //
    // 打通「关窗驻留」：本函数由 `update-downloaded` 触发，而那是**启动 30 秒后**
    // 才可能发生的事，此时 `index.ts` 的模块级 `app.on('before-quit')` 早已注册
    // （早于 `app.whenReady()`）。因此 `quitAndInstall()` 内部走 `app.quit()` 时，
    // `quitting` 会被置位，窗口 `close` 拦截随之放行，退出不会被「隐藏到托盘」吞掉。
    autoUpdater.quitAndInstall()
  } catch (error) {
    // 约束 2：询问本身失败也不能弹框（弹框失败再弹一个框毫无意义）。
    logError('更新提示失败（已忽略，不影响使用）：', error)
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
 * @param promptRestart - 询问用户是否立即重启。
 * @returns 组装好的依赖。
 */
export function updaterDeps(promptRestart: UpdaterDeps['promptRestart']): UpdaterDeps {
  return {
    isPackaged: app.isPackaged,
    dataDir: app.getPath('userData'),
    promptRestart,
  }
}
