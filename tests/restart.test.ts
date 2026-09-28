import { describe, expect, it } from 'vitest'
import { needsRestartFor } from '../src/main/restart.js'

describe('needsRestartFor', () => {
  it('新增 http 主机（启动时列表为空）→ true', () => {
    // 首次运行的最常见路径：无 hosts.json，用户添加第一台 http 主机。
    expect(needsRestartFor('http://192.168.1.5:3080', [])).toBe(true)
  })

  it('新增 http 主机（启动时列表有其他 origin）→ true', () => {
    expect(needsRestartFor('http://192.168.1.5:3080', ['http://nas:3080'])).toBe(true)
  })

  it('新增 https 主机 → false（不受该开关限制）', () => {
    expect(needsRestartFor('https://dsh.example.com', [])).toBe(false)
    expect(needsRestartFor('https://dsh.example.com', ['http://nas:3080'])).toBe(false)
  })

  it('启动时已生效的 http 主机 → false（无需重启）', () => {
    expect(needsRestartFor('http://nas:3080', ['http://nas:3080'])).toBe(false)
  })

  it('启动时已生效列表中的 https origin 同样不触发 → false', () => {
    expect(needsRestartFor('https://a.example', ['https://a.example', 'http://b:1'])).toBe(false)
  })

  it('同一 origin 重复添加仍稳定返回 false', () => {
    const effective = ['http://nas:3080']
    expect(needsRestartFor('http://nas:3080', effective)).toBe(false)
    expect(needsRestartFor('http://nas:3080', effective)).toBe(false)
  })

  it('大小写/端口差异视为不同 origin（需重启）', () => {
    // 规范化后主机名必为小写、默认端口必被剥离，因此这类差异只可能来自
    // 未规范化的输入；此处确认判定用的是精确匹配而非宽松匹配。
    expect(needsRestartFor('http://NAS:3080', ['http://nas:3080'])).toBe(true)
    expect(needsRestartFor('http://nas:3081', ['http://nas:3080'])).toBe(true)
  })

  it('列表含空串不影响判定', () => {
    expect(needsRestartFor('http://nas:3080', [''])).toBe(true)
  })
})
