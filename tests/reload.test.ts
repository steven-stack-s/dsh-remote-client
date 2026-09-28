import { describe, expect, it } from 'vitest'
import { reloadTargetFor } from '../src/main/reload.js'

const HOST = 'https://app-3080-shitaixi.cn72.ugdocker.link'

describe('reloadTargetFor', () => {
  it('当前 URL 已被重定向到第三方 SSO 门户 → 仍返回 host.origin', () => {
    // 真实故障场景：UGOS 门户 302 到登录页，登录后停在桌面上。
    const portal = 'http://shitaixi.cn72.ug.link/desktop/#/login/account'
    expect(reloadTargetFor(HOST, portal)).toBe(HOST)
  })

  it('当前 URL 是门户桌面（登录后的停留点）→ 仍返回 host.origin', () => {
    const desktop = 'http://shitaixi.cn72.ug.link/desktop/#/'
    expect(reloadTargetFor(HOST, desktop)).toBe(HOST)
  })

  it('当前 URL 恰好就是 host.origin → 幂等返回 host.origin', () => {
    expect(reloadTargetFor(HOST, HOST)).toBe(HOST)
  })

  it('当前 URL 是 host.origin 的子路径 → 仍返回 origin（剥离路径，回到入口）', () => {
    expect(reloadTargetFor(HOST, `${HOST}/some/deep/path`)).toBe(HOST)
  })

  it('当前 URL 未知（尚未加载）→ 返回 host.origin', () => {
    expect(reloadTargetFor(HOST, undefined)).toBe(HOST)
  })

  it('当前 URL 为空串 → 返回 host.origin', () => {
    expect(reloadTargetFor(HOST, '')).toBe(HOST)
  })

  it('当前 URL 是 about:blank（窗口刚创建）→ 返回 host.origin', () => {
    expect(reloadTargetFor(HOST, 'about:blank')).toBe(HOST)
  })

  it('当前 URL 是壳自有的离线页 → 仍返回 host.origin', () => {
    const offline = 'file:///C:/app/out/renderer/offline.html?detail=ERR_CONNECTION_REFUSED'
    expect(reloadTargetFor(HOST, offline)).toBe(HOST)
  })

  it('当前 URL 属于另一个已配置主机 → 仍返回本主机的 origin（不串台）', () => {
    // 防止「重新加载」在切换主机的竞态中被误导向旧主机的 URL。
    expect(reloadTargetFor(HOST, 'http://nas:3080')).toBe(HOST)
  })

  it('http 主机同样适用（明文地址 + 门户登录场景）', () => {
    const httpHost = 'http://192.168.1.5:3080'
    expect(reloadTargetFor(httpHost, 'http://portal.example/login')).toBe(httpHost)
  })

  it('结果恒等于入参 hostOrigin，与 currentUrl 完全无关', () => {
    const urls = ['', 'about:blank', HOST, 'https://evil.example/x', 'file:///tmp/offline.html']
    for (const url of urls) {
      expect(reloadTargetFor(HOST, url)).toBe(HOST)
    }
  })
})
