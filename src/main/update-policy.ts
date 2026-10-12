/**
 * 更新提示策略：**纯逻辑**，不 import electron。
 *
 * 分层理由与 `notifications.ts` / `backoff.ts` / `lifecycle.ts` 相同：vitest 跑在
 * node 环境下，**不能 import 含 electron 的模块**（`require('electron')` 会触发下载
 * Electron 二进制，测试直接挂起）。本模块没有任何 electron 值导入，因此「该不该向
 * 用户提示有新版本」这个真正会出错的决策可以被单测完整覆盖；`autoUpdater` 的事件
 * 接线留在本来就无法测试的 `index.ts` / `updater.ts` 里。
 *
 * **只做字符串相等比较，不引入 semver 依赖**：`electron-updater` 自己已经判断过
 * 「确实有更新」才会把版本号交给我们，这里只需回答「这个版本我提示过没有」。用相等
 * 比较还顺带免疫了预发布版本号的解析问题（本仓真出现过 `0.1.4-diagnostic.1`，它不是
 * 标准 semver 的比较对象）。
 */

/** 启动后多久做第一次检查（毫秒）。避开启动高峰，别和首屏抢资源。 */
export const UPDATE_CHECK_DELAY_MS = 30_000

/** 之后每隔多久再查一次（毫秒）。用于长期驻留托盘时的兜底检查。 */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export interface PromptDecisionInput {
  readonly availableVersion: string
  readonly promptedVersion: string | undefined
}

/**
 * 是否应该就 `availableVersion` 向用户弹出「是否重启安装」的询问。
 *
 * 同一版本只问一次：用户点过「稍后」之后不再重复打扰，直到出现**另一个**版本号。
 */
export function shouldPromptForUpdate(input: PromptDecisionInput): boolean {
  const available = input.availableVersion.trim()
  if (available === '') return false
  return available !== input.promptedVersion
}

/** 一次「立即检查更新」的结局。 */
export type UpdateCheckOutcome =
  /** 已是最新。 */
  | 'up-to-date'
  /** 发现新版本，正在后台下载。 */
  | 'available'
  /** 正在下载（用户重复点击时）。 */
  | 'downloading'
  /** 检查失败（网络不通、更新源异常等）。 */
  | 'error'
  /** 更新器未启用（开发模式，或用户在设置里关掉了检查）。 */
  | 'disabled'

/**
 * 把版本号整成可显示的文本。
 *
 * 空值返回「未知」而不是空串：设置界面里出现一个空白行，用户分不清是
 * 「版本号取不到」还是「界面没渲染」。
 *
 * **刻意不加 `v` 前缀**：`package.json` 与安装包里都是 `0.2.0` 这种写法，
 * 界面擅自加 `v` 会让用户对不上（「设置里写 v0.2.0，我下载的文件叫 0.2.0」）。
 *
 * @param version - 原始版本号。
 * @returns 可显示文本。
 */
export function updateVersionText(version: string): string {
  const trimmed = version.trim()
  return trimmed === '' ? '未知' : trimmed
}

/**
 * 把一次检查的结局翻译成给用户看的一句话。
 *
 * 放在这里（而非界面里）是因为它要处理「失败时没有版本号」这类分支，而那些
 * 分支正是最容易拼出残缺文案的地方——纯函数才能被单测钉住。
 *
 * @param outcome - 检查结局。
 * @param version - 相关版本号；失败/开发模式下为空。
 * @returns 一句可读的中文说明。
 */
export function updateCheckMessage(outcome: UpdateCheckOutcome, version: string): string {
  const text = updateVersionText(version)
  switch (outcome) {
    case 'up-to-date':
      return '已是最新版本。'
    case 'available':
      return `发现新版本 ${text}，正在后台下载；下载完成后会询问是否重启。`
    case 'downloading':
      return `新版本 ${text} 正在下载中，请稍候。`
    case 'error':
      // 刻意不拼版本号：失败路径根本拿不到它，硬拼会得到「发现新版本  可用」。
      return '检查更新失败（网络不通或更新源异常）。稍后会再自动检查，不影响使用。'
    case 'disabled':
      return '当前未启用更新检查（开发模式下不检查；也可能是你在上面关掉了它）。'
  }
}
