import { readdirSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { addHost, hostsFilePath, loadHosts, loadHostsSync, saveHosts } from '../src/main/hosts.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-hosts-'))
})

/**
 * 断言备份已存在——**用同步读取，且不做任何 await**。
 *
 * 这是有意的严格性：`loadHosts()` 一旦返回，备份就必须已经落盘。
 * 早先异步入口用 `void rename(...)` fire-and-forget，Linux 上碰巧通过，
 * Windows 上备份尚未写完就被读到，CI 因此失败。同步读取能让这类
 * 竞态在任何平台都立刻暴露。
 *
 * @param target - 要检查的目录。
 * @returns 是否存在备份文件。
 */
function hasCorruptBackup(target: string): boolean {
  return readdirSync(target).some(name => name.startsWith('hosts.json.corrupt-'))
}

describe('loadHosts', () => {
  it('文件不存在时返回空配置', async () => {
    const data = await loadHosts(dir)
    expect(data).toEqual({ version: 1, hosts: [] })
  })

  it('目录不存在时也返回空配置', async () => {
    const data = await loadHosts(join(dir, 'nope', 'deep'))
    expect(data.hosts).toHaveLength(0)
  })

  it('读取已保存的内容', async () => {
    await saveHosts(dir, addHost({ version: 1, hosts: [] }, 'http://nas:3080'))
    const data = await loadHosts(dir)
    expect(data.hosts[0]?.origin).toBe('http://nas:3080')
  })

  it('损坏的 JSON 被备份且返回空配置', async () => {
    await writeFile(hostsFilePath(dir), '{ not json', 'utf8')
    const data = await loadHosts(dir)
    expect(data.hosts).toHaveLength(0)
    expect(hasCorruptBackup(dir)).toBe(true)
  })

  it('结构非法的 JSON 同样进入备份分支', async () => {
    await writeFile(hostsFilePath(dir), '{"version":1,"hosts":"oops"}', 'utf8')
    const data = await loadHosts(dir)
    expect(data.hosts).toHaveLength(0)
    expect(hasCorruptBackup(dir)).toBe(true)
  })
})

describe('saveHosts', () => {
  it('自动创建缺失的目录', async () => {
    const nested = join(dir, 'a', 'b')
    await saveHosts(nested, addHost({ version: 1, hosts: [] }, 'http://nas:3080'))
    const raw = await readFile(hostsFilePath(nested), 'utf8')
    expect(JSON.parse(raw).hosts).toHaveLength(1)
  })

  it('写入的 JSON 以换行结尾且可回环读取', async () => {
    const data = addHost({ version: 1, hosts: [] }, 'http://nas:3080', '家里 NAS')
    await saveHosts(dir, data)
    const raw = await readFile(hostsFilePath(dir), 'utf8')
    expect(raw.endsWith('\n')).toBe(true)
    expect(await loadHosts(dir)).toEqual(data)
  })
})

describe('loadHostsSync', () => {
  it('与异步版本语义一致', async () => {
    await saveHosts(dir, addHost({ version: 1, hosts: [] }, 'http://nas:3080'))
    expect(loadHostsSync(dir)).toEqual(await loadHosts(dir))
  })

  it('文件缺失时返回空配置', () => {
    expect(loadHostsSync(join(dir, 'nope')).hosts).toHaveLength(0)
  })

  it('损坏内容同样备份并返回空配置', async () => {
    await writeFile(hostsFilePath(dir), 'nope', 'utf8')
    expect(loadHostsSync(dir).hosts).toHaveLength(0)
    expect(hasCorruptBackup(dir)).toBe(true)
  })
})
