# Terminal Dock

A local web app that drives terminals from a browser: an iPad, a phone or another desk, over Tailscale or any other private network. It has two backends per target, both local or over SSH:

- `kitty`: the terminal is a GUI kitty window, so everything the browser does is also visible on that machine's physical display.
- `tmux`: a headless tmux server, with nothing on any display. This is the backend for GPU servers and other machines without a GUI.

Current release: `v0.3.0`. The repository and the launchd service on the author's machine still carry the pre-1.0 name `kitty-remote-deck`.

## What It Does

- Saves connection targets locally.
- Defaults to direct local `kitty @` control when the server and GUI kitty run on the same machine.
- Keeps SSH targets for controlling kitty sessions on another host.
- Supports a `tmux` backend per target for servers without a display: sessions, windows, and panes are listed from `tmux list-panes -a`, screens come from `capture-pane -e`, and input goes through `paste-buffer -p` and `send-keys`.
- Discovers kitty sockets such as `/tmp/kitty.sock-*`, or live tmux server sockets under `$TMUX_TMPDIR/tmux-UID/`.
- Lists OS windows, tabs, and panes from `kitty @ ls`.
- Shows a pane as `Transcript` (its text plus scrollback, scrolled in the browser) or `Screen` (the live window as the terminal shows it, every tmux pane in place), preserving ANSI colors. Full-screen apps always use Screen.
- In Screen mode, swipes and the wheel scroll the pane itself: kitty through remote control, tmux through a server-side history offset that never enters copy mode.
- Turns `http://`, `https://`, `file://`, and terminal OSC 8 hyperlinks in output into preview links.
- Opens an embedded right-side Browser with back/forward navigation, history, an address bar and optional pinning. Pages load through the selected target by path-shaped proxy URLs, so relative references, `fetch()`/XHR calls, ES module imports and elements created at runtime all work; private hosts go through the target, public CDNs load directly, and a directory path shows a file listing. The bottom activity-bar view lists opened pages (`Reports`, stored on the server, pinnable) and takes a path or URL. See `docs/url-preview-proxy.md`.
- Sends text, `Enter`, and special keys such as `Esc`, `Tab`, `Ctrl+C`, `Ctrl+D`, line-editing shortcuts, and arrow keys to the selected pane. While the composer is empty, pressing an arrow key or `Esc` sends it to the pane directly; `Enter` on an empty composer sends `Enter`.
- Persists UI preferences such as sidebar state and font size in the browser.

## Requirements

- Machine running `server.js`: Node.js 18 or newer, Python 3, and GUI kitty with remote control sockets enabled for Local targets.
- Client device: a modern browser.
- SSH targets: a local `ssh` command that can reach the target host, plus Python 3 and GUI kitty on that host.
- tmux targets: tmux 3.x on the target host instead of kitty. No display is needed.

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

The raw token is shown once. The server stores only a salted hash in `data/auth.json`, which is ignored by Git. One token represents one device and permits one active browser session. Signing in with the same token from another browser or origin immediately replaces the previous session. Tabs under the same browser origin share the current session cookie.

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

### tmux Targets

Set `Backend` to `tmux` for a host that runs tmux without a GUI, such as a headless GPU server. Transport works the same way: Local runs `tmux` on the server machine, SSH streams the helper to the target host. Leave `Socket Pattern` empty to discover live servers under `$TMUX_TMPDIR/tmux-UID/*` (stale socket files left by exited servers are skipped), or set it to a glob such as `/tmp/tmux-1000/*`. The Socket selector then switches between tmux servers (`tmux -L name` creates a separate socket per name).

