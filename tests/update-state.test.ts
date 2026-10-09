import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readPromptedVersion, writePromptedVersion } from '../src/main/update-state.js'

const tempDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'dsh-update-state-'))

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
    // 调用方是「先写状态、再弹框」——写入时刻正是最容易撞上进程退出/掉电的时刻，
    // 所以改成临时文件 + rename。这条断言守住两个后果：
    // 1. 读者永远看不到半截 JSON（这里表现为最终值必须是某个完整版本号）；
    // 2. 临时文件不残留（否则用户目录里会慢慢堆垃圾）。
    await Promise.all(
      Array.from({ length: 20 }, (_, index) => writePromptedVersion(dir, `9.9.${index}`)),
    )

    const raw = JSON.parse(await readFile(join(dir, 'update-state.json'), 'utf8')) as {
      promptedVersion?: unknown
    }
    expect(typeof raw.promptedVersion).toBe('string')
    expect(raw.promptedVersion).toMatch(/^9\.9\.\d+$/u)

    const leftover = (await readdir(dir)).filter(name => name.endsWith('.tmp'))
    expect(leftover).toEqual([])
  })
})
