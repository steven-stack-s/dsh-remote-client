# 更新日志 (Changelog)

`dsh-remote-client` 的版本记录。本文件按版本整理**用户可感知的变化**，逐条给出「改了什么」与「为什么改」（缺陷修复一律附带根因）。完整的逐提交历史见 `git log` 与 GitHub Releases 页面。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> **发布方式**：推送 `v*` tag 触发 GitHub Actions 在 `windows-latest` 上构建并发布 Release（见 `.github/workflows/build-windows.yml`）。推 `main` 只产出 Artifacts、不创建 Release。版本号的唯一来源是 `package.json`。
>
> **`### Highlights` 小节会被抽成 GitHub Release 正文**（脚本 `scripts/extract-highlights.mjs`，由 workflow 调用）。因此每个**已发布**版本都必须有一个 `### Highlights`，只写**面向用户、无需读代码就能懂**的改动要点：
>
> - 写「用户看到什么变了」，不写根因、函数名、测试数、CI 过程——那些留在 `### Fixed` / `### Notes` 里。
> - 一两句话为宜，用列表；指向安装包的读者只看得到这一节。
> - 缺失时脚本会回退为通用文案并**在构建日志里报警**（不失败），但那样 Release 就退化成没有版本信息的通用页，属应避免的状态。

## [Unreleased]

### Fixed

- **修掉更新器并发用例的时序 flaky**（dd199b9，仅测试文件）。
  发 0.2.5 时 tag 构建在「类型检查与测试」步骤失败：`tests/updater.test.ts` 的「不同版本并发时各自走一遍」报 `expected 1 to be 2`，而同一 commit 的 `main` 构建与本地均全绿，属典型时序 flaky。
  - **根因**：该用例结尾用**固定次数**的 `setTimeout`（20×5ms = 100ms）排空异步链，而那条链包含 `readPromptedVersion` 的文件读取、`promptRestart` 里的 10ms 延时与 `writePromptedVersion` 的落盘——CI 的 Windows runner 上 100ms 偶尔不够，断言在链路走完之前就读到了 `dialogs === 1`。
  - **修法**：新增 `waitFor(predicate)` 条件轮询（上限约 2 秒），用例改为 `await waitFor(() => dialogs >= 2)` 之后再断言；条件成立立即返回，真出 bug 时由超时后的断言报错。
  - **变异验证**：把 `handleDownloaded` 的占位判定改成 `prompting.size > 0`（即「一刀切」）后该用例仍然失败（2145ms 超时），证明它没有把真 bug 一起吞掉；还原后 457 项测试全绿。
  - 对用户不可见，不改动任何运行时行为。重打 tag 后 0.2.5 正常发布。

## [0.2.5] - 2026-10-13

按需求**重做「开新窗口」**，不再修补历史缺陷。

### Highlights

- **打开主机的方式现在由你在菜单里选**：托盘/菜单的主机列表里，每台主机有两个动作——「打开」在本窗口内替换打开，「新窗口打开」另开一个窗口并保留当前窗口。
- **门户（NAS）里点 dsh 快捷方式，恒定在本窗口内打开**，不再出现「点了一下窗口没反应」。
- **删掉了设置里的「跨主机跳转时开新窗口」开关**。它想用一个全局开关表达「这一次想怎样」，做不到；现在改由菜单每次显式选择，不再需要猜。
- 升级后**原有设置不受影响**，无需迁移。

### Changed

- **门户（NAS）里点 dsh 快捷方式，恒定在本窗口内打开**，不再新开窗口。
- **托盘/菜单的主机列表里，每台主机拆成两个动作**：
  - **「打开」** = 在本窗口内打开（替换当前窗口）；
  - **「新窗口打开」** = 另开一个窗口，保留当前窗口。
  - 两者是同一意图的两种归宿，因此在菜单里**成对出现**。
- **点「打开」时会先回到那台主机**：若该窗口的页面已被门户 302 带走（停在门户桌面），会先 `reload()` 再唤起——用户点「打开」的意图是回到那台主机，而不是被唤到一个显示门户的窗口。

### Removed

- **删除设置里的「跨主机跳转时开新窗口」**（`openInNewWindow`）。它试图用一个全局值回答「这一次想怎样」，回答不了；更要命的是它同时被页面链接判定消费，于是反复出现「开着时窗口被唤起却不导航」「判定层加例外又把开关架空」这类拉扯（0.2.3 → 0.2.4 两版都没收敛）。把选择权交给**菜单项**之后，由用户每次显式给出，不再需要猜。
  - 旧设置文件里该字段被**忽略**，同文件其它字段不受影响（无需迁移）。

### Notes

- 验证：重写受影响用例并做**变异验证**——变异「已配置主机不再 `navigate-self`」→ 9 个用例失败；变异「菜单里去掉新窗口打开」→ 5 个用例失败；还原后全绿。`tsc --noEmit` 通过，`vitest run` 457 tests / 26 files 全绿，`electron-vite build` 成功。
- ⚠️ 该版本 tag 曾因一条测试 flaky 导致构建失败，重打 tag 后才发布成功（修复见 [Unreleased]）。
- 测试数从 460 降到 457 是因为**删掉了被移除功能的用例**，不是回归。
- 全区间无破坏性变更，但本版**删除了一个设置项**并新增两个菜单动作，属用户可见的界面/行为变更。

## [0.2.4] - 2026-10-13

### Fixed

- **让「跨主机跳转时开新窗口」开关在门户场景真正生效**（同时是对 0.2.3 的自我回退）。
  - 上一版（0.2.3）方向错了：它在判定层加了「目标 === 本窗口所属主机 → 替换当前窗口」，把结果**恒定**成当前窗口——等于把开关架空，开与关没有区别。
  - **真正的根因**：`openHost()` 把「页面已被门户 302 带走的窗口」仍当成「该主机已开着的窗口」，于是直接 `show()` 唤起那个正显示门户的窗口并 `return`，开新窗口这条路径**永远走不到新建分支**。
  - **修法**：① 回退判定层那条例外，把判断权还给开关；② 在 `openHost()` 里让位——新增纯函数 `shouldOpenNewHostWindow()`，当「该主机的窗口已存在**但页面不在该主机的 origin 上**」且调用方要求开新窗口时，把它从注册表摘掉，由新建流程接管（「同一 host 至多一个窗口」不变量仍成立）；③ `HostWindowHandle` 新增 `isOnHostOrigin()`。
  - **结果**：开关**关** → 当前窗口直接进入 dsh；开关**开** → 停在门户的旧窗口让位，**新开一个**进 dsh。
  - 验证按 TDD 落地：先写 3 条 `shouldOpenNewHostWindow` 断言并确认失败后才实现，同时删掉上一版那 6 条把开关架空的断言。460 tests / 26 files 全绿。

### Notes

- ⚠️ 本版与 0.2.3 是对同一功能（门户场景「开新窗口」）的**两次不成功尝试**，0.2.5 才按需求重做并删除该设置项。三版应串起来读。

## [0.2.3] - 2026-10-12

### Fixed

- **修掉门户（绿联 UGOS）里点 dsh 图标打不开的问题**（真机缺陷，0.2.x 复现、回退到 0.1.10 正常）。
  - **现象**：窗口进去后被 302 到门户自己的域、停在门户桌面（UGOS 登录后**不回跳**）；此时点门户里的 dsh 图标，窗口纹丝不动，控制台报 `Uncaught (in promise) Error: link type not supported`。把「跨主机跳转时开新窗口」**关掉**就正常。
  - **根因**：`windowOpenDecision` 只问「页面**现在**停在哪」（`currentOrigin`），没问「这个窗口**名义上**属于哪台主机」。门户场景下两者分叉（`currentOrigin` = 门户域，`target` = 那台 dsh 主机的 origin），于是落进「跨主机」判定：开关开 → 走开新窗口路径 → `openHost()` 发现该主机已有窗口（就是当前这个）→ 只 `show()` 不导航 → 窗口不动；同时我们 `deny` 了 `window.open`，门户的 CloudWindow 桥拿不到窗口 → 报上述错误。这也解释了版本差异：0.1.10 没有这个开关，恒定走 `navigate-self`，所以一直好用。
  - **修法**：给 `windowOpenDecision` 增加可选输入 `windowHostOrigin`（本窗口承载的主机 origin），新增判定「**目标 === 本窗口所属主机 → `navigate-self`**」，且**先于**跨主机判定。两条判据互补：`currentOrigin` 管「站内跳转」，`windowHostOrigin` 管「这台主机自己的窗口」；真跨主机（A → B）仍按设置开新窗口。省略该参数时行为与改动前完全一致（有测试钉住，证明这是纯增量条件）。
  - 按 TDD 落地：先写 5 条断言并确认全部失败后才实现。463 tests / 26 files 全绿。

