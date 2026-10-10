/**
 * 更新器的**落盘诊断日志**：纯逻辑 + 与 Electron 解耦的文件 IO。
 *
 * 分层理由与 `update-policy.ts` / `update-state.ts` / `notifications.ts` 相同：
 * 本模块**不 import electron**，因此可以被 vitest 直接加载、用临时目录完整覆盖。
 *
 * ## 为什么需要它
 *
 * `updater.ts` 把 `autoUpdater.logger` 设成了 `null`（它默认往 stdout 刷进度，
 * 在打包版是噪音），此后所有诊断只走 `console.error`。而**打包版 Windows 没有
 * 控制台**——用户看不到任何输出。后果有两条，都真实发生过：
 *
 * 1. **验收做不了**：验证指南的自动更新清单要求「启动约 30 秒后，日志出现检查
 *    更新」「断网启动只留日志」，真机上根本无日志可看；
 * 2. **排障没线索**：定位通知「有时不弹」那个缺陷时，正是因为当时临时加了一个
 *    日志文件才查出根因（`userData/notify-trace.log`）。更新功能需要一个**常设**的
 *    等价物，而不是每次出事再临时加。
 *
 * ## 上限口径（本模块最容易做错的地方）
 *
 * 日志是长期保留的，绝不能无限增长。这里用**行数上限**而不是字节上限：
 *
 * - 每条记录先经 {@link normalizeLogEntry} 压成**单行**并截断到
 *   {@link UPDATE_LOG_MAX_LINE_CHARS} 字符，因此单条大小有界；
 * - 于是「保留最近 {@link UPDATE_LOG_MAX_LINES} 行」也就等价于大小有界
 *   （上界约 200 × 400 ≈ 80KB，实际远小于此）；
 * - 行数口径比字节口径更容易推理与测试：不必考虑多字节字符的字节长度差异。
 *
 * 写入用**整文件重写**而不是追加：文件本身很小（几十 KB），重写一次的开销可忽略，
 * 换来的是「截断」这件事变得平凡，也不会出现追加到一半留下半行的情况。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 日志文件名，与 `update-state.json` 同放在 `userData/` 下。 */
export const UPDATE_LOG_FILE = 'update.log'

/** 保留的最大**行数**；超出时丢弃最旧的。口径说明见文件头。 */
export const UPDATE_LOG_MAX_LINES = 200

/** 单条记录的最大**字符数**；超出时截断并加省略号。 */
export const UPDATE_LOG_MAX_LINE_CHARS = 400

/**
 * 把一条记录规范化为单行、并限制长度。
 *
 * 压成单行是必需的：错误对象的 message 可能自带换行，一旦原样写入就会让
 * 「行数上限」失去意义（一条记录占掉几十行），也会让日志难以按行阅读。
 *
 * @param entry - 原始记录文本。
 * @param maxChars - 单条上限，默认 {@link UPDATE_LOG_MAX_LINE_CHARS}。
 * @returns 单行、长度不超过 `maxChars` 的文本；被截断时以 `…` 结尾。
 */
export function normalizeLogEntry(entry: string, maxChars: number = UPDATE_LOG_MAX_LINE_CHARS): string {
  // 换行替换成可见符号而不是空格：读者能看出「这里原本有换行」，信息不丢。
  const single = entry.replace(/\r?\n/g, ' ⏎ ').trim()
  if (single.length <= maxChars) return single
  // 截断处留一个字符给省略号，保证结果长度**不超过** maxChars 而不是等于 maxChars + 1。
  return `${single.slice(0, Math.max(0, maxChars - 1))}…`
}

/**
 * 追加一条记录并按行数上限裁剪。
 *
 * 抽成纯函数的理由：边界条件（恰好等于上限、超出若干行、上限为 0 或 1）最容易写错，
 * 而这正是「日志慢慢撑爆用户磁盘」这类问题的所在。
 *
 * @param existing - 现有行（按时间从旧到新）。
 * @param entry - 要追加的记录（应当是 {@link normalizeLogEntry} 的结果）。
 * @param maxLines - 保留的最大行数。
 * @returns 新的行数组；长度不超过 `maxLines`，且总是保留**最新的**那些行。
 */
export function boundLogLines(
  existing: readonly string[],
  entry: string,
  maxLines: number = UPDATE_LOG_MAX_LINES,
): string[] {
  const next = [...existing, entry]
  if (next.length <= maxLines) return next
  // 丢弃最旧的：排障时关心的是「刚刚发生了什么」。
  return next.slice(next.length - maxLines)
}

/** 更新器日志句柄。 */
export interface UpdateLog {
  /**
   * 记录一条诊断信息（同步返回，写入在内部排队）。
   *
   * 刻意**不做成 async**：调用方分散在各处事件回调里，让它们逐个 await 写日志
   * 既啰嗦又会把 IO 延迟掺进更新流程。写入失败一律吞掉（见下）。
   *
   * @param message - 记录文本；含换行会被压平。
   */
  record: (message: string) => void
  /**
   * 等待已排队的写入落地。
   *
   * 只为测试与「退出前确保落盘」而存在——正常路径不需要调用它。
   *
   * @returns 队列排空后 resolve（写入失败也不会 reject）。
   */
  flush: () => Promise<void>
}

/**
 * 创建更新器日志。
 *
 * **所有失败都被吞掉**：写日志是纯粹的附加能力，磁盘满、目录只读、文件被占用
 * 都不能牵连更新流程，更不能影响应用启动。这与本项目对「更新是锦上添花」的一贯
 * 态度一致（见 `updater.ts` 的约束 2）。
 *
 * @param deps - 目录与可选时钟。
 * @returns 日志句柄。
 */
export function createUpdateLog(deps: { dir: string, now?: () => Date }): UpdateLog {
  /** 已加载的行。undefined 表示尚未加载（首次写入时才读盘）。 */
  let lines: string[] | undefined
  /** 写入串行队列：避免并发写同一文件互相截断。 */
  let queue: Promise<void> = Promise.resolve()

  const load = async (): Promise<string[]> => {
    if (lines !== undefined) return lines
    try {
      const raw = await readFile(join(deps.dir, UPDATE_LOG_FILE), 'utf8')
      // 丢弃空行：文件末尾的换行会 split 出一个空串。
      lines = raw.split('\n').filter(line => line !== '')
    } catch {
      // 文件不存在（首次运行）或读失败 —— 都从空开始，不是错误。
      lines = []
    }
    return lines
  }

  const record = (message: string): void => {
    const at = (deps.now ?? ((): Date => new Date()))().toISOString()
    const entry = `${at} ${normalizeLogEntry(message)}`

    // 接到队尾而不是 await：record 是同步签名，且调用方都在不该被 IO 阻塞的位置。
    queue = queue.then(async () => {
      try {
        const existing = await load()
        const next = boundLogLines(existing, entry)
        // 先更新内存再落盘：即便写盘失败，本次进程内的后续记录也不会重复计算旧内容。
        lines = next
        await mkdir(deps.dir, { recursive: true })
        await writeFile(join(deps.dir, UPDATE_LOG_FILE), `${next.join('\n')}\n`, 'utf8')
      } catch {
        // 见上：写日志失败绝不影响更新流程。
      }
    })
  }

  return { record, flush: (): Promise<void> => queue }
}
