import { describe, expect, it } from 'vitest'
import {
  addHost,
  defaultLabelFor,
  emptyHosts,
  removeHost,
  renameHost,
  resolveStartupHost,
  touchHost,
} from '../src/main/hosts.js'
import { hostIdFromOrigin } from '../src/main/partitions.js'

describe('addHost', () => {
  it('添加并规范化 origin', () => {
    const next = addHost(emptyHosts(), 'http://NAS:3080/')
    expect(next.hosts).toHaveLength(1)
    expect(next.hosts[0]?.origin).toBe('http://nas:3080')
    expect(next.hosts[0]?.id).toBe(hostIdFromOrigin('http://nas:3080'))
  })

  it('默认使用 origin 作为 label', () => {
    const next = addHost(emptyHosts(), 'http://nas:3080')
    expect(next.hosts[0]?.label).toBe('nas:3080')
  })

  it('接受自定义 label', () => {
    const next = addHost(emptyHosts(), 'http://nas:3080', '家里 NAS')
    expect(next.hosts[0]?.label).toBe('家里 NAS')
  })

  it('重复添加同一 origin 不产生第二条记录', () => {
    const once = addHost(emptyHosts(), 'http://nas:3080')
    const twice = addHost(once, 'http://nas:3080/')
    expect(twice.hosts).toHaveLength(1)
  })

  it('重复添加时更新 label 与 lastUsedAt', () => {
    const once = addHost(emptyHosts(), 'http://nas:3080', '旧名')
    const twice = addHost(once, 'http://nas:3080', '新名')
    expect(twice.hosts[0]?.label).toBe('新名')
    expect(twice.hosts[0]?.lastUsedAt).toBeGreaterThanOrEqual(once.hosts[0]?.lastUsedAt ?? 0)
  })

  it('不修改入参', () => {
    const base = emptyHosts()
    addHost(base, 'http://nas:3080')
    expect(base.hosts).toHaveLength(0)
  })

  it('拒绝非法 origin', () => {
    expect(() => addHost(emptyHosts(), 'ftp://x')).toThrow(/只支持 http\/https/u)
  })
})

describe('removeHost / renameHost / touchHost', () => {
  it('删除后 lastHostId 不再指向已删除主机', () => {
    const one = addHost(emptyHosts(), 'http://nas:3080')
    const id = one.hosts[0]!.id
    const two = removeHost(one, id)
    expect(two.hosts).toHaveLength(0)
    expect(two.lastHostId).toBeUndefined()
  })

  it('重命名保留 id 与 origin', () => {
    const one = addHost(emptyHosts(), 'http://nas:3080')
    const id = one.hosts[0]!.id
    const two = renameHost(one, id, '新名')
    expect(two.hosts[0]?.label).toBe('新名')
    expect(two.hosts[0]?.origin).toBe('http://nas:3080')
  })

  it('touchHost 更新 lastUsedAt 并设置 lastHostId', () => {
    const one = addHost(emptyHosts(), 'http://nas:3080')
    const id = one.hosts[0]!.id
    const two = touchHost(one, id)
    expect(two.lastHostId).toBe(id)
  })

  it('对未知 id 的操作是空操作', () => {
    const one = addHost(emptyHosts(), 'http://nas:3080')
    expect(removeHost(one, 'deadbeefdeadbeef').hosts).toHaveLength(1)
    expect(renameHost(one, 'deadbeefdeadbeef', 'x').hosts[0]?.label).toBe('nas:3080')
  })
})

describe('resolveStartupHost', () => {
  it('无主机时返回 undefined', () => {
    expect(resolveStartupHost(emptyHosts())).toBeUndefined()
  })

  it('优先返回 lastHostId 指向的主机', () => {
    const one = addHost(addHost(emptyHosts(), 'http://a:1'), 'http://b:2')
    const bId = one.hosts.find(h => h.origin === 'http://b:2')!.id
    const two = touchHost(one, bId)
    expect(resolveStartupHost(two)?.origin).toBe('http://b:2')
  })

  it('lastHostId 失效时回退到最近使用的主机', () => {
    const one = addHost(addHost(emptyHosts(), 'http://a:1'), 'http://b:2')
    const broken = { ...one, lastHostId: 'deadbeefdeadbeef' }
    expect(resolveStartupHost(broken)).toBeDefined()
  })
})

describe('defaultLabelFor', () => {
  it('去掉协议前缀', () => {
    expect(defaultLabelFor('http://nas:3080')).toBe('nas:3080')
    expect(defaultLabelFor('https://example.com')).toBe('example.com')
  })
})
