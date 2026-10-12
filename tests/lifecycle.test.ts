import { describe, expect, it } from 'vitest'
import { shouldHideOnClose } from '../src/main/lifecycle.js'

describe('shouldHideOnClose', () => {
  it('Windows 上用户关闭主机窗口 → 隐藏（托盘存活）', () => {
    expect(shouldHideOnClose({ kind: 'host', platform: 'win32', quitting: false, hideOnClose: true })).toBe(true)
  })

  it('Linux 上同样隐藏（非 darwin 一致处理）', () => {
    expect(shouldHideOnClose({ kind: 'host', platform: 'linux', quitting: false, hideOnClose: true })).toBe(true)
  })

  it('macOS 上关闭主机窗口 → 放行（保持既有语义，不回归）', () => {
    expect(shouldHideOnClose({ kind: 'host', platform: 'darwin', quitting: false, hideOnClose: true })).toBe(false)
  })

  it('应用正在退出时一律放行（否则退出流程会被卡住）', () => {
    expect(shouldHideOnClose({ kind: 'host', platform: 'win32', quitting: true, hideOnClose: true })).toBe(false)
    expect(shouldHideOnClose({ kind: 'host', platform: 'linux', quitting: true, hideOnClose: true })).toBe(false)
    expect(shouldHideOnClose({ kind: 'host', platform: 'darwin', quitting: true, hideOnClose: true })).toBe(false)
  })

  it('欢迎窗口在任何平台都放行（壳自有工具窗口）', () => {
    for (const platform of ['win32', 'linux', 'darwin']) {
      expect(shouldHideOnClose({ kind: 'welcome', platform, quitting: false, hideOnClose: true })).toBe(false)
    }
  })

  it('欢迎窗口即便在退出过程中也放行', () => {
    expect(shouldHideOnClose({ kind: 'welcome', platform: 'win32', quitting: true, hideOnClose: true })).toBe(false)
  })
})

describe('hideOnClose 设置（task-19：关窗驻留可关闭）', () => {
  it('关掉设置后，Windows/Linux 上关窗即真关（放行 → 触发 window-all-closed）', () => {
    for (const platform of ['win32', 'linux']) {
      expect(shouldHideOnClose({ kind: 'host', platform, quitting: false, hideOnClose: false }))
        .toBe(false)
    }
  })

  it('关掉设置不影响 macOS —— 那里本来就放行，语义没有变化', () => {
    expect(shouldHideOnClose({ kind: 'host', platform: 'darwin', quitting: false, hideOnClose: false }))
      .toBe(false)
  })

  it('开启设置时保持既有行为（非 darwin 隐藏）', () => {
    expect(shouldHideOnClose({ kind: 'host', platform: 'win32', quitting: false, hideOnClose: true }))
      .toBe(true)
  })

  it('hideOnClose 与 quitting 互相独立：正在退出时设置开不开都放行', () => {
    for (const hideOnClose of [true, false]) {
      expect(shouldHideOnClose({ kind: 'host', platform: 'win32', quitting: true, hideOnClose }))
        .toBe(false)
    }
  })
})
