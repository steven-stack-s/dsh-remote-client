import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  QUIET_MS_MAX,
  QUIET_MS_MIN,
  clampQuietMs,
  isClientSettings,
  normalizeSettings,
} from '../src/shared/settings.js'

describe('DEFAULT_SETTINGS', () => {
  it('默认值与当前硬编码行为一致（不得悄悄改变既有行为）', () => {
    // 通知默认开、静默期 15 秒——即 notifications.ts 的 QUIET_PERIOD_MS。
    expect(DEFAULT_SETTINGS.notifyEnabled).toBe(true)
    expect(DEFAULT_SETTINGS.notifyQuietMs).toBe(15000)
    expect(DEFAULT_SETTINGS.startupBehavior).toBe('lastHost')
    // 关窗驻留默认开——即 lifecycle.ts 在非 darwin 平台的既有行为。
    expect(DEFAULT_SETTINGS.hideOnClose).toBe(true)
    expect(DEFAULT_SETTINGS.updateCheckEnabled).toBe(true)
  })
})

describe('clampQuietMs（Review Focus #4：极端值）', () => {
  it('低于下限 → 钳到下限（0 会让通知立即触发、轰炸用户）', () => {
    expect(clampQuietMs(0)).toBe(QUIET_MS_MIN)
    expect(clampQuietMs(-5000)).toBe(QUIET_MS_MIN)
  })

  it('高于上限 → 钳到上限', () => {
    expect(clampQuietMs(10 ** 9)).toBe(QUIET_MS_MAX)
  })

  it('区间内原样返回', () => {
    expect(clampQuietMs(15000)).toBe(15000)
    expect(clampQuietMs(60000)).toBe(60000)
  })

  it('NaN / Infinity 这类非有限值 → 回退到默认（不是钳制）', () => {
    expect(clampQuietMs(Number.NaN)).toBe(DEFAULT_SETTINGS.notifyQuietMs)
    expect(clampQuietMs(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SETTINGS.notifyQuietMs)
  })
})

describe('normalizeSettings（逐字段回退，不整体丢弃）', () => {
  it('全部非法 → 全默认值', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS)
  })

  it('只坏一个字段时，其余字段保持用户设定（关键：不能一坏就全丢）', () => {
    const result = normalizeSettings({
      notifyEnabled: false,          // 合法，必须保住
      notifyQuietMs: 'abc',          // 非法 → 默认
      startupBehavior: 'welcome',    // 合法，必须保住
      hideOnClose: true,
      updateCheckEnabled: false,     // 合法，必须保住
    })
    expect(result.notifyEnabled).toBe(false)
    expect(result.notifyQuietMs).toBe(DEFAULT_SETTINGS.notifyQuietMs)
    expect(result.startupBehavior).toBe('welcome')
    expect(result.updateCheckEnabled).toBe(false)
  })

  it('缺字段 → 补默认（向前兼容旧设置文件）', () => {
    expect(normalizeSettings({ notifyEnabled: false })).toEqual({
      ...DEFAULT_SETTINGS,
      notifyEnabled: false,
    })
  })

  it('静默期合法数字走钳制', () => {
    expect(normalizeSettings({ notifyQuietMs: 100 }).notifyQuietMs).toBe(QUIET_MS_MIN)
  })

  it('下限是 15 秒（用户确认的区间 15s–5min）', () => {
    expect(QUIET_MS_MIN).toBe(15000)
    expect(QUIET_MS_MAX).toBe(300000)
    // 恰好在下限的值原样通过，不被钳制。
    expect(normalizeSettings({ notifyQuietMs: 15000 }).notifyQuietMs).toBe(15000)
    // 差 1 毫秒就被抬到下限。
    expect(normalizeSettings({ notifyQuietMs: 14999 }).notifyQuietMs).toBe(15000)
  })

  it('startupBehavior 只认两个字面量', () => {
    expect(normalizeSettings({ startupBehavior: 'bogus' }).startupBehavior).toBe('lastHost')
    expect(normalizeSettings({ startupBehavior: 'welcome' }).startupBehavior).toBe('welcome')
  })
})

describe('isClientSettings', () => {
  it('合法对象 → true', () => {
    expect(isClientSettings(DEFAULT_SETTINGS)).toBe(true)
  })

  it('缺字段 / 类型不符 → false', () => {
    expect(isClientSettings({})).toBe(false)
    expect(isClientSettings({ ...DEFAULT_SETTINGS, notifyEnabled: 'yes' })).toBe(false)
  })
})