- **「手动检查更新」显示错版本**——升级弹窗说 0.2.2 已下载完成，同一页却写「发现新版本 0.2.1」。
  - **根因**：`checkNow()` 只返回结局字符串，版本号由 IPC handler 用 `app.getVersion()`（**当前运行的**版本）补上，而界面文案是「发现新版本 X」。
  - **修法**：让**知道它的一方**提供——`checkNow()` 改为返回 `{ outcome, version }`，version 取自库的 `updateInfo.version`，handler 只透传。库没给出版本号时界面显示「未知」——**编造一个版本号比显示未知糟得多**，用户会照着它去找一个不存在的安装包。
  - 按 TDD 落地：先写 4 条断言并确认失败后才实现，原有 15 条测试保持通过。

- **设置页最上面那行「弹出系统通知」看不到**（顶部不可达）。
  - **根因**：`body { height: 100vh; display: grid; place-content: center }`——表单比视口高时，grid track 被「居中」到容器外，**上半部分落到负坐标**，而滚动区域从 0 开始，那一截内容用滚动条**够不到**（经典居中溢出陷阱）。截图里最顶部是「消息通知的静默期」而非「客户端设置」标题，正是该现象。
  - **修法**：`height` → `min-height`。内容超出时 body 随内容增高，顶部始终可达；内容不足一屏时仍保持垂直居中。
  - 顺带统一界面侧的版本号兜底规则（空值 →「未知」），与主进程 `updateVersionText()` 语义对齐——两处各写一份文案是既有设计（设置页是 `file://` 页面、import 不了主进程模块），但**兜底规则必须一致**。

### Notes

- 457 tests 全绿（`78cb45c`）；463 tests / 26 files 全绿（`8d4772d`）。
- ⚠️ 本版对门户「开新窗口」的修法在 0.2.4 被判定方向错误并回退——请勿据此认为该修法仍有效。

## [0.2.2] - 2026-10-12

### Documentation

- 把「无边框导致 DevTools 弹独立窗口」记为**已知约束**（真机判定实验结论，非缺陷）。
  - 实验结论（同一份代码、同一个 mode）：

    | 窗口 | 边框 | Ctrl+Shift+I |
    |---|---|---|
    | 客户端设置（有边框） | 有 | **内嵌** |
    | 主机窗口（Windows） | 无 | **独立窗口** |

  - 因此这是**窗口形态**的约束（无边框无法停靠 DevTools），**与 mode 参数无关**。主机窗口的无边框是为了「顶部跟随应用主题」，用户已明确选择**保留自绘顶部、接受 DevTools 独立**。
  - 本提交只写结论与注释、**不改任何行为**，并明确标注「不要试图去修」——唯一能让主机窗口内嵌的办法是去掉无边框，而那会牺牲用户要保留的主题跟随。
  - 补 3 条测试把结论钉住：用 `usesCustomTitlebar` 作为「是否无边框」的唯一判据，防止后来者为了「修」DevTools 而改掉窗口方案。
  - 修正 README（中英）里「DevTools 一律在窗口内打开」这句**已不准确**的描述，并在「已知限制」里如实记录。

### Notes

- 本版发布提交仅提升版本号，**无功能代码改动**；唯一实质提交是上述文档/注释提交。此条是 0.2.1 中 DevTools 悬案的结案。

## [0.2.1] - 2026-10-12

回应 **0.2.0 的四项真机反馈**。

### Added

- **设置 → 更新：显示当前版本号，并新增「立即检查更新」按钮**。
  - 新增 IPC `shell:settings:version`（版本号取自 `app.getVersion()`）与 `shell:settings:checkUpdate`。
  - `installUpdater` 由返回 void 改为返回 `UpdaterHandle`，且**幂等分支也返回句柄**——否则第二次调用会把可用状态误报成「未启用」。
  - 未打包时句柄为 undefined，界面据此**禁用按钮并说明原因**，而不是给一个点了没反应的按钮。
  - 文案生成抽到纯函数 `updateVersionText()` / `updateCheckMessage()`（有单测），其中失败分支刻意不拼版本号（否则会得到「发现新版本  可用」这种残缺文案）。

### Fixed

- **托盘/菜单的主机列表切换主机时不遵守「跨主机开新窗口」设置**（勾与不勾都是开新窗口）。
  - **根因**：`openInNewWindow` 此前只接在「页面里跨主机跳转」上，而用户实际用得最多的入口是**托盘的「主机列表」**——那条路径直接调 `openHost()`，根本没读这个设置。
  - **修法**：新增纯函数 `hostOpenEffect()`（`window-registry.ts`，有单测）判定 focus / keep-open / replace 三态，并新增 `openHostFromMenu()` 应用它，托盘的 `openHost` 回调改走这条路径。「目标主机已开着时一律只唤起」的不变量保留。

- **壳页面改为白底**：settings / edit / welcome / offline 四页原为深色（`#151517`）。改背景的同时把整套配色（文字、边框、次要按钮、警示框、成功/失败色）都换成浅色可读的值——只改背景会得到白底白字。`color-scheme` 一并改为 light。

### Notes

- **DevTools 仍以独立窗口打开（部分修复，当时尚未定论）**：代码与产物本就正确（`openDevTools({ mode: 'right' })`，`toggleDevTools` 已移除），真机现象另有原因。本版只做两件事：补测试钉住「mode 必须是停靠类（left/right/bottom），不得是 detach/undocked」防回归；确认 `webPreferences.devTools` 默认 true 不是禁用所致。当时怀疑与主机窗口在 Windows 上 frameless 有关，留待真机判定实验——结论见 0.2.2。
- 450 项测试 + typecheck 全绿。`0be2d9d` stat = 12 files changed, +494 / −47。

## [0.2.0] - 2026-10-12

一次性交付三项改动，其中第三项是重构，因此按语义化版本升 **minor**。

### Added

- **客户端设置窗口**（托盘「客户端设置」/ 菜单栏「设置…」/ `Ctrl+,`）：通知开关、消息静默期（15s–5min）、启动行为、关窗是否收进托盘、跨主机跳转是否开新窗口、是否检查更新。
  - 改完**立刻生效**（宿主行为读当前值而非启动快照），无需重启。
  - 设置存 `%APPDATA%\dsh-remote-client\settings.json`；文件损坏时先备份成 `settings.json.corrupt-<时间戳>` 再回退默认值，**不会静默丢弃**。
  - `Ctrl+,` 在 application menu 之外**还注册了一份窗口内快捷键**——Windows 上无边框窗口不显示菜单栏，只注册菜单栏会按了没反应。
  - 六项偏好的默认值**全部等于改动前的硬编码行为**，装了不会感觉行为变了。

### Changed

- **DevTools 改为窗口内嵌打开**（`mode: 'right'`），不再弹独立窗口。
  - ⚠️ 后续真机判定实验表明，Windows 上**无边框的主机窗口**仍会弹独立窗口（窗口形态约束，见 0.2.2）。
- **多主机并行 + 跨主机跳转开新窗口**：主机窗口从「同一时刻只有一台」改为**按 host id 索引的注册表**（原先 `currentWindow` / `currentHostId` 两个标量被 46 处引用），每台主机可同时打开（各自一个窗口）。
  - 每台主机**至多一个窗口**（同一台重复打开只唤起既有窗口），否则同一个 origin 会并存两份 WebSocket 连到同一台 dsh。
  - 「当前主机」退化为「**最后聚焦**的那一台」（菜单 ● 标记、托盘「重新加载」以它为目标）——这是一个**有意的降级**，多窗口下本就没有唯一的「当前」。
  - 三类 sender 校验（`shell:network` / `shell:theme` / `shell:notify`）此前只认**单个** webContents id，多窗口下第二个窗口的所有上报（网络恢复、主题、通知）会被**静默丢弃**——不报错、不提示，只是「功能在另一台主机上不工作」。已放宽为按发送方解析。
  - 通知必须用**发送方那一台**的主机名与唤起目标，取「当前主机」会让 B 窗口的通知显示 A 的名字、点了跳到 A。
  - 跨主机跳转默认仍替换当前窗口，可在设置里改为开新窗口；**站内跳转（同 origin 内部，如切换会话）不受影响**，永远留在原窗口——否则点任何一个会话都会弹新窗口。
