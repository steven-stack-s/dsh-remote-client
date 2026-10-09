import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
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
 * ## 为什么走「临时文件 + rename」而不是直写
 *
 * 调用方的顺序是「先写状态、再弹框」——恰恰是为了防「用户点立即重启后进程马上
 * 退出、来不及写盘」。但那也意味着**写入时刻正是最容易撞上进程退出或掉电的
 * 时刻**。`writeFile` 直写目标路径时，若在写入中途中断，磁盘上会留下半截 JSON。
 *
 * 降级本身是良性的（`readPromptedVersion` 读不出来就当「没提示过」，见其说明），
 * 所以这是 Important 偏 Minor；但原子写几乎没有成本，能直接消掉这个窗口。
 *
 * `rename` 在同一文件系统内是原子的：读者要么看到**旧的完整内容**，要么看到
 * **新的完整内容**，不存在半截状态。临时文件放在同一目录（同文件系统）是前提。
 *
 * 临时文件名带上 pid 与随机串：同一进程内并发写入（例如两个版本号几乎同时
 * 下载完成）不会互相踩对方的临时文件。写失败时尽力清理，清理失败只忽略——
 * 一个残留的临时文件不该让「记录状态」这件事失败。
 *
 * ## 为什么写入还要串行（Windows 的 EPERM）
 *
 * 临时文件名唯一只解决了「互相踩临时文件」，**没解决「并发 rename 同一个目标」**：
 * 两条写入各自 rename 到同一个 `update-state.json` 时，Windows 会把目标文件当成
 * 独占资源，**第二个 rename 直接失败 `EPERM: operation not permitted, rename`**
 * （POSIX 允许静默覆盖，所以 Linux 上 20 路并发全成功、完全测不出来）。
 * 而并发是真实存在的：调用方的 `prompting` Set 按 version 去重，**不同版本**可以
 * 同时走到这里；且状态文件写在用户目录，杀软/索引服务短暂占用目标文件同样会 EPERM。
 *
 * 因此本模块把所有写入排进一条 promise 链（`writeQueue`），**同一进程内严格串行**：
 * 任意时刻至多只有一次 rename 在途，目标不可能被另一个 rename 占用，EPERM 的
 * 竞争条件从根上不存在（不需要重试与退避）。语义也是对的——后写覆盖先写，链的
 * 顺序即调用的顺序。跨进程并发不在考虑范围：应用有单实例锁。
 *
 * 注意本函数**保持既有导出签名不变**，调用方无需改动。
 *
 * @param dir - 状态文件所在目录，不存在时自动创建。
 * @param version - 已提示过的版本号。
 */
export async function writePromptedVersion(dir: string, version: string): Promise<void> {
  // 排到队尾。注意这里**不 await 队列**，只把自己接上去：`run` 内部已经把错误
  // 转成「已处理的 rejection」，所以一次失败不会污染后续写入，也不会触发
  // unhandled rejection；而每次调用各自 await 自己的 `run`，因此错误照常抛给
  // 各自的调用方（签名与错误语义不变）。
  const run = writeQueue.then(() => writePromptedVersionNow(dir, version))
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** 串行队列的尾节点：已完成（含失败）的 promise，永不 reject。 */
let writeQueue: Promise<void> = Promise.resolve()

/** 真正落盘的一步；只被 {@link writePromptedVersion} 经队列串行调用。 */
async function writePromptedVersionNow(dir: string, version: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  const target = join(dir, STATE_FILE)
  // 与目标同目录（同文件系统），否则 rename 会退化成跨设备拷贝、失去原子性。
  const temp = join(dir, `${STATE_FILE}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(temp, `${JSON.stringify({ promptedVersion: version }, null, 2)}\n`, 'utf8')
    await rename(temp, target)
  } catch (error) {
    // 尽力清理临时文件；清理本身失败只忽略，别把真正的写入错误盖掉。
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
}
