import { describe, expect, it } from 'vitest'
import {
  TRAY_MENU_LABELS,
  canEditHost,
  canOpenEditWindow,
  canOpenHost,
  canReloadHost,
  contentWindowWebPreferences,
  editMenuLayout,
  emptyHostsPlaceholder,
  hostAfterEditEffect,
  matchesDevToolsChord,
  matchesReloadChord,
  navigationOutcome,
  shouldQuitOnAllWindowsClosed,
  trayIconVariant,
  trayMenuItemKinds,
  trayOpenAction,
  windowOpenDecision,
  type KeyChord,
} from '../src/main/menu-state.js'
import { partitionNameFor } from '../src/main/partitions.js'

describe('canReloadHost', () => {
  it('无当前主机 → false（菜单项应禁用）', () => {
    expect(canReloadHost(undefined)).toBe(false)
  })

  it('有当前主机 → true', () => {
    expect(canReloadHost('0123456789abcdef')).toBe(true)
  })

  it('空串视为无主机 → false（防御 id 来自未初始化状态）', () => {
    expect(canReloadHost('')).toBe(false)
  })
})

describe('canOpenHost', () => {
  it('任何已配置主机都可打开', () => {
    expect(canOpenHost()).toBe(true)
  })
})

describe('emptyHostsPlaceholder', () => {
  it('无主机时给出占位文案（避免菜单一片空白）', () => {
    expect(emptyHostsPlaceholder(0)).toBe('（尚未添加主机）')
  })

  it('有主机时不产生占位项', () => {
    expect(emptyHostsPlaceholder(1)).toBeUndefined()
    expect(emptyHostsPlaceholder(5)).toBeUndefined()
  })
})

describe('canEditHost', () => {
  it('无当前主机 → false（「编辑主机…」「删除主机…」应禁用）', () => {
    expect(canEditHost(undefined)).toBe(false)
  })

  it('有当前主机 → true', () => {
    expect(canEditHost('0123456789abcdef')).toBe(true)
  })

  it('空串视为无主机 → false', () => {
    expect(canEditHost('')).toBe(false)
  })

  it('与 canReloadHost 当前同条件（两者都作用于当前主机）', () => {
    for (const id of [undefined, '', 'abc']) {
      expect(canEditHost(id)).toBe(canReloadHost(id))
    }
  })
})

describe('editMenuLayout（#1：编辑菜单的分隔线）', () => {
  it('项集合与顺序固定', () => {
    expect(editMenuLayout()).toEqual(['addHost', 'editHost', 'removeHost', 'separator', 'quit'])
  })

  it('「添加主机…」与「编辑主机…」之间没有分隔线（用户明确要求）', () => {
    const layout = editMenuLayout()
    const addIndex = layout.indexOf('addHost')
    const editIndex = layout.indexOf('editHost')
    expect(editIndex).toBe(addIndex + 1)
  })

  it('「退出」前保留一条分隔线（它与主机管理不同层级）', () => {
    const layout = editMenuLayout()
    expect(layout[layout.length - 2]).toBe('separator')
    expect(layout[layout.length - 1]).toBe('quit')
  })

  it('整条菜单里恰好只有一条分隔线', () => {
    expect(editMenuLayout().filter(kind => kind === 'separator')).toHaveLength(1)
  })
})

describe('canOpenEditWindow（#2：编辑窗口可选主机）', () => {
  it('没有主机 → 禁用（没有可编辑的对象）', () => {
    expect(canOpenEditWindow(0)).toBe(false)
  })

  it('还有主机 → 可用，即使没有「当前主机」', () => {
    // 这正是与 canEditHost 的区别：编辑窗口内部能切换对象，
    // 因此「当前主机刚被删掉但还剩别的主机」时也必须能打开它。
    expect(canOpenEditWindow(1)).toBe(true)
    expect(canOpenEditWindow(3)).toBe(true)
    expect(canEditHost(undefined)).toBe(false)
  })
})

