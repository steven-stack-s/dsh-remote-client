import { describe, expect, it } from 'vitest'
import {
  THEME_SOURCE_ATTRIBUTE,
  TITLEBAR_ARGUMENT,
  TITLEBAR_ATTRIBUTE,
  TITLEBAR_HEIGHT,
  TITLEBAR_HEIGHT_VARIABLE,
  applyTitlebarContract,
  parseThemeSource,
  readThemeSource,
  titlebarHeightFromArguments,
  usesCustomTitlebar,
} from '../src/shared/desktop-shell.js'

describe('THEME_SOURCE_ATTRIBUTE', () => {
  it('钉住契约属性名（改名会让「原生装饰跟随主题」静默失效）', () => {
    expect(THEME_SOURCE_ATTRIBUTE).toBe('data-ds-theme-source')
  })
})

describe('parseThemeSource', () => {
  it('接受官方公布的三态', () => {
    expect(parseThemeSource('light')).toBe('light')
    expect(parseThemeSource('dark')).toBe('dark')
    expect(parseThemeSource('system')).toBe('system')
  })

  it('system 原样保留（跟随系统由 nativeTheme 自己继续做，壳不代劳）', () => {
    // 若这里把 system 解析成 light/dark，用户切系统主题时窗口装饰就不再跟随。
    expect(parseThemeSource('system')).toBe('system')
  })

  it('大小写不宽容：官方只公布小写三态', () => {
    expect(parseThemeSource('DARK')).toBeUndefined()
    expect(parseThemeSource('Light')).toBeUndefined()
  })

  it('拒绝前后空白的值（不当 Trim 型宽容，避免把脏值塞进 nativeTheme）', () => {
    expect(parseThemeSource(' dark')).toBeUndefined()
    expect(parseThemeSource('dark ')).toBeUndefined()
  })

  it('拒绝未知字符串（前端换代或远端页面篡改都走这条）', () => {
    expect(parseThemeSource('auto')).toBeUndefined()
    expect(parseThemeSource('')).toBeUndefined()
    expect(parseThemeSource('dark;evil')).toBeUndefined()
  })

  it('拒绝非字符串', () => {
    expect(parseThemeSource(null)).toBeUndefined()
    expect(parseThemeSource(undefined)).toBeUndefined()
    expect(parseThemeSource(0)).toBeUndefined()
    expect(parseThemeSource({})).toBeUndefined()
    expect(parseThemeSource(['dark'])).toBeUndefined()
  })
})

/** 造一个只实现 getAttribute 的假根元素。 */
function fakeRoot(attrs: Record<string, string>): { getAttribute(name: string): string | null } {
  return { getAttribute: (name: string) => attrs[name] ?? null }
}

describe('readThemeSource', () => {
  it('从根元素读出当前主题来源', () => {
    expect(readThemeSource(fakeRoot({ 'data-ds-theme-source': 'dark' }))).toBe('dark')
  })

  it('根元素还不存在时返回 undefined（preload 跑在 document-start，这是常态）', () => {
    expect(readThemeSource(null)).toBeUndefined()
  })

  it('属性尚未公布时返回 undefined', () => {
    expect(readThemeSource(fakeRoot({}))).toBeUndefined()
  })

  it('属性值非法时返回 undefined，而不是抛错', () => {
    expect(readThemeSource(fakeRoot({ 'data-ds-theme-source': 'nord' }))).toBeUndefined()
  })

  it('只认契约属性名，不认近似名', () => {
    expect(readThemeSource(fakeRoot({ 'data-theme-source': 'dark' }))).toBeUndefined()
  })
})

describe('自绘标题栏契约名', () => {
  it('钉住属性名与 CSS 变量名（前端按这两个名字找过来，改名即静默失效）', () => {
    expect(TITLEBAR_ATTRIBUTE).toBe('data-windows-titlebar')
    expect(TITLEBAR_HEIGHT_VARIABLE).toBe('--dsh-windows-titlebar-height')
  })

  it('钉住命令行参数名（主进程与 preload 靠它对齐高度）', () => {
    expect(TITLEBAR_ARGUMENT).toBe('--dsh-custom-titlebar')
  })

  it('高度是正数', () => {
    expect(TITLEBAR_HEIGHT).toBeGreaterThan(0)
  })
})

