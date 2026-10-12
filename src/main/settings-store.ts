import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, normalizeSettings } from '../shared/settings.js'
import type { ClientSettings } from '../shared/settings.js'

/**
 * 客户端设置的持久化。
 *
 * 形态**刻意与 `hosts.ts` 对齐**（异步 + 同步两个入口、损坏文件同步改名留证），
 * 因为那套做法在本仓已经被真实故障打磨过：早先的实现在异步入口里注入
 * `void rename(...)`（fire-and-forget），于是 `load` 返回时备份可能尚未落盘——
 * Linux 上文件系统快、碰巧赶在断言前完成，Windows 上则被 `readdir` 抢先读到，
 * 导致 CI 失败。同目录内的 rename 只是元数据操作，同步执行的开销可忽略。
 *
 * 与 `hosts.ts` 的**唯一实质区别**在判据：那边「结构不符 = 损坏」，这边
 * 「有对象就尽力还原」。理由是设置项会随版本增删，**旧文件缺字段是常态而非
 * 事故**；只有 JSON 本身解析不了，才值得备份留证。
 */

/** 配置文件名。 */
const SETTINGS_FILE = 'settings.json'

/**
 * 某数据目录下的设置文件路径。
 *
 * @param dir - 数据目录（运行时为 `app.getPath('userData')`，测试时为临时目录）。
 * @returns 文件绝对路径。
 */
export function settingsFilePath(dir: string): string {
  return join(dir, SETTINGS_FILE)
}

/**
 * 把损坏的文件备份成 `settings.json.corrupt-<时间戳>`。
 *
 * **刻意用同步 API**：调用方 {@link parseSettings} 是同步函数，无法 `await`，
 * 而「备份必须在返回前完成」是它的语义承诺——调用者拿到默认值时，备份就应当
 * 已经存在。理由与 `hosts.ts` 的同名函数完全一致（见文件头说明）。
 *
 * @param from - 原文件路径。
 * @param to - 备份文件路径。
 */
function backupCorruptFile(from: string, to: string): void {
  renameSync(from, to)
}

/**
 * 解析设置文本；JSON 损坏时备份原文件。
 *
 * @param raw - 文件内容。
 * @param path - 文件路径，用于备份。
 * @returns 解析结果；损坏时返回默认值。
 */
function parseSettings(raw: string, path: string): ClientSettings {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 只有「连 JSON 都不是」才当损坏：这时原文件已无法承载任何用户意图，
    // 改名留证既保住了排查线索，也不影响可用性（仍返回默认值让用户能继续用）。
    try {
      backupCorruptFile(path, `${path}.corrupt-${String(Date.now())}`)
    } catch {
      // 备份失败不应吞掉可用性。
    }
    return { ...DEFAULT_SETTINGS }
  }
  // 字段级问题交给 normalizeSettings 逐字段回退——**不产生备份**：
  // 把一个能解析、只是旧了的文件改名，会让用户莫名看到一堆 corrupt 文件。
  return normalizeSettings(parsed)
}

/**
 * 读取设置。文件缺失或目录不存在都返回默认值；内容损坏时先把原文件改名为
 * `settings.json.corrupt-<时间戳>` 留证，再返回默认值。
 *
 * @param dir - 数据目录。
 * @returns 设置对象。
 */
export async function loadSettings(dir: string): Promise<ClientSettings> {
  const path = settingsFilePath(dir)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
  return parseSettings(raw, path)
}

/**
 * {@link loadSettings} 的同步版本。
 *
 * 存在的理由：设置的某些消费点必须在 `app.whenReady()` **之前**读到值
 * （与 `hosts.ts` 的 `loadHostsSync` 同理——Chromium 命令行开关只能在启动早期
 * 设置，那时无法 await）。
 *
 * @param dir - 数据目录。
 * @returns 设置对象。
 */
export function loadSettingsSync(dir: string): ClientSettings {
  const path = settingsFilePath(dir)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
  return parseSettings(raw, path)
}

/**
 * 写入设置，必要时创建目录。以换行结尾便于人工查看与版本控制。
 *
 * @param dir - 数据目录。
 * @param settings - 要写入的设置。
 */
export async function saveSettings(dir: string, settings: ClientSettings): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(settingsFilePath(dir), `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}
