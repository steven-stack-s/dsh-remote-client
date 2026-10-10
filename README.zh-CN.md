# dsh-remote-client

[English](README.md) | [简体中文](README.zh-CN.md)

直载远端 dsh 的桌面客户端。目标后端是跑在服务器/NAS 上的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 实例（例如 [dsh-docker](https://github.com/steven-stack-s/dsh-docker) 部署的）。

## 它解决什么问题

官方 Electron 桌面客户端把 dsh 后端**与本机绑死**：

- `apps/desktop/src/main.ts` 里 `hostUrl` 是全壳唯一变量，唯一赋值点来自本地子进程的 `ready.url`；
- `apps/desktop/src/host-process.ts` 校验 hostname 必须属于 `{localhost, 127.0.0.1, [::1]}`，并禁止 URL 内嵌凭据；
- desktop 独占本机 `$DSH_HOME/profiles/desktop`，核心包由签名资源提供。

结果是：**换一台电脑 = 换一个 `$DSH_HOME` = 会话、工作区、插件、凭据全部不在**。

本客户端反过来：**后端始终在远端**。窗口直载远端 origin，因此换任何一台装了客户端的电脑，连上同一个 dsh-docker 就是同一批会话、同一个工作区、同一批文件。

## 设计要点

- **不做请求代理**：窗口 `loadURL(host.origin)`。HTML、assets、`/plugins/*/client.js`、`/api/*` 全部来自远端。这带来两个直接好处：cookie jar 与远端 authority 天然一致（登录页、MFA、登出、续期全部自动正确）；客户端插件与 Host 的 Typert 描述符**永远同版**，客户端无需跟随 dsh 升级。

- **多主机用 partition 隔离**：每个主机一个 `persist:host-<sha256(origin)>`，cookie / localStorage / IndexedDB 天然互不干扰。

- **零页面侵入**：preload 不向远端页面暴露任何 API（不调用 `contextBridge.exposeInMainWorld`）。只有壳自有的欢迎页有自己的窄接口。

- **安全上下文**：对已配置的 `http://` origin 设置 `unsafely-treat-insecure-origin-as-secure`，让 `navigator.clipboard` 可用。仅对显式配置的 origin 生效，不做通配。

- **顶部跟随应用主题**：dsh 的换肤插件只改得到网页内部，而窗口标题栏与菜单栏由操作系统绘制，网页 CSS 够不着——不额外做一步，换肤后就会出现「页面全变了、最上面那一条没变」。客户端为此做两件事：把 dsh 前端公布的 `data-ds-theme-source` 转发进 `nativeTheme.themeSource`（官方为宿主壳预留的契约），并在 Windows 上改用**无边框窗口**，把顶上那一条让给 dsh 自绘。

  代价是 Windows 上**原生菜单栏不再显示**——Electron 对 frameless 的定义就是 no chrome，chrome 明确包含 toolbars。主机管理因此同时放进了托盘；菜单栏那套快捷键仍然有效（`Ctrl+N` 添加主机、`Ctrl+E` 编辑主机、`Ctrl+Q` 退出），只是失去了提示面。macOS / Linux 仍是有边框窗口，菜单栏照旧。

## 功能

- **多主机管理**：添加 / 切换 / 重命名 / 删除；每台主机独占一份登录态（partition 隔离）。
- **免插件接入**：未装认证插件的 dsh，可用 `dsh web` 打印的 launch token 直接接入。
- **离线自愈**：连不上时显示覆盖页并指数退避重试（1s→2s→…→30s），网络恢复即刻重试。
- **链接分流**：指向已配置主机或当前站点的链接在客户端内导航；外链交给系统浏览器。
- **原生通知**：审批请求**无条件**弹（它阻塞你的工作流）；一轮回复**真正停下来**且窗口失焦时，弹一条消息通知。
- **托盘**：主机管理与开关都在这里（Windows 上无边框窗口不显示菜单栏，见「设计要点」）。
- **快捷键**：`Ctrl+N` 添加主机、`Ctrl+E` 编辑主机、`Ctrl+R` 刷新页面、`Ctrl+Shift+I` / `F12` 开 DevTools。
- **自动更新（差分）**：启动约 30 秒后**后台**检查新版本，只下载变化的部分（不再重下 106MB），下载完成后弹一次询问——「立即重启」才安装，「稍后」不打扰、也不会对同一版本再问第二遍。全程静默：网络不通或更新源异常时只留日志，**绝不弹错误框**，不影响正常使用。
  > **实测数字**：从 0.1.9 升到 0.1.10，完整包 106.3MB，实际只下载了 **1.26MB**（约 1%）。
  > 更新器的诊断日志在 `%APPDATA%\dsh-remote-client\update.log`（最多保留 200 行），
  > 每次下载了多少、有没有退化成整包，都能在里面查到。
  > ⚠️ **本功能需要客户端自身是 0.1.7 或更新**。0.1.6 及更早的版本里没有更新器，只能手动下载安装包升级——**这是最后一次需要手动装的 106MB**。
- **Windows 安装包**：自带 Electron 运行时，双击即装，由 CI 构建。

## 远端前置条件（二选一）

否则表现为「页面能打开，但 `/api` 全部 403」——这是 dsh 的 trust fence（防 DNS rebinding）在拦截非 loopback 的 Host。

1. 在 dsh-docker 的 `.env` 里配置：
   ```
   DSH_TRUSTED_HOSTS=<宿主IP或域名>:3080
   ```
2. 或安装认证插件 `@xgone/dsh-remote`（登录后其 `trustProxy` 会把已认证请求的 Host 归一为 loopback）：
   ```bash
   docker exec dsh dsh plugin --profile web add @xgone/dsh-remote
   docker restart dsh
   ```

## 开发

```bash
pnpm install
pnpm test        # 构建 + 全部测试（含构建产物断言）
pnpm test:unit   # 只跑单测（快速回路，不含构建）
pnpm test:build  # 只跑构建产物断言
pnpm typecheck
pnpm dev         # 启动客户端（需要图形环境）
```

> `pnpm test` 刻意**包含构建**。阶段 1 暴露过一个真实教训：42 个单测全绿、typecheck 退出码 0 的同时，构建产物是坏的（`out/renderer/` 未生成、preload 内联了整个 npm `electron` 包）。单测与类型检查都覆盖不到构建布局与产物形态，所以 `tests/build-artifacts.test.ts` 专门断言产物结构与 preload 形态，并接进了标准验证命令。

## 已知限制

- **cookie 名绑定 authority**（`dsh-auth-` + `sha256(authority)`），因此换 IP / 换域名访问会被视为**新主机**，需要重新登录。
- `unsafely-treat-insecure-origin-as-secure` **只能在启动时设置**，所以运行时新增 `http://` 主机后需重启客户端生效；`https://` 主机不受影响。
- 明文 HTTP 链路上 dsh 的会话 cookie 不带 `Secure` 属性，跨网络部署建议配 HTTPS 反向代理。
- 原生通知：**审批通知与消息通知均已真机验证可用**（选择器取自 dsh 上游组件源码，不依赖真机勘察）。审批**无条件**弹出；消息通知只在窗口**失焦**时弹出，而且要等这一轮**真的安静下来**（最后一轮流式输出结束后 15 秒内没有新输出）——中途停下等工具结果不会提醒。**已知的误报边界**：dsh 没有「整个会话是否在跑」的信号，所以若某一步持续输出间隙超过 15 秒，仍可能中途弹一次。`MESSAGE_SELECTOR` 为 `null` 时该条规则不启用，功能只是不触发而非坏掉。若将来 dsh 上游改版导致选择器失效，可用 [`docs/dom-recon-script.js`](docs/dom-recon-script.js) 重新勘察 DOM 特征。
- 主机重命名已可用：「编辑(E)」→「编辑主机…」可改显示名、地址与 launch token。
- **安装包未做代码签名**，最终用户首次运行会遇到 SmartScreen「未知发布者」提示（见下）。

---

## 安装与分发

### 给最终用户

下载 `DSH.Remote.Client-<版本>-setup.exe`，双击安装即可。

**不需要安装 Node、pnpm 或任何运行环境** —— Electron 运行时已打进安装包（约 106MB）。

安装向导支持自选安装位置、创建桌面与开始菜单快捷方式，**不需要管理员权限**（装到当前用户目录）。卸载时**保留**主机配置与登录态，重装后无需重新配置。

> ⚠️ 安装包**未做代码签名**，Windows SmartScreen 会提示「未知发布者」。
> 点「更多信息」→「仍要运行」即可。若要消除该提示，需要购买代码签名证书，
> 在 `electron-builder.yml` 里配置 `win.certificateFile` / `certificatePassword`。

**关于自动更新**：从 **0.1.7** 起客户端会自己发现新版本并只下载差异部分，之后升级都不需要再点安装包。但**这一次仍然要手动装**——0.1.6 及更早的版本里没有更新器，它不会自己升级。

> **装好后无需任何操作。** 客户端启动约 30 秒后会在后台检查更新，下载完成才会弹一次对话框问你是否立即重启。选「稍后」也没关系，不会反复打扰，下次启动会再检查。

### Release 里的三个文件：只需要下载 exe

每次发布，Release 下会看到三个文件：

| 文件 | 给谁用 | 要下载吗 |
|---|---|---|
| `DSH.Remote.Client-<版本>-setup.exe` | **给人用**的安装包 | ✅ 需要 |
| `latest.yml` | 更新器用：记录最新版本号 | ❌ 不用，**也不要删** |
| `DSH.Remote.Client-<版本>-setup.exe.blockmap` | 更新器用：块索引，据此算出只需下载哪几块 | ❌ 不用，**也不要删** |

`latest.yml` 让已装的客户端知道「有新版了、新包叫什么名字」，`.blockmap` 让它知道「这个新包里哪几块变了」——两者缺一，自动更新就会失效或退化成重下整个 106MB 的安装包。

> ⚠️ **请不要删除 `latest.yml` 与 `.blockmap`**。它们看起来像多余文件，实际是更新链路的两个必要环节。同理，历史版本的这两个文件也不要清理——旧版本客户端仍可能需要它们。

### 构建安装包

**方式一：GitHub Actions（推荐，无需任何本地环境）**

推一个 tag 即自动构建并发布到 Release：

```bash
git tag v0.1.0 && git push origin v0.1.0
```

也可在仓库 Actions 页面手动触发 `workflow_dispatch`，产物在 Actions 的 Artifacts 里下载。
见 [`.github/workflows/build-windows.yml`](.github/workflows/build-windows.yml)。

**方式二：本地构建（Linux 或 Windows）**

```bash
./scripts/build-windows.sh
```

该脚本固化了在 Linux 上交叉构建 Windows 包时实际踩到的四个坑（Node ≥ 22.12、
必须有 wine、二进制工具需走镜像、`pnpm install --force` 解决平台绑定缺失），
详见脚本头部注释。**在 Windows 本机构建则不需要 wine。**

产物在 `release/` 下：

```
release/DSH.Remote.Client-<版本>-setup.exe          安装包（给用户）
release/DSH.Remote.Client-<版本>-setup.exe.blockmap 差分块索引（给更新器）
release/latest.yml                                  版本清单（给更新器）
```

后两个由 `electron-builder.yml` 里的 `publish` 段触发产出。**发布时三者必须一起上传**，
否则已装客户端要么发现不了新版，要么只能重下整包。（本地构建若只给自己测，忽略它们即可。）
