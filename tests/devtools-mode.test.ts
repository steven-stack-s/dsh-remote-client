import { describe, expect, it } from 'vitest'
import { devToolsOpenOptions } from '../src/main/menu-state.js'
import { usesCustomTitlebar } from '../src/shared/desktop-shell.js'

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

describe('无边框窗口的 DevTools 约束（2026-10-12 真机判定实验）', () => {
  it('实验事实：有边框窗口内嵌、无边框窗口独立 —— 固化为已知约束', () => {
    // 真机实测（同一份代码、同一个 mode）：
    //   客户端设置窗口（有边框）→ 内嵌
    //   主机窗口（Windows，无边框）→ 独立窗口
    //
    // 沿用 `usesCustomTitlebar` 作为「该窗口是否无边框」的判据：它是这个决定的
    // 唯一来源，因此测试与实现不可能漂移。
    expect(usesCustomTitlebar('win32')).toBe(true)   // 主机窗口无边框 → DevTools 会独立
    expect(usesCustomTitlebar('linux')).toBe(false)  // 有边框 → 内嵌
    expect(usesCustomTitlebar('darwin')).toBe(false) // 有边框 → 内嵌
  })

  it('因此 host 窗口的 DevTools 独立是「已接受」的，不是待修缺陷', () => {
    // 这条测试的作用是**阻止**后来者去「修」它：唯一能让主机窗口内嵌的办法是
    // 去掉无边框（`titleBarStyle: 'hidden'`），而那会牺牲用户明确要保留的
    // 「顶部跟随应用主题」。若有人为此改掉 usesCustomTitlebar，这条会红。
    //
    // 注意断言的是「win32 上仍为无边框」——如果将来真的改了窗口方案，
    // 应当同时更新这里与 devToolsOpenOptions 的注释，而不是让约束悄悄失效。
    expect(usesCustomTitlebar('win32')).toBe(true)
  })

  it('mode 仍是停靠类 —— 对有边框的窗口（设置/编辑/欢迎页）确实生效', () => {
    // 主机窗口用不上它，但设置窗口等**有边框**窗口用得上（真机已验证内嵌）。
    // 去掉 mode 会让那些窗口也退化成独立窗口。
    expect(devToolsOpenOptions().mode).toBe('right')
  })
})
