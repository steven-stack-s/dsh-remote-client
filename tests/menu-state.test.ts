import { describe, expect, it } from 'vitest'
import {
  canEditHost,
  canOpenHost,
  canReloadHost,
  emptyHostsPlaceholder,
} from '../src/main/menu-state.js'

describe('canReloadHost', () => {
  it('无当前主机 → false（菜单项应禁用）', () => {
    expect(canReloadHost(undefined)).toBe(false)
  })

  it('有当前主机 → true', () => {
    expect(canReloadHost('0123456789abcdef')).toBe(true)
  })

  it('空串视为无主机 → false（防御 id 来自未初始化状态）', () => {
    expect(canReloadHost('')).toBe(false)
  })
})

describe('canOpenHost', () => {
  it('任何已配置主机都可打开', () => {
    expect(canOpenHost()).toBe(true)
  })
})

describe('emptyHostsPlaceholder', () => {
  it('无主机时给出占位文案（避免菜单一片空白）', () => {
    expect(emptyHostsPlaceholder(0)).toBe('（尚未添加主机）')
  })

  it('有主机时不产生占位项', () => {
    expect(emptyHostsPlaceholder(1)).toBeUndefined()
    expect(emptyHostsPlaceholder(5)).toBeUndefined()
  })
})

describe('canEditHost', () => {
  it('无当前主机 → false（「编辑主机…」「删除主机…」应禁用）', () => {
    expect(canEditHost(undefined)).toBe(false)
  })

  it('有当前主机 → true', () => {
    expect(canEditHost('0123456789abcdef')).toBe(true)
  })

  it('空串视为无主机 → false', () => {
    expect(canEditHost('')).toBe(false)
  })

  it('与 canReloadHost 当前同条件（两者都作用于当前主机）', () => {
    for (const id of [undefined, '', 'abc']) {
      expect(canEditHost(id)).toBe(canReloadHost(id))
    }
  })
})
