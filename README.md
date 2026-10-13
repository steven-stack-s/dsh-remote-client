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

  The cost is that on Windows the **native menu bar is no longer shown** — Electron defines frameless as *no chrome*, and chrome explicitly includes toolbars. Host management has therefore also moved into the tray; the menu bar's accelerators still work (`Ctrl+N` to add a host, `Ctrl+E` to edit one, `Ctrl+,` for settings, `Ctrl+Q` to quit), they simply have no surface left to advertise them. **For that same reason `Ctrl+,` (settings) is registered a second time as an in-window accelerator** — registered on the menu bar alone, that key would do nothing at all on Windows. macOS / Linux keep their framed windows and their menu bar.

- **At most one window per host, several hosts in parallel**: windows are indexed by host id, so opening the same host again just raises the existing window (otherwise one origin would run two WebSockets against the same dsh). With several windows open, "the current host" means **the last one focused** — the menu's ● marker and the tray's "Reload / Retry now" all target it.

## Features

- **Multi-host management**: add / switch / rename / delete; each host gets its own isolated login state (per-partition). Several hosts can be **open at the same time** (one window each).
- **Access without a plugin**: a dsh without the auth plugin can be reached with the launch token printed by `dsh web`.
- **Offline self-healing**: when the host is unreachable the client shows an overlay page and retries with exponential backoff (1s→2s→…→30s), retrying immediately once the network recovers.
- **Link routing**: links to a configured host **always open in the current window** (clicking a dsh icon on a portal likewise replaces the current window — no new window); external links go to the system browser.
- **Client settings**: tray → "Client settings", or `Ctrl+,`. Covers the notification switch and quiet period, startup behaviour, whether closing hides to the tray, and update checks. Changes take effect **immediately**, no restart.
- **Multi-host**: in the tray / menu host list every host offers two actions — "Open" (**inside the current window**, replacing it) and "Open in new window" (**spawns another window**, keeping the current one).
- **Native notifications**: approval requests pop up **unconditionally** (they block your workflow); a message notification fires only once a reply has **genuinely stopped** and the window is unfocused. With several hosts the notification names **the host it came from**, and clicking it returns to that window.
- **Tray**: host management and on/off both live here (on Windows the frameless window shows no menu bar — see Design highlights).
- **Shortcuts**: `Ctrl+N` add host, `Ctrl+E` edit host, `Ctrl+,` client settings, `Ctrl+Q` quit, `Ctrl+R` reload the page, `Ctrl+Shift+I` / `F12` open DevTools (docked in framed windows; on Windows the host window is frameless, so it opens in a separate window — see Known limitations).
- **Automatic (differential) updates**: about 30 seconds after startup the client checks for a new version **in the background** and downloads only the parts that changed (no more re-downloading 106MB). Once the download finishes it asks exactly once — "Restart now" installs it, "Later" is not nagging and the same version is never asked about twice. All of it is silent: an unreachable network or a broken update source only leaves a log line, **never an error dialog**, and never affects normal use.
  > **Measured**: upgrading 0.1.9 → 0.1.10 pulled **1.26MB** instead of the full 106.3MB package (about 1%).
  > The updater writes a diagnostic log to `%APPDATA%\dsh-remote-client\update.log` (latest
  > 200 lines), where you can see how much each download actually transferred and whether it
  > ever fell back to the full package.
  > ⚠️ **This requires the installed client to already be 0.1.7 or newer.** Versions 0.1.6 and earlier contain no updater, so they can only be upgraded by downloading the installer by hand — **that is the last time anyone has to install the 106MB package manually.**
- **Windows installer**: ships its own Electron runtime, double-click to install, built by CI.

## Client settings

