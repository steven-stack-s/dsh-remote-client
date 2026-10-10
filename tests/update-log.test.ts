import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  UPDATE_LOG_FILE,
  UPDATE_LOG_MAX_LINE_CHARS,
  boundLogLines,
  createUpdateLog,
  normalizeLogEntry,
} from '../src/main/update-log.js'

const tempDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'dsh-update-log-'))

/**
 * 上限与截断规则的行为契约。
 *
 * 存在的理由：日志是**长期保留**的，而「忘了设上限」的后果（慢慢撑爆用户磁盘）
 * 在开发和测试里都不会显现——只有用户用上几个月才暴露。而实现上限的代码又全是
 * 边界条件（恰好满、只超一行、上限为 1），所以把规则抽成纯函数在这里守住。
 */
describe('normalizeLogEntry', () => {
  it('普通文本原样返回', () => {
    expect(normalizeLogEntry('检查更新', 100)).toBe('检查更新')
  })

  it('把换行压成单行——否则「行数上限」会被一条多行错误撑破', () => {
    // 真实场景：Error 的 message 自带换行（Node 的很多网络错误都这样）。
    const entry = normalizeLogEntry('下载失败\n原因: ECONNRESET\r\n重试: 无', 100)
    expect(entry).not.toMatch(/\n/)
    expect(entry).toContain('ECONNRESET')
  })

  it('超过上限时截断并以省略号结尾，且长度不超过上限', () => {
    const entry = normalizeLogEntry('x'.repeat(50), 10)
    expect(entry.length).toBe(10)
    expect(entry.endsWith('…')).toBe(true)
  })

  it('恰好等于上限时不截断（边界取不到等号）', () => {
    const entry = normalizeLogEntry('x'.repeat(10), 10)
    expect(entry).toBe('x'.repeat(10))
    expect(entry.endsWith('…')).toBe(false)
  })

  it('首尾空白被去掉', () => {
    expect(normalizeLogEntry('  检查更新  ', 100)).toBe('检查更新')
  })

  it('默认上限是文件头声明的那个值', () => {
    const entry = normalizeLogEntry('y'.repeat(UPDATE_LOG_MAX_LINE_CHARS + 100))
    expect(entry.length).toBe(UPDATE_LOG_MAX_LINE_CHARS)
  })
})

