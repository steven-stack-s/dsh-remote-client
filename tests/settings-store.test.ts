import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  it('固定为 settings.json', () => {
    expect(settingsFilePath('/tmp/x')).toBe('/tmp/x/settings.json')
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