- **为什么是 minor 而不是 patch**：C 端行为有变（默认值都保持旧行为，但多窗口是新的能力边界），且内部模型换了。

### Compatibility

- 所有设置项的**默认值都等于升级前的硬编码行为**，装了不会感觉行为变了。
- **旧配置无需迁移**：缺字段按默认值补齐（`settings.json` 首次运行自动生成）。

### Fixed

（本版 tag 推送后发布构建失败，两次修复如下；均为测试基础设施修复，对用户不可见。）

- **路径断言未做平台中立，导致 0.2.0 发布构建失败**（`c85a15a`）。
  - **现象**：v0.2.0 的 tag 推上去后，`windows-latest` 的「类型检查与测试」步骤 **7 秒即失败，Release 没有产出任何安装包**；而本地 436 项测试 + typecheck 全绿——因为本机是 Linux。
  - **根因**：`tests/settings-store.test.ts` 写了字面量 POSIX 路径断言 `expect(settingsFilePath('/tmp/x')).toBe('/tmp/x/settings.json')`，而 `settingsFilePath` 内部用 `node:path` 的 `join`，在 Windows 上产出 `\tmp\x\settings.json`；两者在 Linux 上恰好相等，所以本地**永远复现不了**。
  - **修法**：期望值改用 `join()` 拼（既有 `tests/hosts-io.test.ts` 一直这么做，是没跟住这个惯例）。同时补一条**源码级**守卫（该缺陷在 Linux 上恒真，本地唯一能拦住的办法是检查断言的写法本身），已用变异测试验证。第一版守卫直接对全文做正则、结果匹配到自己的注释，已改为只扫 `expect` 开头的行。
- **修掉守卫自身踩的同一个坑**（`b35ac52`）。
  - 第二版守卫里用 `expect(join(...)).toBe('/tmp/x/settings.json')` 当「平台差异」的证据，但 `join` 本身就是平台相关的——Windows 上它产出 `\\tmp\\x\\settings.json`，于是这条守卫自己变成了新的盲区（CI 报错原文即此）。
  - **修法**：改为只比较两个**显式指定**的平台（posix 字面量 vs `win32.join`），不再引用本机 `join`；并在 linux 与 win32 两种 join 下模拟验证三条断言都成立。同时把源码级守卫从「只认 `settingsFilePath(...)`」扩到「也认 `join(...)`」——第二类正是第二次踩的坑，已用变异测试确认两类都会被拦。

### Notes

- 433 项测试 + typecheck 全绿（含 `tests/build-artifacts.test.ts` 的产物断言）。
- ⚠️ 发布时**多窗口的真实交互尚未真机验证**，三件事只能在真机上确认：两台主机同时连时的通知归属；多窗口下 `nativeTheme`（进程级单例）在两个窗口皮肤不同时会互相覆盖；全部窗口关闭时的退出判定。
- **产物事故（内部史实）**：`settings.html` / `settings.cjs` 曾漏登 `electron.vite.config.ts` 的显式入口列表（该配置用显式列表而非 glob，构建会安静跳过未登记项），导致「402 项测试全绿 + typecheck 退出码 0，而这两个产物根本没被构建出来」。产物断言从「七个」改为「九个」，并新增守根因的「每个 renderer 页面与 preload 都登记进了构建入口」断言。
- ⚠️ **关于本版 tag 的边界**：`c85a15a` 与 `b35ac52` 两个测试提交在 tag 上可见——`v0.2.0` 是**轻量标签**，实际指向 `b35ac52` 而非发布提交 `7fd2afe`（tag 被打到了两个测试修复之后）。若以**发布提交 `7fd2afe` 为边界**（即发布语义上的 0.2.0），这两个提交首见于 0.2.1。

## [0.1.10] - 2026-10-10

### Changed

- **差分更新的实测数字**：0.1.9 → 0.1.10 的真机日志给出确定答案——`[库] Full: 108,821.46 KB, To download: 1,291.07 KB (1%)`。完整包 **106.3MB，实际只下了 1.26MB（约 1%）**。README（中英）补上该数字与诊断日志的位置；原文只承诺「只下载变化的部分」，现在有实测支撑。

### Fixed

- **关掉 web 安装器警告**：真机日志里出现库自己的建议 `disableWebInstaller is set to false, you should set it to true if you do not plan on using a web installer`。我们构建的是普通 nsis 目标，Release 里从来没有 web 安装器；不显式关掉的话这行警告每次下载都会出现，会占掉 `update.log` 里本就有限的 200 行，而且库明说未来会把默认值翻成 `true`。显式置位既让日志干净，也避免将来默认值翻转时行为突变——万一真改用 web 安装器，它会以 `ERR_UPDATER_WEB_INSTALLER_DISABLED` 明确报错，而不是悄悄走错分支。已加断言守住，并**变异验证**：改成 `false` 后恰好只有对应断言变红、其余 14 条仍绿。

### Notes

- ⚠️ 本版**没有任何代码改动**（`git diff v0.1.9..v0.1.10` 仅 `package.json` 1 行），唯一目的是作为更新目标，让 0.1.9 的客户端去下载它，从而验证差分到底省不省流量。
  - 技术前提：差分下载的「旧文件」基线由安装器自己复制到更新器缓存（`app-builder-lib/templates/nsis/include/installer.nsh`），所以**手动安装也会留下基线**。
- 376 项测试全绿；tsc 无输出；构建成功。

## [0.1.9] - 2026-10-10

### Fixed

- **把库的内部日志接进 `update.log`——不再丢掉「差分失败」这条线索**。
  - **问题**：`autoUpdater.logger = null` 当初是为了不让库往 stdout 刷屏，但置 null 会连带丢掉库内部**唯一**报告 `Cannot download differentially, fallback to full download: …` 的渠道——它只从 `AppUpdater.differentialDownloadInstaller` 的 catch 里发出，**没有任何公开事件或返回值暴露给调用方**（该方法对调用方只返回一个布尔：成功 false、回退 true）。于是用户完全无从知道「这次更新为什么下了 106MB 而不是几 MB」——而这恰恰是差分更新唯一要回答的问题。
  - **改法**：换成写进落盘日志的适配器 `{ info, warn, error }`；`debug` **刻意不接**（逐块级细节会把 200 行上限冲掉、反而埋掉关键行）。日志前缀 `[库]` / `[库·警告]` / `[库·错误]`。
  - **验证**：既有断言原本编码的是「logger === null」（把实现细节当契约），已改写为断言真正意图（logger 非 null、具备三方法、且真的把消息写进 `update.log`，喂一条差分回退消息再断言出现在文件里）；**变异验证**：改回 `null` 后恰好只有该条断言变红、其余 14 条仍绿。

### Notes

- 376 项测试全绿；tsc 无输出；构建成功。无新功能。
- 历史参考数据：0.1.7 → 0.1.8 耗时 6502 ms、0.1.8 → 0.1.9 耗时 5861 ms，两次基线都齐全；本版起不再需要靠耗时推算是否走了差分。

## [0.1.8] - 2026-10-10

### Fixed

- **日志补上「检查完成：当前已是最新版本」**。
  - **问题**：用户真机日志暴露歧义——一次**成功**的检查如果没发现新版本，日志里只留下「开始检查更新」一行就断了，读者无法区分两种情形：a) 检查成功、确实没新版（正常）；b) 进程在检查途中没了／结果被丢弃（异常）。
  - **修法**：三种结局各有明确一行——有新版本 → `发现新版本 x.y.z，开始后台下载`；没有新版 → `检查完成：当前已是最新版本`；失败 → `检查更新失败（已忽略，不影响使用）：…`。
  - 该行在 **0.1.7 上不生效**（用户当时装的是上一版）。

### Notes

- 本版无用户可见的新功能，纯粹是让上一步的日志改动到达用户机器，并**充当差分更新的验证目标**（见 0.1.10）。
- 376 项测试全绿；tsc 无输出。
- 更新源是 GitHub：electron-updater 的 GitHub provider **只走 github.com**（强制先取 releases.atom，没有 api.github.com 回退），实测系统代理生效时可行。

