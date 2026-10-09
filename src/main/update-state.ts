import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const STATE_FILE = 'update-state.json'

/**
 * 读取「上次已提示过的版本」。
 *
 * **一律不抛**：文件不存在、坏 JSON、字段类型不对都返回 `undefined`，
 * 语义等同「没提示过」。理由是不能因为一个状态文件损坏就阻塞更新——
 * 最坏情况是同一个版本多问用户一次，而抛异常会让整条更新链路停摆。
 *
 * @param dir - 状态文件所在目录（主进程用 `app.getPath('userData')`）。
 * @returns 已提示过的版本号；读不出来时为 `undefined`。
 */
export async function readPromptedVersion(dir: string): Promise<string | undefined> {
  try {
    const raw = JSON.parse(await readFile(join(dir, STATE_FILE), 'utf8')) as unknown
    if (typeof raw !== 'object' || raw === null) return undefined
    const value = (raw as { promptedVersion?: unknown }).promptedVersion
    return typeof value === 'string' && value !== '' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * 记录「已就某版本提示过用户」。
 *
 * 写路径**如实抛错**，由调用方决定吞不吞：记不上状态只是下次多问一遍，
 * 不该让已经下载好的更新失败，但也不该由本模块替调用方做这个取舍。
 *
 * @param dir - 状态文件所在目录，不存在时自动创建。
 * @param version - 已提示过的版本号。
 */
export async function writePromptedVersion(dir: string, version: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, STATE_FILE), `${JSON.stringify({ promptedVersion: version }, null, 2)}\n`, 'utf8')
}