describe('hostAfterEditEffect（#3：改地址保存后的窗口处理）', () => {
  it('地址没变且正是当前主机 → reload（重放 token 握手）', () => {
    expect(hostAfterEditEffect({
      originChanged: false,
      editedIsOpenHost: true,
      hasHostWindow: true,
    })).toBe('reload')
  })

  it('地址没变且不是当前主机 → none', () => {
    expect(hostAfterEditEffect({
      originChanged: false,
      editedIsOpenHost: false,
      hasHostWindow: true,
    })).toBe('none')
  })

  it('改地址且正是当前主机 → reopen（**绝不返回 none**，否则会留下空窗期）', () => {
    // 这是「改地址保存后客户端退出」那个缺陷的回归守卫：旧窗口被销毁后
    // 必须立刻打开新地址的窗口，否则用户一关编辑窗口就一个窗口都不剩，
    // 触发 window-all-closed 把客户端退掉。
    const effect = hostAfterEditEffect({
      originChanged: true,
      editedIsOpenHost: true,
      hasHostWindow: true,
    })
    expect(effect).toBe('reopen')
    expect(effect).not.toBe('none')
  })

  it('改地址但编辑的是别的主机、且当前有窗口 → none（不把用户从正在用的主机上切走）', () => {
    expect(hostAfterEditEffect({
      originChanged: true,
      editedIsOpenHost: false,
      hasHostWindow: true,
    })).toBe('none')
  })

  it('改地址且一个主机窗口都没有 → reopen（否则用户改完可能再无窗口）', () => {
    expect(hostAfterEditEffect({
      originChanged: true,
      editedIsOpenHost: false,
      hasHostWindow: false,
    })).toBe('reopen')
  })
})

describe('trayMenuItemKinds（#4：托盘精简为两项）', () => {
  it('恰好两项：打开客户端 / 关闭客户端', () => {
    expect(trayMenuItemKinds()).toEqual(['open', 'quit'])
  })

  it('文案正确', () => {
    expect(TRAY_MENU_LABELS.open).toBe('打开客户端')
    expect(TRAY_MENU_LABELS.quit).toBe('关闭客户端')
  })

  it('不再包含任何主机管理项', () => {
    // 主机管理全部在菜单栏的「主机(H)」里；托盘在 Windows 上还可能不显示，
    // 把主机管理放在那里本就是错的。这条断言防止有人把它加回来。
    const labels = trayMenuItemKinds().map(kind => TRAY_MENU_LABELS[kind])
    for (const gone of ['打开', '重新加载', '立即重试', '重置登录态', '删除…', '添加主机…', '退出']) {
      expect(labels).not.toContain(gone)
    }
  })
})

describe('trayOpenAction（#4：打开客户端）', () => {
  it('有任何窗口 → show（即使没有当前主机，例如只剩欢迎页）', () => {
    expect(trayOpenAction({ hasWindow: true, hasCurrentHost: true })).toBe('show')
    expect(trayOpenAction({ hasWindow: true, hasCurrentHost: false })).toBe('show')
  })

  it('没有窗口但有当前主机 → reopen', () => {
    expect(trayOpenAction({ hasWindow: false, hasCurrentHost: true })).toBe('reopen')
  })

  it('没有窗口也没有当前主机 → welcome（不能点了没反应）', () => {
    expect(trayOpenAction({ hasWindow: false, hasCurrentHost: false })).toBe('welcome')
  })
})

describe('trayIconVariant（#5：托盘图标随主题与离线状态选色）', () => {
  it('离线时一律用灰图标（**离线优先于主题**）', () => {
    expect(trayIconVariant({ offline: true, dark: false })).toBe('offline')
    expect(trayIconVariant({ offline: true, dark: true })).toBe('offline')
  })

  it('正常态：深色主题用白鲸鱼（黑鲸鱼在深色任务栏上看不见）', () => {
    expect(trayIconVariant({ offline: false, dark: true })).toBe('dark')
  })

  it('正常态：浅色主题用黑鲸鱼', () => {
    expect(trayIconVariant({ offline: false, dark: false })).toBe('light')
  })
})

describe('matchesReloadChord（Ctrl/Cmd+R）', () => {
  const chord = (over: Partial<KeyChord> = {}): KeyChord => ({
    key: 'r',
    control: false,
    meta: false,
    alt: false,
    shift: false,
    platform: 'win32',
    ...over,
  })

  it('Windows：Ctrl+R 命中', () => {
    expect(matchesReloadChord(chord({ control: true }))).toBe(true)
  })

  it('Windows：无修饰键的 R 不命中（否则会吞掉页面里的普通输入）', () => {
    expect(matchesReloadChord(chord())).toBe(false)
  })

  it('不吞 Shift+Ctrl+R（强制重载语义不同）与 Alt 组合', () => {
    expect(matchesReloadChord(chord({ control: true, shift: true }))).toBe(false)
    expect(matchesReloadChord(chord({ control: true, alt: true }))).toBe(false)
  })

  it('macOS：用 Command 而非 Ctrl', () => {
    expect(matchesReloadChord(chord({ platform: 'darwin', meta: true }))).toBe(true)
    expect(matchesReloadChord(chord({ platform: 'darwin', control: true }))).toBe(false)
  })

  it('大小写不敏感（按住 Shift 时 Electron 报的是大写 R）', () => {
    expect(matchesReloadChord(chord({ key: 'R', control: true }))).toBe(true)
  })
})

