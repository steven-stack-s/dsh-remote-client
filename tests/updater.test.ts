import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `updater.ts` 的行为断言。
 *
 * 这个模块 import 了 electron 与 electron-updater，vitest 在 node 环境下**直接加载
 * 会挂起**（`require('electron')` 会触发下载 Electron 二进制）。所以这里用
 * `vi.mock` 把两者换成假的，就能在单测里真正驱动**本模块自己的**接线逻辑——
 * 这是产物断言（`build-artifacts.test.ts`）做不到的：那条只能证明「符号进了 bundle」，
 * 证明不了「接线是对的」。
 *
 * 覆盖的是评审发现的那几项，全都是只有运行时才暴露、产物断言看不见的：
 *
 * - `autoDownload` 必须被显式关掉（否则失败会走库那条无人 await 的分支，
 *   产生没有 `console.error` 的 unhandled rejection，违反「失败要留日志」）；
 * - `installUpdater` 幂等（`boot()` 可重入，重复注册会让一次事件触发多遍）；
 * - 同一版本并发只提示一次（重入占位）；
 * - `beforeInstall` 在 `quitAndInstall()` **之前**被调用（否则「立即重启」
 *   会被「关窗驻留」吞掉——详见 `updater.ts` 里那段说明）。
 *
 * 注意：纯决策逻辑（`shouldPromptForUpdate`）与状态持久化
 * （`readPromptedVersion` / `writePromptedVersion`）各有自己的测试文件，
 * 这里只守护「接线」。
 */

const { fake } = vi.hoisted(() => ({
  fake: {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    logger: 'default' as unknown,
    quitCalled: 0,
    handlers: {} as Record<string, Array<(...args: unknown[]) => void>>,
    on(event: string, handler: (...args: unknown[]) => void) {
      (fake.handlers[event] ||= []).push(handler)
      return fake
    },
    async checkForUpdates() { return {} },
    async downloadUpdate() { return [] },
    quitAndInstall() { fake.quitCalled++ },
  },
}))

vi.mock('electron', () => ({ app: { isPackaged: true, getPath: () => '/tmp/x' } }))
vi.mock('electron-updater', () => ({ autoUpdater: fake }))

/**
 * 取一份**全新的模块实例**。
 *
 * `installUpdater` 的幂等标志是模块级状态，复用同一实例会让第二个用例的调用变成
 * no-op——那本身正是 I2 生效的证据，但会让测试之间互相污染，所以每个用例都要
 * `resetModules()`。
 */
async function freshModule(): Promise<typeof import('../src/main/updater.js')> {
  vi.resetModules()
  fake.handlers = {}
  return await import('../src/main/updater.js')
}

/** 某个事件当前注册了几个监听器。 */
const handlerCount = (event: string): number => (fake.handlers[event] ?? []).length

/**
 * 触发 `update-downloaded`。
 *
 * 该事件的 handler 是 fire-and-forget（`void handleDownloaded(...)`），触发后
 * 异步链还在跑，因此必须把微任务/定时器队列排空再断言，否则会看到「什么都没发生」。
 *
 * @param version - 已下载完成的版本号。
 */
async function fireDownloaded(version: string): Promise<void> {
  const handlers = fake.handlers['update-downloaded'] ?? []
  await Promise.all(handlers.map(handler => handler({ version })))
  for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 5))
}

/**
 * 用一组回调装配更新器，返回它使用的状态目录。
 *
 * @param mod - {@link freshModule} 拿到的模块实例。
 * @param overrides - 覆盖默认的 `promptRestart` / `beforeInstall`。
 */
async function install(
  mod: typeof import('../src/main/updater.js'),
  overrides: Partial<{
    promptRestart: (version: string) => Promise<boolean>
    beforeInstall: () => void
  }> = {},
): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-updater-'))
  mod.installUpdater({
    isPackaged: true,
    dataDir,
    promptRestart: async () => false,
    beforeInstall: () => {},
    ...overrides,
  })
  return dataDir
}

