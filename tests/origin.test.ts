import { describe, expect, it } from 'vitest'
import { insecureOriginsSwitchValue, normalizeOrigin } from '../src/shared/origin.js'

describe('normalizeOrigin', () => {
  it('保留显式端口', () => {
    expect(normalizeOrigin('http://nas:3080')).toBe('http://nas:3080')
  })

  it('剥离路径、查询与末尾斜杠', () => {
    expect(normalizeOrigin('http://nas:3080/')).toBe('http://nas:3080')
    expect(normalizeOrigin('http://nas:3080/a/b?x=1#f')).toBe('http://nas:3080')
  })

  it('主机名转小写', () => {
    expect(normalizeOrigin('http://NAS.Local:3080')).toBe('http://nas.local:3080')
  })

  it('剥离协议默认端口', () => {
    expect(normalizeOrigin('http://example.com:80')).toBe('http://example.com')
    expect(normalizeOrigin('https://example.com:443')).toBe('https://example.com')
  })

  it('缺省协议时补 http', () => {
    expect(normalizeOrigin('192.168.1.5:3080')).toBe('http://192.168.1.5:3080')
  })

  it('保留 IPv6 方括号', () => {
    expect(normalizeOrigin('http://[::1]:3080')).toBe('http://[::1]:3080')
  })

  it('拒绝空输入', () => {
    expect(() => normalizeOrigin('   ')).toThrow(/不能为空/u)
  })

  it('拒绝非 http/https 协议', () => {
    expect(() => normalizeOrigin('ftp://example.com')).toThrow(/只支持 http\/https/u)
  })

  it('拒绝内嵌凭据', () => {
    expect(() => normalizeOrigin('http://user:pass@example.com')).toThrow(/用户名或密码/u)
  })
})

describe('insecureOriginsSwitchValue', () => {
  it('只保留 http origin', () => {
    expect(insecureOriginsSwitchValue(['http://nas:3080', 'https://safe.example']))
      .toBe('http://nas:3080')
  })

  it('多个 http origin 用逗号连接', () => {
    expect(insecureOriginsSwitchValue(['http://a:1', 'https://b', 'http://c:2']))
      .toBe('http://a:1,http://c:2')
  })

  it('没有 http origin 时返回空串', () => {
    expect(insecureOriginsSwitchValue(['https://a', 'https://b'])).toBe('')
  })

  it('空列表返回空串', () => {
    expect(insecureOriginsSwitchValue([])).toBe('')
  })
})