## [0.1.7] - 2026-10-10

**差分更新的客户端半边。**

### Added

- **自动更新（差分）**：集成 `electron-updater`，启动约 30 秒后**后台**检查新版本（6 小时兜底复查），只下载变化的部分（不再重下 106MB），下载完成后弹一次询问——「立即重启」才安装，「稍后」不打扰。全程静默：网络不通或更新源异常时只留日志，**绝不弹错误框**。
  - 四条硬性约束：只在打包版启用、任何失败都静默只留日志绝不弹框、不自动安装、同一版本只提示一次。
  - 弹框默认按钮与 Esc 都是「稍后」（与「删除主机」同一考虑：误按回车绝不能重启应用）。
  - **同一版本只提示一次**：依据是跨进程持久化的 `update-state.json`，而不是只活在本次进程内的状态。读路径**一律不抛**（文件不存在/坏 JSON/类型不对 → `undefined`，语义等于「没提示过」）；写路径**如实抛错**，由调用方决定吞不吞。
  - 显式 `autoUpdater.autoInstallOnAppQuit = false`——它默认 true，会在**用户从托盘退出应用时**顺手装上更新，必须关掉。
  - 定时器都 `.unref()`，不让待触发的定时器吊住进程退出。
  - 装配放在 `boot()` 的 `finally` 里，且**在 try/catch 之外也照做**：启动任何一步失败都不该让用户失去更新能力，启动就出问题的人最需要能升到修复版。
- **更新器落盘日志** `%APPDATA%\dsh-remote-client\update.log`（最多保留 200 行）。
  - **为什么需要**：`updater.ts` 把 `autoUpdater.logger` 设为 `null`（它默认往 stdout 刷进度，打包版是噪音），此后所有诊断只走 `console.error`，而**打包版 Windows 没有控制台**，用户看不到任何输出。两个具体后果：**验收做不了**（验证指南当时写「用命令行启动 exe 或开 DevTools 看 Console」，对最终用户基本不可行）；**排障没有线索**（定位通知「有时不弹」时，正是靠临时加的 `userData/notify-trace.log` 才查出根因）。
  - 记录点覆盖：更新器启动（含当前版本）、开始检查、发现新版本、下载完成、因「已提示过」而跳过、用户选「立即重启」/「稍后」，以及各类失败。其中**「因已提示过而跳过」尤其重要**：它把「确实没有新版」与「静默失败了」分开——用户报「有新版本却没提示」时，这行能说明是设计如此，不是坏了。
  - **上限口径**用**行数**而非字节：每条记录先压成单行并截断到 400 字符（错误消息常自带换行，不压平的话一条就能把「行数上限」撑破），于是「保留最近 200 行」等价于大小有界（上界约 80KB）。行数口径比字节口径更容易推理与测试，不必考虑多字节字符的字节长度。写入用整文件重写而非追加：文件很小，换来的是截断变得平凡、也不会留下半行。
- 构建侧：声明 GitHub publish 并在 CI 上传 `.blockmap` 与 `latest.yml`（更新器需要这两样才能工作）。CI 的 electron-builder 必须继续带 `--publish never`，否则会自己推 Release 与 action-gh-release 打架。
- ⚠️ **本功能需要客户端自身是 0.1.7 或更新**。0.1.6 及更早的版本里没有更新器，只能手动下载安装包升级——**这是最后一次需要手动装的 106MB**。

### Fixed

（0.1.7 的功能在发布前后经历了一轮密集评审与真机修复，逐条如下。）

- **「立即重启」会被「关窗驻留」吞掉**——表现为「点了立即重启，窗口消失了但版本没变」。
  - **根因**：由 `quitAndInstall()` 发起的退出，Electron 的 `before-quit` 是在**所有窗口 close 之后**才 emit 的（与普通 `app.quit()` 的顺序相反；已核对 electron-updater 6.8.9 源码，其 `quitAndInstall()` 最终就是裸 `app.quit()`）。而主机窗口的 close 被拦截为「隐藏到托盘」，只有 `quitting === true` 才放行；等到 `before-quit` 才置位已经太晚，`preventDefault()` 会让 Electron 取消整个退出流程。
  - **影响**：**必然发生、不是偶发**，应用会变成还活着的幽灵进程。
  - **修法**：在用户确认后、调用 `quitAndInstall()` **之前**置位。文档明确标注这不是「注册顺序」问题——那是个问错了的问题。
- **最终评审发现的一组缺陷**：
  - **B1**：补上 `autoUpdater.autoDownload = false`。库默认 `true`，此前注释承诺的「下载由我们发起、失败由我们记日志」并不成立，而是靠时序巧合——库那条分支的 rejection 无人 await，失败会产生**不经 `console.error`** 的 unhandled rejection，违反「任何失败都静默且留日志」。
  - **I2**：`installUpdater` 加模块级幂等守卫。`boot()` 在 macOS `activate` 路径上可重入，此前会重复注册监听与定时器。
  - **I3**：并发下会弹出两个相同对话框 → 加占位去重（不同版本仍各自走一遍）。
  - **I4**：`writePromptedVersion` 改为**临时文件 + rename 原子写**（临时文件与目标同目录、带 pid+uuid，失败时尽力清理）。
  - **M7**：`UpdaterDeps` 新增**必填** `beforeInstall` 回调。「返回 true 时必须已置位 quitting」原是类型上表达不出的隐式契约，改后漏掉会直接编译失败。
- **`prompting` 占位只加不删，把同一版本永久锁死**（B2）。
  - 上一步修 I3 时加的 `prompting` Set 从不 `delete`，占位与进程同寿：用户点过「稍后」之后，同一版本在本次进程剩余的全部生命周期内**再也不会被询问**——常驻托盘时即「更新永远装不上」。这比原 I3（可能弹两个框）严重得多：原问题是「问多了」，这个是「该问却永远不问」。
  - **修法**：`handleDownloaded` 用 `try/finally` 收口，`prompting.delete(version)` 放进 `finally`，保证判定不通过、用户点稍后、安装完成、以及任何抛出这四条路径都清理。而「每个版本号只提示一次」的正主仍是跨进程的 `update-state.json`，Set 只负责进程内并发去重。
  - 同时补 4 条 I5 测试——现有两条并发用例**无法区分**「占位正常释放」与「永久残留」，B2 正是因此从 345 项全绿里漏过。验证：临时移除 `finally` 后，恰好这 2 条新用例失败、其余 9 条全绿，精确复现 B2 的漏网原因。
- **并发写状态文件在 Windows 上抛 `EPERM`**（CI 阻塞项）。
  - **现象**：CI（`windows-latest`）在 20 路并发写用例上抛 `EPERM: operation not permitted, rename update-state.json.*.tmp -> update-state.json`。
  - **根因**：**并发 rename 同一目标**——Windows 把目标文件当独占资源，后到的 rename 直接被拒；POSIX 允许静默覆盖，所以 Linux 上 20 路并发零失败、本地完全测不出来。⚠️ **这个缺陷正是被「本地全绿」骗过去的。**
  - **修法**：模块级 promise 链（`writeQueue`）把同一进程内所有写入**严格串行**，任意时刻至多一次 rename 在途（不需要重试与退避，也不改「临时文件 + rename」的原子性）。队列的两个细节各配了一条可反证的测试：队尾节点吸收 rejection（否则**一次失败会让之后所有写入永久失败**，而调用方会吞掉写入错误继续弹框、没有任何别的信号）；每次调用 await 自己的 run（错误照常抛给各自的调用方）。
  - **自证**（本地复现不出 Windows EPERM，所以不用「本地全绿」当证据）：mock 一层真实 rename 统计在途数，断言 20 路并发时 `maxInFlight === 1`，并自检 `calls === 20`（避免钩子失效导致假绿）；**反证**：摘掉队列后该用例在 Linux 上立即变红（`expected 20 to be 1`）。另有独立真实文件系统观测（临时文件峰值 fixed = 1、无队列版本 = 20）。