describe('matchesDevToolsChord（#6：Ctrl+Shift+I / Cmd+Option+I / F12）', () => {
  const chord = (over: Partial<KeyChord> = {}): KeyChord => ({
    key: 'i',
    control: false,
    meta: false,
    alt: false,
    shift: false,
    platform: 'win32',
    ...over,
  })

  it('Windows/Linux：Ctrl+Shift+I 命中（用户报的那组键）', () => {
    expect(matchesDevToolsChord(chord({ control: true, shift: true }))).toBe(true)
  })

  it('Windows/Linux：Ctrl+I（缺 Shift）不命中', () => {
    expect(matchesDevToolsChord(chord({ control: true }))).toBe(false)
  })

  it('Windows/Linux：无修饰键的 I 不命中', () => {
    expect(matchesDevToolsChord(chord({ shift: true }))).toBe(false)
  })

  it('macOS：Cmd+Option+I 命中', () => {
    expect(matchesDevToolsChord(chord({ platform: 'darwin', meta: true, alt: true }))).toBe(true)
  })

  it('macOS：Cmd+I（缺 Option）不命中', () => {
    expect(matchesDevToolsChord(chord({ platform: 'darwin', meta: true }))).toBe(false)
  })

  it('macOS：Ctrl+Shift+I 不命中（macOS 惯例是 Command）', () => {
    expect(matchesDevToolsChord(chord({ platform: 'darwin', control: true, shift: true }))).toBe(false)
  })

  it('F12 无需修饰键即命中（Windows 的常见习惯，成本为零的兼容）', () => {
    expect(matchesDevToolsChord(chord({ key: 'F12' }))).toBe(true)
    expect(matchesDevToolsChord(chord({ key: 'f12' }))).toBe(true)
  })

  it('与「重新加载」不冲突：F12 不会触发重载，Ctrl+R 不会开 DevTools', () => {
    expect(matchesReloadChord(chord({ key: 'F12' }))).toBe(false)
    expect(matchesDevToolsChord(chord({ key: 'r', control: true }))).toBe(false)
  })

  it('其它按键不命中', () => {
    expect(matchesDevToolsChord(chord({ key: 'l', control: true, shift: true }))).toBe(false)
  })
})

describe('shouldQuitOnAllWindowsClosed（#3：加固）', () => {
  it('正在退出 → 不重复退出', () => {
    expect(shouldQuitOnAllWindowsClosed({
      trayAvailable: false,
      platform: 'win32',
      quitting: true,
    })).toBe(false)
  })

  it('托盘可用 → 常驻不退出（用户从托盘「打开客户端」回来）', () => {
    for (const platform of ['win32', 'linux', 'darwin']) {
      expect(shouldQuitOnAllWindowsClosed({ trayAvailable: true, platform, quitting: false }))
        .toBe(false)
    }
  })

  it('托盘不可用 + 非 macOS → 退出（否则是看不见也退不出的幽灵进程）', () => {
    expect(shouldQuitOnAllWindowsClosed({
      trayAvailable: false,
      platform: 'win32',
      quitting: false,
    })).toBe(true)
    expect(shouldQuitOnAllWindowsClosed({
      trayAvailable: false,
      platform: 'linux',
      quitting: false,
    })).toBe(true)
  })

  it('托盘不可用 + macOS → 不退出（符合平台惯例，保持既有语义）', () => {
    expect(shouldQuitOnAllWindowsClosed({
      trayAvailable: false,
      platform: 'darwin',
      quitting: false,
    })).toBe(false)
  })
})

describe('windowOpenDecision（#task-15：新窗口该在应用内开还是交给系统）', () => {
  it('https / http → 在应用内打开（用户就是要在客户端里用 dsh）', () => {
    expect(windowOpenDecision('https://example.com/')).toBe('in-app')
    expect(windowOpenDecision('https://oray.com:8443/portal?x=1#y')).toBe('in-app')
    expect(windowOpenDecision('http://192.168.1.10:3080/')).toBe('in-app')
  })

  it('协议大小写不敏感', () => {
    expect(windowOpenDecision('HTTPS://EXAMPLE.COM/')).toBe('in-app')
    expect(windowOpenDecision('Http://example.com/')).toBe('in-app')
  })

  it('带用户名密码/端口/查询/锚点的 http(s) 仍算应用内', () => {
    expect(windowOpenDecision('https://user:pw@host:8443/a/b?c=d#e')).toBe('in-app')
  })

  it('mailto: / tel: → 交给系统（邮件、电话应用）', () => {
    expect(windowOpenDecision('mailto:someone@example.com')).toBe('external')
    expect(windowOpenDecision('tel:+8613800138000')).toBe('external')
  })

  it('自定义 scheme → 交给系统（塞进应用内只会是空白页）', () => {
    expect(windowOpenDecision('dsh://open?session=1')).toBe('external')
    expect(windowOpenDecision('obsidian://open?vault=v')).toBe('external')
    expect(windowOpenDecision('vscode://file/tmp/a')).toBe('external')
  })

  it('file: → 交给系统一侧（安全边界：不得让远端页面在应用内打开本地文件）', () => {
    expect(windowOpenDecision('file:///etc/passwd')).toBe('external')
    expect(windowOpenDecision('file://C:/Windows/win.ini')).toBe('external')
  })

  it('javascript: / data: / about: → 交给系统一侧（安全边界）', () => {
    expect(windowOpenDecision('javascript:alert(1)')).toBe('external')
    expect(windowOpenDecision('data:text/html,<script>alert(1)</script>')).toBe('external')
    expect(windowOpenDecision('about:blank')).toBe('external')
  })

  it('非法 URL 不抛错，一律归入 external', () => {
    for (const url of ['', '   ', 'not a url', 'http://', '///', 'example.com']) {
      expect(windowOpenDecision(url), `应当判定为 external：${JSON.stringify(url)}`)
        .toBe('external')
    }
  })
})

