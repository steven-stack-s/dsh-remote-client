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
  matchesCloseChord,
  matchesDevToolsChord,
  matchesReloadChord,
  isSameAddress,
  navigationOutcome,
  shouldQuitOnAllWindowsClosed,
  shouldRemoveWindowMenuBar,
  trayIconVariant,
  trayMenuLayout,
  trayOpenAction,
  windowOpenDecision,
  windowTitleFor,
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

describe('trayMenuLayout（主机管理回到托盘）', () => {
  it('布局固定：打开客户端 / 主机管理段 / 关闭客户端', () => {
    expect(trayMenuLayout()).toEqual([
      'open',
      'separator',
      'hosts',
      'addHost',
      'editHost',
      'separator',
      'quit',
    ])
  })

  it('文案正确', () => {
    expect(TRAY_MENU_LABELS.open).toBe('打开客户端')
    expect(TRAY_MENU_LABELS.quit).toBe('关闭客户端')
    expect(TRAY_MENU_LABELS.hosts).toBe('主机')
    expect(TRAY_MENU_LABELS.addHost).toBe('添加主机…')
    expect(TRAY_MENU_LABELS.editHost).toBe('编辑主机…')
  })

  it('每个可点击项都有非空文案（漏一个会渲染成一条空白项）', () => {
    for (const entry of trayMenuLayout()) {
      if (entry === 'separator') continue
      expect(TRAY_MENU_LABELS[entry]).toBeTruthy()
    }
  })

  it('主机管理重新可达：hosts / addHost / editHost 都在', () => {
    // 这三项是本次加回来的。Windows 上主机窗口无边框 → 菜单栏不再显示，
    // 而「编辑主机…」「删除主机…」在 editMenuLayout() 里**没有快捷键**，
    // 托盘不带它们就等于彻底失去入口。这条断言防止有人再把托盘精简回去。
    expect(trayMenuLayout()).toContain('hosts')
    expect(trayMenuLayout()).toContain('addHost')
    expect(trayMenuLayout()).toContain('editHost')
  })

  it('「退出」紧邻其上的分隔线（避免它在主机列表里被误点）', () => {
    const layout = trayMenuLayout()
    expect(layout[layout.indexOf('quit') - 1]).toBe('separator')
  })

  it('高频操作排在退出之前', () => {
    const layout = trayMenuLayout()
    expect(layout.indexOf('open')).toBeLessThan(layout.indexOf('quit'))
    expect(layout.indexOf('hosts')).toBeLessThan(layout.indexOf('quit'))
  })

  it('不出现连续两条分隔线（会渲染成双倍留白）', () => {
    const layout = trayMenuLayout()
    layout.forEach((entry, index) => {
      if (entry !== 'separator' || index === 0) return
      expect(layout[index - 1]).not.toBe('separator')
    })
  })

  it('首项不是分隔线、末项也不是（菜单两端出现留白是布局错误）', () => {
    const layout = trayMenuLayout()
    expect(layout[0]).not.toBe('separator')
    expect(layout[layout.length - 1]).not.toBe('separator')
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

describe('windowOpenDecision（task-18：指向已知主机则替换当前窗口，外链走浏览器）', () => {
  /** 用户的实际场景：主机窗口被门户占了（花生壳域名），门户上有指向 dsh 的图标。 */
  const portal = 'https://nas.oray.com'
  const dshHost = 'https://dsh.example.com:8443'
  const known = [dshHost]
  const decide = (url: string, currentOrigin = portal, knownHostOrigins = known) =>
    windowOpenDecision({ url, currentOrigin, knownHostOrigins })

  it('第 3 条：指向**已配置主机**的链接 → 在当前窗口导航（跨域也要留在应用内）', () => {
    // 这是用户需求 1 的关键：门户与 dsh 不同源，靠同源判定会漏掉它。
    expect(decide(`${dshHost}/session/1`)).toBe('navigate-self')
    expect(decide(`${dshHost}/`)).toBe('navigate-self')
  })

  it('第 4 条：当前站点内的链接 → 在当前窗口导航', () => {
    expect(decide(`${portal}/desktop`)).toBe('navigate-self')
    expect(decide(`${portal}/app.php?id=7`)).toBe('navigate-self')
  })

  it('第 5 条：真外链 → 交给系统浏览器（用户需求 2）', () => {
    expect(decide('https://github.com/steven-stack-s/dsh-remote-client/actions'))
      .toBe('external')
    expect(decide('https://www.google.com/')).toBe('external')
  })

  it('第 1 条：非 http(s) 协议 → 交给系统（含安全边界）', () => {
    for (const url of [
      'mailto:someone@example.com',
      'tel:+8613800138000',
      'dsh://open?session=1',
      'obsidian://open?vault=v',
      // 安全边界：远端页面不该借我们的手在应用内打开本地文件或执行脚本。
      'file:///etc/passwd',
      'file://C:/Windows/win.ini',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'about:blank',
    ]) {
      expect(decide(url), `应当是 external：${JSON.stringify(url)}`).toBe('external')
    }
  })

  it('第 2 条：非法 URL 不抛错，一律 external', () => {
    for (const url of ['', '   ', 'not a url', 'http://', '///', 'example.com']) {
      expect(decide(url), `应当是 external：${JSON.stringify(url)}`).toBe('external')
    }
  })

  it('origin 比较先规范化：大小写不同不算不同主机', () => {
    // 不规范化的话，用户按配置里的写法（或门户里的写法）点开就会被误判成外链。
    expect(decide('https://DSH.Example.COM:8443/x')).toBe('navigate-self')
    expect(decide('HTTPS://Dsh.Example.com:8443/x')).toBe('navigate-self')
  })

  it('origin 比较先规范化：默认端口显式与隐式等价', () => {
    expect(decide('https://dsh.example.com:443/x', `${dshHost}/`, ['https://dsh.example.com']))
      .toBe('navigate-self')
    expect(decide('http://nas.local:80/x', 'http://nas.local', ['http://nas.local:80']))
      .toBe('navigate-self')
  })

  it('origin 比较先规范化：末尾斜杠/路径/查询不影响判定', () => {
    expect(decide('https://dsh.example.com:8443', `${portal}/`)).toBe('navigate-self')
    expect(decide('https://dsh.example.com:8443/?a=1#b')).toBe('navigate-self')
  })

  it('已知主机列表里的写法不被信任：列表项同样过一遍规范化', () => {
    // 配置理论上已经是规范化的，但比较两侧用同一套规则才不会有暗坑。
    expect(decide('https://dsh.example.com:8443/x', portal, ['HTTPS://DSH.example.com:8443/']))
      .toBe('navigate-self')
  })

  it('端口不同就是不同主机（不能只比域名）', () => {
    expect(decide('https://dsh.example.com:9999/x')).toBe('external')
  })

  it('协议不同就是不同主机（http 与 https 不是同一处）', () => {
    expect(decide('http://dsh.example.com:8443/x')).toBe('external')
  })

  it('currentOrigin 为空串（取不到当前页，例如壳自有的 file:// 离线页）→ 第 4 条不参与', () => {
    // 不能因为「取不到当前页」就把所有链接当成站内链接。
    expect(decide(`${portal}/desktop`, '')).toBe('external')
    // 但已知主机仍然照常判定。
    expect(decide(`${dshHost}/x`, '')).toBe('navigate-self')
  })

  it('knownHostOrigins 为空数组 → 只有当前站点算内部链接', () => {
    expect(decide(`${dshHost}/x`, portal, [])).toBe('external')
    expect(decide(`${portal}/x`, portal, [])).toBe('navigate-self')
  })

  it('大小写不敏感：协议与主机名', () => {
    expect(decide('HTTPS://GITHUB.COM/x')).toBe('external')          // 外链，但确实被解析了
    expect(decide('HTTPS://NAS.ORAY.COM/desktop')).toBe('navigate-self')
  })
})

describe('isSameAddress（task-18：deny 之后避免对同一地址重复导航）', () => {
  it('完全相同 → true', () => {
    expect(isSameAddress('https://a.com/x', 'https://a.com/x')).toBe(true)
  })

  it('规范化后相同 → true（大小写、默认端口、末尾斜杠）', () => {
    expect(isSameAddress('https://A.com/x', 'https://a.com/x')).toBe(true)
    expect(isSameAddress('https://a.com:443/x', 'https://a.com/x')).toBe(true)
    expect(isSameAddress('https://a.com', 'https://a.com/')).toBe(true)
  })

  it('不同地址 → false', () => {
    expect(isSameAddress('https://a.com/x', 'https://a.com/y')).toBe(false)
    expect(isSameAddress('https://a.com/', 'https://b.com/')).toBe(false)
    expect(isSameAddress('https://a.com/', 'http://a.com/')).toBe(false)
  })

  it('解析不了的字符串退回字面比较（不抛错）', () => {
    expect(isSameAddress('', '')).toBe(true)
    expect(isSameAddress('', 'https://a.com')).toBe(false)
    expect(isSameAddress('not a url', 'not a url')).toBe(true)
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

describe('windowTitleFor（task-17：内容窗口标题要带主机名前缀）', () => {
  it('拼成「主机名 — 页面标题」', () => {
    expect(windowTitleFor('家里的 NAS', 'DeepSeek Harness'))
      .toBe('家里的 NAS — DeepSeek Harness')
  })

  it('拿不到页面标题时退化为纯主机名（不能留悬挂的分隔符）', () => {
    expect(windowTitleFor('家里的 NAS', '')).toBe('家里的 NAS')
    expect(windowTitleFor('家里的 NAS', '   ')).toBe('家里的 NAS')
  })

  it('页面标题两侧空白被裁掉', () => {
    expect(windowTitleFor('NAS', '  会话  ')).toBe('NAS — 会话')
  })

  it('页面标题自身含分隔符时原样保留', () => {
    expect(windowTitleFor('NAS', '修复 — 登录')).toBe('NAS — 修复 — 登录')
  })
})

describe('matchesCloseChord（task-17：Ctrl/Cmd+W 关闭内容窗口）', () => {
  const chord = (over: Partial<KeyChord> = {}): KeyChord => ({
    key: 'w',
    control: false,
    meta: false,
    alt: false,
    shift: false,
    platform: 'win32',
    ...over,
  })

  it('Windows/Linux：Ctrl+W 命中', () => {
    expect(matchesCloseChord(chord({ control: true }))).toBe(true)
  })

  it('macOS：Cmd+W 命中，Ctrl+W 不命中（与其它快捷键同一套修饰键规则）', () => {
    expect(matchesCloseChord(chord({ platform: 'darwin', meta: true }))).toBe(true)
    expect(matchesCloseChord(chord({ platform: 'darwin', control: true }))).toBe(false)
  })

  it('无修饰键的 W 不命中（否则会吞掉页面里的普通输入）', () => {
    expect(matchesCloseChord(chord())).toBe(false)
  })

  it('不吞 Shift/Alt 组合（Ctrl+Shift+W 语义不同）', () => {
    expect(matchesCloseChord(chord({ control: true, shift: true }))).toBe(false)
    expect(matchesCloseChord(chord({ control: true, alt: true }))).toBe(false)
  })

  it('大小写不敏感', () => {
    expect(matchesCloseChord(chord({ key: 'W', control: true }))).toBe(true)
  })

  it('与其它快捷键互不误触', () => {
    const ctrlW = chord({ control: true })
    expect(matchesReloadChord(ctrlW)).toBe(false)
    expect(matchesDevToolsChord(ctrlW)).toBe(false)
    expect(matchesCloseChord(chord({ key: 'r', control: true }))).toBe(false)
    expect(matchesCloseChord(chord({ key: 'i', control: true, shift: true }))).toBe(false)
  })
})

describe('shouldRemoveWindowMenuBar（task-17：非主机窗口不要菜单栏）', () => {
  it('Windows / Linux → 移除（菜单栏属于窗口）', () => {
    expect(shouldRemoveWindowMenuBar('win32')).toBe(true)
    expect(shouldRemoveWindowMenuBar('linux')).toBe(true)
  })

  it('macOS → 不移除（菜单栏属于应用，setMenu/removeMenu 在 darwin 上无效）', () => {
    // 这是 Electron 的平台约束（这两个 API 都标注 @platform linux,win32）。
    // 强行去动应用级菜单会连带弄掉主机窗口的菜单，所以这里保持现状——
    // macOS 上「窗口在看着 A、菜单在操作主机窗口」这个差异是平台限制。
    expect(shouldRemoveWindowMenuBar('darwin')).toBe(false)
  })
})
