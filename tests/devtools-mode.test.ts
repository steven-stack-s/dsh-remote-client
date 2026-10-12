import { describe, expect, it } from 'vitest'
import { devToolsOpenOptions } from '../src/main/menu-state.js'

describe('devToolsOpenOptions（task-20：DevTools 必须在窗口内打开）', () => {
  it('mode 为 right（内嵌），不是 detach（独立窗口）', () => {
    expect(devToolsOpenOptions().mode).toBe('right')
  })

  it('返回的是新对象，调用方改它不会污染后续调用', () => {
    // 用 `as` 绕过字面量类型：这条测的正是「调用方能就地改这个对象」，
    // 而那需要一个比 'right' 更宽的类型才写得出来。
    const first = devToolsOpenOptions() as { mode: string }
    first.mode = 'detach'
    expect(devToolsOpenOptions().mode).toBe('right')
  })
})

describe('DevTools 形态在三种状态下都确定（0.2.0 真机反馈「还是独立窗口」）', () => {
  it('选项里必须显式给出 mode —— 不能依赖 Electron 记住的上次状态', () => {
    // 真机反馈：0.2.0 里按 Ctrl+Shift+I 仍然是独立窗口。原因之一是
    // `toggleDevTools()` 不接受 mode，形态取决于库记住的上次停靠状态。
    // 这条钉住「我们始终显式指定」，从而不依赖那份记忆。
    const options = devToolsOpenOptions()
    expect(options.mode).toBeDefined()
    expect(['left', 'right', 'bottom']).toContain(options.mode)
  })

  it('mode 是停靠类（left/right/bottom），不是 detach/undocked', () => {
    // 用户明确要求「在窗口内打开」。detach 与 undocked 都是独立窗口，
    // 一旦有人「顺手」改成它们，这条会立刻红。
    expect(['left', 'right', 'bottom']).toContain(devToolsOpenOptions().mode)
    expect(devToolsOpenOptions().mode).not.toBe('detach')
    expect(devToolsOpenOptions().mode).not.toBe('undocked')
  })
})
