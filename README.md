# Kitty Remote Deck

A local web app for browsing and controlling GUI `kitty` sessions on the same machine or over SSH.

Current release: `v0.1.0`.

## What It Does

- Saves connection targets locally.
- Defaults to direct local `kitty @` control when the server and GUI kitty run on the same machine.
- Keeps SSH targets for controlling kitty sessions on another host.
- Discovers kitty sockets such as `/tmp/kitty.sock-*`.
- Lists OS windows, tabs, and panes from `kitty @ ls`.
- Shows either the current screen text or the full screen + scrollback text for a selected pane.
- In Screen mode, scrolls the selected pane through kitty remote control and refreshes the visible screen text.
- Turns `http://`, `https://`, and `file://` URLs in terminal output into preview links.
- Opens an embedded right-side Browser with back/forward navigation, history, an address bar, optional pinning, and proxied HTML, CSS, images, fonts, and relative links through the selected Local or SSH target.
- Sends text, `Enter`, `Esc`, `Ctrl+C`, and `Ctrl+D` to the selected pane.
- Persists UI preferences such as sidebar state and font size in the browser.

## Requirements

- Machine running `server.js`: Node.js 18 or newer, Python 3, and GUI kitty with remote control sockets enabled for Local targets.
- Client device: a modern browser.
- SSH targets: a local `ssh` command that can reach the target host, plus Python 3 and GUI kitty on that host.

No npm dependencies are required for the current app. No Python packages are required either: the helper uses only the Python standard library. In Local mode it is run directly; in SSH mode it is streamed over SSH.

On Windows, install Node.js if Windows is running `server.js`; otherwise a browser is enough. For SSH targets, use the built-in OpenSSH client or Git for Windows OpenSSH. SSH aliases are usually configured in `%USERPROFILE%\.ssh\config`.

## Run

From the repository root:

```bash
npm start
```

Then open:

```text
http://localhost:3040
```

By default the server binds to `127.0.0.1:3040`. This is intentional: expose it through a trusted reverse tunnel such as Cloudflared rather than binding the app directly to a public interface.

## Device Token Login

All target/session/control APIs require a device session. Create one token per device from the machine running `server.js`:

```bash
node scripts/auth-admin.js create-device "iPhone"
```

The raw token is shown once. The server stores only a salted hash in `data/auth.json`, which is ignored by Git. One token represents one device; the same token may keep multiple active browser sessions so normal tabs, mobile views, and desktop-mode tabs on the same phone do not kick each other out.

Useful local admin commands:

```bash
node scripts/auth-admin.js list-devices
node scripts/auth-admin.js revoke-device "iPhone"
node scripts/auth-admin.js rotate-device "iPhone"
```

When served through Cloudflared, route the hostname to the local-only listener:

```yaml
ingress:
  - hostname: your-kitty-hostname.example.com
    service: http://127.0.0.1:3040
```

## Target Configuration

The app runs locally. In Local mode, actions execute through a small Python helper on this machine, and the helper calls the local `kitty @` CLI directly. In SSH mode, the same helper is streamed over SSH and calls `kitty @` on the target host.

Target data is stored in `data/targets.json`. That directory is ignored by Git because it contains machine-specific host names, socket paths, and notes. On first launch, the server creates a default editable `Local Kitty` target with these assumptions:

```text
kitty binary: kitty
socket pattern: /tmp/kitty.sock-*
```

Edit the target in the Connect sidebar if your kitty binary or socket pattern differs. Use `transport: SSH` only when the kitty session lives on another host.

## Keyboard Workflow

