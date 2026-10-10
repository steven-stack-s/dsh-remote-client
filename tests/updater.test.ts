import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
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
 * - 重入占位既要**挡住并发**，又必须在流程结束后**释放**——只挡不释放会把同一
 *   版本永久锁死（B2：用户点过「稍后」后该版本再也不问）；
 * - `beforeInstall` 在 `quitAndInstall()` **之前**被调用（否则「立即重启」
 *   会被「关窗驻留」吞掉——详见 `updater.ts` 里那段说明）。
 *
 * ## `vi.mock` 的使用边界（**本项目首次出现，后来者请先读这一段**）
 *
 * 本项目的主线分层是「**能抽成纯逻辑的一律抽出来单测，只把与 electron 的耦合
 * 留在最外圈**」（见 spec §3.5，以及 `notifications.ts` / `backoff.ts` /
 * `lifecycle.ts` / `update-policy.ts` / `update-state.ts` 的做法）。
 *
 * 本文件用 `vi.mock` 是**不得已**，且仅限一种情形：
 *
 * > **模块顶层就 `import ... from 'electron'`，而依赖注入无法解决顶层 import。**
 *
 * `updater.ts` 正是如此——它顶层 `import { app } from 'electron'` 与
 * `import { autoUpdater } from 'electron-updater'`，没有任何接缝能绕过。
 *
 * ⚠️ **禁令：能被抽成纯函数的「决策」，一律抽到 `update-policy.ts` 那一类模块里测，
 * 不要用 `vi.mock` 在这里补。** 本文件只用来验证**接线**——事件监听、调用顺序、
 * 开关设置、幂等与重入——不用来验证决策。判据很简单：
 *
 * - 「该不该提示 / 该不该下载 / 文案怎么拼」→ 纯函数，去 `*-policy.ts` 测；
 * - 「谁在什么时候被调用、调用几次、以什么顺序」→ 接线，才轮到本文件的 `vi.mock`。
 *
 * 注意：纯决策逻辑（`shouldPromptForUpdate`）与状态持久化
 * （`readPromptedVersion` / `writePromptedVersion`）各有自己的测试文件，
 * 这里只守护「接线」。
 */

