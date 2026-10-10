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

  it('托盘注册了双击事件，且接到「打开客户端」的动作上', async () => {
    requireBuilt()
    const main = await readFile(join(outDir, 'main', 'index.js'), 'utf8')
    // Windows 上 Electron **不给托盘图标任何默认点击行为**：不注册 'double-click'
    // 就是「双击毫无反应」。用户真机报过这个缺陷，而 tray.ts import 了 electron、
    // 单测跑不起来（与上一条同理），所以按产物形态守一道。
    expect(main).toContain('double-click')
    // 光有事件名不算数——必须真把动作接上去。中间允许任意空白（构建输出的缩进
    // 不是契约），但要求它紧跟在后面：隔得太远就说明挂的是别的东西。
    expect(main).toMatch(/double-click[\s\S]{0,80}?onOpen\(\)/)
  })

  it('主进程请求了单实例锁（否则重复点图标会开出多个实例与多个托盘）', async () => {
    requireBuilt()
    const main = await readFile(join(outDir, 'main', 'index.js'), 'utf8')
    // 用户真机反馈：多次点击桌面图标会打开多个实例、冒出多个托盘图标。
    // Electron **不会**自动做单实例——必须显式 `requestSingleInstanceLock()`，
    // 拿不到锁的那次要自行退出。这是启动路径上的代码，单测覆盖不到。
    expect(main).toContain('requestSingleInstanceLock')
    // 光退出还不够：已经在跑的那个实例必须响应后来者，把窗口唤起，
    // 否则用户双击图标会「什么都不发生」——比开出多个窗口更让人困惑。
    expect(main).toContain('second-instance')
  })

  it('主进程接线了自动更新（产物里必须有 autoUpdater）', async () => {
    requireBuilt()
    const main = await readFile(join(outDir, 'main', 'index.js'), 'utf8')
    // 用户要求「后台下好再问我要不要重启」。更新器 import 了 electron，
    // 单测覆盖不到，所以按产物形态守一道（与托盘双击、单实例锁同理）。
    expect(main).toContain('autoUpdater')
    // 只在打包版启用：开发模式下 electron-updater 会因缺 app-update.yml 报错。
    expect(main).toContain('isPackaged')
  })
})

/**
 * 打包配置与 CI 产物断言。
 *
 * 这两条读的是**源码配置**而非 out/ 产物，所以不需要 requireBuilt()：构建配置
 * 本身就是「更新链路有没有接通」的契约。背景是差分更新需要三样东西同时在
 * Release 里——latest.yml 告诉更新器「有没有新版」、.exe 是下载目标、
 * .blockmap 才能只下差异块。少任何一样，更新要么发现不了、要么退化成全量。
 *
 * 之所以能在单测里守住：打包配置是静态文件，而「配了但 CI 没上传」这类问题
 * 只有等真机更新失败时才会暴露，那时代价是用户装不上新版本。
 */
describe('差分更新产物', () => {
  it('打包配置声明了 GitHub publish（差分更新元数据的来源）', async () => {
    const config = await readFile(join(root, 'electron-builder.yml'), 'utf8')
    // 没有 publish 段，构建就不产出 latest.yml，更新器无从知道"有没有新版"。
    // owner / repo 按 electron-builder 的标准写法分成两行匹配（计划初稿里
    // 写成 `owner/repo` 合并式是笔误，YAML 里从来不是那个形状）。
    expect(config).toContain('publish:')
    expect(config).toContain('provider: github')
    expect(config).toContain('owner: steven-stack-s')
    expect(config).toContain('repo: dsh-remote-client')
  })

  it('CI 把 blockmap 与 latest.yml 一并上传（否则更新链路断在半路）', async () => {
    const ci = await readFile(join(root, '.github', 'workflows', 'build-windows.yml'), 'utf8')
    // 更新器要三样齐全：latest.yml 找版本、.exe 是目标、.blockmap 才能差分。
    expect(ci).toContain('*.blockmap')
    expect(ci).toContain('latest.yml')
    // 出现过两次：Artifacts 一次、Release 一次。少任何一处都会让对应通道失效。
    expect(ci.match(/latest\.yml/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('artifactName 不含空格（否则 latest.yml 指向的名字 404，自动更新必然失败）', async () => {
    const config = await readFile(join(root, 'electron-builder.yml'), 'utf8')

    // 这条断言守的是一个**真实发生过**的缺陷，不是假想：
    //
    // 曾用 `artifactName: ${productName}-${version}-setup.${ext}`，而 productName 是
    // `DSH Remote Client`（含空格）。于是同一个包在三个地方有三个名字：
    //   磁盘文件名      `DSH Remote Client-0.1.7-setup.exe`  （原样保留空格）
    //   latest.yml url  `DSH-Remote-Client-0.1.7-setup.exe`  （electron-builder 把空格换成连字符）
    //   GitHub 附件名   `DSH.Remote.Client-0.1.7-setup.exe`  （GitHub 上传时把空格换成点）
    // 更新器按 latest.yml 的名字去下载，Release 里只有点号那个 → **404**。
    //
    // 它躲过了 350 项测试与 typecheck：没有任何测试会真的去下载更新包，只有人工
    // 核对「latest.yml 里的 url 与 Release 附件名」才抓得到。所以这条断言直接把
    // 根因（配置里有空格）钉死在这里。
    const match = config.match(/^\s*artifactName:\s*(.+?)\s*$/m)
    expect(match, 'electron-builder.yml 里应当有 artifactName').not.toBeNull()
    // 用 ?? '' 兜底而不是 match![1]：非空断言只在表达式上生效，赋给变量后
    // 类型仍是 string | undefined。断言已在上方保证非 null，这里取不到值
    // 时下面的断言会失败并给出可读信息，不会静默放过。
    const artifactName = match?.[1] ?? ''

    // 展开成真实产物名的形态再判定：把 ${...} 宏当作不含空格的值替换掉，
    // 剩下的字面部分若含空格，就是会把三处名字撕裂的那个空格。
    const literal = artifactName.replace(/\$\{[^}]*\}/g, 'X')
    expect(literal, `artifactName 不能含空格（当前：${artifactName}）`).not.toMatch(/\s/)

    // 并明确要求它不要再依赖 ${productName}——那个宏的值带空格，一旦有人"优化"
    // 成 `${productName}` 就会把缺陷带回来。
    expect(artifactName).not.toContain('${productName}')
  })
})