describe('更新器接线', () => {
  beforeEach(() => {
    fake.autoDownload = true
    fake.autoInstallOnAppQuit = true
    fake.logger = 'default'
    fake.quitCalled = 0
  })

  it('关掉 autoDownload / autoInstallOnAppQuit 与自带日志器', async () => {
    const mod = await freshModule()
    await install(mod)

    // autoDownload 默认 true：不关掉的话，下载的启动者是库而不是我们，
    // 那条分支的 rejection 无人 await，失败不会有 console.error。
    expect(fake.autoDownload).toBe(false)
    // autoInstallOnAppQuit 默认 true：会在用户从托盘正常退出时顺手装更新，
    // 属于「不自动安装」约束要挡的静默重启。
    expect(fake.autoInstallOnAppQuit).toBe(false)
    // 关掉库自带日志器（setter 会把 null 换成 NoOpLogger），改用 console.error。
    expect(fake.logger).toBe(null)
  })

  it('installUpdater 幂等：重复调用不重复注册监听', async () => {
    const mod = await freshModule()
    const dataDir = await mkdtemp(join(tmpdir(), 'dsh-updater-'))
    const deps = {
      isPackaged: true,
      dataDir,
      promptRestart: async () => false,
      beforeInstall: () => {},
    }

    // boot() 可重入（macOS 的 activate 路径），会重复调用 installUpdater。
    mod.installUpdater(deps)
    mod.installUpdater(deps)
    mod.installUpdater(deps)

    expect(handlerCount('update-available')).toBe(1)
    expect(handlerCount('update-downloaded')).toBe(1)
    expect(handlerCount('error')).toBe(1)
  })

  it('只在打包版启用：isPackaged 为 false 时完全不碰 autoUpdater', async () => {
    const mod = await freshModule()
    mod.installUpdater({
      isPackaged: false,
      dataDir: await mkdtemp(join(tmpdir(), 'dsh-updater-')),
      promptRestart: async () => false,
      beforeInstall: () => {},
    })

    // 开发模式没有 app-update.yml，一旦碰 autoUpdater 就会走进错误路径。
    expect(fake.handlers).toEqual({})
    expect(fake.autoDownload).toBe(true)
  })

  it('同一版本并发下载完成时只弹一次对话框', async () => {
    const mod = await freshModule()
    let dialogs = 0
    await install(mod, {
      promptRestart: async () => {
        dialogs++
        // 让点：两条并发调用必须在「都读到未提示过」之前就完成占位。
        await new Promise(resolve => setTimeout(resolve, 40))
        return false
      },
    })

    await Promise.all([fireDownloaded('1.0.0'), fireDownloaded('1.0.0')])

    // 两个一模一样的对话框正是 spec §3.3 约束 4 要防的体验。
    expect(dialogs).toBe(1)
  })

  it('不同版本并发时各自走一遍（占位不能一刀切）', async () => {
    const mod = await freshModule()
    let dialogs = 0
    await install(mod, {
      promptRestart: async () => {
        dialogs++
        await new Promise(resolve => setTimeout(resolve, 10))
        return false
      },
    })

    await Promise.all([fireDownloaded('2.0.0'), fireDownloaded('2.0.1')])

    expect(dialogs).toBe(2)
  })

  it('点「立即重启」时 beforeInstall 先于 quitAndInstall', async () => {
    const mod = await freshModule()
    const order: string[] = []
    const original = fake.quitAndInstall
    fake.quitAndInstall = () => {
      order.push('quitAndInstall')
      original()
    }

    await install(mod, {
      promptRestart: async () => {
        order.push('promptRestart:true')
        return true
      },
      beforeInstall: () => { order.push('beforeInstall') },
    })

    await fireDownloaded('3.0.0')
    fake.quitAndInstall = original

    // 这个顺序就是全部意义所在：beforeInstall 让应用进入「正在退出」状态，
    // `quitAndInstall()` 随后关窗时 close 拦截才会放行。反过来就 100% 卡死。
    expect(order).toEqual(['promptRestart:true', 'beforeInstall', 'quitAndInstall'])
  })

  it('点「稍后」时不安装：不调用 beforeInstall，也不调用 quitAndInstall', async () => {
    const mod = await freshModule()
    const order: string[] = []
    await install(mod, {
      promptRestart: async () => {
        order.push('promptRestart:false')
        return false
      },
      beforeInstall: () => { order.push('beforeInstall') },
    })

    await fireDownloaded('4.0.0')

    expect(order).toEqual(['promptRestart:false'])
    expect(fake.quitCalled).toBe(0)
  })
})