The Session Explorer keeps the same three-level layout with tmux names: tmux sessions appear as the top level, tmux windows as the middle level, and panes as the selectable items. The explorer offers `New Session` (a detached session started in the target user's home directory) for tmux targets; windows and splits are arranged from the terminal as usual, although the create API still supports `tab` and `split` kinds for tmux.

Differences from kitty targets:

- Pane width follows tmux, not the browser: a pane is as wide as its attached client, or 80×24 when it never had one. The deck resizes detached panes to the cells that fit the view whenever the view changes: pane selection, window or sidebar resize, bottom panel drag, and `A-`/`A+` font steps (`Auto-fit detached panes` in the `⋯` menu, on by default). When a capture shows that the window was resized elsewhere (another deck client, an earlier layout of this page), the view fits it again at most once per local interaction, so two decks on one pane do not fight and the device being used wins. `Fit pane to screen` also resizes a pane whose session has a terminal attached; that pins the window's `window-size` to `manual`, so the attached terminal then sees a fixed canvas until you reset it with `tmux set -w window-size latest`. Screen mode draws the whole tmux window the way an attached terminal shows it: every pane in place, one cell of border between them, and only the zoomed pane when the window is zoomed. Click a pane in the view to make it the input target; `Zoom pane (prefix-z)` in the `⋯` menu toggles zoom. Transcript still shows the selected pane's full scrollback.
- Layouts: the third activity-bar view lists named layouts saved on the server in `data/layouts.json` (`GET/POST /api/layouts`, `POST /api/layouts/delete`), so the same list is available from every device. A layout stores the view tree, per view the target, socket and pane, and the Browser when it is pinned (URL and target; width stays a device preference). The list starts with `Scratch`, the unsaved layout of this device, kept in the browser only. `Save layout` in the Session Explorer head (or the Layouts view's field) saves the current layout under a new name and switches to it; a copy stays behind as Scratch. A named layout is live: splits, pane changes and pinning or navigating the Browser are written back automatically, so there is nothing to overwrite. Rows switch, duplicate or delete; the active row is highlighted. The Sessions tab never changes the layout, it only picks panes for the active view of whatever layout is on screen. On start-up and on `↻` the page adopts the server's copy of the active layout, so an edit from another device wins. An autosave names the `updatedAt` it last saw; if another device has written the layout since, the server answers 409 with its copy and the page adopts that instead of overwriting it. Phones never pin the Browser, so a phone keeps a layout's Browser as it was.
- Browser handle: while a Browser page exists but the drawer is hidden, a tab on the right edge brings it back. On the desktop it shows the globe and slides the page title out on hover or focus; a click, Enter or Space opens the drawer. On a phone it sits on the terminal screen only, and a tap or a leftward swipe (the tab follows the finger) opens the Browser screen.
- Phone navigation is a stack: Connect, Sessions, Layouts, Reports, Terminal and Browser are full-screen, every move forward pushes a screen, and every back (the `‹` button, a swipe back, the hardware key) pops one. Opening a screen that is already on the stack unwinds to it (a report opened from the Browser's Reports screen returns to the Browser rather than nesting). Back buttons name the screen underneath. The stack is mirrored into the browser history, and the Browser frame is navigated with `location.replace`, so a swipe back never lands on a frame page.
- View splits (browser-side, after deepseek-harness ui-layout): `Split right` / `Split down` in the `⋯` menu or the view header split the screen area into a tree of views. Each view shows one pane from any saved target; the highlighted view is the one the composer, Keys, scrolling and fitting act on, and clicking another view (or a tmux pane inside it) moves that focus there. Drag the divider to resize (20–80%), `×` closes a view, the last view stays open. The tree and the active view persist in this browser only; tmux never sees these splits. Phones show only the active view.
- Terminal counterpart: `scripts/td` is a small CLI (Python 3, no dependencies) that lists the same tmux sessions from a real terminal and attaches to them with `ssh -t HOST tmux new-session -A`. `td` opens a picker (Enter attach, `n` new, `x` kill, `r` refresh, `q` quit), `td ls` prints the table, `td HOST[:SESSION]` and `td new HOST [NAME]` attach directly, `--tab` opens the attach in a new kitty tab, `--socket NAME` targets another tmux server. Hosts come from `~/.config/td/hosts` (one `alias [display name]` per line, `local` for this machine); attaching from inside tmux switches the client instead of nesting. Install with a symlink into a directory on your PATH. `td img [HOST[:SESSION]]` uploads the local clipboard image (xclip, wl-paste, or pngpaste/osascript) to `~/Pictures/remote-deck/YYYYMMDD/` on the host, the same place the deck uploads to, and pastes the Markdown link into the session's active pane; with no argument it targets the session the focused kitty window is attached to, so it can be bound to a kitty key (`map ctrl+shift+u launch --type=background td img`). Errors surface through `kitten notify` when there is no terminal to print to.
- Session management: the sidebar's `×` controls kill a tmux session, window, or pane (kitty: tab or window) after a confirmation. `Ctrl+D ×2` in the Keys menu sends both presses in one round trip, which is how Claude Code exits.
- Claude Code's fullscreen renderer draws on the alternate screen, which has no tmux scrollback. For such panes (marked `alt-screen` in the explorer) the deck shows the live viewport only and turns scroll gestures into `PgUp`/`PgDn` for the app, with `Latest output ↓` sending `Ctrl+End`. To browse the transcript in the deck's Transcript view instead, start Claude Code with `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1` or run `/tui default` inside it.

- Screen-mode scrolling does not put the pane into copy mode, so attached terminals are unaffected. The deck keeps a scroll offset per pane and captures the matching slice of history; the offset resets when the server restarts.
- `capture-pane -e` preserves colors and attributes but not OSC 8 hyperlinks; plain `http://`, `https://`, and `file://` URLs in the text are still clickable.
- Composer text is loaded into a tmux buffer and pasted with bracketed paste when the program asked for it, then `Enter` is sent as a separate key.
- Keys are translated from kitty names to tmux names (`ctrl+c` to `C-c`, `shift+tab` to `BTab`, `alt+up` to `M-Up`).

## Keyboard Workflow

- `Enter` in the composer, or the round arrow button, sends text and a final terminal `Enter` when the textbox has content, including whitespace or newline-only content.
- `Enter` in an empty composer sends `Enter` to the selected pane.
- `Alt+Enter`, or the `No ⏎` button above the composer, sends the text without a trailing `Enter`, for filling a prompt you will finish by hand.
- `Shift+Enter`, or a mobile keyboard action that inserts a newline, keeps that newline in the composer.
- While a composer action is in flight, repeated Enter presses and key-button taps are ignored and the input remains read-only until the request finishes.
- The Image button above the composer, paste, or drag/drop can attach one image to the composer. Sending saves it on the active target and sends a Markdown link such as `[name](file:///target/path)` to the selected pane. The link omits the leading `!` of image syntax because `!` switches Codex into shell mode.
- Images are stored on the active target host, not in the browser. The default path is `~/Pictures/remote-deck/YYYYMMDD/YYYYMMDDHHMMSS-random-name.ext`; Local targets use the server machine, and SSH targets use the remote SSH user's home directory. Set `KRD_IMAGE_UPLOAD_DIR=/path/to/dir` before starting the server to override the root directory for target-side uploads.
- Image uploads are not cleaned automatically. Treat `~/Pictures/remote-deck/` as a user-visible inbox for files sent into KT sessions.
- The `⋯` menu in the editor toolbar holds the pane view (`Transcript` is the default; `Screen` shows the live window) and the tmux pane-size tools. Updates are always live or polled; the status bar shows which.
- tmux targets update live: the page keeps one `/api/events` stream for every view it shows, the server watches each pane's session through a tmux control-mode client (`tmux -C attach`, which tmux excludes from window sizing and the deck excludes from `attached`), and a `screen` event triggers the normal `/api/screen` fetch within about 100 ms of output. Polling then only runs every 15 s as a safety net and the status bar reads `Updates: live`; kitty targets and streams that cannot attach fall back to adaptive polling (0.7 s active, 1.5 s warm, 4 s idle). Bursts are coalesced: one fetch in flight, at most one queued, and at least 0.6 s between `Transcript` refreshes. Traffic stays small because a refresh with `since` returns `unchanged` when nothing moved, a line delta (`drop`/`keep`/`tail` relative to the text the page already has) when the tail changed, and the full gzipped text only when the page has nothing to build on. Rendering is incremental too: one block per line, and only changed lines are replaced. The last 8 panes shown stay cached in the page (the explorer marks them `cached`), so switching between sessions repaints instantly from the cache and only revalidates with the server. Each split view keeps its own output element for its whole life; activating a view changes only which one receives input, so views never move or re-render on activation.
- `Screen` mode shows the current kitty viewport with ANSI colors. Mouse wheel scrolls the browser's local text view first; only extra scrolling at the top or bottom edge sends `kitty @ scroll-window` to the selected pane and refreshes the screen text.
- `All` mode fetches `get-text --extent all`; mouse wheel scrolls the browser's local scrollback view.
- When `All` mode is scrolled away from the bottom, automatic full-text refresh pauses to avoid jumping and repeated scrollback transfers. Use `Refresh All` to return to the live tail.
- Terminal URLs are clickable; clicking one opens the right-side Browser as a new root page, so unrelated pane/topic links do not share one Browser Back stack.
- Session Explorer can create Kitty surfaces through scoped controls: `New Window` creates a new top-level Kitty OS window, `New Tab` appears inside each OS window card, and `New Split` appears inside each tab card.
- The Browser address bar accepts `https://`, `http://`, `file://`, bare hostnames such as `example.com`, hostnames with ports such as `localhost:8080`, and absolute target-side paths such as `/tmp/report.html`.
- When the Browser is not pinned, clicking or focusing elsewhere in the workbench hides it. Pinning keeps it open as a real right-side column that compresses the editor and composer instead of overlaying them.
- On mobile-width screens, the UI becomes a chat-style flow: Connect screen, full-screen Session list, then a full-screen pane conversation with a back button.
- Mobile pane conversations keep the input composer visible at the bottom. Fit mode wraps terminal text to the phone width; Wide mode preserves terminal columns and allows horizontal scrolling.
- Switching panes clears the previous pane text immediately, identifies the pane being loaded, cancels the previous screen request, and ignores any late response from the old pane.
- On mobile, terminal URL clicks open the Browser as a full-screen overlay. Use `‹ Terminal` or the system Back action to return to the pane; the Reports screen (from the Sessions head or the Browser head) reopens pages.
- The `Keys` menu above the composer is grouped by the program that reads the key, each button with a one-line hint. `Claude Code`: `Shift+Tab` (cycle permission mode), `Esc Esc` (rewind menu), `Ctrl+B` (background the running task; one press suffices because tmux `send-keys` bypasses the prefix), `Ctrl+X Ctrl+S` (send queued messages now), `Ctrl+T`, `Ctrl+O`, `Ctrl+R`, `Alt+P`, `Alt+O`, `Ctrl+X Ctrl+K`. `Codex`: `Shift+Tab` (cycle collaboration mode), `Esc Esc` (edit previous message), `Tab` (queue the draft), `Shift+←/→` (questions and queued messages), `Ctrl+]`, `Shift+↑/↓` (reasoning effort), `Ctrl+T`, `Ctrl+R`, `Alt+←/→` (switch agent), `y`/`a`/`n` for approvals. `Terminal`: `Esc`, `Tab`, `Ctrl+C`, `Ctrl+D`, `Ctrl+D ×2`, `Ctrl+Z`, `Ctrl+L`; then line editing (`Backspace`, `Delete`, `Ctrl+A/E/K/U/W/Y`) and navigation (arrows, `Home`, `End`, `PgUp`, `PgDn`).
- Chords such as `Ctrl+X Ctrl+S` go out as one `/api/send-key` request with a `keys` array; a repeated `Esc` is written as separate presses 50 ms apart so the program does not read the pair as one Alt-prefixed key.
- Composer text is sent verbatim with bracketed paste when the pane program supports it, so backslashes survive and multi-line drafts arrive as one paste before the final `Enter`.
- After scrolling into history, `Latest output ↓` returns to the live end. The last selected pane is restored after a page reload.

## Workbench Layout

- Activity Bar: switch between Connect target management and KT session selection.
- Primary Sidebar: shows the active Connect or KT Session view.
- Editor: shows the selected kitty pane and takes the largest area.
- Secondary Browser Drawer: slides in from the right for proxied URL browsing and can be hidden.
- Bottom Panel: tool row (image, Keys) above a chat-style composer that grows with its text; the round send button sits inside the field.
- Status Bar: current connection health, target, socket, pane, and auto-refresh state.
- Themes: Dark, Graphite, Nord, Catppuccin Mocha, Tokyo Night, Gruvbox, Rosé Pine, Light, Catppuccin Latte, Solarized Light, chosen from the top bar and remembered per browser.
- Top controls: numeric font size, theme, and the layout lock (padlock button). Locked by default; unlocking shows drag lines on the sidebar's right edge (220–520px) and the bottom panel's top edge. Dragging the panel edge pins the composer to that height (80–420px); double-click the edge to let it grow with the text again. The handles overlay the edges, so toggling the lock never moves the terminal. The Browser drawer's left edge is always draggable on desktop, pinned or floating, from 320px up to 70% of the window while the terminal keeps at least 180px.

## Frontend Structure

- `public/app.js`: stateful app orchestration, event wiring, session control, and API calls.
- `public/modules/browser-utils.js`: URL normalization, Browser proxy URL creation, HTML escaping, and terminal URL linkification.
- `public/modules/mobile-utils.js`: mobile viewport and browser-history helpers.
- `public/modules/preview-history.js`: pure Browser URL stack operations for root, back, forward, and jump behavior.
- `public/modules/composer-utils.js`: pure composer Enter-key submit decisions and special-key menu definitions.
- `server/image_upload.js`: target-side image upload helpers and Markdown image-reference formatting.

## Embedded Browser Proxy

Terminal `http://`, `https://`, and `file://` URLs open in a right-side Browser drawer. A terminal click resets the Browser's local URL stack to that clicked page; at that root page, Browser Back returns to the KT Panel. Address-bar navigation and in-frame link navigation then build Back/Forward history inside that preview. Browser resources are fetched through the active Local or SSH target and proxied back through the local app, including relative HTML/CSS resources, media byte ranges for MP4/WebM playback, and in-frame link navigation.

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

The same Python helper serves both backends; the `backend` field of the target selects the kitty or tmux action set.

Run the browser layout smoke test with Chrome or Chromium installed:

```bash
npm run smoke:chrome
```

Set `CHROME_BIN=/path/to/chrome` if Chrome is not in a common Linux path. Session/control endpoints require device-token login; use the browser UI for authenticated manual checks.

The UI smoke signs in with a real device token and exercises the layout lock, the Browser drawer drag and handle, Layouts (save, autosave, 409 on a stale write, delete) and the phone navigation stack on a desktop and a phone viewport. Point it at a deck whose `data/` may be written to (it saves and deletes a layout and records the fixture page in Reports), with a throwaway tmux session on the target:

```bash
tmux new-session -d -s krdsmoke
DECK_URL=http://127.0.0.1:3041 DECK_TOKEN=krd_... npm run smoke:ui
```

`CDP_URL=http://127.0.0.1:9333` uses a Chrome that is already running (for example one on another host behind an SSH tunnel) instead of starting one; `DECK_TARGET`, `DECK_SESSION` and `DECK_FIXTURE` (an HTML file on the target, default `tests/fixtures/smoke-report.html`) adjust the rest.

## Versioning

The project uses semantic versioning. The current release is recorded in:

- `package.json`
- `VERSION`
- `CHANGELOG.md`

Git release tags use the `vMAJOR.MINOR.PATCH` format, for example `v0.2.2`.

## Sync to a Remote Playground

If you mirror this app to a remote development machine, keep local targets and logs out of the sync unless you deliberately need them:

```bash
rsync -av --exclude data --exclude tmp ./ user@example-host:/path/to/kitty-remote-deck/
```
