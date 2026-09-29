import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 构建产物断言。
 *
 * 存在的理由：阶段 1 曾出现「42 个单测全绿 + typecheck 退出码 0，但构建产物
 * 是坏的」——preload 把 npm `electron` 包整包内联，在 sandbox: true 下加载即崩，
 * 而所有既有验证手段都看不见 out/ 里的东西。这组断言直接检查产物形态。
 *
 * out/ 不存在时**故意失败**并给出可操作提示，绝不静默跳过——静默跳过正是
 * 当初漏掉该缺陷的成因。
 */
const root = join(import.meta.dirname, '..')
const outDir = join(root, 'out')

/** 构建产物存在性前置检查，缺失时给出明确指引。 */
function requireBuilt(): void {
  if (!existsSync(join(outDir, 'main', 'index.js'))) {
    throw new Error(
      '未找到构建产物 out/main/index.js。请先运行 `pnpm build`（或直接跑 `pnpm test`，'
      + '该脚本已串联构建）后再执行构建产物断言。',
    )
  }
}

describe('构建产物', () => {
  it('七个关键产物均存在', async () => {
    requireBuilt()
    // 断言「恰好」这些，而非「至少包含」：这个测试的价值就是守住产物结构。
    // 新增页面/入口时**必须**同步更新本列表——那正是提醒作者「你在改产物
    // 布局」的时机。edit.* 于 task-12 加入（编辑主机窗口）。
    const expected = [
      'main/index.js',
      'preload/host.cjs',
      'preload/welcome.cjs',
      'preload/edit.cjs',
      'renderer/offline.html',
      'renderer/welcome.html',
      'renderer/edit.html',
    ]
    for (const relative of expected) {
      expect(existsSync(join(outDir, relative)), `缺少产物：out/${relative}`).toBe(true)
    }

    // 反向断言：产物总数必须恰好等于预期，多出来的文件（例如意外生成的
    // 共享 chunk）会被这里挡住——P0-1 那次事故正是共享 chunk 造成的。
    const actual = [
      ...(await readdir(join(outDir, 'main'))).map(n => `main/${n}`),
      ...(await readdir(join(outDir, 'preload'))).map(n => `preload/${n}`),
      ...(await readdir(join(outDir, 'renderer'))).map(n => `renderer/${n}`),
    ].sort()
    expect(actual).toEqual([...expected].sort())
  })

  it('preload 未内联 npm electron 包', async () => {
    requireBuilt()
    const files = (await readdir(join(outDir, 'preload'))).filter(name => name.endsWith('.cjs'))
    expect(files.length).toBeGreaterThan(0)

    for (const name of files) {
      const content = await readFile(join(outDir, 'preload', name), 'utf8')
      // 这三个符号来自 npm electron 包的 Node 端入口，被内联后会在 require 时
      // 执行 spawnSync——在 sandbox: true 的 preload 里必然抛错。
      expect(content, `${name} 内联了 electron 包（downloadElectron）`).not.toContain('downloadElectron')
      expect(content, `${name} 内联了 electron 包（getElectronPath）`).not.toContain('getElectronPath')
      expect(content, `${name} 内联了 spawnSync`).not.toContain('spawnSync')
    }
  })

  it('preload 以裸 require("electron") 引用宿主 API', async () => {
    requireBuilt()
    const host = await readFile(join(outDir, 'preload', 'host.cjs'), 'utf8')
    expect(host).toMatch(/require\(["']electron["']\)/u)
    // 不应存在指向本地 chunk 的 require，那正是内联的特征。
    expect(host).not.toMatch(/require\(["']\.\//u)
  })

  it('preload 为 CJS 格式（sandbox 不支持 ESM preload）', async () => {
    requireBuilt()
    const host = await readFile(join(outDir, 'preload', 'host.cjs'), 'utf8')
    expect(host).not.toMatch(/^\s*import\s.+from\s/mu)
    expect(host).not.toMatch(/^\s*export\s/mu)
  })

  it('通知观察器同时监听节点新增与 data-streaming 属性变化', async () => {
    requireBuilt()
    const host = await readFile(join(outDir, 'preload', 'host.cjs'), 'utf8')
    // 两条通知规则靠**不同的**触发方式：审批 = 节点出现（childList），
    // 消息 = 属性消失（attributeFilter）。少任何一项都会静默丢掉一半功能
    // ——「只把观察配置改了一半」的改动在单测里看不见（preload 无法单测），
    // 却能通过类型检查与构建，所以在这里按产物形态守一道。
    expect(host).toContain('childList')
    expect(host).toContain('attributeFilter')
    expect(host).toContain('observedAttributes')
    // 属性名由 selectors.ts 提供，最终必须出现在产物里（否则过滤会失效）。
    expect(host).toContain('data-streaming')
  })
})