- **`artifactName` 里的空格会让 `latest.yml` 指向 404 文件，自动更新必然失败**。
  - **现象**（v0.1.7 发布后人工核对 Release 时发现，三个产物对不上）：
    - `latest.yml` 里的 url：`DSH-Remote-Client-0.1.7-setup.exe` → 实测 HTTP **404**
    - Release 实际附件名：`DSH.Remote.Client-0.1.7-setup.exe` → 实测 HTTP **200**

    更新器按 `latest.yml` 里的名字去下载，而 Release 里根本没有那个文件——**自动更新的核心路径是断的**，会永远 404。
  - **根因**：**一个空格被三种规则改写**。`artifactName` 原本是 `${productName}-${version}-setup.${ext}`，而 `productName` 是 `DSH Remote Client`（含空格）：① 磁盘文件名保持原样；② `latest.yml` 的 url 由 electron-builder 的 `computeSafeArtifactNameIfNeeded` 把空格换成连字符；③ GitHub 附件名在上传时把空格换成点。（已从 app-builder-lib 26.15.3 源码逐环节确认：`isSafeGithubName` 只认 `[0-9A-Za-z._-]`，含空格即判不安全，随后 `.replace(/ /g, "-")`。）
  - **修法**：**消除歧义源**——显式写成不含空格的形式（点号形式是刻意选的：它正是 GitHub 过去改写后的样子，用户已经见过，与历史版本的下载名保持连续）。`productName` 未改动（它是应用显示名，出现在窗口标题、安装向导与快捷方式里）。改后三方名字必然一致。
  - **验证**：用 electron-builder 自己的两个函数（从产物中抽取真实源码执行，不是复刻逻辑）复现了缺陷并确认修复。
  - 同时新增断言「`artifactName` 不含空格」且**不得依赖 `${productName}`**（那个宏的值带空格，一旦有人「优化」回去就会把缺陷带回来），并做**变异验证**：改回 `${productName}-...` 后恰好只有这一条断言变红、其余 10 条仍绿。
  - ⚠️ **这个缺陷躲过了此前全部 350 项测试与 typecheck**——因为没有任何测试会真的去下载更新包，它只在真机暴露，这次是靠发布后人工核对才抓到；新断言把根因钉在了配置层。
- **`quitAndInstall()` 之前必须先刷盘日志**：写入在队列里异步进行，而下一行就走应用退出流程——不 await 的话，最关键的「用户确实点了重启」很可能还没落盘进程就没了，真机日志恰好缺最后一环。已加 `flush()` 并**变异验证**：去掉它之后恰好只有「点立即重启的记录会先落盘」这一条断言变红、其余 14 条仍绿。
- 文档同步（README 中英、验证指南中英、CI 的 Release 正文，共 14 处）：产物名引用全部改为新名；验证指南中「GitHub 会把资产名里的空格改写成点」的原有说明**整个前提已不成立**，改写为对这段历史的如实记录，避免读者按过时解释去理解文件名。

### Notes

- 验证：376 项测试全绿（21 文件）；`tsc --noEmit --noUnusedLocals` 无输出；`electron-vite build` 成功。
- `package.json` 补 `repository` 字段（`publish` 段被删时 electron-builder 会退回按 `.git/config` 猜仓库）。
- 验证指南新增「§5 自动更新」验收段（5.0 为何要发两版 / 5.1 发布前可验的四条 / 5.2 发布后的完整链路），原 §5–§8 顺延为 §6–§9。

## [0.1.6] - 2026-10-09

### Fixed

- **修正 401 提示里的入口——那个「文件」菜单根本不存在**（全仓共四处）。
  - **双重错误**：① 客户端**从来没有「文件」菜单**（菜单栏只有「编辑(E)」和「主机(H)」）；② 即便菜单名写对，**Windows 上菜单栏从 0.1.1 起就不再显示**（无边框窗口），用户照着找会一无所获。
  - **正确入口是托盘的「添加主机…」**（macOS / Linux 上菜单栏「编辑(E)」里也有）。
  - 这不是离线页一处的笔误，而是一次**系统性漂移**——0.1.1 让 Windows 菜单栏消失后，所有「从菜单栏找入口」的文案都没跟上。四处一并修正：① `src/renderer/offline.html`（用户截图里那个页面）；② `src/main/windows.ts`（401 时跳离线页传的 detail 文案，**用户实际看到的就是它**）；③ `src/main/menu-state.ts`（注释里引用了「文件」菜单）；④ 验证指南中英各一处。改后全仓 grep「文件」菜单引用为 0。
  - 同时核对了其余两条提示（重连退避 1s→2s→4s→8s 上限 30s、403 的 `DSH_TRUSTED_HOSTS` / `@xgone/dsh-remote`），与 `backoff.ts` 及 README 一致，未动。

### Notes

- 323 项测试全绿；typecheck 通过。本版版本号提升与该文案修正合在同一提交内（无独立的 release 提交）。

## [0.1.5] - 2026-10-09

### Fixed

- **加单实例锁——重复点桌面图标不再开出多个实例与多个托盘**。
  - **根因**：项目**从来没有单实例锁**（`requestSingleInstanceLock` / `second-instance` / `makeSingleInstance` 三个 API 全仓零匹配），于是每点一次图标就是一个全新进程，各自建窗口、各自建托盘。这不只是「多了几个图标」：多个实例会争抢同一份 `hosts.json` 与同一个 partition，属于**会真正损坏状态**的冲突。
  - **实现要点**：
    - `app.requestSingleInstanceLock()` 放在**模块顶层最前面**（先于读配置、注册 IPC 等一切副作用），因为必须在 `whenReady()` 之前调用。
    - 拿不到锁时用 **`app.exit(0)` 而不是 `app.quit()`**：`quit()` 是异步的，会让下面的模块级语句（含 `whenReady().then(boot)` 那条链）继续执行一遍，于是第二个实例照样把托盘加上去——正是要修的症状。
    - `boot()` 开头再加一道 `if (!hasSingleInstanceLock) return`：`app.exit()` 同样是异步生效的，万一 `whenReady` 先 resolve，这一道能确保第二个实例不建托盘、不开窗。
    - 注册 `second-instance` → `openClient()`。**光让后来者退出还不够**：已经在跑的那个必须响应，否则用户双击图标会「什么都没发生」，比开出多个窗口更让人困惑（**窗口藏在托盘里，用户以为程序没启动**）。
  - **测试**：这是启动路径上的代码，单测覆盖不到，所以照 `build-artifacts.test.ts` 的既有先例按**产物形态**守一道，断言**同时要求两个 API 都在**——只退出不响应是半个修复。
  - **变异验证**：把产物里的 `app.requestSingleInstanceLock()` 调用移除后，恰好只有这一条变红、其余 6 条仍绿。（第一次变异把 API 名加了个后缀，测试**仍绿**——因为断言是子串匹配；改用「删除调用」这种真实回归形态才抓得住，这一点值得记下。）

### Notes

- 323 项测试全绿；typecheck 通过。

## [0.1.4] - 2026-10-09

### Fixed

- **保住 `Notification` 对象引用——Windows 上它可能在显示前被 GC**（修掉「真实场景不弹通知」）。
  - **现象**：用户反馈「装了 0.1.3 后，切走等很久也收不到消息通知」；而**同一台机器上手工注入的探针却能弹出通知**——同一个应用、同一条代码路径，结果不一致。症状是「有时弹、有时不弹」。
  - **定位**：真机日志显示修复前后两次运行的**决策链完全相同**（`ipc 收到 urgent=false` → `pulse 起/重置静默期` → `fire via=quiet-elapsed focused=false` → `judge notifier.notify 返回 true`），即 `Notification.show()` 确实被调用了，但屏幕上什么都没有。**逻辑层已无路可走，问题只可能在「对象创建」与「系统显示」之间。**
  - **根因**：**Windows 上 `Notification` 实例若被垃圾回收，尚未显示出来的通知会直接消失**（Electron 已知行为）。原代码里创建它的是 `notify()` 内的一个局部变量，函数一返回就没人引用；**GC 何时跑是不确定的**，所以早先的探针弹出来了、真实场景那次没有。
  - **修法**：用进程级 `Set` 持有引用（**同时可能有多条通知，所以不是单个变量**），在 `close` 事件里移除以免长期持有。修复后 **11ms** 后即观察到「native 系统已显示」。
  - 顺带保留 `failed` 事件的 `console.error`：显示失败是**真实异常**（比如系统禁用了通知），用户报「没收到通知」时那是唯一能自证的线索；成功路径不记日志。
  - 定位期间临时加的诊断埋点（写 `notify-trace.log` 那套）已按约定**完全撤除**，grep 无残留。

### Notes

