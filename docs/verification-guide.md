# Graphical Environment Verification Guide (Windows)

[English](verification-guide.md) | [简体中文](verification-guide.zh-CN.md)

This guide is for verifying dsh-remote-client on **Windows**.

This development environment is a GUI-less Linux container, so the following **cannot be verified here**: window appearance, how the menus and the tray actually render, login-state persistence, offline reconnect behaviour, and so on. This guide exists precisely to have them verified one by one.

> ✅ **Already confirmed on real hardware**: the client can connect to dsh (via "local address + the full URL carrying `?token=`", i.e. the launch-token handshake).
> The items below still need your confirmation.

> 📌 **Windows note**: the implementation was originally written with macOS/Linux habits; after the environment was recognized as Windows we added fixes for several problems that would have shown up immediately (an empty tray icon possibly not being displayed, close-window-quits conflicting with the chosen capability, etc.). **Please verify against the latest built installer.**

> **Note on language**: the client UI itself is in Chinese, so menu and button names are kept in their original Chinese form with an English gloss in parentheses, e.g. 「编辑(E)」 (Edit(E)), 「重新加载」 (Reload). Command blocks are kept byte-identical to the Chinese original; where a block contains a Chinese comment, an English gloss follows immediately after the block.

---

## 0. Preparation

### 0.0 Fastest path: use the installer directly (recommended)

**If all you want to verify is "can the client be used", you do not need any development environment** — the installer has already been built:

```
release/DSH.Remote.Client-<version>-setup.exe   (about 106MB, Electron runtime bundled in)
```

`<版本>` is the version of the copy you obtained (see the filename or the Release
title) — it is **deliberately not hard-coded**, for the same reason the SHA256 below
is not: it changes with every release, so a hard-coded value inevitably becomes wrong
after some version (that already happened once: the guide still carried the 0.1.0 hash
while 0.1.1 was the published build).

(The annotation means: about 106MB, with the Electron runtime bundled in.)

To check the package is the right one, compare its **SHA256** — the value is printed in
the matching GitHub Release notes (CI prints it during the build). It is deliberately
**not** hard-coded here: it changes with every build, so a hard-coded value is bound to
go stale — and a stale hash is worse than none, because it makes people think they
downloaded the wrong file.

> **From v0.1.8 the artifact name is fixed at `DSH.Remote.Client-<version>-setup.exe`**
> (dot-separated, no spaces), so a local build and the Release asset carry **exactly the
> same name**.
>
> v0.1.7 and earlier were different: `artifactName` used `${productName}`, and
> `productName` contains spaces, so one package ended up with three different names
> (spaces on disk, hyphens in `latest.yml`, dots on the GitHub asset). That is what made
> v0.1.7's auto-update 404 — the updater looks for the name in `latest.yml`, while the
> Release only had the dotted one. See the comment above `artifactName` in
> `electron-builder.yml`.

Double-click to install (no administrator privileges needed), then jump straight to §1.

> ⚠️ Not code-signed, so SmartScreen will say "unknown publisher" → click "More info" → "Run anyway".

**Only if you need to change the code / rebuild** do you need the development environment below.

### 0.1 Development environment requirements (only needed when changing code)

