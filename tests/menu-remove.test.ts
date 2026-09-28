import { describe, expect, it } from 'vitest'
import { canRemoveHost, canResetLoginState, shouldCloseWindowAfterRemove } from '../src/main/menu-state.js'

describe('canResetLoginState', () => {
  it('主机存在 → 可用', () => {
    expect(canResetLoginState(true)).toBe(true)
  })

  it('主机已不存在（例如刚被删除）→ 不可用', () => {
    expect(canResetLoginState(false)).toBe(false)
  })
})

describe('canRemoveHost', () => {
  it('主机存在 → 可用', () => {
    expect(canRemoveHost(true)).toBe(true)
  })

  it('主机已不存在 → 不可用', () => {
    expect(canRemoveHost(false)).toBe(false)
  })

  it('删除最后一台主机是允许的（不该被「好心」禁用而把用户困住）', () => {
    // 删光后仍可从「文件 → 添加主机…」或托盘的「添加主机…」恢复，
    // 因此不存在「必须留一台」的约束。此处固化该决定。
    expect(canRemoveHost(true)).toBe(true)
  })
})

describe('shouldCloseWindowAfterRemove', () => {
  it('删除的正是当前主机 → 应关闭窗口', () => {
    expect(shouldCloseWindowAfterRemove('host-a', 'host-a')).toBe(true)
  })

  it('删除的是其他主机 → 当前窗口不受影响', () => {
    expect(shouldCloseWindowAfterRemove('host-b', 'host-a')).toBe(false)
  })

  it('当前没有打开任何主机 → 无需关闭', () => {
    expect(shouldCloseWindowAfterRemove('host-a', undefined)).toBe(false)
  })

  it('当前主机为 undefined 时永不为 true（避免误关无关窗口）', () => {
    expect(shouldCloseWindowAfterRemove('', undefined)).toBe(false)
    expect(shouldCloseWindowAfterRemove('anything', undefined)).toBe(false)
  })

  it('只有 id 完全相等才关闭（不做前缀/包含匹配）', () => {
    expect(shouldCloseWindowAfterRemove('host-a', 'host-ab')).toBe(false)
    expect(shouldCloseWindowAfterRemove('host-ab', 'host-a')).toBe(false)
  })
})
