import { describe, expect, it } from 'vitest'
import {
  HOST_MENU_LABELS,
  hostMenuItemKinds,
  hostMenuLabel,
} from '../src/main/host-menu-state.js'
import type { HostEntry } from '../src/shared/types.js'

/**
 * 注意：本文件**只** import `host-menu-state.ts`（无 electron 依赖）。
 * `host-menu.ts` import 了 electron，在 vitest 的 node 环境下会导致
 * `require('electron')` 尝试下载二进制而挂起——因此纯逻辑必须留在
 * 这个无依赖模块里，才能真正被守护。
 */

const host = (over: Partial<HostEntry> = {}): HostEntry => ({
  id: 'host-a',
  origin: 'http://localhost:3080',
  label: '家里 NAS',
  addedAt: 0,
  lastUsedAt: 0,
  ...over,
})

describe('hostMenuLabel', () => {
  it('当前主机带 ● 标记', () => {
    expect(hostMenuLabel(host(), 'host-a', false)).toBe('● 家里 NAS')
  })

  it('非当前主机用全角空格占位对齐', () => {
    expect(hostMenuLabel(host(), 'host-b', false)).toBe('　家里 NAS')
  })

  it('无当前主机时不加标记', () => {
    expect(hostMenuLabel(host(), undefined, false)).toBe('　家里 NAS')
  })

  it('当前主机且离线时追加「（离线）」', () => {
    expect(hostMenuLabel(host(), 'host-a', true)).toBe('● 家里 NAS（离线）')
  })

  it('离线标记只加在当前主机上（避免误导）', () => {
    expect(hostMenuLabel(host(), 'host-b', true)).toBe('　家里 NAS')
  })
})

describe('hostMenuItemKinds', () => {
  it('非当前主机：打开 / 重置登录态 / 删除', () => {
    expect(hostMenuItemKinds(false, false)).toEqual(['open', 'resetLogin', 'remove'])
  })

  it('当前主机（在线）：加「重新加载」，但不加「立即重试」', () => {
    expect(hostMenuItemKinds(true, false)).toEqual(['open', 'reload', 'resetLogin', 'remove'])
  })

  it('当前主机（离线）：同时有「重新加载」与「立即重试」', () => {
    expect(hostMenuItemKinds(true, true)).toEqual([
      'open', 'reload', 'retryNow', 'resetLogin', 'remove',
    ])
  })

  it('非当前主机即便 offline=true 也不出现重载/重试（避免对未打开窗口操作）', () => {
    expect(hostMenuItemKinds(false, true)).toEqual(['open', 'resetLogin', 'remove'])
  })

  it('重置登录态与删除在任何组合下都必然存在（本次补齐的核心契约）', () => {
    for (const isCurrent of [true, false]) {
      for (const offline of [true, false]) {
        const kinds = hostMenuItemKinds(isCurrent, offline)
        expect(kinds).toContain('resetLogin')
        expect(kinds).toContain('remove')
      }
    }
  })

  it('顺序稳定：打开在最前，删除在最后', () => {
    for (const isCurrent of [true, false]) {
      for (const offline of [true, false]) {
        const kinds = hostMenuItemKinds(isCurrent, offline)
        expect(kinds[0]).toBe('open')
        expect(kinds[kinds.length - 1]).toBe('remove')
      }
    }
  })
})

describe('HOST_MENU_LABELS', () => {
  it('每个动作都有文案，且无多余键', () => {
    expect(Object.keys(HOST_MENU_LABELS).sort()).toEqual(
      ['open', 'reload', 'remove', 'resetLogin', 'retryNow'].sort(),
    )
  })

  it('删除项带省略号，表明会弹确认框', () => {
    expect(HOST_MENU_LABELS.remove).toBe('删除…')
  })
})
