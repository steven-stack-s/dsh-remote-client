import { describe, expect, it } from 'vitest'
import { shouldHideOnClose } from '../src/main/lifecycle.js'

describe('shouldHideOnClose', () => {
  it('Windows 上用户关闭主机窗口 → 隐藏（托盘存活）', () => {
    expect(shouldHideOnClose({ kind: 'host', platform: 'win32', quitting: false })).toBe(true)
  })

  it('Linux 上同样隐藏（非 darwin 一致处理）', () => {
    expect(shouldHideOnClose({ kind: 'host', platform: 'linux', quitting: false })).toBe(true)
  })

  it('macOS 上关闭主机窗口 → 放行（保持既有语义，不回归）', () => {
    expect(shouldHideOnClose({ kind: 'host', platform: 'darwin', quitting: false })).toBe(false)
  })

  it('应用正在退出时一律放行（否则退出流程会被卡住）', () => {
    expect(shouldHideOnClose({ kind: 'host', platform: 'win32', quitting: true })).toBe(false)
    expect(shouldHideOnClose({ kind: 'host', platform: 'linux', quitting: true })).toBe(false)
    expect(shouldHideOnClose({ kind: 'host', platform: 'darwin', quitting: true })).toBe(false)
  })

  it('欢迎窗口在任何平台都放行（壳自有工具窗口）', () => {
    for (const platform of ['win32', 'linux', 'darwin']) {
      expect(shouldHideOnClose({ kind: 'welcome', platform, quitting: false })).toBe(false)
    }
  })

  it('欢迎窗口即便在退出过程中也放行', () => {
    expect(shouldHideOnClose({ kind: 'welcome', platform: 'win32', quitting: true })).toBe(false)
  })
})
