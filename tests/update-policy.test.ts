import { describe, expect, it } from 'vitest'
import {
  UPDATE_CHECK_DELAY_MS,
  UPDATE_CHECK_INTERVAL_MS,
  shouldPromptForUpdate,
} from '../src/main/update-policy.js'

describe('shouldPromptForUpdate', () => {
  it('从未提示过 → 提示', () => {
    expect(shouldPromptForUpdate({ availableVersion: '0.1.8', promptedVersion: undefined })).toBe(true)
  })

  it('同一版本已提示过 → 不再提示（用户点过「稍后」）', () => {
    expect(shouldPromptForUpdate({ availableVersion: '0.1.8', promptedVersion: '0.1.8' })).toBe(false)
  })

  it('换了一个新版本 → 重新提示', () => {
    expect(shouldPromptForUpdate({ availableVersion: '0.1.9', promptedVersion: '0.1.8' })).toBe(true)
  })

  it('版本号是预发布格式也不误判（本仓真出现过 0.1.4-diagnostic.1）', () => {
    expect(shouldPromptForUpdate({ availableVersion: '0.1.4-diagnostic.2', promptedVersion: '0.1.4-diagnostic.1' })).toBe(true)
    expect(shouldPromptForUpdate({ availableVersion: '0.1.4-diagnostic.1', promptedVersion: '0.1.4-diagnostic.1' })).toBe(false)
  })

  it('可用版本为空串 → 不提示（视为没有可用更新）', () => {
    expect(shouldPromptForUpdate({ availableVersion: '', promptedVersion: undefined })).toBe(false)
  })

  it('时钟常量在合理范围（延迟用于避开启动高峰，间隔用于长期驻留）', () => {
    expect(UPDATE_CHECK_DELAY_MS).toBeGreaterThanOrEqual(10_000)
    expect(UPDATE_CHECK_INTERVAL_MS).toBeGreaterThanOrEqual(60 * 60 * 1000)
  })
})