- `Enter` in the composer sends text and a final terminal `Enter` when the textbox has content, including whitespace or newline-only content.
- `Enter` in an empty composer sends `Enter` to the selected pane.
- `Shift+Enter`, or a mobile keyboard action that inserts a newline, keeps that newline in the composer.
- `Screen` mode shows the current kitty viewport; mouse wheel sends `kitty @ scroll-window` to the selected pane and then refreshes the screen text.
- `All` mode fetches `get-text --extent all`; mouse wheel scrolls the browser's local scrollback view.
- When `All` mode is scrolled away from the bottom, automatic full-text refresh pauses to avoid jumping and repeated scrollback transfers. Use `Refresh All` to return to the live tail.
- Terminal URLs are clickable; clicking one opens the right-side Browser.
- The Browser address bar accepts `https://`, `http://`, `file://`, bare hostnames such as `example.com`, hostnames with ports such as `localhost:8080`, and absolute target-side paths such as `/tmp/report.html`.
- When the Browser is not pinned, clicking or focusing elsewhere in the workbench hides it. Pinning keeps it open as a real right-side column that compresses the editor and Input Console instead of overlaying them.
- On mobile-width screens, the UI becomes a chat-style flow: Connect screen, full-screen Session list, then a full-screen pane conversation with a back button.
- Mobile pane conversations keep the input composer visible at the bottom. Fit mode wraps terminal text to the phone width; Wide mode preserves terminal columns and allows horizontal scrolling.
- `发送 Esc` sends `escape` to the selected pane, useful for interrupting full-screen or agent UIs.
- `发送 Ctrl+C` sends `ctrl+c` to the selected pane.
- `Ctrl+D` sends `ctrl+d` to the selected pane.

## Workbench Layout

- Activity Bar: switch between Connect target management and KT session selection.
- Primary Sidebar: shows the active Connect or KT Session view.
- Editor: shows the selected kitty pane and takes the largest area.
- Secondary Browser Drawer: slides in from the right for proxied URL browsing and can be hidden.
- Bottom Panel: Input Console and common key buttons.
- Status Bar: current connection health, target, socket, pane, and auto-refresh state.
- Top controls: numeric font size, theme, and resize mode. Resize mode is off by default; enabling it exposes sidebar, Browser, and bottom panel resize handles.

## Embedded Browser Proxy

Terminal `http://`, `https://`, and `file://` URLs open in a right-side Browser drawer. The Browser also has URL input, back/forward buttons, and a local history menu. Browser resources are fetched through the active Local or SSH target and proxied back through the local app, including relative HTML/CSS resources and in-frame link navigation.

See [docs/url-preview-proxy.md](docs/url-preview-proxy.md) for the proxy flow, security model, and limits.

## Security And Repository Hygiene

- `data/` is ignored by Git. It may contain device-token hashes, connection targets, host aliases, socket paths, and local notes.
- Raw device tokens are printed once by `scripts/auth-admin.js` and are never meant to be committed.
- Keep `server.js` bound to `127.0.0.1` unless you are putting an authenticated reverse proxy or tunnel in front of it.
- Treat every authenticated browser session as equivalent to local keyboard control of the selected kitty pane.
- Public documentation uses generic hostnames and paths. Put machine-specific details in ignored local data or private deployment notes.

## Verification

Useful local checks:

```bash
npm test
node --check server.js
node --check public/app.js
node --check scripts/auth-admin.js
python -m py_compile server/remote_helper.py
curl http://localhost:3040/api/health
```

Run the browser layout smoke test with Chrome or Chromium installed:

```bash
npm run smoke:chrome
```

Set `CHROME_BIN=/path/to/chrome` if Chrome is not in a common Linux path. Session/control endpoints require device-token login; use the browser UI for authenticated manual checks.

## Versioning

The project uses semantic versioning. The current release is recorded in:

- `package.json`
- `VERSION`
- `CHANGELOG.md`

Git release tags use the `vMAJOR.MINOR.PATCH` format, for example `v0.1.0`.

## Sync to a Remote Playground

If you mirror this app to a remote development machine, keep local targets and logs out of the sync unless you deliberately need them:

```bash
rsync -av --exclude data --exclude tmp ./ user@example-host:/path/to/kitty-remote-deck/
```