- 322 项测试全绿；typecheck 通过（含 `noUnusedLocals`，它能证明只为埋点引入的两个 import 确实没有残留引用）。
- 本版 tag 直接落在修复提交上（无独立的 release 提交）。定位期间存在两个中间态版本（`0.1.4-diagnostic.1` / `.2`），**只产 Artifacts、不打 tag**，故不单列。

## [0.1.3] - 2026-10-09

### Changed

- **消息通知改为「真的安静下来」才提醒**。
  - **根因**：用户反馈「**每轮回复都提醒太频繁**，只想要审批 + 会话结束」。原实现是 `data-streaming` 属性一消失就弹，而**一轮之内那个属性会反复消失**（它同时匹配 dsh 的**思考行与正文两个元素**），所以中途停顿也算一次「结束」。
  - **修法**：改成**静默期**判定——最后一轮流式输出结束后再等 **15 秒**，期间任何新输出都重置计时，连续安静满 15 秒才认为 agent 真的停下来了。**审批不受影响**——它阻塞工作流，立即判定、无条件弹出。
  - **为什么用「静默」而不是一个更硬的信号**：勘察过 dsh 前端，**没有**暴露「整个会话是否在跑」的稳定标记——`data-state="running"` 只挂在思考行上；`aria-label="停止生成"` 的按钮在输入框非空时不渲染；`data-running` 只用于轨迹行与终端块。判定依据与取舍写在 `QUIET_PERIOD_MS` 的注释里。
  - 一个细节：**焦点在静默期到期那一刻现取**，不是上报时取一次存着——用户在静默期内切回窗口看结果，就不该再弹。
  - 分层：静默期闸门 `createQuietGate` 放在 `notifications.ts`（纯逻辑、无 electron 导入，可被单测完整覆盖）；`index.ts` 只做接线。
  - 按 TDD 落地：先写 7 条测试并确认失败（`createQuietGate is not a function`，是功能缺失而非笔误），再写最小实现。过程中修掉两处测试自身缺陷与一处实现弱点（取消语义原本完全托付给调度端口，补了代次自检）。
  - **变异验证**：去掉「重置静默期」逻辑 → 恰好 1 条红（`expected 3 to be 1`）；去掉代次自检 → 恰好 1 条红。**值得注意的是第一次变异没有变红**——原因是原用例只触发最后一个任务，漏取消的前序任务根本不会被执行；把断言改成「触发所有未被取消的任务」后才抓得住。这条教训写进了用例注释。
  - 另修正 README 一处**本来就写错**的描述：原文称「审批请求在窗口失焦时弹」，而审批其实是无条件弹的。

### Notes

- 322 项测试全绿；typecheck 通过（含 `noUnusedLocals`/`noUnusedParameters`）。
- **已知误报边界**：dsh 没有暴露「整个会话是否在跑」的信号，所以若某一步的输出间隙超过 15 秒，仍可能中途弹一次。**宁可偶尔多弹也不漏报**——漏报的后果是用户干别的去了、永远等不到「干完了」的提醒。

## [0.1.2] - 2026-10-08

### Fixed

- **双击托盘图标打开客户端**。
  - **根因**：这**不是回归，而是这个绑定从来没有存在过**——托盘只调了 `setContextMenu`（那是管右键菜单的），而 Electron 在 Windows 上**不给托盘图标任何默认点击行为**，不注册 `double-click` 就是毫无反应。**证据**：`git log -S "double-click"` 与 `-S "tray.on"` 在 `tray.ts` 的整个历史里都是**空的**。
  - **修法**：**只绑双击**，单击与右键刻意不绑——双击是 Windows 托盘应用的传统惯例，也是用户预期的动作；**单击留给「手滑点到」**的情况，避免误触就把窗口拽到前台；**右键由 `setContextMenu` 接管，再绑 `right-click` 会两边打架**。
  - 动作走 `deps.onOpen`——与菜单里的「打开客户端」是同一个入口（唤起已有窗口 / 按当前主机重开 / 没主机则开欢迎页），不新造第二套语义。
  - 测试：`tray.ts` 导入了 electron、单测跑不起来，照 `build-artifacts.test.ts` 先例按**产物形态**守一道；断言不只是事件名存在，还要求它**紧跟着 `onOpen()`**。**变异验证**：把产物里的 `double-click` 改成 `dblclick` 后恰好只有这一条变红、其余 5 条仍绿。

### Documentation

- 消息通知已**真机验证**（此前标着「待真机确认」）。用户真机验证通过：窗口失焦时 agent 每回复完一次弹一条系统通知。这也解释了用户反馈的「一次收到 5 条」不是重复弹——他当时正在多轮对话，对应 **5 次回复结束**；同一次回复不会连弹，两层 5 秒去重（渲染侧压 IPC + 主进程最终闸门）挡着。**这是最后一条从 0.1.0 起就悬着「待真机确认」的功能项**，验完后功能面不再有未验证的东西。
- 说明 GitHub 会把 Release 资产名里的空格改写成点：实际 Release 里是 `DSH.Remote.Client-0.1.1-setup.exe`（点），而验证指南里写的是本地构建路径（空格）。**文件内容与 SHA256 不受影响。**（⚠️ 这一「历史解释」在 0.1.7 因 `artifactName` 修复而整个前提不再成立，见 0.1.7。）

### Notes

- 315 项测试全绿；typecheck 通过。
- 发布杂项：验证指南里的产物名改用 `<版本>` 占位符。写死具体版本号与写死 SHA256 是同一个毛病：每次发版都会过期，而**上一版真的漏改过一次**——0.1.1 发布时文档里还留着 0.1.0 的哈希。与其指望每次发版都记得改，不如让它不需要改。

## [0.1.1] - 2026-09-30

### Added

- **顶部跟随应用主题 + Windows 无边框标题栏**（本版核心）。
  - **问题**：用户在客户端里换肤后「页面全变了、最上面那一条没变」。**根因不在换肤插件**：它是纯网页内插件，全部效果通过 `--dsw-*` 变量与自有 `<style>` 表达；而**窗口标题栏由操作系统绘制、菜单栏由 Electron 绘制，网页 CSS 与 preload 都够不着**。
  - **依据**：在 dsh 前端源码里找到官方为此预留的契约——`@deepseek-ai/dsh-client-ui-layout` 的 `theme-presenter` 把当前主题来源写到 `<html data-ds-theme-source>`，其注释原文即「for host shells that mirror it into the native theme」。**即让原生装饰跟随应用主题本来就是宿主壳的活，客户端一直没接这一棒。**
  - **第 1 半（所有平台）**：preload 观察该属性并上报（**仅变化时发 IPC**），index.ts 校验 sender 后写入 `nativeTheme.themeSource`。不成环的理由：DSH 只在主题偏好为 system 时才读 `prefers-color-scheme`，而那种情况下转发的也正是 `'system'`。
  - **第 2 半（仅 Windows）**：`titleBarStyle: 'hidden'` + `titleBarOverlay`，**overlay 底色取全透明**，让 dsh 用皮肤 token 画的那条标题栏透出来；符号色随明暗同步。高度只留一个常量 `TITLEBAR_HEIGHT`，同时供给 overlay 与页面 CSS 变量——「何时该用自绘标题栏」的判定**只在主进程一处**，否则两边漂移会让页面凭空多出**一条 40px 空白**。**平台判定只认 win32**：Electron 的 `titleBarStyle` 适用范围不含 Linux，macOS 另有交通灯那一套，套用会得到没有窗口按钮的窗口。

### Changed

- **代价与补偿（Windows）**：原生菜单栏不再显示（已 `setMenuBarVisibility(false)` 写死），主机管理因此同时搬进托盘；而菜单栏那套快捷键仍有效（`Ctrl+N` 添加主机、`Ctrl+E` 编辑主机、`Ctrl+Q` 退出），只是**失去了提示面**。
  - ⚠️ 由此埋下后续多处「照着文档找不到入口」的文案漂移，直到 0.1.6 才系统性修正。
