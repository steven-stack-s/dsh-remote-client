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
- 原生通知：**审批通知已真机验证可用**（选择器取自 dsh 上游组件源码，不依赖真机勘察）；**消息通知**（agent 回复完毕时提醒）另需真机确认，且只在窗口失焦时弹出。`MESSAGE_SELECTOR` 为 `null` 时该条规则不启用，功能只是不触发而非坏掉。若将来 dsh 上游改版导致选择器失效，可用 [`docs/dom-recon-script.js`](docs/dom-recon-script.js) 重新勘察 DOM 特征。
- 主机重命名已可用：「编辑(E)」→「编辑主机…」可改显示名、地址与 launch token。
- **安装包未做代码签名**，最终用户首次运行会遇到 SmartScreen「未知发布者」提示（见下）。

---

## 安装与分发

### 给最终用户

下载 `DSH Remote Client-<版本>-setup.exe`，双击安装即可。

**不需要安装 Node、pnpm 或任何运行环境** —— Electron 运行时已打进安装包（约 106MB）。

安装向导支持自选安装位置、创建桌面与开始菜单快捷方式，**不需要管理员权限**（装到当前用户目录）。卸载时**保留**主机配置与登录态，重装后无需重新配置。

> ⚠️ 安装包**未做代码签名**，Windows SmartScreen 会提示「未知发布者」。
> 点「更多信息」→「仍要运行」即可。若要消除该提示，需要购买代码签名证书，
> 在 `electron-builder.yml` 里配置 `win.certificateFile` / `certificatePassword`。

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

产物：`release/DSH Remote Client-<版本>-setup.exe`。

---

## 状态

**已实现**：多主机配置与切换、登录态隔离与保持、直载窗口、离线覆盖页与**指数退避自动重连**（1s→2s→…→30s，网络恢复即刻重试）、**launch token 免插件接入**（未装认证插件的 dsh 靠它接入，已经真机验证）、应用菜单栏（主机管理 + 编辑主机窗口，可切换编辑任意一台）、精简托盘（仅「打开客户端 / 关闭客户端」）、**链接分流**（指向已配置主机 → 在客户端内打开；外链 → 系统默认浏览器）、**原生通知**（审批请求；选择器取自 dsh 上游组件源码，已真机验证）、**DeepSeek 鲸鱼图标**（随系统主题变色）、`Ctrl+Shift+I` / `F12` 开 DevTools、**Windows 安装包（CI 构建）**。

**待验证**：消息通知（agent 回复完毕时提醒）需真机确认——它只在窗口**失焦**时弹出。

设计规格与实施计划保留在本地 `docs/superpowers/`，**刻意不入库**（见 `.gitignore`）——它们属于内部设计与实现记录，不适合公开。其中设计规格 §14 记录了实现期发现并修复的 8 个真实缺陷。

### 内部设计文档不入库

设计规格与实施计划保留在本地 `docs/superpowers/`，**刻意不入库**（见 `.gitignore`）——它们属于内部设计与实现记录，不适合公开。其中设计规格 §14 记录了实现期发现并修复的 8 个真实缺陷。

新增此类文档时，直接放到 `docs/superpowers/` 即可，**无需再改 `.gitignore`**。