describe('usesCustomTitlebar', () => {
  it('Windows 使用自绘标题栏', () => {
    expect(usesCustomTitlebar('win32')).toBe(true)
  })

  it('macOS 不用：它有自己的一套（交通灯 + data-platform="darwin"）', () => {
    // 拿 Windows 这套契约去套 macOS 会得到「没有窗口按钮」的窗口——用户只剩
    // 快捷键能关窗，这是不可接受的回归。
    expect(usesCustomTitlebar('darwin')).toBe(false)
  })

  it('Linux 不用：Electron 的 titleBarStyle 适用范围不含 Linux', () => {
    expect(usesCustomTitlebar('linux')).toBe(false)
  })

  it('空串/未知平台一律不用（宁可保留系统标题栏，也不要造出没有按钮的窗口）', () => {
    expect(usesCustomTitlebar('')).toBe(false)
    expect(usesCustomTitlebar('freebsd')).toBe(false)
  })
})

/** 造一个记录写入的假根元素。 */
function fakeTitlebarRoot(): {
  attrs: Map<string, string>
  styles: Map<string, string>
  setAttribute: (name: string, value: string) => void
  style: { setProperty: (name: string, value: string) => void }
} {
  const attrs = new Map<string, string>()
  const styles = new Map<string, string>()
  return {
    attrs,
    styles,
    setAttribute: (name, value) => { attrs.set(name, value) },
    style: { setProperty: (name, value) => { styles.set(name, value) } },
  }
}

describe('applyTitlebarContract', () => {
  it('声明属性，并用带 px 单位的高度写 CSS 变量', () => {
    const root = fakeTitlebarRoot()
    applyTitlebarContract(root, 40)
    expect(root.attrs.has('data-windows-titlebar')).toBe(true)
    // 前端用 parseFloat 读这个变量，缺了单位在某些取值下读出来就不是 40。
    expect(root.styles.get('--dsh-windows-titlebar-height')).toBe('40px')
  })

  it('属性值为空串（前端用 hasAttribute/[data-*] 判定，值本身无意义）', () => {
    const root = fakeTitlebarRoot()
    applyTitlebarContract(root, 40)
    expect(root.attrs.get('data-windows-titlebar')).toBe('')
  })

  it('幂等：重复注入得到相同结果（DOM 就绪与导航后各调一次是正常路径）', () => {
    const root = fakeTitlebarRoot()
    applyTitlebarContract(root, 40)
    const first = new Map(root.styles)
    applyTitlebarContract(root, 40)
    expect(root.styles).toEqual(first)
    expect(root.attrs.size).toBe(1)
  })

  it('高度跟随入参，不写死常量', () => {
    const root = fakeTitlebarRoot()
    applyTitlebarContract(root, 36)
    expect(root.styles.get('--dsh-windows-titlebar-height')).toBe('36px')
  })
})

describe('titlebarHeightFromArguments', () => {
  it('从参数里读出高度', () => {
    expect(titlebarHeightFromArguments(['/app/electron', '--dsh-custom-titlebar=40'])).toBe(40)
  })

  it('混在别的参数里也能找到', () => {
    expect(
      titlebarHeightFromArguments([
        '/app/electron',
        '--enable-logging',
        '--dsh-custom-titlebar=48',
        '--no-sandbox',
      ]),
    ).toBe(48)
  })

  it('没有该参数时返回 undefined（调用方据此决定不注入）', () => {
    expect(titlebarHeightFromArguments(['/app/electron'])).toBeUndefined()
  })

  it('畸形值返回 undefined，绝不退化成默认高度', () => {
    // 「悄悄用一个与 titleBarOverlay.height 不同的高度」换来的是错位的界面，
    // 比完全不注入更难排查——宁可什么都没有。
    expect(titlebarHeightFromArguments(['--dsh-custom-titlebar='])).toBeUndefined()
    expect(titlebarHeightFromArguments(['--dsh-custom-titlebar=abc'])).toBeUndefined()
    expect(titlebarHeightFromArguments(['--dsh-custom-titlebar=NaN'])).toBeUndefined()
    expect(titlebarHeightFromArguments(['--dsh-custom-titlebar=Infinity'])).toBeUndefined()
  })

  it('零与负数返回 undefined（0 高的标题栏等于没有按钮可用区）', () => {
    expect(titlebarHeightFromArguments(['--dsh-custom-titlebar=0'])).toBeUndefined()
    expect(titlebarHeightFromArguments(['--dsh-custom-titlebar=-40'])).toBeUndefined()
  })

  it('不匹配前缀相似的参数', () => {
    expect(titlebarHeightFromArguments(['--dsh-custom-titlebar-x=40'])).toBeUndefined()
    expect(titlebarHeightFromArguments(['x--dsh-custom-titlebar=40'])).toBeUndefined()
  })

  it('小数高度可接受（高 DPI 下按比例给值）', () => {
    expect(titlebarHeightFromArguments(['--dsh-custom-titlebar=40.5'])).toBe(40.5)
  })
})
