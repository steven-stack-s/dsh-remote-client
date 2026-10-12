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

describe('shouldCloseWindowAfterRemove（task-19：多窗口版）', () => {
  it('被删主机有打开的窗口 → 应关闭它', () => {
    expect(shouldCloseWindowAfterRemove('host-a', ['host-a', 'host-b'])).toBe(true)
  })

  it('被删主机没有窗口 → 不关任何窗口（别误伤正在用的那台）', () => {
    // 多窗口下这是新增的关键情形：用户可能删掉一台**没开着**的主机，
    // 此时若按「关掉当前窗口」处理，会把用户正在看的那台关掉。
    expect(shouldCloseWindowAfterRemove('host-a', ['host-b', 'host-c'])).toBe(false)
  })

  it('没有任何窗口 → false', () => {
    expect(shouldCloseWindowAfterRemove('host-a', [])).toBe(false)
  })

  it('只删有窗口的那台时，其它主机的窗口不受影响（判定与该集合里其它 id 无关）', () => {
    expect(shouldCloseWindowAfterRemove('host-b', ['host-a', 'host-b'])).toBe(true)
    expect(shouldCloseWindowAfterRemove('host-c', ['host-a', 'host-b'])).toBe(false)
  })

  it('只有 id 完全相等才算命中（不做前缀/包含匹配）', () => {
    expect(shouldCloseWindowAfterRemove('host-a', ['host-ab'])).toBe(false)
    expect(shouldCloseWindowAfterRemove('host-ab', ['host-a'])).toBe(false)
  })

  it('空串永远不会命中（防御未初始化状态）', () => {
    expect(shouldCloseWindowAfterRemove('', [''])).toBe(true)  // 集合里真有空串才命中
    expect(shouldCloseWindowAfterRemove('', ['host-a'])).toBe(false)
  })
})