- **「编辑主机…」补上 `Ctrl+E`，托盘「主机」改名「主机列表」**。
  - `Ctrl+E` **不是有意为之，是当初漏了**——全仓找不到关于它为什么没键的说明。与 `Ctrl+N`（New）对称，Edit 取首字母。补之前确认无冲突——已占用的是 `Ctrl+N/Q/R`、`Ctrl+Shift+I`、`F12`、`Ctrl+W`（内容窗口）。快捷键集中成 `MENU_ACCELERATORS`（原先菜单栏与托盘各写一遍，迟早漂移）。
  - **「删除主机…」刻意不给快捷键**：不可撤销的破坏性操作，确认框默认按钮还是「取消」，多按一次回车就前功尽弃。这条决定**有测试守护**。
  - 托盘「主机」→「主机列表」：它下面挂的是每台主机一个子菜单，叫「主机」容易被读成「当前主机」这个动作。菜单栏的「主机(H)」**刻意未改**（它下面挂的不是列表而是子菜单树）。
- README 去掉「状态」一节，内容拆到「功能」与「设计要点」（中英）。

### Notes

- **macOS / Linux 仍是有边框窗口、菜单栏照旧——本版只改 Windows 的窗口形态。**
- 验证：314 项测试全绿；typecheck 通过；build 通过，产物已核对含全部契约与窗口选项。
- 文档中英双语化 + 文件名去中文（`README.md` 改英文主文档、原中文迁到 `README.zh-CN.md`；`docs/验证指南.md` → `docs/verification-guide.zh-CN.md`），**中文正文内容零改动**；另修正双语化过程中发现的 4 处原文错误。

## [0.1.0] - 2026-09-29

首个可用版本。基于设计规格「B1 直载远端 dsh」，两阶段实现（核心链路 / 通知与 token 接入）。装客户端的电脑连同一远端 dsh，看到同一批会话/工作区，**无需安装 Node/pnpm/任何运行环境**。

### Added

- **直载远端 dsh 的 Electron 壳**：窗口直接 `loadURL(host.origin)`，壳**不做任何请求代理**，因此前端/插件版本与远端天然一致。窗口固定 `contextIsolation` / `nodeIntegration` / `sandbox` 三件套；`setWindowOpenHandler` 一律 `deny` + `shell.openExternal`。安全上下文开关在 `app.whenReady()` **之前**用 `loadHostsSync` 同步设置，仅对 http origin 生效且不通配。
- **多主机管理**：添加 / 切换 / 重命名 / 删除；每台主机独占一份登录态（partition 隔离），并长期保持。主机配置存 `hosts.json`（纯函数层 + 读写 + 损坏备份）。
- **欢迎页与「添加主机」**：首次启动即引导添加主机；**精简托盘**（每主机「打开 / 重置登录态 / 删除」，加「添加主机…」与「退出」），含 **DeepSeek 鲸鱼图标**并随系统主题选色（浅色→黑、深色→白、离线→灰，**离线优先于主题**）。
- **应用菜单栏兜底**：`Menu.setApplicationMenu()` 装配应用菜单（含「添加主机…」「重新加载当前主机」「主机列表」「退出」，无当前主机时禁用），三平台可见且不依赖 Tray。后续补齐「删除主机 / 重置登录态」与删除确认框（**默认按钮为「取消」**，回车/Esc 都不会误删）；「删除主机…」原先只能手改 `hosts.json`，而用户的托盘图标不可用，故必须补。刻意不放破坏性操作的原则，在托盘不可用被证实后按实际需要放宽。
- **编辑主机窗口**：「编辑菜单」重构（`文件(F)` → `编辑(E)`，「编辑主机…」「删除主机…」）；编辑窗口含显示名 / 主机地址 / launch token 三项，可切换编辑对象（**不下发令牌**）；改地址时**实时**黄条警告会丢失已保存登录状态。
- **dsh launch token 支持**（未装认证插件的部署阻塞项）：
  - **问题**：未装 `@xgone/dsh-remote` 的部署只能靠 `dsh web` 打印的 `?token=` 换取 cookie，而 `normalizeOrigin` 返回 `url.origin`——**URL.origin 不含 query**，用户粘贴的 token 被静默剥掉，于是必然 **401「authentication required」**。
  - **做法**：`HostEntry` 增加可选 `launchToken`，与 origin 分开存（origin 仍需保持纯净，它同时是 cookie authority 的输入）；`parseHostInput` / `tokenHandshakeUrl` 拆出 origin 与 token（其余 query 忽略、空 token 视为无、trim 处理）；首次加载走带 token 的握手 URL，`reload`/重试仍加载干净 origin（cookie 已在 partition，重放无必要且 token 可能失效）；**401 时回放一次握手**以覆盖 dsh 重启后的令牌轮换，仍失败则显示离线页指引重新添加主机。
- **离线自愈与自动重连**：连不上时显示覆盖页并**指数退避**重试（1s→2s→…→30s 上限），网络恢复即刻重试；窗口销毁/卸载时清理定时器；离线状态反映到标题与托盘 tooltip。**隐藏期间暂停重试**（隐藏 ≠ 关闭，否则收进托盘的窗口会永远后台空转）。
- **SSO 门户「重新加载」**（解决容器远程地址卡在门户桌面无法进入）：容器远程地址（如绿联 UGOS `https://app-3080-*.ugdocker.link/`）第一跳 302 到 SSO 门户登录页，登录后门户 SPA 没有 return-URL 回跳，客户端永远停在门户。新增「重新加载」动作与 `Ctrl+R`（`before-input-event`，Electron 默认不启用；仅主机窗口）——**必须重新请求 origin**（`webContents.reload()` 只会再加载门户桌面），并重置退避与离线标记。同时明确：托盘「打开」对当前主机只做 show/focus、**不重载**（有意设计），避免用户误以为「打开」=「刷新」。
- **链接分流**：判据**不是「同源」**（门户→dsh 天然跨域），而是「这个地址是不是我们认识的」。五条顺序判定：非法 URL → external；非 http(s) → external；origin ∈ 已知主机 → **替换当前窗口**；origin === 当前窗口 origin → 替换当前窗口；其余 → external。比较前先用 `normalizeOrigin()` 规范化（否则 `https://GitHub.com` 与 `https://github.com` 会被判成两处）。指向已知主机的链接在应用内打开并**继承登录态**；真外链交给系统浏览器。`deny` 的代价逐条评估过：`did-fail-load` 已忽略 `-3`；**无导航循环**。
- **原生通知**：
  - **审批请求无条件弹**（它阻塞工作流）；**消息通知**监听 `data-streaming` 属性消失（回复结束），且窗口失焦时才弹。审批信号选择器从上游组件源码勘察得出（`dsh-client-ui-approval` 0.1.7-rc.2 的 `data-approval-key` 与 `aria-busy`），**不依赖运行时**；写 `[data-approval-key]:not([aria-busy="true"])` 而非 `[aria-busy="false"]`，无论 React 渲染成 `"false"` 还是省略属性都能命中。
  - `whenReady` 后调用 `setAppUserModelId`（与 electron-builder.yml 的 appId 一致，**Windows 上不设置则通知静默不显示**）。
  - 去重**按信号类型分别计时**（`urgent` / `message` 各一份时间戳）——原实现共用一个全局时间戳，一条消息通知之后的 5 秒内到达的**审批通知会被一并抑制**，而审批必须被用户看到（agent 正卡在那里等回应，**漏报的代价是任务停摆**）。**对抗性验证**：强制改回全局单时间戳后，恰好 2 条新用例 FAIL。
- **http 主机的「需重启」提示与一键重启**：`unsafely-treat-insecure-origin-as-secure` 只能在 `app.whenReady()` 之前设置，因此运行时新增的 `http://` 主机不是安全上下文，`navigator.clipboard` 等特性会**静默失效**且原本毫无提示，用户会误判为「复制按钮坏了」。现显示黄色提示条与「立即重启」按钮（`https` 与启动时已生效的 `http` 主机不提示），并校验重启 IPC 的 sender 必须是欢迎页（**远端页面是不可信内容，不得触发重启**）。
- **Windows 安装包构建（最终用户零依赖）**：`DSH Remote Client-0.1.0-setup.exe`，**106MB**，自带 Electron 运行时，最终用户**双击即装，无需 Node/pnpm 或任何运行环境**。NSIS 配置支持自选安装位置、免管理员权限、当前用户安装、卸载保留用户数据；CI 在 tag 时自动构建并发布 Release，**输出安装包 SHA256**（安装包未做代码签名，SHA256 让「我下到的就是 CI 产出的那一份」可自行核对）。

### Fixed

（首版实现期发现并修复的真实缺陷。）

