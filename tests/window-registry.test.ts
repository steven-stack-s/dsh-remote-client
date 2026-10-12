import { describe, expect, it } from 'vitest'
import {
  focusTargetFor,
  isKnownHostWebContents,
} from '../src/main/window-registry.js'

/**
 * 多主机窗口注册表的**纯逻辑**测试。
 *
 * 本文件不 import electron（也做不到：vitest 跑在 node 环境），因此被测的都是
 * 「该唤起哪一台 / 这个 sender 认不认」这类判定。真正的 Map 持有落在
 * `index.ts`（`HostWindowRegistry` 的实例化），这里只测判定本身。
 */

describe('isKnownHostWebContents（Review Focus #1：多窗口下不得张冠李戴）', () => {
  const entries = [
    { hostId: 'a', webContentsId: 11 },
    { hostId: 'b', webContentsId: 22 },
  ]

  it('任一已登记主机窗口的 sender 都合法（B 窗口的审批通知不得被丢弃）', () => {
    // 这是本次重构最危险的一条：旧实现只认**单个** hostWebContentsId()，
    // 多窗口下 B 窗口的上报会被静默丢弃——用户完全收不到审批提醒，
    // 而 agent 正卡在那里等他。
    expect(isKnownHostWebContents(entries, 11)).toBe(true)
    expect(isKnownHostWebContents(entries, 22)).toBe(true)
  })

  it('未登记的 sender 一律拒绝（欢迎页/编辑页/设置页/已销毁的旧窗口）', () => {
    expect(isKnownHostWebContents(entries, 33)).toBe(false)
    expect(isKnownHostWebContents([], 11)).toBe(false)
  })

  it('空集合下任何 sender 都不合法（没有主机窗口时不该有上报）', () => {
    expect(isKnownHostWebContents([], 0)).toBe(false)
  })
})

describe('focusTargetFor（Review Focus #2：唤起哪一台）', () => {
  it('有已打开的主机窗口且记得上次焦点 → 唤起那一台', () => {
    expect(focusTargetFor({ openHostIds: ['a', 'b'], lastFocusedId: 'b', fallbackWindowExists: true }))
      .toEqual({ kind: 'host', hostId: 'b' })
  })

  it('记得的那台已关闭 → 退到任意一台，而不是报错或什么都不做', () => {
    expect(focusTargetFor({ openHostIds: ['a'], lastFocusedId: 'b', fallbackWindowExists: true }))
      .toEqual({ kind: 'host', hostId: 'a' })
  })

  it('有窗口但没有任何主机窗口 → 唤起任意窗口（欢迎页/编辑页也算）', () => {
    expect(focusTargetFor({ openHostIds: [], lastFocusedId: undefined, fallbackWindowExists: true }))
      .toEqual({ kind: 'any' })
  })

  it('没有任何窗口但有上次的主机 → 重开它', () => {
    expect(focusTargetFor({ openHostIds: [], lastFocusedId: 'a', fallbackWindowExists: false }))
      .toEqual({ kind: 'reopen', hostId: 'a' })
  })

  it('一个窗口都没有、也没有主机 → 欢迎页（绝不能「点了没反应」）', () => {
    expect(focusTargetFor({ openHostIds: [], lastFocusedId: undefined, fallbackWindowExists: false }))
      .toEqual({ kind: 'welcome' })
  })
})