- **Node.js ≥ 20.19** (download the LTS from [nodejs.org](https://nodejs.org/), and tick "Add to PATH" during installation) — the build toolchain (vite / electron-vite) actually requires `^20.19.0 || >=22.12.0`. If you use the **cross-build script** (§0.2 option 1), it separately requires `≥ 22.12`; see the header of `scripts/build-windows.sh`
- **pnpm**: after installing Node, open PowerShell and run
  ```powershell
  corepack enable
  corepack prepare pnpm@latest --activate
  ```
  (Node ships corepack, which is cleaner than `npm i -g pnpm`)

Verify:
```powershell
node -v      # 应 ≥ v20
pnpm -v
```
(`# 应 ≥ v20` = "should be ≥ v20".)

### 0.2 Copy the code to Windows

The repository is about **590K** (61 files, excluding `node_modules`), so transferring it is light. Pack it on the development machine:

```bash
# 开发机（Linux 容器内）
tar czf /tmp/dsh-remote-client.tar.gz \
  --exclude=node_modules --exclude=.git --exclude=out --exclude=.tmp \
  -C /workspace/code dsh-remote-client
```
(`# 开发机（Linux 容器内）` = "development machine (inside the Linux container)".)

Windows 10 1803+ **ships `tar`**, so you can extract it directly:

```powershell
# Windows PowerShell（在你想放项目的目录，例如 D:\dev）
tar xzf dsh-remote-client.tar.gz
cd dsh-remote-client
```
(`# Windows PowerShell（在你想放项目的目录，例如 D:\dev）` = "Windows PowerShell (in the directory where you want to put the project, e.g. D:\dev)".)

> If `tar` is unavailable, pack it as a zip instead and extract it in File Explorer.
> This repository currently **has no git remote configured**, so copying is the only option; if you want to collaborate over git, just add a remote to it.

### 0.3 Install dependencies

```powershell
pnpm install
```

**This step downloads about 100MB of Electron binaries** (this development environment skipped it with `ELECTRON_SKIP_BINARY_DOWNLOAD=1`; on Windows the real download is needed). If your network is slow, you can set a mirror:

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
pnpm install
```

---

## 1. Key starting point: prefer verifying with `127.0.0.1`, which needs zero configuration

**If dsh-docker runs on this Windows machine** (Docker Desktop / WSL2), add the host as `http://127.0.0.1:3080` — this is the least troublesome path and sidesteps two pitfalls at once:

| Pitfall | With 127.0.0.1 |
|---|---|
| dsh's trust fence rejects non-loopback Hosts (the page opens but `/api` is all 403) | `127.0.0.1` is loopback, so it is **allowed straight through** — no need to configure `DSH_TRUSTED_HOSTS`, no need to install `dsh-remote` |
| Plaintext HTTP is not a secure context (clipboard stops working) | `127.0.0.1` is a trusted origin as far as the browser is concerned, so it **is a secure context** and the clipboard works normally |

Only when you need to access it via a **LAN IP or domain** do you have to deal with these two things (see §6).

> Docker Desktop maps container ports to Windows' `localhost` by default, so this path works out of the box.

---

## 2. Getting started: the minimal loop (highest priority)

```powershell
pnpm dev
```

**Expected**: a window titled 「添加 dsh 主机」 (Add dsh Host) appears (560×420), containing two input fields — address and display name — and an 「添加并打开」 (Add and Open) button.

**This step verifies the two P0s fixed in phase 1**:
- `out/renderer/` was previously not generated at all → **white screen on first launch**
- the preload previously inlined the whole npm `electron` package → `window.shell` was `undefined` → **clicking the button did nothing**

**If the screen is white**: press `Ctrl+Shift+I` in the window to open DevTools and look at the Console. The terminal running `pnpm dev` also prints main-process errors.

**If the button does nothing**: type `window.shell` in the DevTools Console; if it is `undefined`, the preload failed to load.

---

## 3. Core verification: connect to a real dsh

Fill in the address on the welcome page and submit.

**Expected (in order)**:
1. After submitting, the host window opens immediately, with the host display name as the title at first;
2. **Remote online** → the dsh UI or the login page appears (depending on whether `dsh-remote` is installed);
3. **Remote unreachable** → the shell's own offline page, giving the failure reason plus a `DSH_TRUSTED_HOSTS` hint.

**Then confirm each item**:

| Item | Action | Expected |
|---|---|---|
| Login-state persistence | Log in → **tray → 「关闭客户端」 (Close Client)** (not closing the window) → restart the client | Goes straight into the logged-in state |
| Multi-host isolation | Add a second host (a non-existent address will do) → switch back to the first from the **tray's 「主机列表」 (Host List)** | The two hosts' login states do not affect each other |
| Tray | Look at the bottom-right of the taskbar (you may need to click `^` for "show hidden icons") | A **whale** icon; the right-click menu contains 「打开客户端」 (Open Client) / 「主机列表」 (Host List) / 「添加主机…」 (Add Host…) / 「编辑主机…」 (Edit Host…) / 「关闭客户端」 (Close Client) |
| Host switching | Tray 「主机列表」 (Host List) → click another host | The window switches to that host |
| Edit host | Tray → 「编辑主机…」 (Edit Host…), or press `Ctrl+E` | You can **dropdown-select any** host at the top of the window (no need to switch to it first); changing the display name / address / token and saving takes effect |
| Reset login state | Tray 「主机列表」 (Host List) → a host → 「重置登录态」 (Reset Login State) → reopen that host | Back to the login page |
| Delete | Tray 「主机列表」 (Host List) → a host → 「删除…」 (Delete…) | A confirmation dialog pops up (the default button is 「取消」 (Cancel), so **pressing Enter by accident will not delete**); after deleting, the menu no longer lists it |
| **Top strip follows the theme** | **Change the skin** in dsh's settings (e.g. dark ↔ light) | The top strip of the window (the title bar dsh draws itself) **changes colour with it** and matches the page skin; the system minimise/maximise/close buttons remain usable and clearly visible |
| Reload page | Press `Ctrl+R` in the dsh window | The page reloads (re-requests the host origin; the same as the tray’s 「重新加载」 (Reload)) |
| DevTools | Press `Ctrl+Shift+I` or `F12` in the dsh window | Opens the developer tools (for diagnostics, and also the entry point to the DOM recon script) |
| Drag-and-drop upload | Drag a local file into the dsh window | It goes into the remote workspace as an attachment (a front-end capability; the shell does not handle it) |

> ⚠️ **「打开」 (Open) is not the same as 「刷新」/「重新加载」 (Refresh / Reload)**
>
> For a host that is **already open**, choosing 「打开」 (Open) only brings the window to the foreground (`show()` + `focus()`) and **does not reload the page** — this is deliberate, to avoid two WebSockets coexisting for the same address.
>
> **When you need to reload the page, use 「主机列表」 (Host List) → that host → 「重新加载」 (Reload), or press `Ctrl+R`.**

### 3.00 UI composition: on Windows, host management lives in the tray

> **Every 「tray → …」 and 「Host → …」 entry point below also exists in the menu bar on macOS / Linux** (those platforms keep framed windows, so their menu bar is still shown). On Windows, always go through the tray.

**The window on Windows** (the focus of this section, because it differs from the other platforms):

```
┌────────────────────────────────────────────┬──────────────┐
│  (title bar drawn by dsh: follows the app  │  ─  □  ✕     │  ← system window buttons
│   theme, draggable)                        │              │     are drawn at its right
├────────────────────────────────────────────┴──────────────┤
│                       the dsh page                         │
└────────────────────────────────────────────────────────────┘
```

- The window is **frameless**: the system title bar is gone, and the top strip is drawn by dsh itself — which is why it **changes colour together with the skin plugin**.
- The **native menu bar is not shown** (Electron defines frameless as *no chrome*, and chrome explicitly includes toolbars). Its accelerators still work (`Ctrl+N` to add a host, `Ctrl+E` to edit one, `Ctrl+Q` to quit), but they are **invisible** — once the menu bar is hidden, these keys have no surface left to advertise them.
- Because the menu bar is gone, **all host management lives in the tray** (next section).

**System tray** (bottom-right of the taskbar; you may need to click `^` to expand hidden icons) — both host management and on/off live here:

```
打开客户端     ← raise the window (bring it back if hidden; reopen for the current host if destroyed)
──────────────
主机列表 ▸          ← one submenu per host: 打开 / 重新加载 / 立即重试 / 重置登录态 / 删除…
添加主机…       ← Ctrl+N
编辑主机…       ← Ctrl+E (the window lets you dropdown-switch to any host)
──────────────
关闭客户端     ← really quit (clicking the window's ✕ only hides it and does not quit)
```

(「打开客户端」 = Open Client, 「主机」 = Host, 「添加主机…」 = Add Host…, 「编辑主机…」 = Edit Host…, 「关闭客户端」 = Close Client. Per-host items: 「打开」 = Open, 「重新加载」 = Reload, 「立即重试」 = Retry Now, 「重置登录态」 = Reset Login State, 「删除…」 = Delete….)

> **Why the tray took host management back**: the tray used to carry only 「打开客户端」 (Open Client) and 「关闭客户端」 (Close Client), on the grounds that host management was **already fully available in the menu bar** and the tray is the historically least reliable part. That reasoning held at the time, but its **premise is now gone**: once the Windows window became frameless the menu bar stopped being shown, and 「编辑主机…」 (Edit Host…) and 「删除主机…」 (Delete Host…) **have no keyboard shortcut** — not moving them into the tray would have meant losing those entry points entirely.
>
> **The icon recolors with the system theme**: a **black whale** in the light theme, a **white whale** in the dark theme, and **grey** while offline-retrying (offline takes precedence over the theme).
>
> **The menu is rebuilt as the configuration changes**: after adding/removing a host, switching the current host, or a change in offline state, the tray menu immediately reflects the latest state instead of sitting on a stale list.

**If the tray does not appear**, start the client from the **command line** to capture logs (it will explicitly print the failure reason instead of failing silently):

```powershell
& "$env:LOCALAPPDATA\Programs\DSH Remote Client\DSH Remote Client.exe"
```

Watch for `[dsh-remote-client] 托盘创建失败…` or `启动流程失败…`. (Those mean "tray creation failed…" and "startup flow failed…".)
**On Windows, an unusable tray means host management has no entry point at all** (the menu bar is no longer shown), so this item matters more there than ever; if it really fails, start from the command line as shown above to capture the evidence, and use `Ctrl+N` to add a host in the meantime.

> Additional note: if the tray **fails to assemble**, the app falls back to the "quitting when all windows are closed" behaviour. This is deliberate — otherwise the app would become a ghost process that you can neither see nor quit.

### 3.000 dsh without the auth plugin: you must paste the full URL with the token

If your dsh **does not have** an auth plugin such as `@xgone/dsh-remote` installed, it enables dsh's native **launch token** protection:
visiting the address directly returns `401 dsh web authentication required; reopen the URL printed by dsh web.`

**The correct approach**: paste **the whole line of URL printed when `dsh web` starts** into 「添加主机…」 (Add Host…) unchanged:

```
http://127.0.0.1:3080/?token=xxxxxxxxxxxxxxxx
```

The client splits it into the origin (`http://127.0.0.1:3080`) and the token by itself, and **completes the handshake on first load using the URL that carries the token** (exchanging it for a cookie stored in that host's partition); after that everything is normal.

> ⚠️ **Copy the whole thing; do not hand-edit that token string.** The URL standard decodes `+` in the query as a space — if the token happens to contain `+`, hand-copying is very error-prone. Copy and paste is the most reliable.

> ⚠️ **This token changes every time dsh restarts** (it is randomly generated when the process starts, and no configuration can pin it).
> If you get a 401 again after a dsh restart, the client automatically **replays** the handshake once; if that still fails, use the **tray's 「添加主机…」 (Add Host…)** to paste the **new** token-carrying address again
> (on macOS / Linux that entry point is in the menu bar's 「编辑(E)」 (Edit); on Windows the menu bar is not shown, so the tray is the only way in.
> Re-adding the same address does not lose the saved login state — partitions are named after the origin).

### 3.0 Addresses behind an SSO portal: after logging in you must manually 「重新加载」 (Reload)

If your dsh address goes through a login portal (typically the UGREEN UGOS container remote address
`https://app-3080-<name>.ugdocker.link/`), you will hit this:

1. The client loads the address → gets **302**-redirected by the portal to the login page;
2. You log in successfully → the portal jumps to **its own desktop** and **does not redirect back** to the original address;
3. So the client sits on the portal desktop and **never reaches dsh**.

**This is not a client failure, and the address is not filled in wrongly** — visiting the same address in a browser "once more while already logged in" goes straight into dsh.

**What to do**: after completing the login in the client window, use the **tray's 「主机列表」 (Host List) → that host → 「重新加载」 (Reload)** (or press `Ctrl+R`; on macOS / Linux this entry point is in the menu bar's 「主机(H)」 (Host)).
The client will then re-request **the original address from the configuration** (instead of staying on the portal desktop), carrying the login state it has just obtained, and you get into dsh.

> Using `webContents.reload()` does not work — that only loads the portal desktop once more. This is also why 「重新加载」 (Reload) was made a separate menu item instead of reusing 「打开」 (Open).

> **Addition (after changing the token)**: once editing the host has updated the launch token, clicking 「重新加载」 (Reload) should also get you into dsh. The window receives the latest configuration along with it, and on a 401 it replays the handshake with the **new** token.

### 3.05 Link and window behaviour

When you click a link, the client routes it by "**is this target a site we already know?**":

| Action | Expected |
|---|---|
| Clicking the **dsh icon** in the portal (whose address is exactly the host you configured) | The **current window** becomes dsh (it does **not** open a new window) |
| Clicking an **external link** inside dsh (e.g. GitHub) | Goes to the **system default browser** |
| Clicking **the portal's own page** inside the portal (an in-site navigation) | Navigates in the **current window**, does not go to the browser |
| Clicking a non-web link such as `mailto:` | Handed to the system |

**Routing rules** (only `scheme://host:port` is compared; the path and query do not participate):

1. The target is **one of your configured hosts** → open inside the client
2. The target is **the site the current page is on** → open inside the client
3. Everything else → the system browser

**Comparison is normalized first**, so forms like `https://GitHub.com`, `http://x:80` and `http://x:3080/` are all recognized correctly.

**Other window behaviour**:

| Action | Expected |
|---|---|
| Window title | Of the form `主机名 — 页面标题` (**prefixed with the host name**) |
| Top of a content window (one opened by the page itself) | **No** menu bar (the menu bar only grows on host windows) |
| Pressing `Ctrl+W` in a content window | Closes that window |

> ⚠️ **A known semantic trade-off**: if some icon points at **another** host you have configured, the current window will load it, but the "current host" is still the original one — in that case clicking the menu's 「重新加载」 (Reload) pulls you back to the original host. Single-host setups are unaffected.

### 3.1 Windows-specific: close-window behaviour (a fixed item, verify carefully)

**Before the fix**: closing the host window on Windows = the app quits immediately and the tray disappears.
**After the fix**: closing the window should **minimize to the tray** and the app should keep running.

**Verification steps and expected results**:

| Action | Expected |
|---|---|
| Clicking the ✕ in the top-right of the host window | The window disappears, but the **tray icon is still there** and the app has not quit |
| Tray → 「打开客户端」 (Open Client) | The window reappears and takes focus (it is not a newly opened window) |
| Tray → 「关闭客户端」 (Close Client) | The **app actually quits** and the tray icon disappears |
| Closing the ✕ of the 「添加 dsh 主机」 (Add dsh Host) welcome window | That window closes normally (it does **not** minimize to the tray) |

> If the app is simply gone after closing the window, the W-2 fix did not take effect — please report it.

---

## 4. Offline and auto-reconnect (a fixed item, verify carefully)

The spec requires exponential-backoff retry (1s→2s→4s→8s→…→30s), which **was previously not implemented at all**.

**Steps**:
1. Open a host that is already connected;
2. Stop dsh-docker: `docker compose stop` (or `docker stop dsh`);
3. Watch the window.

**Expected**:
- The window switches to the offline page;
- **A countdown appears in the window title** (of the form 「离线，N 秒后重试」, i.e. "offline, retrying in N seconds", with the interval doubling each time up to a 30s cap);
- The tray icon turns **grey** and the tooltip shows 「（离线，正在重试）」 ("(offline, retrying)");
- 「立即重试」 (Retry Now) appears for that host under the tray's 「主机列表」 (Host List); clicking it retries immediately (on macOS / Linux it is under the menu bar's 「主机(H)」 (Host)).

**Recovery**: `docker compose start`.

**Expected**: the client **recovers automatically** to the dsh UI, with no manual intervention.

> ⚠️ Note: if the dsh page **has already rendered in the window**, the container may be stopped while the front end still shows the old UI (the WebSocket is disconnected), whereas the shell's offline page only triggers when the page **fails to load**. **If you see "the UI is still there but it cannot connect" instead of the offline page, that is expected behaviour** — please tell me about it, because it determines whether phase 2 needs to add "also show offline when the WebSocket disconnects".

---

## 5. Automatic (differential) updates — ⚠️ requires v0.1.8 to be published first

**This is the one section that cannot be run yet.** The reason is below.

### 5.0 Why it cannot run yet: two releases are required

Automatic updating verifies that an *old* client can fetch a *new* version, so it inherently needs two versions:

| Version | Contents | Who installs it |
|---|---|---|
| **v0.1.7** | Ships the updater and `latest.yml` / `.blockmap` for the first time | Still a **manual install** (the last 106MB one) |
| **v0.1.8** | Any small change | **Nobody** — an installed 0.1.7 should find it by itself |

Therefore:

- **Before v0.1.8 is published**, 0.1.7 can only be used to verify "it does not error and does not affect normal use" (§5.1). There is no target version to update to, so nothing happens — that is correct behaviour, not a defect.
- **After v0.1.8 is published**, the full chain in §5.2 can be verified.

### 5.1 Before v0.1.8: confirm it stays out of the way (do this now)

These four checks can be run right now, and **any failure is a real defect**:

| Action | Expected |
|---|---|
| Launch the client normally (installed package) | UI, tray and host connection are **exactly as before**, no different from 0.1.6 |
| Launch it, then leave it idle for **1 minute** while watching | **No window or dialog ever appears** (including no pointless "you are up to date" notice) |
| **Launch with the network down** (pull the cable / turn off Wi-Fi) | Still **no error dialog**. Only one line in `update.log`: `检查更新失败（已忽略，不影响使用）…` |
| Launch in `pnpm dev` development mode | Nothing pops up either. The updater **does not start at all in development mode** (there is no `app-update.yml`, and starting it would only spam error logs) — this is deliberate |

> **Where to read the log (definitive answer since v0.1.7)**
>
> The updater writes its key steps to `update.log` in the **user data directory**, which
> works for a packaged build too — no command line needed:
>
> ```powershell
> Get-Content "$env:APPDATA\dsh-remote-client\update.log" -Tail 20
> ```
>
> If that path does not exist, locate it with:
>
> ```powershell
> Get-ChildItem $env:APPDATA -Recurse -Filter update.log -ErrorAction SilentlyContinue |
>   Select-Object FullName
> ```
>
> Each line carries an ISO timestamp:
>
> ```
> 2026-10-11T02:31:07.512Z 更新器启动（当前版本 0.1.7，日志位于 update.log）
> 2026-10-11T02:31:37.480Z 开始检查更新（当前版本 0.1.7）
> ```
>
> It keeps at most the latest 200 lines (each truncated to 400 characters), so it
> **cannot grow without bound** and can safely be left in place.
>
> Before this log existed, this section said "start the installed exe from a command
> line, or open the DevTools Console" — which is effectively impossible for an end user,
> leaving "why did the update do nothing on a real machine?" with no evidence at all.
> `update.log` is that evidence now.

### 5.2 After v0.1.8 is published: the full chain (this is the important part)

**Precondition**: v0.1.8 has been published to a Release as a tag, and that Release **contains all three files** — `setup.exe`, `latest.yml` and `*.exe.blockmap` (see "Three files in the Release" in the README).

Run these in order and **look at the result of every step**:

| # | Action | Expected | What a failure means |
|---|---|---|---|
| 1 | Confirm you are running **0.1.7**, launch the client and wait about **30 seconds** | `update.log` shows 「开始检查更新」 (an update check started) — see §5.1 for how to read it | The timer never fired |
| 2 | Leave it running and wait for the background download to finish | A dialog appears: 「新版本 **0.1.8** 已下载完成，现在重启安装吗？」 with buttons 「立即重启」 / 「稍后」 | The quiet-period/policy logic swallowed the prompt |
| 3 | **Record the actual number of bytes downloaded** (see below) | Clearly less than 106MB | Differential download did not take effect and it fell back to the whole package |
| 4 | Click **「立即重启」 (Restart now)** | The app **really does exit**, installs briefly, **reopens by itself**, and the version is now **0.1.8** | ⚠️ See "Known trap" below |
| 5 | Confirm the version after the restart | About box / window title / the version corresponding to `package.json` are all 0.1.8 | The install did not actually complete |
| 6 | **Start a fresh round**: click 「稍后」 (Later) and do nothing else | The dialog closes with **no side effects at all** (window, tray and host connection all unchanged) | The update disturbed the main path |
| 7 | Continuing from above: **fully quit the client and start it again**, then wait for another check | **It does not ask about 0.1.8 a second time** (the user has already answered) | The state was not remembered and the user gets nagged repeatedly |
| 8 | After restarting, publish a **0.1.9** to the Release (if you are willing to test it) | It prompts **again**, for 0.1.9 | The state is remembered but is not reset when the version changes |

**How to record the download size in step 3**: the only real evidence that differential download works is how much was actually transferred. The most direct way is to watch the process's received traffic during the download in a system resource monitor (Windows Task Manager → Performance → Ethernet); if you launched it from a command line you can read the updater output directly. **Write the number down** — it decides whether differential updates are worth keeping at all.

**Why step 4 is the single most important item in this section**:

> ⚠️ **Known trap (already fixed this round, see commit `11239d3`): for a quit initiated by `quitAndInstall()`, Electron emits `before-quit` *after* emitting `close` on all windows — the *opposite* of a normal `app.quit()`.**
>
> In this app the host window's `close` is intercepted as "hide to the tray", and only `quitting === true` lets it through. So if you set the flag only when `before-quit` fires, it is still `false` when `close` reaches the interceptor → `preventDefault()` → **Electron cancels the entire quit sequence**. The symptom is exactly "you clicked Restart now, the window disappeared, but the version did not change" — and it happens **every time, not intermittently**.
>
> The fix is to set `quitting` *before* calling `quitAndInstall()`, once the user has confirmed (this is part of the `UpdaterDeps.promptRestart` contract, and is commented in both `src/main/updater.ts` and `src/main/index.ts`).
>
> **For anyone changing this feature later**: this path is only reached in a packaged build *and* only when an update has genuinely finished downloading — **neither the unit tests nor the artifact assertions can reach it**. If you touch the quit flow, the window `close` interceptor, or the dialog plumbing, you must come back and re-run step 4. Please also read the comment on `handleDownloaded` in `src/main/updater.ts` while you are there.
>
> 📌 **Do not misremember this defect as a "registration order" problem.** An earlier draft of the design doc said to "confirm that `before-quit` is registered before the updater" — that is **the wrong question**: the registration order is correct by construction (`before-quit` is registered at module top level, while `installUpdater` only runs inside `boot()`), so checking it **can never find the problem**. The real variable is the **event firing order**, and the corresponding acceptance check is step 4.

---

## 6. LAN / remote access (optional, advanced)

When you want to use a **LAN IP or domain** (not 127.0.0.1):

**5.1 trust fence** (otherwise the page opens but `/api` is all 403) — configure it in dsh-docker's `.env`:
```
DSH_TRUSTED_HOSTS=192.168.1.5:3080
```
Or install the auth plugin:
```bash
docker exec dsh dsh plugin --profile web add @xgone/dsh-remote
docker restart dsh
```

**5.2 secure context** (otherwise the clipboard stops working)

For **configured `http://` origins** the shell sets `unsafely-treat-insecure-origin-as-secure`, but **that switch can only take effect at startup**.

After adding `http://192.168.x.x:3080` for the first time, the welcome page shows a yellow hint and provides a **「立即重启」 (Restart Now) button** — press it, and only then is that origin included in the switch list.

> Known minor UX wart: **re-adding the same http host** within the same session still prompts once more (semantically correct — it really has not taken effect yet, but it feels wordy).

**5.3 Verify isolation**: add both an `http://` and an `https://` host and confirm their login states do not interfere.

---

## 7. Known limitations (so you do not misjudge them as defects)

The following are **known by design**, not bugs:

- **Native notifications**: **approval notifications are verified working** (the selectors come from the dsh upstream component source `dsh-client-ui-approval`, so no on-device recon is needed). **Message notifications** (reminding you when an agent reply has finished) were just added and are **awaiting on-device verification** — note that they **only pop up while the window is unfocused**, so you must switch away from the window to verify them; approval notifications, by contrast, pop up unconditionally (the agent is sitting there waiting for you).
- **Changing the IP or domain of an `http://` host = a new host**, requiring you to log in again. This is caused by dsh's cookie name being bound to the authority (`sha256(authority)`).
- **Only one host window is kept**: switching hosts closes the old window.
- **On macOS a content window still shows the menu bar**: on Windows/Linux it has been removed per window; on macOS the menu is **application-level**, and removing it per window would also affect the host window's menu, which is not worth it. **macOS only.**
- **A page that relies on the return value of `window.open` will error**: to make links open in the **current window** we must reject Electron's default "open a new window" behaviour, so `window.open()` returns `null`. If the page then uses that return value (e.g. `w.focus()`) it throws a JS error — the impact is limited to that page itself, and **the navigation has already been done by us**.
- **One trade-off in link routing**: see §3.05 — if an icon points at **another** configured host, the current window loads it but the "current host" does not change.
- **Unsigned app**: if you package an exe later, Windows Defender / SmartScreen may warn; running in `pnpm dev` development mode does not involve this.
- **Automatic updates only work in a packaged build**: under `pnpm dev` the updater does not start at all (there is no `app-update.yml`, and starting it would only spam error logs). **So no update behaviour can be verified in development mode** — you must use the installer (see §5).
- **Every failure in automatic updating is silent**: no network, an unreachable update source or a malformed `latest.yml` all leave just one line in `update.log` and **never show a dialog**. This is deliberate (the user is not waiting for an update, so interrupting them is a net negative) — which means **"nothing happened" is usually correct behaviour**, so do not rush to report it as a defect. To tell whether it is running at all, read `update.log` (§5.1 shows how): it separates "there genuinely is no new version" from "it failed silently", which is exactly why the log exists.
- **Only prompting once is not forgetfulness**: once the user has been asked about a version, it is never asked again (the state lives in `userData/update-state.json`). If you want to see the dialog again, delete that file.
- **Versions 0.1.6 and earlier do not auto-update**: there is no updater in them. They must be **manually upgraded to 0.1.7 once**, after which they are on the automatic update path.
- **Uninstalling keeps `update-state.json`**: it is kept along with the other user data (uninstalling does not clear `userData`). The "already prompted version" therefore carries over after a reinstall, which is deliberate.

---

## 8. Report template for problems

```
【步骤】§3.1 关窗行为
【操作】点主机窗口的 ✕
【预期】窗口消失、托盘仍在、应用未退出
【实际】应用直接退出，托盘消失
【证据】
  - pnpm dev 终端输出：<粘贴>
  - DevTools Console 报错：<粘贴>
  - 截图/录屏：<如有>
【环境】Windows 11 23H2 / Node 20.11 / pnpm 9；远端 = Docker Desktop 本机
```

(The block above is a fill-in template and is kept verbatim in Chinese on purpose. Field labels: 【步骤】 = Step, 【操作】 = Action, 【预期】 = Expected, 【实际】 = Actual, 【证据】 = Evidence; `pnpm dev 终端输出` = `pnpm dev` terminal output, `DevTools Console 报错` = DevTools Console error, `截图/录屏` = screenshot / screen recording, 【环境】 = Environment, `远端` = remote.)

**The three most valuable pieces of information**:
1. The **complete terminal output** of `pnpm dev`
2. The **verbatim error text** from the DevTools Console (`Ctrl+Shift+I`)
3. The **actual text** in the window title bar (to judge the countdown and the title logic)

---

## 9. Run the automated part first (can be done in parallel with GUI verification)

Before GUI verification, confirm the automated part is green:

```powershell
pnpm test        # 构建 + 全部测试（含构建产物断言）
pnpm typecheck
```

(The comment means "build + all tests (including build-artifact assertions)".)

Expected: `Tests passed`, typecheck exit code 0, and exactly 5 artifact files under `out\`.

That command caught two P0s in phase 1 (`out/renderer/` not being generated, the preload inlining the electron package), **which neither the unit tests nor the type check could catch** — so if you see anything odd around the build, `pnpm test` is the first sieve.