- **启动白屏与 preload 加载失败**（由 `electron-vite build` 实测发现）：
  - ① `out/renderer/` 完全不生成——配置缺少 renderer 段，build 明确警告 `(!) renderer config is missing`，而 `windows.ts` 引用 `../renderer/offline.html` 与 `welcome.html`，首启欢迎页即 **404 白屏**；修复为补 renderer 多页面入口。
  - ② preload 产物是 `.mjs`（ESM），但窗口是 `sandbox: true`——Electron 官方支持矩阵明确 **Sandboxed preload scripts can't use ESM imports**，且代码引用的是 `.js`，与实际产物名也不符（**两层错误**）。修复为 preload 输出 CJS；因 `package.json` 是 `type: module`，**必须用 `.cjs` 扩展名**。
- **preload 内联 `electron` 包（P0）与六个真实缺陷**：
  - **P0-1**：`externalizeDepsPlugin` 只读 `dependencies`，而本项目依赖全在 `devDependencies`，plugin 把预设 external 列表**覆盖成空**，导致 `electron` 包被整包内联、`require` 时执行 `spawnSync`，在 `sandbox: true` 下必然失败 → **两个 preload 全挂 → 欢迎页 `window.shell` 为 `undefined`**。显式声明 `rollupOptions.external = ['electron']` 修复。
  - 同批修复另外六项：**P1-2** 删除 preload 的 `MutationObserver` 与 `shell:title` 上报（流式输出时 IPC 风暴，且与 `page-title-updated` 原生事件抢设标题）；**P1-3** 欢迎页添加主机改走 `persist()`，新主机即时出现在托盘菜单；**P1-4** 实现指数退避自动重连；**P1-5** 离线页/欢迎页改用 `loadFile()`，修掉 Windows 上手工拼 `file://` 无效；**P2-6** 托盘菜单新增「添加主机…」，避免删光主机后无法恢复；**P2-7** 新增**构建产物断言测试**并把构建串联进 `test` 脚本，堵住「单测全绿但产物坏」的流程盲点（已用故意移除 external 的方式验证该测试确实能抓到 P0-1）。
- **Windows 托盘图标不显示与关窗驻留冲突（W-1/W-2）**：
  - **W-1**：`nativeImage.createEmpty()` 在 Windows 上会导致托盘项**完全不出现**，而托盘是主机管理的唯一入口。改用内联 base64 PNG（32×32 品牌蓝实心圆），零资源文件依赖；有了真实图标后「离线变灰」也真正可做。另防御性地检查 `isEmpty()`（`createFromDataURL` 解析失败会返回空图而非抛异常），并补 16×16 / 32 两档表示让 Windows 按 DPI 选用。
  - **W-2**：Windows 上关主机窗口原本触发 `window-all-closed` → 应用退出 → 托盘消失，与用户勾选的「关窗后仍能被唤起」直接冲突。现拦截主机窗口 close 并改为 hide，用 `before-quit` 标志区分用户关窗与真正退出；欢迎窗口不受拦截，**macOS 保持既有语义**。
  - **托盘不显示的根因排查**：托盘装配原先位于 `boot()` 中的 `openHost()` 之后，前面任一步抛异常即不会装配；且 `whenReady().then(boot)` 没有 `.catch`，异常会变成**完全静默**的 unhandled rejection——正是「托盘不显示却毫无线索」的原因。现将装配提到 `boot()` 最前面并各自 `try/catch`、补齐 `.catch`，启动任一步失败时用离线页呈现原因。
- **`hosts.json` 备份的异步竞态**（Windows CI 上测试失败的真实原因）：`parseHosts` 是同步函数，但异步入口 `loadHosts` 注入的备份实现是 fire-and-forget（`void rename(...).catch(...)`），于是 `loadHosts()` 返回时备份可能尚未落盘；Linux 上文件系统快、碰巧赶在断言前完成，Windows 上被 readdir 抢先读到——**同一份代码 run #1 通过、run #2 失败**。这同时是生产语义错误：函数承诺「先备份再返回空配置」，实际没做到。修复为两个入口共用同一个同步实现（`renameSync`）；**对抗性验证**：改回 fire-and-forget 后该测试在 Linux 上立刻 3 项 FAIL。
- **窗口行为一组修复**：
  - 接管新窗口——链接改在应用内打开并继承登录态（原实现是「一律 deny + `shell.openExternal(url)`」，于是页面里每一个 `window.open` / `target="_blank"` 都被扔出应用；且 Electron 创建的**新窗口不继承父窗口的 `partition`**，会落在另一个 session）。
  - 窗口持有的主机配置改为可变状态（真机反馈「token 失效 → 编辑主机更新 token → 点『重新加载』仍进不去 dsh，而点『打开』能进」；根因是主机配置被**按值捕获进闭包**，此后所有 `host.*` 读的都是创建时的快照，reload 用旧 token 握手 → 401 → 401 回放**也用旧 token** → 再 401 → 离线页）。
  - 内容窗口不再继承菜单栏（用户在子窗口点「重新加载」被重载的却是**另一个窗口**；**macOS 例外**，规则统一为「菜单栏只长在主机窗口上」，启动失败的离线窗口保留菜单）；子窗口标题补上主机名前缀；`Ctrl+W` **只加在内容窗口**（主机窗口关窗语义是「隐藏到托盘」）。
  - 主机窗口标题加 `preventDefault`——`page-title-updated` 事件**之后** Electron 会把原生标题设成文档标题，本项目处理器只在里面调 `onTitle()`，拼好的标题立刻被覆盖。**用户真机截图可证：外层窗口标题只有主机型号，没有主机名前缀**。
  - **改地址保存后客户端退出**：改地址时旧窗口被销毁，只剩编辑窗口，用户关掉它 → `window-all-closed` → `app.quit()`。
  - **`Ctrl+Shift+I` 打不开 DevTools**：Electron 默认不提供，全仓原本没有任何 DevTools 代码，而它正是跑勘察脚本的唯一入口。
- **CI 修复**：`pnpm-workspace.yaml` 里 `electron-winstaller` 的值是 pnpm 交互式 approve-builds 留下的提示文字 `set this to true or false`，不是合法布尔值；加 `--publish never`、`npmRebuild: false`，构建输出落盘 `build.log`，失败时把**末尾 40 行**写成 annotation 让失败原因暴露。

### Notes

- 本版 tag 说明自称 **274 个单元测试 + 构建产物断言**；Windows 安装包由 CI 构建。
- 首版实测固化的四个构建坑（详见 `scripts/build-windows.sh` 注释）：① Node 必须 ≥ 22.12（electron-builder 的 blockmap 用 `require()` 加载 ESM）；② Linux 交叉构建 Windows NSIS 必须有 wine，否则只产出 **161KB 半成品**；③ electron-builder 二进制工具镜像必须是 `registry.npmmirror.com/-/binary/...`（`npmmirror.com/mirrors/...` 会 ETIMEDOUT）；④ pnpm 首装后 rolldown 等平台绑定可能缺失，需 `pnpm install --force`。
- CI 上 `main` 推送也触发构建（只出 Artifacts、不创建 Release），`retention-days: 7` 避免 106MB 安装包无限累积占用配额。
- **已知限制**：安装包未做代码签名，SmartScreen / 浏览器会给「未知来源」警告，以 Release 说明里的 SHA256 为准。通知选择器取自 dsh 上游 `dsh-client-ui-approval` / `dsh-client-ui-chat`，**上游改结构需同步更新**。

[Unreleased]: https://github.com/steven-stack-s/dsh-remote-client/compare/v0.2.5...HEAD
[0.2.5]: https://github.com/steven-stack-s/dsh-remote-client/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/steven-stack-s/dsh-remote-client/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/steven-stack-s/dsh-remote-client/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/steven-stack-s/dsh-remote-client/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/steven-stack-s/dsh-remote-client/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/steven-stack-s/dsh-remote-client/compare/v0.1.10...v0.2.0
[0.1.10]: https://github.com/steven-stack-s/dsh-remote-client/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/steven-stack-s/dsh-remote-client/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/steven-stack-s/dsh-remote-client/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/steven-stack-s/dsh-remote-client/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/steven-stack-s/dsh-remote-client/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/steven-stack-s/dsh-remote-client/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/steven-stack-s/dsh-remote-client/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/steven-stack-s/dsh-remote-client/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/steven-stack-s/dsh-remote-client/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/steven-stack-s/dsh-remote-client/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/steven-stack-s/dsh-remote-client/releases/tag/v0.1.0
