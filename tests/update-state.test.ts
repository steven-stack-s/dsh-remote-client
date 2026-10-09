import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { readPromptedVersion, writePromptedVersion } from '../src/main/update-state.js'

/**
 * `rename` 观测钩子：统计「同时在途」的 rename 数。
 *
 * 存在的理由——CI 在 `windows-latest` 上报的 `EPERM: operation not permitted, rename`
 * **在 Linux 上复现不出来**（POSIX 允许 rename 静默覆盖同一目标，Windows 直接拒绝），
 * 所以「本地全绿」对这个缺陷毫无证明力。这里换一条与平台无关的路：既然根因是
 * 「两个 rename 同时指向同一个目标」，那就**直接测「rename 是否重叠」**——
 * 计数为 0 即证明写入被串行化，EPERM 的竞争条件不存在。这个断言在 Linux 上同样
 * 有区分度：把串行队列去掉后它会立刻变红（见提交说明里的反证记录）。
 *
 * 用 `vi.mock` 包一层真实实现（其余 API 原样透传），不是为了替换行为，只是取一个
 * 可观测点；`calls` 计数同时兼作「钩子确实生效」的自检，避免拦截失效时测试**假绿**。
 */
const renameProbe = vi.hoisted(() => ({
  inFlight: 0,
  maxInFlight: 0,
  calls: 0,
}))

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    default: actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      renameProbe.calls += 1
      renameProbe.inFlight += 1
      if (renameProbe.inFlight > renameProbe.maxInFlight) {
        renameProbe.maxInFlight = renameProbe.inFlight
      }
      try {
        return await actual.rename(...args)
      } finally {
        renameProbe.inFlight -= 1
      }
    },
  }
})

const tempDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'dsh-update-state-'))

/** 重置观测点，避免用例之间互相污染。 */
const resetRenameProbe = (): void => {
  renameProbe.inFlight = 0
  renameProbe.maxInFlight = 0
  renameProbe.calls = 0
}

describe('更新状态读写', () => {
  it('写入后能读回', async () => {
    const dir = await tempDir()
    await writePromptedVersion(dir, '0.1.8')
    expect(await readPromptedVersion(dir)).toBe('0.1.8')
  })

  it('文件不存在 → undefined（当作没提示过，不是错误）', async () => {
    const dir = await tempDir()
    expect(await readPromptedVersion(dir)).toBeUndefined()
  })

  it('文件是坏 JSON → undefined（不能因为状态损坏就阻塞更新）', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'update-state.json'), '{ 这不是 JSON', 'utf8')
    expect(await readPromptedVersion(dir)).toBeUndefined()
  })

  it('字段类型不对 → undefined（远端/手工改坏都要挡住）', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'update-state.json'), '{"promptedVersion": 42}', 'utf8')
    expect(await readPromptedVersion(dir)).toBeUndefined()
  })

  it('写入是覆盖式的，只留最后那个版本', async () => {
    const dir = await tempDir()
    await writePromptedVersion(dir, '0.1.8')
    await writePromptedVersion(dir, '0.1.9')
    expect(await readPromptedVersion(dir)).toBe('0.1.9')
    const raw = JSON.parse(await readFile(join(dir, 'update-state.json'), 'utf8'))
    expect(Object.keys(raw)).toEqual(['promptedVersion'])
  })

  it('写入是原子式的：并发写不产生半截文件，也不残留临时文件', async () => {
    const dir = await tempDir()
    resetRenameProbe()
    // 调用方是「先写状态、再弹框」——写入时刻正是最容易撞上进程退出/掉电的时刻，
    // 所以改成临时文件 + rename。这条断言守住两个后果：
    // 1. 读者永远看不到半截 JSON（这里表现为最终值必须是某个完整版本号）；
    // 2. 临时文件不残留（否则用户目录里会慢慢堆垃圾）。
    //
    // 再加上一条与平台无关的**串行化证据**：20 路并发写里，任意时刻至多只有一次
    // rename 在途（maxInFlight === 1）。这正是 Windows EPERM 的根因所在——两个
    // rename 同时指向同一目标时 Windows 会拒绝后来者；Linux 上不会报错，所以
    // 只有这条断言能在本地把「队列被摘掉」的回归测出来。
    await Promise.all(
      Array.from({ length: 20 }, (_, index) => writePromptedVersion(dir, `9.9.${index}`)),
    )

    // 自检：钩子确实被走到了（否则 maxInFlight === 1 只是「什么都没观测到」的假绿）。
    expect(renameProbe.calls).toBe(20)
    expect(renameProbe.inFlight).toBe(0)
    expect(renameProbe.maxInFlight).toBe(1)

    const raw = JSON.parse(await readFile(join(dir, 'update-state.json'), 'utf8')) as {
      promptedVersion?: unknown
    }
    expect(typeof raw.promptedVersion).toBe('string')
    expect(raw.promptedVersion).toMatch(/^9\.9\.\d+$/u)

    const leftover = (await readdir(dir)).filter(name => name.endsWith('.tmp'))
    expect(leftover).toEqual([])
  })

  it('一次写入失败不会毒化串行队列：后续写入照常成功', async () => {
    // 串行队列是新引入的**跨调用共享状态**，它带来一个原本不存在的故障模式：
    // 若把队列尾节点直接设成会 reject 的 promise，任何一次失败（例如目录被占、
    // 磁盘满、Windows 上的瞬时 EPERM）都会让**之后所有**写入永久失败——
    // 比原来的 EPERM 严重得多（原缺陷只是并发时偶发失败，这个是永久性失效）。
    // 调用方 updater.ts 会吞掉写入错误继续弹框，所以这条退化路径不会有别的信号。
    const dir = await tempDir()
    // dataDir 指向一个普通文件：内部的 mkdir 必然失败，用来制造一次真实的写入失败。
    const notADir = join(dir, 'not-a-dir')
    await writeFile(notADir, 'x', 'utf8')

    await expect(writePromptedVersion(notADir, '1.0.0')).rejects.toThrow()

    // 关键断言：失败之后队列必须仍然可用。
    await writePromptedVersion(dir, '2.0.0')
    expect(await readPromptedVersion(dir)).toBe('2.0.0')
  })
})
