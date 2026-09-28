import { describe, expect, it } from 'vitest'
import { parseHostInput } from '../src/shared/host-input.js'

describe('parseHostInput', () => {
  it('取出 token 并保持 origin 纯净', () => {
    expect(parseHostInput('http://localhost:3080/?token=abc')).toEqual({
      origin: 'http://localhost:3080',
      launchToken: 'abc',
    })
  })

  it('无 token 时只返回 origin', () => {
    expect(parseHostInput('http://localhost:3080')).toEqual({ origin: 'http://localhost:3080' })
  })

  it('token 为空值时视为无 token', () => {
    expect(parseHostInput('http://localhost:3080/?token=')).toEqual({ origin: 'http://localhost:3080' })
  })

  it('token 仅空白时视为无 token', () => {
    expect(parseHostInput('http://localhost:3080/?token=%20%20')).toEqual({
      origin: 'http://localhost:3080',
    })
  })

  it('token 两侧空白被 trim', () => {
    expect(parseHostInput('http://localhost:3080/?token=%20%20abc%20%20')).toEqual({
      origin: 'http://localhost:3080',
      launchToken: 'abc',
    })
  })

  it('忽略其他 query 参数，只取 token', () => {
    expect(parseHostInput('http://localhost:3080/?foo=1&token=abc&bar=2')).toEqual({
      origin: 'http://localhost:3080',
      launchToken: 'abc',
    })
  })

  it('token 含百分号编码的特殊字符能正确解码', () => {
    expect(parseHostInput('http://localhost:3080/?token=a%2Bb%2Fc%3D')).toEqual({
      origin: 'http://localhost:3080',
      launchToken: 'a+b/c=',
    })
  })

  it('query 里的 + 按表单语义解码为空格（记录该行为，避免误判为 bug）', () => {
    // URL 标准：query 中的 + 等价于空格。因此若令牌本身含 +，
    // 用户需要写成 %2B。这里固化语义以便日后回归时不会误改。
    expect(parseHostInput('http://localhost:3080/?token=a+b')).toEqual({
      origin: 'http://localhost:3080',
      launchToken: 'a b',
    })
  })

  it('缺省协议时同样能解析 token', () => {
    expect(parseHostInput('localhost:3080/?token=xyz')).toEqual({
      origin: 'http://localhost:3080',
      launchToken: 'xyz',
    })
  })

  it('origin 规范化语义与 normalizeOrigin 一致（默认端口剥离）', () => {
    expect(parseHostInput('http://example.com:80/?token=t')).toEqual({
      origin: 'http://example.com',
      launchToken: 't',
    })
    expect(parseHostInput('https://example.com:443/?token=t')).toEqual({
      origin: 'https://example.com',
      launchToken: 't',
    })
  })

  it('主机名小写化', () => {
    expect(parseHostInput('http://NAS.Local:3080/?token=t')).toEqual({
      origin: 'http://nas.local:3080',
      launchToken: 't',
    })
  })

  it('路径与 fragment 被剥离，不影响 token', () => {
    expect(parseHostInput('https://x.example/some/path?token=t#frag')).toEqual({
      origin: 'https://x.example',
      launchToken: 't',
    })
  })

  it('token 中不含 query 分隔符时不会串入其他参数', () => {
    expect(parseHostInput('http://localhost:3080/?token=t&next=1')).toEqual({
      origin: 'http://localhost:3080',
      launchToken: 't',
    })
  })

  it('非法输入抛出与 normalizeOrigin 一致的错误', () => {
    expect(() => parseHostInput('   ')).toThrow(/不能为空/u)
    expect(() => parseHostInput('ftp://example.com/?token=t')).toThrow(/只支持 http\/https/u)
    expect(() => parseHostInput('http://user:pass@example.com/?token=t')).toThrow(/用户名或密码/u)
  })

  it('返回值中的 origin 永不包含 token 或 query', () => {
    const parsed = parseHostInput('http://localhost:3080/?token=secret')
    expect(parsed.origin).not.toContain('token')
    expect(parsed.origin).not.toContain('?')
    expect(parsed.origin).not.toContain('secret')
  })
})