describe('boundLogLines', () => {
  it('未达上限时全部保留', () => {
    expect(boundLogLines(['a', 'b'], 'c', 5)).toEqual(['a', 'b', 'c'])
  })

  it('恰好等于上限时仍全保留', () => {
    expect(boundLogLines(['a', 'b'], 'c', 3)).toEqual(['a', 'b', 'c'])
  })

  it('超出一行时丢掉最旧的那条', () => {
    expect(boundLogLines(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd'])
  })

  it('超出多行时保留最新的 maxLines 条', () => {
    expect(boundLogLines(['a', 'b', 'c', 'd'], 'e', 2)).toEqual(['d', 'e'])
  })

  it('上限为 1 时只留最新一条', () => {
    expect(boundLogLines(['a', 'b'], 'c', 1)).toEqual(['c'])
  })

  it('上限为 0 时结果为空（不崩、也不静默超限）', () => {
    expect(boundLogLines(['a'], 'b', 0)).toEqual([])
  })

  it('不修改传入的数组（纯函数）', () => {
    const existing = ['a', 'b']
    boundLogLines(existing, 'c', 1)
    expect(existing).toEqual(['a', 'b'])
  })
})

/**
 * 文件 IO 的行为契约。
 *
 * 两条要求各有真实后果：**上限**决定它能否长期留在用户磁盘上；**失败静默**
 * 决定它会不会把更新功能甚至应用启动一起拖下水。
 */
describe('createUpdateLog', () => {
  it('写入后能在磁盘上读到，且带时间戳', async () => {
    const dir = await tempDir()
    const log = createUpdateLog({ dir })
    log.record('检查更新')
    await log.flush()

    const text = await readFile(join(dir, UPDATE_LOG_FILE), 'utf8')
    expect(text).toContain('检查更新')
    // ISO 时间戳前缀，便于按时间排查。
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z /m)
  })

  it('多次记录按顺序累积', async () => {
    const dir = await tempDir()
    const log = createUpdateLog({ dir })
    log.record('第一条')
    log.record('第二条')
    await log.flush()

    const lines = (await readFile(join(dir, UPDATE_LOG_FILE), 'utf8')).split('\n').filter(Boolean)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('第一条')
    expect(lines[1]).toContain('第二条')
  })

  it('跨「重启」保留历史：新实例读取已有文件后继续追加', async () => {
    const dir = await tempDir()
    const first = createUpdateLog({ dir })
    first.record('上一次运行')
    await first.flush()

    const second = createUpdateLog({ dir })
    second.record('这一次运行')
    await second.flush()

    const text = await readFile(join(dir, UPDATE_LOG_FILE), 'utf8')
    expect(text).toContain('上一次运行')
    expect(text).toContain('这一次运行')
  })

  it('超过行数上限时丢弃最旧的，文件不会无限增长', async () => {
    const dir = await tempDir()
    // 上限来自实现，这里用足够多的记录触发裁剪。
    const { UPDATE_LOG_MAX_LINES } = await import('../src/main/update-log.js')
    const log = createUpdateLog({ dir })
    for (let i = 0; i < UPDATE_LOG_MAX_LINES + 20; i++) log.record(`第 ${i} 条`)
    await log.flush()

    const lines = (await readFile(join(dir, UPDATE_LOG_FILE), 'utf8')).split('\n').filter(Boolean)
    expect(lines).toHaveLength(UPDATE_LOG_MAX_LINES)
    // 最旧的已被丢弃，最新的还在。
    expect(lines.join('\n')).not.toContain('第 0 条')
    expect(lines.join('\n')).toContain(`第 ${UPDATE_LOG_MAX_LINES + 19} 条`)
  })

  it('目录不存在时自行创建', async () => {
    const parent = await tempDir()
    const dir = join(parent, 'nested', 'deeper')
    const log = createUpdateLog({ dir })
    log.record('目录是自动建的')
    await log.flush()

    expect(await readFile(join(dir, UPDATE_LOG_FILE), 'utf8')).toContain('目录是自动建的')
  })

  it('写不进去时静默失败——绝不抛给调用方', async () => {
    // 构造一个必然失败的场景：把 file 占成普通文件，于是 mkdir(file, ...) 必然 EEXIST。
    const parent = await tempDir()
    const dir = join(parent, 'not-a-dir')
    await writeFile(dir, 'x', 'utf8')

    const log = createUpdateLog({ dir })
    expect(() => { log.record('这条写不进去') }).not.toThrow()
    // flush 也不该抛——否则「退出前确保落盘」会变成新的崩溃点。
    await expect(log.flush()).resolves.toBeUndefined()
  })

  it('已有内容是坏编码/空文件时不影响后续写入', async () => {
    const dir = await tempDir()
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, UPDATE_LOG_FILE), '', 'utf8')

    const log = createUpdateLog({ dir })
    log.record('空文件之后照样写')
    await log.flush()

    expect(await readFile(join(dir, UPDATE_LOG_FILE), 'utf8')).toContain('空文件之后照样写')
  })

  it('并发记录不互相覆盖（写入是串行的）', async () => {
    const dir = await tempDir()
    const log = createUpdateLog({ dir })
    for (let i = 0; i < 30; i++) log.record(`并发 ${i}`)
    await log.flush()

    const lines = (await readFile(join(dir, UPDATE_LOG_FILE), 'utf8')).split('\n').filter(Boolean)
    expect(lines).toHaveLength(30)
  })
})
