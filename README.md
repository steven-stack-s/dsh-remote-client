# dsh-remote-client

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
- 托盘图标目前是 `nativeImage.createEmpty()` **空图占位**，因此「离线时图标变灰」无法实现，降级为 tooltip + 菜单「（离线）」标注 +「立即重试」项。
- 原生通知（审批请求 / 任务完成）尚未实现，属于阶段 2。
- 重命名主机推迟到阶段 2（添加主机时可填显示名，默认取 origin 去掉协议前缀）。

## 状态

阶段 1（核心链路）：多主机配置与切换、登录态隔离与保持、直载窗口、离线覆盖页与**指数退避自动重连**（1s→2s→…→30s，网络恢复即刻重试）、托盘管理。

阶段 2（计划中）：原生通知、launch token 免插件接入、应用图标、主机重命名。

设计规格见 [`docs/superpowers/specs/2026-09-28-dsh-remote-client-design.md`](docs/superpowers/specs/2026-09-28-dsh-remote-client-design.md)（§14 记录了实现期发现并修复的 8 个真实缺陷），
实施计划见 [`docs/superpowers/plans/2026-09-28-stage1-core.md`](docs/superpowers/plans/2026-09-28-stage1-core.md)。