describe('contentWindowWebPreferences（#task-15：子窗口必须继承父窗口的登录态）', () => {
  const origin = 'https://nas.example.com:8443'
  const preload = '/app/out/preload/host.cjs'

  it('partition 由 origin 派生，且与主机窗口用的是同一个值', () => {
    // 这条断言是本任务的核心契约：父窗口与它打开的子窗口落在同一个 session 里，
    // 否则新窗口没有登录态（cookie 全空），用户会看到一个未登录的 dsh。
    expect(contentWindowWebPreferences({ origin, preload }).partition)
      .toBe(partitionNameFor(origin))
  })

  it('preload 原样传入（子窗口也要有离线检测与通知观察器）', () => {
    expect(contentWindowWebPreferences({ origin, preload }).preload).toBe(preload)
  })

  it('沙箱三项固定：远端页面是不可信内容，不得被放宽', () => {
    const prefs = contentWindowWebPreferences({ origin, preload })
    expect(prefs.contextIsolation).toBe(true)
    expect(prefs.nodeIntegration).toBe(false)
    expect(prefs.sandbox).toBe(true)
  })

  it('不同主机得到不同 partition（登录态隔离不被破坏）', () => {
    const a = contentWindowWebPreferences({ origin: 'https://a.example.com', preload }).partition
    const b = contentWindowWebPreferences({ origin: 'https://b.example.com', preload }).partition
    expect(a).not.toBe(b)
  })

  it('同一 origin 反复调用结果稳定（父子窗口不能各拿到一个 session）', () => {
    const parent = contentWindowWebPreferences({ origin, preload })
    const child = contentWindowWebPreferences({ origin, preload })
    expect(child).toEqual(parent)
  })
})

describe('navigationOutcome（task-16：401 之后是否回放 token）', () => {
  it('非 401 → ignore（与认证无关）', () => {
    for (const statusCode of [200, 204, 302, 403, 404, 500]) {
      for (const hasLaunchToken of [true, false]) {
        for (const alreadyReplayed of [true, false]) {
          expect(navigationOutcome({ statusCode, hasLaunchToken, alreadyReplayed }))
            .toBe('ignore')
        }
      }
    }
  })

  it('401 且没配 token → offline（无从回放，交给离线页提示更新令牌）', () => {
    expect(navigationOutcome({ statusCode: 401, hasLaunchToken: false, alreadyReplayed: false }))
      .toBe('offline')
    expect(navigationOutcome({ statusCode: 401, hasLaunchToken: false, alreadyReplayed: true }))
      .toBe('offline')
  })

  it('401 + 配了 token + 尚未回放 → replay-token', () => {
    expect(navigationOutcome({ statusCode: 401, hasLaunchToken: true, alreadyReplayed: false }))
      .toBe('replay-token')
  })

  it('401 + 已回放过 → offline（禁止无限回放：既是无效流量，也会掩盖真正的问题）', () => {
    expect(navigationOutcome({ statusCode: 401, hasLaunchToken: true, alreadyReplayed: true }))
      .toBe('offline')
  })

  it('回归守卫：令牌更新（回放标志被重新武装）后，同一个 401 重新可回放', () => {
    // updateHost() 会把 alreadyReplayed 归零，正是为了让这条路径重新可用。
    // 若有人「优化」掉那个归零，用户就会看到「token 明明更新了却依然进不去」
    // ——症状与 task-16 的缺陷完全一致。
    expect(navigationOutcome({
      statusCode: 401,
      hasLaunchToken: true,
      alreadyReplayed: true,   // 旧 token 已经回放过
    })).toBe('offline')
    expect(navigationOutcome({
      statusCode: 401,
      hasLaunchToken: true,
      alreadyReplayed: false,  // updateHost() 之后重新武装
    })).toBe('replay-token')
  })
})
