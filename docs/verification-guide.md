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
| Tray/menu host list → "**Open**" on a host | That host opens **inside the current window** (replacing it) |
| Tray/menu host list → "**Open in new window**" on a host | That host opens in **another window**, keeping the current one (parallel multi-host) |

> **"New window" lives in the menu, not in page links**: links inside pages (including a
> dsh icon on a portal) always open in the current window. To watch two hosts side by
> side, use "Open in new window" in the host list — the intent is stated **per action**.
> A single host never gets two windows (two WebSockets against the same dsh is both
> wasteful and makes page state fight itself), so either action merely focuses a host
> that is already open.

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

## 4. Client settings window (added in 0.2.0 / 0.2.1, verify carefully)

The **client's own** behaviour preferences. These settings **only affect the client** (notifications, startup and close-window behaviour, updates) and do **not** touch the remote dsh — dsh's own preferences are still managed by the settings panel inside the dsh web UI.

### 4.0 The three entry points (all three must work)

| Entry point | Action | Expected |
|---|---|---|
| Tray | Tray → 「**客户端设置**」 (Client settings) | Opens the 「客户端设置」 (Client settings) window (560×640) |
| Menu bar | 「编辑(E)」 (Edit(E)) → 「**设置…**」 (Settings…) | The same window (macOS / Linux; on Windows the menu bar is not shown — see §3.00) |
| Shortcut | `Ctrl+,` (`Cmd+,` on macOS) | The same window |

> ⚠️ **`Ctrl+,` must work on Windows.** This one is deliberately double-registered: once on the application menu and once as an **in-window** `before-input-event` handler. On Windows the host window is frameless and the menu bar is not shown at all, so with only the menu-bar registration this key would **do absolutely nothing**. Please verify this one specifically.
>
> **Only one settings window may exist**: invoking an entry point while it is already open must **raise the existing window** (restoring it first if minimised), **not** open a second one. Two windows editing the same `settings.json` would overwrite each other.

### 4.1 The five preferences plus the version area (confirm each one exists and saves)

| Group | Setting | Default | Expected behaviour |
|---|---|---|---|
| Notifications | 「弹出系统通知」 (Show native notifications) | **on** | When off, neither approval requests nor new messages raise a system notification |
| Notifications | 「消息通知的静默期」 (Quiet period for message notifications) | **15 seconds** (range 15–300) | After a round of output ends, wait this long with no new output before notifying. **Approval notifications ignore it** and always fire immediately |
| Startup & close | 「启动时」 (On startup) | **Open the last host** | Switchable to 「每次显示「添加主机」页」 (always show the "Add host" page) |
| Startup & close | 「关闭窗口时收进托盘（不退出）」 (Hide to tray instead of quitting) | **on** | When off, **closing the window quits** the client |
| Updates | 「启动后在后台检查新版本」 (Check for updates after startup) | **on** | When off, **the updater is not wired up at all** (you will not even get the "restart to install?" prompt) |
| Updates | 「当前版本」 (Current version) + 「立即检查更新」 (Check for updates now) | — | See §4.4 |

**The five preferences all default to the pre-0.2.0 hard-coded behaviour** — after upgrading, not touching them should leave behaviour **exactly as before**.

> Try one out-of-range value on the quiet-period input: enter `0` or `9999`; on save the box should be **corrected to 15 / 300** (clamped once in the UI layer and once in the main process).

### 4.2 Changes take effect immediately (no restart)

The settings window does **not** do the "takes effect after a restart" thing: consumers read the **current** value rather than a snapshot taken at startup. Verify each one:

