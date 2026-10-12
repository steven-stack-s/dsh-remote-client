import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/shared/settings.js'
import {
  loadSettings,
  loadSettingsSync,
  saveSettings,
  settingsFilePath,
} from '../src/main/settings-store.js'

const dir = () => mkdtemp(join(tmpdir(), 'dsh-settings-'))

describe('settingsFilePath', () => {
  it('固定在数据目录下的 settings.json', () => {
    // **必须用 join 拼期望值，不能写字面量 `/tmp/x/settings.json`**：
    // `settingsFilePath` 内部用 `node:path` 的 `join`，在 Windows 上产出反斜杠。
    // 字面量断言在 Linux 上通过、在 windows-latest CI 上必红——这正是 0.2.0
    // 首次发布构建失败的原因（本地全绿、CI 在 7 秒内就倒在测试步骤）。
    expect(settingsFilePath('/tmp/x')).toBe(join('/tmp/x', 'settings.json'))
  })
})

describe('loadSettings', () => {
  it('文件不存在 → 默认值（首次运行）', async () => {
    expect(await loadSettings(await dir())).toEqual(DEFAULT_SETTINGS)
  })

  it('写入后读回一致（round-trip）', async () => {
    const d = await dir()
    const custom = { ...DEFAULT_SETTINGS, notifyEnabled: false, notifyQuietMs: 30000 }
    await saveSettings(d, custom)
    expect(await loadSettings(d)).toEqual(custom)
  })

  it('以换行结尾，便于人工查看（与 hosts.json 一致）', async () => {
    const d = await dir()
    await saveSettings(d, DEFAULT_SETTINGS)
    expect(await readFile(settingsFilePath(d), 'utf8')).toMatch(/\n$/)
  })
})

describe('损坏文件的处理（Review Focus #3）', () => {
  it('JSON 损坏 → 备份原文件后返回默认值，绝不静默丢弃', async () => {
    const d = await dir()
    await writeFile(settingsFilePath(d), '{ 这不是 JSON', 'utf8')

    expect(await loadSettings(d)).toEqual(DEFAULT_SETTINGS)

    // 备份必须**已经存在**（不是 fire-and-forget）。
    const files = await readdir(d)
    expect(files.some(name => name.startsWith('settings.json.corrupt-'))).toBe(true)
  })

  it('结构合法但字段非法 → normalizeSettings 逐字段回退，不产生备份', async () => {
    const d = await dir()
    await writeFile(settingsFilePath(d), JSON.stringify({ notifyEnabled: 'yes' }), 'utf8')

    const loaded = await loadSettings(d)
    expect(loaded).toEqual(DEFAULT_SETTINGS)
    const files = await readdir(d)
    expect(files.some(name => name.includes('corrupt'))).toBe(false)
  })
})

describe('loadSettingsSync', () => {
  it('与异步版读同一份结果', async () => {
    const d = await dir()
    await saveSettings(d, { ...DEFAULT_SETTINGS, startupBehavior: 'welcome' })
    expect(loadSettingsSync(d).startupBehavior).toBe('welcome')
  })

  it('目录不存在 → 默认值，不抛', () => {
    expect(loadSettingsSync('/tmp/definitely-not-here-xyz')).toEqual(DEFAULT_SETTINGS)
  })
})

describe('测试自身的平台中立性（0.2.0 首次发布构建失败的根因）', () => {
  it('本文件里不存在拿路径去比字面量的断言（源码级检查）', async () => {
    // **为什么只能做源码级检查**：那个缺陷在 Linux 上根本复现不了——
    // `join('/tmp/x','settings.json')` 与字面量 `/tmp/x/settings.json` 恰好相等，
    // 所以把断言改回字面量，本机 433 项测试照样全绿（我实测过）。
    // 唯一能在 Linux 上拦住它的办法，就是检查**断言的写法本身**。
    //
    // 背景：0.2.0 的 tag 推上去后，windows-latest 在测试步骤 7 秒就失败，
    // Release 没有产出任何安装包；而本地全绿，因为本机是 Linux。
    const { readFile } = await import('node:fs/promises')
    const source = await readFile(join(import.meta.dirname, 'settings-store.test.ts'), 'utf8')

    // 匹配「把**函数调用结果**直接比字面量绝对路径」的**实际断言代码**。
    // 只认 `expect(...)` 开头的行，因此注释里的反例（本函数自己也引用了那段
    // 错误写法作为说明）不会被误报——这条规则我踩过一次：第一版直接对全文
    // 做正则，结果把守卫自己的注释匹配了。
    const dangerous = source
      .split('\n')
      .filter(line => /^\s*expect\(/u.test(line))
      .filter(line => /settingsFilePath\([^)]*\)\s*\)\s*\.toBe\(\s*['"]\//u.test(line))
    expect(
      dangerous,
      'settingsFilePath 的结果被拿去比字面量路径——在 Linux 上恒真、在 Windows CI 上必红，请改用 join() 拼期望值',
    ).toEqual([])
  })

  it('join 在两种平台上的产出确实不同（这条盲区的证据）', () => {
    // 固化「为什么上一条必须做源码级检查」：两种平台的产出形式不同。
    expect(join('/tmp/x', 'settings.json')).toBe('/tmp/x/settings.json')
    expect(win32.join('/tmp/x', 'settings.json')).not.toBe('/tmp/x/settings.json')
  })

  it('settingsFilePath 与 join 的产出一致（当前实现）', () => {
    expect(settingsFilePath('/tmp/x')).toBe(join('/tmp/x', 'settings.json'))
  })
})