Tray → "Client settings", menu bar → "Edit(E) → Settings…", or `Ctrl+,`. All of these are preferences of the **client itself** and do not affect the remote dsh (those live in dsh's own settings panel in the web UI).

| Setting | Default | Notes |
|---|---|---|
| Show native notifications | on | When off, neither approvals nor new messages raise a system notification |
| Quiet period for message notifications | 15s (range 15–300) | After a reply stops streaming, wait this long with no new output before notifying. Too short and "waiting on a slow tool" is mistaken for "finished". **Approval notifications ignore it** and always fire immediately |
| On startup | Open the last host | Can be changed to always show the "Add host" page |
| Hide to tray instead of quitting | on | When off, closing the window quits (on macOS this has no effect — that platform already keeps running when the last window closes) |
| Check for updates after startup | on | When off, the updater is not wired up at all |

The update section also shows the **current version** and offers a "Check for updates now" button (in development the updater is not wired up, so the button is disabled with an explanation).

Changes take effect **immediately** (host behaviour reads the current value rather than a startup snapshot), with no restart. Settings live in `%APPDATA%\dsh-remote-client\settings.json`; a corrupt file is first backed up as `settings.json.corrupt-<timestamp>` before falling back to defaults — it is never silently discarded.

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
- Native notifications: **both approval and message notifications are verified working on a real machine** (the selectors come from dsh's upstream client UI packages, so no on-device recon was needed). Approvals pop up **unconditionally**; message notifications fire only when the window is **unfocused**, and only once the reply has **genuinely gone quiet** (no new streaming output within 15 seconds of the last one) — pausing to wait for a tool result does not trigger one. **Known false-positive boundary**: dsh exposes no "is the whole session running" signal, so if some step leaves a gap longer than 15 seconds between outputs, a mid-run notification can still slip through. While `MESSAGE_SELECTOR` is `null` that rule is simply disabled — the feature does not trigger rather than breaking. If an upstream dsh change ever invalidates the selectors, [`docs/dom-recon-script.js`](docs/dom-recon-script.js) can be used to re-reconnoitre the DOM.
- Host renaming is already available: 「编辑(E)」 (Edit(E)) → 「编辑主机…」 (Edit Host…) lets you change the display name, the address and the launch token.
- **On Windows the host window's DevTools opens in a separate window** (not docked). The host window is **frameless** (so the top bar can follow the app theme), and a frameless window cannot dock DevTools. **Verified on a real machine**: in a **framed** window (Client settings, Edit host, Add host) the same code docks DevTools normally. This is a deliberate trade-off — dropping the frameless style would dock DevTools but lose the themed top bar. On macOS / Linux the host window is framed, so DevTools docks as usual.
- **The installer is not code-signed**, so end users will hit SmartScreen's "unknown publisher" prompt on first run (see below).

---

## Installation & distribution

### For end users

Download `DSH.Remote.Client-<version>-setup.exe` and double-click to install.

**No Node, pnpm or any other runtime needs to be installed** — the Electron runtime is already bundled into the installer (about 106MB).

The setup wizard supports choosing the install location and creating desktop and Start Menu shortcuts, and **does not require administrator privileges** (it installs into the current user's directory). Uninstalling **keeps** the host configuration and login state, so no reconfiguration is needed after reinstalling.

> ⚠️ The installer is **not code-signed**, so Windows SmartScreen will show "unknown publisher".
> Click "More info" → "Run anyway". To get rid of that prompt you would need to buy a code-signing
> certificate and configure `win.certificateFile` / `certificatePassword` in `electron-builder.yml`.

**About automatic updates**: from **0.1.7** onwards the client discovers new versions by itself and downloads only the changed parts, so later upgrades never need an installer again. But **this one still has to be installed by hand** — 0.1.6 and earlier have no updater, so they will not upgrade themselves.

> **Nothing to do once installed.** The client checks for updates in the background about 30 seconds after startup and only shows a dialog once a download has completed. Choosing "Later" is fine: it will not nag you, and it will check again on the next launch.

### Three files in the Release: you only need to download the exe

Each release carries three files:

| File | Who it is for | Download? |
|---|---|---|
| `DSH.Remote.Client-<version>-setup.exe` | The installer, **for people** | ✅ Yes |
| `latest.yml` | For the updater: records the latest version | ❌ No — and **do not delete it** |
| `DSH.Remote.Client-<version>-setup.exe.blockmap` | For the updater: a block index used to work out which blocks changed | ❌ No — and **do not delete it** |

`latest.yml` tells an installed client "there is a new version, and here is what the new package is called"; the `.blockmap` tells it "these are the blocks that changed". With either one missing, automatic updates either stop working altogether or degrade into re-downloading the whole 106MB installer.

> ⚠️ **Please do not delete `latest.yml` or the `.blockmap`.** They look like stray files, but they are two essential links in the update chain. For the same reason, do not clean up those two files on older releases either — older clients may still need them.

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

The artifacts land in `release/`:

```
release/DSH.Remote.Client-<version>-setup.exe          the installer (for users)
release/DSH.Remote.Client-<version>-setup.exe.blockmap the differential block index (for the updater)
release/latest.yml                                     the version manifest (for the updater)
```

The last two are produced because of the `publish` section in `electron-builder.yml`. **All three must be uploaded together when releasing**, otherwise installed clients either will not see the new version or can only re-download the whole package. (If you built locally just to test, you can ignore them.)