| What you change | How to verify immediately | Expected |
|---|---|---|
| Turn off 「弹出系统通知」 (Show native notifications) | Let the agent finish a round, then switch away from the window | No notification appears any more |
| Set the quiet period to 60 seconds | Let the agent finish a round, then switch away | The notification appears **clearly later** than 15 seconds |
| Turn off 「关闭窗口时收进托盘」 (Hide to tray) | Click the ✕ of a host window | **The app quits outright** (the opposite of §3.1's default behaviour) — please turn it back on afterwards |
| Set 「启动时」 (On startup) to always show the "Add host" page | Quit the client and start it again | It stops on the welcome page even though hosts were configured |
| Turn off 「启动后在后台检查新版本」 (Check for updates after startup) | Restart the client, wait more than 30 seconds, read `update.log` | 「开始检查更新」 (an update check started) no longer appears (see §8.1) |

> ⚠️ The "close quits" item takes effect **immediately, on windows that are already open** (host behaviour reads the current value). If it still hides to the tray after you change it, the read-fresh behaviour is not working — please report it.

### 4.3 Where settings live and what happens when the file is corrupt

Settings live in `%APPDATA%\dsh-remote-client\settings.json` (`%APPDATA%` is `app.getPath('userData')`).

**Verifying "a corrupt file is never silently discarded"**:
1. Note down any values you changed; quit the client completely;
2. Replace the contents of `settings.json` with text that is **not JSON** (e.g. `{{{`);
3. Start the client again → open the settings window.

**Expected**:
- A backup **`settings.json.corrupt-<timestamp>`** appears in the same directory (the original was renamed to preserve the evidence);
- The settings window shows **all default values**, and the client is fully usable.

> 📌 **"The file is old" and "the file is broken" are handled differently — do not confuse them.** A `corrupt-` backup is produced **only when the file is not JSON at all**. If the file parses but is merely **missing a field** (written by an older version, fewer items than the current one), each missing field simply falls back to its default — and **no backup is produced**. Renaming a file that parses would leave users staring at a folder full of mysterious `corrupt` files.
>
> So do **not** expect a backup from "set one field to an illegal value" either: that case is per-field fallback (the bad one reverts to its default, the rest are kept as they are), and it also produces no backup.

### 4.4 Settings → Updates: version number and "check for updates now" (added in 0.2.1)

The 「更新」 (Updates) group should show the **current version number** and offer a 「立即检查更新」 (Check for updates now) button.

| Scenario | Action | Expected |
|---|---|---|
| Version number | Open the settings window and look at 「当前版本」 (Current version) | Shows the **version you are actually running** (of the form `0.2.5`, **without a `v` prefix**, matching the installer filename and `package.json`) |
| Packaged build, button pressed | Install via the installer, then press 「立即检查更新」 (Check for updates now) | 「正在检查…」 ("Checking…") appears briefly, then one of the outcomes in the table below |
| **Development mode** | Open the settings window under `pnpm dev` | The version shows normally; the button is **disabled** and already explains why: 「当前未启用更新检查（开发模式下不检查；也可能是你把上面的开关关掉了）。」 |

> ⚠️ **In development mode the button must be "disabled + explains why", not "does nothing when clicked"** — a button you cannot press is worse than no button. **This one can be verified in development mode**, no installer needed.

**The outcome messages** (five of them — just check each one lines up):

| Outcome | Message |
|---|---|
| Up to date | 已是最新版本。 |
| New version found | 发现新版本 **X**，正在后台下载；下载完成后会询问是否重启。 |
| Downloading | 新版本 **X** 正在下载中，请稍候。 |
| Failed | 检查更新失败（网络不通或更新源异常）。稍后会再自动检查，不影响使用。 |
| Not enabled | 当前未启用更新检查（开发模式下不检查；也可能是你把上面的开关关掉了）。 |

> ⚠️ **The X in "发现新版本 X" must be the *new* version, not the current one.** There was a real on-device defect here: the upgrade dialog said 0.2.2 had finished downloading, while the same page read "found new version 0.2.1" — the root cause being that the field was filled with the version **currently running** (fixed in 0.2.3). **When verifying, check that the version in the message is not the same number as the one you are running.**
>
> When the version cannot be read the UI shows 「**未知**」 ("unknown"). **Inventing a version number is far worse than saying unknown** — the user would go looking for an installer that does not exist.

---

## 5. Several host windows in parallel (added in 0.2.0, settled in 0.2.5)

### 5.0 The model: one window per host

Before 0.2.0 there was **only one host window at a time** (switching hosts closed the old window). Since 0.2.0 windows live in a **registry indexed by host id**, therefore:

| Action | Expected |
|---|---|
| Open a second host with 「新窗口打开」 (Open in new window — see §3.05) | **Two hosts, one window each**, visible and connected at the same time |
| Login state in the two windows | They do not interfere (partitions are isolated per origin) |

**Since 0.2.0 "the current host" degrades to "the last one focused"** — a **deliberate downgrade** (with several windows open there is no single "current" one). It decides where the menu's `●` marker sits and which window the tray's 「重新加载」 (Reload) / 「立即重试」 (Retry Now) target. To verify: click window A, then click window B; the `●` in the tray's 「主机列表」 (Host List) should move with it.

### 5.1 At most one window per host (a hard invariant)

**This is an invariant, not an optimisation**: two windows on the same origin would mean two WebSockets against the same dsh, which is both wasteful and makes the pages fight over the same state.

| Action | Expected |
|---|---|
| Choosing 「打开」 (Open) for a host that is **already open** | Merely **raises** the existing window (creates nothing) |
| Choosing 「新窗口打开」 (Open in new window) for a host that is **already open** | Also merely **raises** the existing window (creates nothing and does not keep two) |

> Hence "either action on an already-open host just raises it" — already stated in §3.05; here it is in its multi-window form.

### 5.2 「打开」 (Open) vs 「新窗口打开」 (Open in new window) (0.2.5, verify carefully)

From 0.2.0 to 0.2.4 a **global setting** (「跨主机跳转时开新窗口」 / `openInNewWindow`) decided this, and two releases failed to converge; 0.2.5 **deleted** it in favour of **choosing explicitly each time** from the menu.

**Precondition**: add two hosts (the second may be a non-existent address) and open at least one of them.

| Action | Expected | What a failure means |
|---|---|---|
| Tray/menu → 「主机列表」 (Host List) → another host → 「**打开**」 (Open) | The target host opens **inside the current window** and **the current window is replaced** (no extra window appears) | `hostOpenEffect`'s `replace` branch was not reached |
| Tray/menu → 「主机列表」 (Host List) → a third host → 「**新窗口打开**」 (Open in new window) | **Another window opens** and the current one is **kept** | The `keep-open` branch was not reached |
| Choosing either action for an **already-open** host | Only **raises** it, creates nothing (see §5.1) | The invariant is broken |
| Looking for 「跨主机跳转时开新窗口」 (Open cross-host jumps in a new window) in the menu | **It should not be there** — the item was deleted in 0.2.5 | You are running 0.2.4 or earlier |

> ⚠️ **「打开」 (Open) first returns to that host**: if the window's page has already been carried off by the portal with a 302 (left sitting on the portal desktop — see §3.0), choosing 「打开」 reloads it back onto that host before raising it. **The user's intent in choosing 「打开」 is to get back to that host**, not to be raised onto a window displaying the portal. Please verify this one specifically (it is easiest to see in a portal deployment).
>
> 📌 **Links inside pages are no longer governed by any switch**: clicking a dsh shortcut in the portal **always opens inside the current window** (see §3.05). "Open in a new window" only ever comes from the menu.

### 5.3 Three things to confirm specifically with several windows

When 0.2.0 shipped, **the real interaction of multiple windows had not yet been verified on a real machine** (that version's Notes list this explicitly). Please walk through the following with care:

| # | Verification | Expected | Why it needs its own check |
|---|---|---|---|
| 1 | With two hosts open, trigger a notification from the **non-current** one | The notification title names **the host that raised it**, and clicking it **returns to that one** | Taking "the current host" would make window B's notification show A's name and jump to A when clicked |
| 2 | Give the two hosts **different skins** in dsh (dark / light), switching focus back and forth | Each window's top strip **follows its own page** | `nativeTheme` is a **process-level singleton**, so two windows with different skins risk overwriting each other — please record honestly what you actually see |
| 3 | Close **every** window one by one | The app **does not quit**, the tray is still there, and 「打开客户端」 (Open Client) brings a window back | With multiple windows, the "all windows closed" quit decision needs re-confirming (with a usable tray it should stay resident anyway) |

> If item 2 produces "the window I touched last recoloured the other one too", **please report it with a screenshot** — that would mean the process-level singleton really does bleed across, and it is a trade-off to schedule into a later version.

---

## 6. Shell page appearance and window form (0.2.1 / 0.2.2)

### 6.1 The shell pages are uniformly white now (changed in 0.2.1)

**Before**, these four pages were dark (`#151517`). From 0.2.1 they are **white**, and the whole palette (text, borders, secondary buttons, warning boxes, success/failure colours) moved to light, readable values along with it.

| Page | When you see it | Expected |
|---|---|---|
| **welcome** (welcome page / "Add host") | First launch, tray 「添加主机…」 (Add Host…) | White background, dark text; inputs and buttons clearly readable |
| **edit** (edit host) | Tray 「编辑主机…」 (Edit Host…) / `Ctrl+E` | As above; the yellow warning strip shown when changing the address is still clearly readable on white |
| **settings** (client settings) | Tray 「客户端设置」 (Client settings) / `Ctrl+,` | As above |
| **offline** (offline page) | When the remote is unreachable (see §7) | As above; the failure reason and the `DSH_TRUSTED_HOSTS` hint are readable |

> ⚠️ **Look specifically for white-on-white**: changing only the background without the text colour is exactly how you get that. 0.2.1 changed the whole palette deliberately, so anywhere you cannot read something is a defect.
>
> **These pages being light has nothing to do with dsh's own theme**: these four are the shell's own `file://` pages and do not follow dsh's skin (skinning refers to the **top strip of the host window** — see the "top strip follows the theme" row in §3).

### 6.2 The top of the settings page must be reachable (fixed in 0.2.3)

When the settings page is taller than one screen, **the topmost row (the 「客户端设置」 (Client settings) title and the 「弹出系统通知」 (Show native notifications) switch) must be scrollable into view**.

> ⚠️ There was a real on-device defect here: `body` used `height: 100vh` + `place-content: center`. When the form is taller than the viewport, the grid track is "centered" outside the container and **its upper half lands at negative coordinates**, while the scroll region starts at 0 — so that part was **unreachable by scrolling** (in the screenshot the topmost item was the quiet period rather than the title). Changing it to `min-height` fixed it.
>
> **Verification**: drag the settings window as short as it will go, then confirm you can scroll to the 「客户端设置」 (Client settings) title and the first switch.

### 6.3 On Windows the host window's DevTools opens in a separate window (**a window-form constraint, not a defect**)

Pressing `Ctrl+Shift+I` or `F12` in the **host window** makes DevTools **pop out into a separate window** rather than dock on the right.

**This is a measured conclusion — please do not report it as a defect.** An on-device experiment with the same code and the same mode:

| Window | Framed? | Behaviour of `Ctrl+Shift+I` |
|---|---|---|
| Client settings (**framed**) | Yes | **Docked** (split to the right) |
| Host window (Windows, **frameless**) | No | **Separate window** |

**Cause**: on Windows the host window is **frameless** (the top strip is handed to dsh to draw itself, so it can follow the app theme — see §3). Frameless means "no chrome", and docking DevTools needs the window's own chrome layout container — **it has nothing to do with the `mode` argument**.

**This is a deliberate trade-off** (the user has explicitly chosen to **keep the self-drawn top strip and accept DevTools popping out**): the only way to dock DevTools in the host window is to drop the frameless style, and that would sacrifice the themed top strip. **On macOS / Linux the host window is framed, so DevTools docks normally.**

> So this is **not** a pending fix. If you find DevTools popping out in a *framed* window (settings / edit / add host), **that** is a defect — please report it.

### 6.4 Title, shortcut and window-menu behaviour for the settings window

| Action | Expected |
|---|---|
| Window title | 「客户端设置」 (Client settings) |
| Window size | 560×640 |
| Menu bar at the top of the settings window | **None** — the rule is "the menu bar only grows on host windows", so 「删除主机…」 (Delete Host…) cannot be triggered from in here and act on some other window |
| Press `Ctrl+W` in the settings window | It closes. This is a **shell-owned tool window**, not the window carrying a host session — closing it really closes it, there is no "hide to the tray" semantics |
| Press `Ctrl+R` in the settings window | Reloads the settings page itself (it is a local page; there is no "re-request the host origin" semantics here) |

---

## 7. Offline and auto-reconnect (a fixed item, verify carefully)

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

## 8. Upgrade acceptance (automatic / differential updates)

**This section is the acceptance procedure for upgrading `<old version>` → `<new version>`.** It is written with placeholders on purpose: hard-coding two version numbers would go stale on every release (the guide has already been caught out that way once — it still carried the 0.1.0 hash when 0.1.1 was the published build). Read `<old version>` as "the version you currently have installed" and `<new version>` as "the version you are upgrading to".

Automatic updating verifies that an *old* client can fetch a *new* version, so it inherently needs **two** versions: one installed, one published. Nothing here needs a version to be "released first" — every step below runs against whatever pair is current at the time you read this (as of writing, 0.2.5 is the released version).

> 📌 **This section used to hard-code `v0.1.7 → v0.1.8` and carry the heading "requires v0.1.8 to be published first". That premise expired long ago** (the released version is now **0.2.5**, and the automatic-update path has been running normally since 0.1.7). The note is kept so that readers do not re-interpret the section by the old numbering — the acceptance value of every step is unchanged; only the version numbers are now yours to fill in.

> ⚠️ **One precondition that never goes away**: the **installed** client must already be **0.1.7 or newer**. Versions 0.1.6 and earlier contain no updater at all, so they can only be upgraded by downloading the installer by hand — see §10.

### 8.0 Two versions are required

| Version | Contents | Who installs it |
|---|---|---|
| **`<old version>`** | The version currently installed, which carries the updater and publishes `latest.yml` / `.blockmap` | **Installed by hand** — the last 106MB manual install before this path takes over |
| **`<new version>`** | Any small change | **Nobody** — an installed `<old version>` should find it by itself |

Therefore:

- **Before `<new version>` is published**, `<old version>` can only be used to verify "it does not error and does not affect normal use" (§8.1). There is no target version to update to, so nothing happens — that is correct behaviour, not a defect.
- **After `<new version>` is published**, the full chain in §8.2 can be verified.

### 8.1 Confirm it stays out of the way

These checks **do not need a second version** to run, and **any failure is a real defect**:

| Action | Expected |
|---|---|
| Launch the client normally (installed package) | UI, tray and host connection are **exactly as before** — installing a version with the updater changes nothing you can see |
| Launch it, then leave it idle for **1 minute** while watching | **No window or dialog ever appears** (including no pointless "you are up to date" notice) |
| **Launch with the network down** (pull the cable / turn off Wi-Fi) | Still **no error dialog**. Only one line in `update.log`: `检查更新失败（已忽略，不影响使用）…` |
| Launch in `pnpm dev` development mode | Nothing pops up either. The updater **does not start at all in development mode** (there is no `app-update.yml`, and starting it would only spam error logs) — this is deliberate |
| Turn off 「启动后在后台检查新版本」 (Check for updates after startup) in settings, then launch | **The updater is not wired up at all**, and 「更新器启动」 (updater started) **does not appear** in `update.log` (since 0.2.0; see §4.1 and §4.4) |

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
> Each line carries an ISO timestamp. **The sample below is a historical sample** — it was
> captured on 2026-10-11 while 0.1.7 was the installed version, so do not read 0.1.7 as
> "the version you should be running"; only the *shape* of the lines matters:
>
> ```
> 2026-10-11T02:31:07.512Z 更新器启动（当前版本 0.1.7，日志位于 update.log）
> 2026-10-11T02:31:37.480Z 开始检查更新（当前版本 0.1.7）
> ```
>
> In your own log the version in parentheses is whatever you have installed.
>
> Since 0.1.8 "no new version found" also leaves a line — 「检查完成：当前已是最新版本」 — so
> **"there genuinely is no new version" and "it failed silently" can be told apart** (0.1.7 did
> not have that line).
>
> Since 0.1.9 the library's own internal log is piped into `update.log` as well (prefixed
> `[库]` / `[库·警告]` / `[库·错误]`, i.e. "[lib]" / "[lib·warning]" / "[lib·error]"), so a failed
> differential download falling back to the full package is stated explicitly instead of being
> inferred from timings.
>
> It keeps at most the latest 200 lines (each truncated to 400 characters), so it
> **cannot grow without bound** and can safely be left in place.
>
> Before this log existed, this section said "start the installed exe from a command
> line, or open the DevTools Console" — which is effectively impossible for an end user,
> leaving "why did the update do nothing on a real machine?" with no evidence at all.
> `update.log` is that evidence now.

### 8.2 The full chain (this is the important part)

**Precondition**: `<new version>` has been published to a Release as a tag, and that Release **contains all three files** — `setup.exe`, `latest.yml` and `*.exe.blockmap` (see "Three files in the Release" in the README).

Run these in order and **look at the result of every step**:

| # | Action | Expected | What a failure means |
|---|---|---|---|
| 1 | Confirm you are running **`<old version>`**, launch the client and wait about **30 seconds** | `update.log` shows 「开始检查更新」 (an update check started) — see §8.1 for how to read it | The timer never fired |
| 2 | Leave it running and wait for the background download to finish | A dialog appears: 「新版本 **`<new version>`** 已下载完成，现在重启安装吗？」 with buttons 「立即重启」 / 「稍后」 | The quiet-period/policy logic swallowed the prompt |
| 3 | **Record the actual number of bytes downloaded** (see below) | Clearly less than 106MB | Differential download did not take effect and it fell back to the whole package |
| 4 | Click **「立即重启」 (Restart now)** | The app **really does exit**, installs briefly, **reopens by itself**, and the version is now **`<new version>`** | ⚠️ See "Known trap" below |
| 5 | Confirm the version after the restart | The settings window's 「当前版本」 (Current version, §4.4) / window title / the version corresponding to `package.json` are all `<new version>` | The install did not actually complete |
| 6 | **Start a fresh round**: click 「稍后」 (Later) and do nothing else | The dialog closes with **no side effects at all** (window, tray and host connection all unchanged) | The update disturbed the main path |
| 7 | Continuing from above: **fully quit the client and start it again**, then wait for another check | **It does not ask about `<new version>` a second time** (the user has already answered) | The state was not remembered and the user gets nagged repeatedly |
| 8 | After restarting, publish a **`<next version>`** to the Release (if you are willing to test it) | It prompts **again**, for `<next version>` | The state is remembered but is not reset when the version changes |
| 9 | Press 「**立即检查更新**」 (Check for updates now) in the settings window (§4.4) | The version in the message is **the same new version** as the dialog in step 2 | The current version was passed off as the new one (fixed in 0.2.3) |

**How to record the download size in step 3**: the only real evidence that differential download works is how much was actually transferred. The most direct way is to watch the process's received traffic during the download in a system resource monitor (Windows Task Manager → Performance → Ethernet); if you launched it from a command line you can read the updater output directly — **since 0.1.9 the library's internal log also lands in `update.log`** (prefixed `[库]` / `[库·警告]` / `[库·错误]`), and a differential download falling back to the full package is stated there explicitly. **Write the number down** — it decides whether differential updates are worth keeping at all.

**Reference figure**: the measured 0.1.9 → 0.1.10 upgrade on a real machine was "full package 106.3MB, actually downloaded **1.26MB** (about 1%)". Your number should be in the same order of magnitude; if it is close to 106MB, the differential download did not take effect.

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

## 9. LAN / remote access (optional, advanced)

When you want to use a **LAN IP or domain** (not 127.0.0.1):

### 9.1 trust fence (otherwise the page opens but `/api` is all 403)

Configure it in dsh-docker's `.env`:
```
DSH_TRUSTED_HOSTS=192.168.1.5:3080
```
Or install the auth plugin:
```bash
docker exec dsh dsh plugin --profile web add @xgone/dsh-remote
docker restart dsh
```

### 9.2 secure context (otherwise the clipboard stops working)

For **configured `http://` origins** the shell sets `unsafely-treat-insecure-origin-as-secure`, but **that switch can only take effect at startup**.

After adding `http://192.168.x.x:3080` for the first time, the welcome page shows a yellow hint and provides a **「立即重启」 (Restart Now) button** — press it, and only then is that origin included in the switch list.

> Known minor UX wart: **re-adding the same http host** within the same session still prompts once more (semantically correct — it really has not taken effect yet, but it feels wordy).

### 9.3 Verify isolation

Add both an `http://` and an `https://` host and confirm their login states do not interfere.

---

## 10. Known limitations (so you do not misjudge them as defects)

The following are **known by design**, not bugs:

- **Native notifications**: **both approval and message notifications are verified working on a real machine**. Approval notifications were verified from the upstream component source `dsh-client-ui-approval` (so no on-device recon was needed); **message notifications were verified on-device back in 0.1.2** (an agent reply that finishes while the window is unfocused raises a system notification). Note that message notifications **only pop up while the window is unfocused**, so you must switch away from the window to verify them; approval notifications, by contrast, pop up unconditionally (the agent is sitting there waiting for you).
- **Changing the IP or domain of an `http://` host = a new host**, requiring you to log in again. This is caused by dsh's cookie name being bound to the authority (`sha256(authority)`).
- **Several host windows are kept at once — one per host**: since 0.2.0 host windows live in a registry indexed by host id (see `src/main/window-registry.ts`), so different hosts can be open side by side. Switching hosts no longer closes the old window: 「打开」 (Open) replaces the current window, 「新窗口打开」 (Open in new window) keeps it (see §3.05). **At most one window per host** is a hard invariant — reopening a host that is already open just raises its existing window, because two windows on one origin would mean two WebSockets against the same dsh. With several windows open, "the current host" means **the last one focused** — that is what the menu's ● marker and the tray's 「重新加载」 (Reload) / 「立即重试」 (Retry Now) act on.
- **On macOS a content window still shows the menu bar**: on Windows/Linux it has been removed per window; on macOS the menu is **application-level**, and removing it per window would also affect the host window's menu, which is not worth it. **macOS only.**
- **A page that relies on the return value of `window.open` will error**: to make links open in the **current window** we must reject Electron's default "open a new window" behaviour, so `window.open()` returns `null`. If the page then uses that return value (e.g. `w.focus()`) it throws a JS error — the impact is limited to that page itself, and **the navigation has already been done by us**.
- **One trade-off in link routing**: see §3.05 — if an icon points at **another** configured host, the current window loads it but the "current host" does not change.
- **「当前主机」 ("the current host") = the last one focused** (a deliberate downgrade since 0.2.0): with several windows open there is no single "current" one, and the menu's `●` marker together with the tray's 「重新加载」 (Reload) / 「立即重试」 (Retry Now) all target it. So after clicking another window the `●` moves over — that is expected, not drift.
- **`nativeTheme` is a process-level singleton**: if two host windows are given **different skins**, how the top strip behaves needs on-device confirmation (see §5.3 item 2). This is an open observation, not a settled behaviour.
- **On Windows the host window's DevTools opens in a separate window (this is a window-form constraint, not a defect)**: the host window is **frameless** (so the top strip can follow the app theme), and a frameless window cannot dock DevTools. Determined by an on-device experiment with the same code and the same mode: **Client settings (framed) → docked**; **host window on Windows (frameless) → separate window**. The variable is the window form, **not the `mode` argument** — the code asks for a docked mode and the choice was made deliberately: dropping the frameless style would dock DevTools but lose the themed top strip. On macOS / Linux the host window is framed, so DevTools docks as usual. **Please do not try to "fix" this** — the only way to dock it on Windows is to give up the frameless window.
- **Unsigned app**: if you package an exe later, Windows Defender / SmartScreen may warn; running in `pnpm dev` development mode does not involve this.
- **Automatic updates only work in a packaged build**: under `pnpm dev` the updater does not start at all (there is no `app-update.yml`, and starting it would only spam error logs). **So no update behaviour can be verified in development mode** — you must use the installer (see §8). The settings window's 「立即检查更新」 (Check for updates now) button is disabled there for the same reason, and says so (§4.4).
- **Every failure in automatic updating is silent**: no network, an unreachable update source or a malformed `latest.yml` all leave just one line in `update.log` and **never show a dialog**. This is deliberate (the user is not waiting for an update, so interrupting them is a net negative) — which means **"nothing happened" is usually correct behaviour**, so do not rush to report it as a defect. To tell whether it is running at all, read `update.log` (§8.1 shows how): it separates "there genuinely is no new version" from "it failed silently", which is exactly why the log exists.
- **Only prompting once is not forgetfulness**: once the user has been asked about a version, it is never asked again (the state lives in `userData/update-state.json`). If you want to see the dialog again, delete that file.
- **「跨主机跳转时开新窗口」 (Open cross-host jumps in a new window) is gone, and that is not a missing setting**: 0.2.5 removed it (`openInNewWindow`) on purpose — the choice now belongs to the per-host 「打开」 / 「新窗口打开」 pair every time you use it (§5.2). An `openInNewWindow` field left over in `settings.json` is **ignored without migration**, and the other fields are unaffected. Its absence from the settings window is by design, not an omission.
- **Versions 0.1.6 and earlier do not auto-update**: there is no updater in them. They must be **manually upgraded to 0.1.7 once**, after which they are on the automatic update path.
- **Uninstalling keeps `update-state.json` and `settings.json`**: they are kept along with the other user data (uninstalling does not clear `userData`). The "already prompted version" and the client settings therefore carry over after a reinstall, which is deliberate.

---

## 11. Report template for problems

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

## 12. Run the automated part first (can be done in parallel with GUI verification)

Before GUI verification, confirm the automated part is green:

```powershell
pnpm test        # 构建 + 全部测试（含构建产物断言）
pnpm typecheck
```

(The comment means "build + all tests (including build-artifact assertions)".)

Expected: `Tests passed`, typecheck exit code 0, and exactly **9** artifact files under `out\`:

```
out/main/index.js
out/preload/host.cjs
out/preload/welcome.cjs
out/preload/edit.cjs
out/preload/settings.cjs
out/renderer/offline.html
out/renderer/welcome.html
out/renderer/edit.html
out/renderer/settings.html
```

This list is asserted **exactly** (not "at least"), and a second assertion checks that every page under `src/renderer/` and every preload under `src/preload/` is registered in `electron.vite.config.ts`'s **explicit** entry list — that config is not a glob, so an unregistered page is skipped silently. That is not hypothetical: `settings.html` / `settings.cjs` were once missing from it, and 402 tests stayed green with typecheck exiting 0 while both artifacts were simply never built. The count went from 7 to 9 when they were added.

That command caught two P0s in phase 1 (`out/renderer/` not being generated, the preload inlining the electron package), **which neither the unit tests nor the type check could catch** — so if you see anything odd around the build, `pnpm test` is the first sieve.
