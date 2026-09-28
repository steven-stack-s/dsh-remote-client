import { describe, expect, it } from 'vitest'
import { applyHostEdit } from '../src/shared/host-edit.js'
import type { HostEntry } from '../src/shared/types.js'

describe('applyHostEdit', () => {
  const deriveId = (origin: string): string => `id:${origin}`
  const base: HostEntry = {
    id: 'id:http://localhost:3080',
    origin: 'http://localhost:3080',
    label: '家里 NAS',
    addedAt: 111,
    lastUsedAt: 222,
  }

  it('显示名非空则更新', () => {
    const { host } = applyHostEdit(base, { label: '新名字', origin: base.origin, launchToken: '' }, deriveId)
    expect(host.label).toBe('新名字')
  })

  it('显示名空白视为保持原值（不静默清空）', () => {
    const { host } = applyHostEdit(base, { label: '   ', origin: base.origin, launchToken: '' }, deriveId)
    expect(host.label).toBe('家里 NAS')
  })

  it('地址不变时 id 与 origin 保持原样', () => {
    const { host, originChanged } = applyHostEdit(
      base,
      { label: 'x', origin: 'http://localhost:3080', launchToken: '' },
      deriveId,
    )
    expect(originChanged).toBe(false)
    expect(host.id).toBe(base.id)
    expect(host.origin).toBe(base.origin)
  })

  it('地址变化时重算 id 并标记 originChanged', () => {
    const { host, originChanged } = applyHostEdit(
      base,
      { label: 'x', origin: 'http://other:3080', launchToken: '' },
      deriveId,
    )
    expect(originChanged).toBe(true)
    expect(host.origin).toBe('http://other:3080')
    expect(host.id).toBe('id:http://other:3080')
    expect(host.id).not.toBe(base.id)
  })

  it('地址等价写法（末尾斜杠/大写/默认端口）不算变化', () => {
    const { originChanged } = applyHostEdit(
      base,
      { label: 'x', origin: 'HTTP://LocalHost:3080/', launchToken: '' },
      deriveId,
    )
    expect(originChanged).toBe(false)
  })

  it('token 空白 → 清除已存 token（用户可能来清掉失效令牌）', () => {
    const withToken: HostEntry = { ...base, launchToken: 'old' }
    const { host } = applyHostEdit(withToken, { label: 'x', origin: withToken.origin, launchToken: '' }, deriveId)
    expect(host.launchToken).toBeUndefined()
    expect('launchToken' in host).toBe(false)
  })

  it('token 非空 → 更新', () => {
    const { host } = applyHostEdit(base, { label: 'x', origin: base.origin, launchToken: 'new-token' }, deriveId)
    expect(host.launchToken).toBe('new-token')
  })

  it('token 带空白被 trim', () => {
    const { host } = applyHostEdit(base, { label: 'x', origin: base.origin, launchToken: '  t  ' }, deriveId)
    expect(host.launchToken).toBe('t')
  })

  it('地址中带 token 时以地址中的为准（粘贴完整 URL 的场景）', () => {
    const { host } = applyHostEdit(
      base,
      { label: 'x', origin: 'http://localhost:3080/?token=from-url', launchToken: 'from-field' },
      deriveId,
    )
    expect(host.launchToken).toBe('from-url')
    // origin 仍需保持纯净，不能把 token 拼进去。
    expect(host.origin).toBe('http://localhost:3080')
  })

  it('保留 addedAt，更新 lastUsedAt', () => {
    const { host } = applyHostEdit(base, { label: 'x', origin: base.origin, launchToken: '' }, deriveId)
    expect(host.addedAt).toBe(111)
    expect(host.lastUsedAt).toBeGreaterThanOrEqual(base.lastUsedAt)
  })

  it('不修改入参', () => {
    const original = { ...base }
    applyHostEdit(base, { label: 'new', origin: 'http://other:1', launchToken: 't' }, deriveId)
    expect(base).toEqual(original)
  })

  it('非法地址抛错', () => {
    expect(() => applyHostEdit(base, { label: 'x', origin: 'ftp://x', launchToken: '' }, deriveId))
      .toThrow(/只支持 http\/https/u)
  })
})
