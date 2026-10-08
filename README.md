# dsh-remote-client

[English](README.md) | [简体中文](README.zh-CN.md)

A desktop client that loads a remote dsh directly. The target backend is a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) instance running on a server/NAS (for example, one deployed with [dsh-docker](https://github.com/steven-stack-s/dsh-docker)).

> Note on language: the client UI itself is in Chinese, so menu and button names appear below in their original Chinese form, sometimes with an English gloss in parentheses. Comments inside command blocks are kept verbatim from the original and explained in the surrounding prose.

## What problem it solves

The official Electron desktop client ties the dsh backend **to the local machine**:

- In `apps/desktop/src/main.ts`, `hostUrl` is the only variable of the whole shell, and its only assignment comes from the local child process's `ready.url`;
- `apps/desktop/src/host-process.ts` checks that the hostname must belong to `{localhost, 127.0.0.1, [::1]}`, and forbids credentials embedded in the URL;
- desktop exclusively occupies the local `$DSH_HOME/profiles/desktop`, and the core package is supplied by signed resources.

The result: **changing computers = changing `$DSH_HOME` = sessions, workspaces, plugins and credentials are all gone**.

This client does the opposite: **the backend always stays remote**. The window loads the remote origin directly, so on any computer with the client installed, connecting to the same dsh-docker gives you the same sessions, the same workspace and the same files.

## Design highlights

- **No request proxying**: the window does `loadURL(host.origin)`. HTML, assets, `/plugins/*/client.js` and `/api/*` all come from the remote. This brings two direct benefits: the cookie jar and the remote authority are naturally consistent (login page, MFA, logout and renewal are all automatically correct); and the client plugin and the Host's Typert descriptors are **always the same version**, so the client never needs to follow dsh upgrades.

- **Multi-host isolation via partitions**: one `persist:host-<sha256(origin)>` per host, so cookies / localStorage / IndexedDB naturally do not interfere with each other.

- **Zero page intrusion**: the preload exposes no API to the remote page (it does not call `contextBridge.exposeInMainWorld`). Only the shell's own welcome page has its own narrow interface.

- **Secure context**: for configured `http://` origins, `unsafely-treat-insecure-origin-as-secure` is set so that `navigator.clipboard` works. It only takes effect for explicitly configured origins, never as a wildcard.

- **The top strip follows the app theme**: a dsh skin plugin can only restyle the page itself; the window title bar and menu bar are drawn by the operating system and are out of reach of page CSS. Without an extra step, changing the skin leaves you with "the whole page changed, but the top strip did not". The client therefore does two things: it forwards `data-ds-theme-source`, which the dsh frontend publishes, into `nativeTheme.themeSource` (the contract dsh officially reserves for host shells), and on Windows it switches to a **frameless window** so that dsh can draw the top strip itself.

  The cost is that on Windows the **native menu bar is no longer shown** — Electron defines frameless as *no chrome*, and chrome explicitly includes toolbars. Host management has therefore also moved into the tray; the menu bar's accelerators still work (`Ctrl+N` to add a host, `Ctrl+E` to edit one, `Ctrl+Q` to quit), they simply have no surface left to advertise them. macOS / Linux keep their framed windows and their menu bar.

## Features

- **Multi-host management**: add / switch / rename / delete; each host gets its own isolated login state (per-partition).
- **Access without a plugin**: a dsh without the auth plugin can be reached with the launch token printed by `dsh web`.
- **Offline self-healing**: when the host is unreachable the client shows an overlay page and retries with exponential backoff (1s→2s→…→30s), retrying immediately once the network recovers.
- **Link routing**: links to a configured host or the current site navigate inside the client; external links go to the system browser.
- **Native notifications**: approval requests raise a system notification while the window is unfocused.
- **Tray**: host management and on/off both live here (on Windows the frameless window shows no menu bar — see Design highlights).
- **Shortcuts**: `Ctrl+N` add host, `Ctrl+E` edit host, `Ctrl+R` reload the page, `Ctrl+Shift+I` / `F12` open DevTools.
- **Windows installer**: ships its own Electron runtime, double-click to install, built by CI.

## Remote prerequisites (choose one)

Otherwise the symptom is "the page opens, but `/api` returns 403 for everything" — that is dsh's trust fence (anti DNS-rebinding) blocking non-loopback Hosts.

1. Configure it in dsh-docker's `.env`:
   ```
   DSH_TRUSTED_HOSTS=<host IP or domain>:3080
   ```
2. Or install the auth plugin `@xgone/dsh-remote` (after login, its `trustProxy` normalizes the Host of authenticated requests to loopback):
   ```bash
   docker exec dsh dsh plugin --profile web add @xgone/dsh-remote
   docker restart dsh
   ```

## Development

```bash
pnpm install
pnpm test        # 构建 + 全部测试（含构建产物断言）
pnpm test:unit   # 只跑单测（快速回路，不含构建）
pnpm test:build  # 只跑构建产物断言
pnpm typecheck
pnpm dev         # 启动客户端（需要图形环境）
```

Reading the Chinese comments in that block: `pnpm test` = build + all tests (including build-artifact assertions); `pnpm test:unit` = unit tests only (fast loop, no build); `pnpm test:build` = build-artifact assertions only; `pnpm dev` = launch the client (requires a graphical environment).

> `pnpm test` deliberately **includes the build**. Phase 1 taught a real lesson: while all 42 unit tests were green and `pnpm typecheck` exited 0, the build output was broken (`out/renderer/` was not generated at all, and the preload had inlined the entire npm `electron` package). Neither the unit tests nor the type check can cover the build layout and artifact shape, so `tests/build-artifacts.test.ts` specifically asserts the artifact structure and the preload shape, and is wired into the standard verification command.

## Known limitations

- **Cookie names are bound to the authority** (`dsh-auth-` + `sha256(authority)`), so accessing via a different IP / domain is treated as a **new host** and requires logging in again.
- `unsafely-treat-insecure-origin-as-secure` **can only be set at startup**, so after adding an `http://` host at runtime the client must be restarted for it to take effect; `https://` hosts are unaffected.
- On a plaintext HTTP link, dsh's session cookie carries no `Secure` attribute, so an HTTPS reverse proxy is recommended for cross-network deployments.
- Native notifications: **both approval and message notifications are verified working on a real machine** (the selectors come from dsh's upstream client UI packages, so no on-device recon was needed). Message notifications only fire when the window is **unfocused**. While `MESSAGE_SELECTOR` is `null` that rule is simply disabled — the feature does not trigger rather than breaking. If an upstream dsh change ever invalidates the selectors, [`docs/dom-recon-script.js`](docs/dom-recon-script.js) can be used to re-reconnoitre the DOM.
- Host renaming is already available: 「编辑(E)」 (Edit(E)) → 「编辑主机…」 (Edit Host…) lets you change the display name, the address and the launch token.
- **The installer is not code-signed**, so end users will hit SmartScreen's "unknown publisher" prompt on first run (see below).

---

## Installation & distribution

### For end users

Download `DSH Remote Client-<version>-setup.exe` and double-click to install.

**No Node, pnpm or any other runtime needs to be installed** — the Electron runtime is already bundled into the installer (about 106MB).

The setup wizard supports choosing the install location and creating desktop and Start Menu shortcuts, and **does not require administrator privileges** (it installs into the current user's directory). Uninstalling **keeps** the host configuration and login state, so no reconfiguration is needed after reinstalling.

> ⚠️ The installer is **not code-signed**, so Windows SmartScreen will show "unknown publisher".
> Click "More info" → "Run anyway". To get rid of that prompt you would need to buy a code-signing
> certificate and configure `win.certificateFile` / `certificatePassword` in `electron-builder.yml`.

### Building the installer

**Option 1: GitHub Actions (recommended, no local environment needed)**

Push a tag and it builds and publishes to a Release automatically:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

You can also trigger `workflow_dispatch` manually on the repository's Actions page; the artifacts can be downloaded from the Actions Artifacts.
See [`.github/workflows/build-windows.yml`](.github/workflows/build-windows.yml).

**Option 2: local build (Linux or Windows)**

```bash
./scripts/build-windows.sh
```

This script codifies the four pitfalls actually hit when cross-building a Windows package on Linux (Node ≥ 22.12, wine is required, the binary tools must go through a mirror, `pnpm install --force` to fix the missing platform bindings) — see the script header for details. **Building natively on Windows does not need wine.**

Artifact: `release/DSH Remote Client-<version>-setup.exe`.
