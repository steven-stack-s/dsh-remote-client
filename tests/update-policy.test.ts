import { describe, expect, it } from 'vitest'
import {
  UPDATE_CHECK_DELAY_MS,
  UPDATE_CHECK_INTERVAL_MS,
  shouldPromptForUpdate,
  updateCheckMessage,
  updateVersionText,
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

describe('更新状态文案（#3：设置里显示当前版本与检查结果）', () => {
  it('当前版本：空值显示「未知」而不是空白', () => {
    expect(updateVersionText('')).toBe('未知')
    expect(updateVersionText('   ')).toBe('未知')
  })

  it('当前版本：正常值原样返回（不额外加 v 前缀）', () => {
    // 版本号在 package.json 里就是 `0.2.0`，界面自己加 `v` 会造成
    // 「设置里写 v0.2.0、安装包叫 0.2.0」这种对不上的困惑。
    expect(updateVersionText('0.2.0')).toBe('0.2.0')
    expect(updateVersionText('0.2.1-beta.1')).toBe('0.2.1-beta.1')
  })

  it('检查结果文案：四种结局各不相同且都可读', () => {
    expect(updateCheckMessage('up-to-date', '0.2.0')).toContain('已是最新')
    expect(updateCheckMessage('available', '0.3.0')).toContain('0.3.0')
    expect(updateCheckMessage('downloading', '0.3.0')).toContain('0.3.0')
    expect(updateCheckMessage('error', '')).toContain('失败')
  })

  it('检查结果文案：失败时不能把空版本号拼进正文', () => {
    // 失败路径拿不到版本号，若直接拼接会出现「新版本  可用」这种残缺文案。
    const text = updateCheckMessage('error', '')
    expect(text).not.toMatch(/新版本\s{2,}/u)
    expect(text).not.toMatch(/新版本\s*$/u)
  })

  it('开发模式（未打包）给出明确说明，而不是假装检查过', () => {
    expect(updateCheckMessage('disabled', '')).toContain('开发模式')
  })
})
