import { describe, expect, it } from 'vitest'
import { addHost, emptyHosts } from '../src/main/hosts.js'
import { parseHostInput, tokenHandshakeUrl } from '../src/shared/host-input.js'
import { reloadTargetFor } from '../src/main/reload.js'

describe('addHost 的 launchToken 贯通', () => {
  it('新增主机时持久化 token', () => {
    const parsed = parseHostInput('http://localhost:3080/?token=abc')
    const next = addHost(emptyHosts(), parsed.origin, undefined, parsed.launchToken)
    expect(next.hosts[0]?.launchToken).toBe('abc')
  })

  it('无 token 时不写入该字段（保持旧 hosts.json 结构简洁）', () => {
    const next = addHost(emptyHosts(), 'http://localhost:3080')
    expect(next.hosts[0]?.launchToken).toBeUndefined()
    expect('launchToken' in (next.hosts[0] ?? {})).toBe(false)
  })

  it('已存在的主机再次添加时更新 token（dsh 重启后 token 会变）', () => {
    const first = addHost(emptyHosts(), 'http://localhost:3080', undefined, 'old-token')
    const second = addHost(first, 'http://localhost:3080', undefined, 'new-token')
    expect(second.hosts).toHaveLength(1)
    expect(second.hosts[0]?.launchToken).toBe('new-token')
  })

  it('不传 token 时保留旧 token（避免重命名/切换时误清空）', () => {
    const first = addHost(emptyHosts(), 'http://localhost:3080', undefined, 'keep-me')
    const second = addHost(first, 'http://localhost:3080')
    expect(second.hosts[0]?.launchToken).toBe('keep-me')
  })

  it('origin 保持纯净：不含 token 与 query', () => {
    const parsed = parseHostInput('http://localhost:3080/?token=secret')
    const next = addHost(emptyHosts(), parsed.origin, undefined, parsed.launchToken)
    expect(next.hosts[0]?.origin).toBe('http://localhost:3080')
    expect(next.hosts[0]?.origin).not.toContain('secret')
  })

  it('id 仍只由 origin 决定（token 变化不影响 partition 与登录态）', () => {
    const a = addHost(emptyHosts(), 'http://localhost:3080', undefined, 'token-a')
    const b = addHost(a, 'http://localhost:3080', undefined, 'token-b')
    expect(b.hosts[0]?.id).toBe(a.hosts[0]?.id)
  })

  it('不修改入参', () => {
    const base = emptyHosts()
    addHost(base, 'http://localhost:3080', undefined, 't')
    expect(base.hosts).toHaveLength(0)
  })
})

describe('tokenHandshakeUrl', () => {
  it('构造指向根路径的带 token URL', () => {
    expect(tokenHandshakeUrl('http://localhost:3080', 'abc')).toBe(
      'http://localhost:3080/?token=abc',
    )
  })

  it('特殊字符被 encodeURIComponent 编码，不破坏 URL 结构', () => {
    const url = tokenHandshakeUrl('http://localhost:3080', 'a+b/c=d&e')
    expect(url).toBe('http://localhost:3080/?token=a%2Bb%2Fc%3Dd%26e')
    // 编码后必须仍是合法的单参数 URL，可被还原。
    const params = new URL(url).searchParams
    expect(params.get('token')).toBe('a+b/c=d&e')
    expect([...params.keys()]).toEqual(['token'])
  })

  it('往返：parseHostInput 能还原握手 URL 里的 token', () => {
    const token = 'x/y+z=1&2'
    const url = tokenHandshakeUrl('http://localhost:3080', token)
    expect(parseHostInput(url)).toEqual({
      origin: 'http://localhost:3080',
      launchToken: token,
    })
  })
})

describe('token 加载路径与 reloadTargetFor 互不干扰', () => {
  const origin = 'http://localhost:3080'
  const token = 'abc'

  it('首次加载用带 token 的 URL', () => {
    expect(tokenHandshakeUrl(origin, token)).toContain('token=abc')
  })

  it('reload 目标始终是干净 origin，不含 token', () => {
    // reload 时 cookie 已在 partition 中，重放 token 无必要且可能因过期而失败。
    const redirected = 'http://portal.example/desktop/#/'
    expect(reloadTargetFor(origin, redirected)).toBe(origin)
    expect(reloadTargetFor(origin, redirected)).not.toContain('token')
    expect(reloadTargetFor(origin, undefined)).toBe(origin)
  })

  it('两个函数的语义不重叠：一个负责首次握手，一个负责后续重载', () => {
    expect(tokenHandshakeUrl(origin, token)).not.toBe(reloadTargetFor(origin, undefined))
  })
})