const { fake } = vi.hoisted(() => ({
  fake: {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    disableWebInstaller: false,
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

/**
 * 等日志文件出现、且内容满足条件；最多轮询约 1 秒。
 *
 * 写入是在队列里异步落盘的，所以断言前得等它出现。用轮询而不是固定 sleep：
 * 慢机器上固定等待会偶发失败，而这组用例本身要断言的就是「写进去了没有」。
 */
async function waitForLog(dir: string, predicate: (text: string) => boolean): Promise<string> {
  const file = join(dir, 'update.log')
  for (let i = 0; i < 50; i++) {
    if (existsSync(file)) {
      const text = await readFile(file, 'utf8')
      if (predicate(text)) return text
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  return existsSync(file) ? readFile(file, 'utf8') : ''
}

describe('更新器接线', () => {
  beforeEach(() => {
    fake.autoDownload = true
    fake.autoInstallOnAppQuit = true
    fake.disableWebInstaller = false
    fake.logger = 'default'
    fake.quitCalled = 0
  })

  it('关掉 autoDownload / autoInstallOnAppQuit，并把库日志接进落盘日志', async () => {
    const mod = await freshModule()
    const dataDir = await install(mod)

    // autoDownload 默认 true：不关掉的话，下载的启动者是库而不是我们，
    // 那条分支的 rejection 无人 await，失败不会有 console.error。
    expect(fake.autoDownload).toBe(false)
    // autoInstallOnAppQuit 默认 true：会在用户从托盘正常退出时顺手装更新，
    // 属于「不自动安装」约束要挡的静默重启。
    expect(fake.autoInstallOnAppQuit).toBe(false)

    // 我们不用 web 安装器。不显式关掉时库每次下载都会警告一句，实测会占掉
    // update.log 里有限的 200 行；而且库说未来版本会把默认值改成 true。
    expect(fake.disableWebInstaller).toBe(true)

    // 日志器**不是** null：库的默认实现往 stdout 刷（打包版看不到），但直接置 null
    // 会连「差分失败、回退全量下载」这条唯一线索一起丢掉——它只从库自己的 logger
    // 发出，没有公开事件暴露。所以换成一个写进 update.log 的适配器。
    //
    // `fake.logger` 声明成 `unknown`（它要能装下任意值），这里按库要求的形状收窄。
    const logger = fake.logger as {
      info: (message: string) => void
      warn: (message: string) => void
      error: (message: string) => void
    } | null
    expect(logger).not.toBeNull()
    expect(typeof logger?.info).toBe('function')
    expect(typeof logger?.warn).toBe('function')
    expect(typeof logger?.error).toBe('function')

    // 关键的一条：它真的把消息写进了我们的日志文件。
    logger?.error('Cannot download differentially, fallback to full download: boom')
    const text = await waitForLog(dataDir, t => t.includes('Cannot download differentially'))
    expect(text).toContain('Cannot download differentially')
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

  /**
   * I5-1：**顺序**(非并发)两次触发同一版本。
   *
   * 上面两条并发用例**无法区分**「占位正常释放」与「占位永久残留」——两种实现在
   * 并发场景下表现完全一致。B2 正是因此从全绿里漏了过去。这条才真正分开它们。
   *
   * 为了让归因钉死在**占位**上而不是状态文件上，第二次触发前先删掉
   * `update-state.json`：若占位已正确释放，就会重新走完整流程（重新询问、重新
   * 写盘）；若占位残留，则会在读盘之前就被挡回，且事后状态文件仍不存在。
   */
  it('顺序两次触发同一版本：占位释放后会重新询问（B2 回归）', async () => {
    const mod = await freshModule()
    let dialogs = 0
    const dataDir = await install(mod, {
      promptRestart: async () => {
        dialogs++
        return false // 用户点「稍后」
      },
    })
    const stateFile = join(dataDir, 'update-state.json')

    await fireDownloaded('1.0.0')
    expect(dialogs).toBe(1)
    expect(existsSync(stateFile)).toBe(true)

    // 删掉状态文件：排除「是状态文件在拦」这个归因，只留下占位这一个解释。
    await rm(stateFile, { force: true })

    await fireDownloaded('1.0.0')

    // 释放后重新走完整流程。永久残留的实现这里会停在 1。
    expect(dialogs).toBe(2)
    // 且确实走到了写盘（残留的实现根本到不了这一步）。
    expect(existsSync(stateFile)).toBe(true)
  })

  it('状态文件仍在时会挡住重复询问（「同一版本只提示一次」的正主是它）', async () => {
    const mod = await freshModule()
    let dialogs = 0
    await install(mod, {
      promptRestart: async () => {
        dialogs++
        return false
      },
    })

    // 两次都保留状态文件：第二次应由 shouldPromptForUpdate 判定为「已提示过」而跳过。
    await fireDownloaded('1.5.0')
    await fireDownloaded('1.5.0')

    expect(dialogs).toBe(1)
  })

  /**
   * I5-2：判定不通过那条 early return 也必须释放占位。
   *
   * 先让状态文件里记着「1.6.0 已提示过」，触发时 `shouldPromptForUpdate` 返回 false
   * 直接 `return`——这条路径最容易漏掉清理。随后删掉状态文件再触发：若那条
   * `return` 释放了占位，这次就该重新询问。
   */
  it('判定不通过（已提示过）提前返回时，占位同样被释放', async () => {
    const mod = await freshModule()
    let dialogs = 0
    const dataDir = await install(mod, {
      promptRestart: async () => {
        dialogs++
        return false
      },
    })
    const stateFile = join(dataDir, 'update-state.json')

    // 预置「已提示过 1.6.0」，让第一次触发走 early return。
    await writeFile(stateFile, '{"promptedVersion":"1.6.0"}\n', 'utf8')

    await fireDownloaded('1.6.0')
    expect(dialogs).toBe(0) // 已提示过，不弹

    // 抹掉记录：若 early return 没释放占位，这里仍会被挡在 has() 上。
    await rm(stateFile, { force: true })
    await fireDownloaded('1.6.0')

    expect(dialogs).toBe(1)
  })

  /**
   * I5-3：写状态失败时的行为（spec §3.3 约束 2 的核心路径）。
   *
   * 「先写状态、再弹框」——写盘失败绝不能中断更新：只记日志，**仍然询问**。
   * 让状态目录不可写即可制造失败（用只读目录更稳，这里用一个「路径被文件占住」
   * 的目录名，`mkdir` 会直接失败）。
   */
  it('写状态失败时：仍继续询问，且不因失败而放弃更新', async () => {
    const mod = await freshModule()
    let dialogs = 0

    // dataDir 指向一个**普通文件**：writePromptedVersion 里的 mkdir 必然失败。
    const blocked = join(await mkdtemp(join(tmpdir(), 'dsh-updater-')), 'not-a-dir')
    await writeFile(blocked, 'occupied', 'utf8')

    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args[0])
    })

    mod.installUpdater({
      isPackaged: true,
      dataDir: blocked,
      promptRestart: async () => {
        dialogs++
        return false
      },
      beforeInstall: () => {},
    })

    await fireDownloaded('1.7.0')
    spy.mockRestore()

    // 关键：写盘失败不该让用户失去这次询问。
    expect(dialogs).toBe(1)
    // 且失败必须留下日志（约束 2 是「静默」而非「无声」）。
    expect(errors.some(message => String(message).includes('更新状态写入失败'))).toBe(true)
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

  /**
   * 落盘日志：真机上唯一能自证的渠道。
   *
   * 打包版 Windows 没有控制台，`console.error` 用户看不到。加这条落盘日志正是为了
   * 让「更新在真机上什么都没发生」可区分——是**确实没有新版**，还是**静默失败了**。
   *
   * 写入是排队异步的，所以断言前要等文件出现内容；用轮询而不是固定 sleep，
   * 免得在慢机器上偶发失败。
   */
  describe('落盘日志（update.log）', () => {
    it('装配后写下启动记录（含当前版本）', async () => {
      const mod = await freshModule()
      const dataDir = await install(mod, { promptRestart: async () => false })

      const text = await waitForLog(dataDir, t => t.includes('更新器启动'))
      expect(text).toContain('更新器启动')
      expect(text).toMatch(/当前版本/)
    })

    it('用户点「稍后」后有对应记录——区别于「静默失败」', async () => {
      const mod = await freshModule()
      const dataDir = await install(mod, { promptRestart: async () => false })

      await fireDownloaded('5.0.0')

      const text = await waitForLog(dataDir, t => t.includes('稍后'))
      expect(text).toContain('稍后')
      expect(text).toContain('5.0.0')
    })

    it('因「已提示过」而跳过时有记录——说明这是设计，不是坏了', async () => {
      const mod = await freshModule()
      const dataDir = await install(mod, { promptRestart: async () => false })

      // 第一次：正常走完并写入状态。
      await fireDownloaded('6.0.0')
      await waitForLog(dataDir, t => t.includes('6.0.0'))

      // 第二次同版本：被 shouldPromptForUpdate 挡下。
      await fireDownloaded('6.0.0')

      const text = await waitForLog(dataDir, t => t.includes('已经提示过'))
      expect(text).toContain('已经提示过')
    })

    it('点「立即重启」的记录会先落盘，再执行安装', async () => {
      const mod = await freshModule()
      // 在安装动作发生时同步读日志：此刻那条记录必须已经在文件里，
      // 否则真机日志会恰好缺掉「用户确实点了重启」这一环。
      let textAtInstall = ''
      let dir = ''
      const original = fake.quitAndInstall
      const mod2 = mod
      dir = await install(mod2, {
        promptRestart: async () => true,
        beforeInstall: () => {},
      })
      fake.quitAndInstall = () => {
        textAtInstall = existsSync(join(dir, 'update.log'))
          ? readFileSync(join(dir, 'update.log'), 'utf8')
          : ''
        original()
      }

      await fireDownloaded('7.0.0')
      fake.quitAndInstall = original

      expect(textAtInstall).toContain('立即重启')
    })
  })
})
