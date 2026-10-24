# Changelog

## Unreleased

- With the composer empty, the arrow keys and `Esc` go straight to the pane (`↑ ↓ ← →` as tmux `Up`/`Down`/`Left`/`Right`, `Esc` as `Escape`), so agent menus, prompt history and interrupting the agent can be driven from the keyboard without opening the Keys menu. Typed text, modifiers and IME composition keep the browser's own cursor movement.
- View slots now own their output element permanently. Activating a view no longer moves `#screenOutput` into that slot and re-renders both sides; it only changes which element the selection, composer and sidebar act on, so nothing in the layout shifts and every view keeps its scroll position. Secondary views follow the page's text mode (`All` or `Screen`) with the same incremental rendering and line deltas as the active view, and the split containers are rebuilt only when a view is split or closed.
- Secondary views use the same `scroll-panel` styling as the active view (stable scrollbar gutter), so activating a view no longer shifts its text by the scrollbar width.
- Fixed saved UI preferences being discarded on every load: an invalid assignment in the preference loader threw, so font size, theme, auto-fit and text mode always reverted to defaults. Font size chosen with `A-`/`A+` now survives reloads.
- Session explorer shows a `cached` badge on panes the page holds a snapshot of. Activating a split view repaints its pane from that cache instead of flashing `Loading pane`, and a view that becomes secondary again starts from the last screen it drew rather than `Loading view...`.
- The page keeps the last 8 pane snapshots it showed (text, hash, scroll position, tail-follow state). Switching back to a pane repaints the cached snapshot immediately and revalidates with `since`, so the round trip usually returns `unchanged` or a small delta instead of the full text, and the view no longer flashes `Loading pane`.
- Screen text is drawn one block element per line and updated incrementally (`public/modules/terminal-lines.js`): only lines that changed since the previous draw are replaced, aligned on lines that scrolled off the top once the history limit is reached. Before, every change rebuilt the whole `All` scrollback (~660 KB of HTML for 2000 lines), which with live updates ran often enough to stall typing in the composer. `/api/screen` can also answer with a line delta (`delta=1` with `since`): the server keeps the last text it served per pane and returns `drop`/`keep`/`tail` relative to it, so a streaming agent costs a few hundred bytes per update instead of the gzipped history (~65 KB).
- Live updates for tmux targets: the page opens one `GET /api/events` stream (server-sent events) for the primary view and every split view. The server keeps a tmux control-mode client (`tmux -C attach`, `server/tmux_watcher.js`) per watched session and forwards `%output` as `screen` events (debounced 80 ms, routed by tmux window), layout/session changes as `tree`, and client exit as `reset`; the page re-fetches through the existing `/api/screen` path, so the agent's output appears within ~100-200 ms plus network instead of waiting for the next poll. Polling drops to a 15 s safety net while the stream is live (status bar shows `Auto-refresh: live`) and resumes at the adaptive cadence when it is not. Control-mode clients no longer count as `attached` (helper `list-clients` with `client_control_mode`), so auto-fit keeps working while the deck watches a session; `td img` skips them too.
- tmux panes can be resized to the browser's cell grid. Detached sessions are fitted automatically when a pane is selected or the view changes (toggle in the `⋯` menu); `Fit pane to screen` in the same menu also resizes attached sessions, pinning that window's `window-size` to `manual`. The explorer shows `attached`, `alt-screen`, and `zoomed` badges on tmux panes.
- Screen mode for tmux targets now reproduces the whole window: panes are drawn at their tmux positions and sizes (`/api/screen` returns `window` and `panes` for the screen extent), clicking a pane selects it, and `Zoom pane (prefix-z)` in the `⋯` menu toggles zoom. Fitting resizes the window; split panes share it as in tmux.
- Added browser-side view splits (`public/modules/pane-tree.js`, modeled on deepseek-harness `ui-layout/panes.ts`): a persisted binary tree of views, each bound to a pane on any target; the active view owns the composer and the pane-fit logic, other views poll their own screen every 2 s with `since` hashing. `⋯` menu and view headers offer split right / split down / close; dividers drag between 20% and 80%.
- Added `scripts/td`, a terminal picker for the same tmux sessions across hosts (list over ssh in parallel, attach with `tmux new-session -A`, kitty `--tab` launch, kill, new).
- Added `td img [HOST[:SESSION]]`: upload the clipboard image to the host and paste its link into the attached tmux pane, detecting the session from the focused kitty window. `kitten` is located next to the running kitty binary when it is not on PATH.
- Added `×` close controls in the session explorer (`/api/close-panel`: tmux kill-session / kill-window / kill-pane, kitty close-tab / close-window) with a confirmation, and a `Ctrl+D ×2` key that sends both presses in one request (`repeat` on `/api/send-key`).
- Default image upload directory renamed from `~/Pictures/voxpress/` to `~/Pictures/remote-deck/` (`KRD_IMAGE_UPLOAD_DIR` still overrides it).
- Alternate-screen panes (Claude Code's fullscreen renderer, `less`, `vim`) have no tmux scrollback, so the deck treats them as viewport-only: scroll gestures send `PgUp`/`PgDn` to the app and `Latest output` sends `Ctrl+End`. For a scrollable transcript in the deck, run Claude Code in tmux with `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1` or switch it with `/tui default`.
- Replaced the Screen/All, Refresh, and Auto-refresh toolbar controls with a single `⋯` view menu. `All` (screen + scrollback, scrolled in the browser) is now the default text mode; `Screen` stays available in the menu for TUI programs and is remembered only when chosen there.
- The round arrow button sends the composer text followed by Enter, like the Enter key. A `No ⏎` button above the composer, or `Alt+Enter`, sends the text without a trailing Enter.
- Rebuilt the bottom panel as a chat-style composer: a slim tool row (image attach, `Keys` menu) sits directly above one rounded field that grows with its text (up to the panel height, 160px by default, adjustable in resize mode), with a round arrow send button inside the field. The `Input Console` header, the `Send` label, and the separate `Enter` button are gone; `Enter` in an empty composer sends the Enter key.

- Added a `tmux` backend per target for hosts without a display. Sessions, windows, and panes are listed from `tmux list-panes -a` and mapped onto the existing explorer (session -> OS window, window -> tab, pane -> pane). Screens use `capture-pane -e`, composer text goes through `load-buffer` + `paste-buffer -p`, and keys are translated to tmux names. Socket discovery lists live servers under `$TMUX_TMPDIR/tmux-UID/*` and skips stale socket files.
- Screen-mode scrolling for tmux panes keeps a per-pane offset on the server and captures the matching slice of history instead of entering copy mode, so attached terminals are not disturbed.
- Window, tab, and pane ids may now be `0` (tmux `%0`, `@0`, `$0`); the API and UI no longer treat `0` as "no selection".
- The Connect form has a Backend selector; the session explorer, status bar, and create buttons use backend-specific names (`Session` / `Window` / `Pane` for tmux). tmux targets only offer `New Session` in the explorer; windows and splits are arranged from the terminal.

- Made auto-refresh adaptive: panes refresh every 0.7s while output is changing or right after input, then back off to 1.5s and 4s as they go quiet. Polling pauses while the page is hidden and resumes immediately when it becomes visible.
- Added screen hashes to `/api/screen`; pollers pass `since=<hash>` and receive a small `{ "unchanged": true }` response instead of the full screen when nothing changed.
- Gzip-compressed JSON and static responses for clients that accept it.
- Static assets now revalidate with ETags (`Cache-Control: no-cache`) and return `304 Not Modified` when unchanged instead of re-downloading on every load.
- Sent composer text verbatim through `kitty @ send-text --stdin` with `--bracketed-paste auto`, followed by a separate Enter key. Backslashes are no longer interpreted as escapes, and multi-line drafts no longer submit early in programs that support bracketed paste.
- Changed image references to `[name](file:///path)`; the previous `![name](...)` form switched Codex's composer into shell mode.
- Restricted OSC 8 terminal hyperlinks to `http://`, `https://`, and `file://` targets; other schemes render as plain text.
- Kept rule-only and Braille-spinner rows on one clipped line instead of wrapping them on narrow screens, and tightened terminal line spacing.
- Added Shift+←, Alt+↑, Shift+Tab, Backspace, and Delete to the Keys menu, with the agent prompt keys first.
- Added a floating `Latest output ↓` button that scrolls the kitty viewport back to its end in Screen mode, or resumes tailing in All mode.
- Restored the last selected pane after a page reload when the same target and socket still list it.

## v0.2.1 - Session Reliability

- Restored single-active-session enforcement for device tokens: a new login now invalidates every previous session for that token.
- Prevented rapid Enter presses and key-button taps from submitting duplicate composer actions while a send is in flight.
- Made pane switching clear stale content immediately, cancel the previous pane request, and ignore late responses from the old pane.

## v0.2.0 - Kitty Surface Management

- Added a mobile chat-style flow: Connect screen, full-screen Session list, full-screen pane conversation, visible bottom composer, and Fit/Wide terminal text modes.
- Allowed one device token to keep multiple active browser sessions, so mobile and desktop-mode tabs from the same device do not invalidate each other.
- Improved device-token authentication feedback with an initial auth-check screen and authenticated key label/toast.
- Added mobile Auto Connect for the last selected target, with suppression after returning from Sessions to Connect.
- Fixed composer Enter handling so newline-only or multiline mobile input is sent as text before the final terminal Enter.
- Split first-pass frontend helpers into `public/modules/` and improved mobile Browser preview as a full-screen overlay with a KT Panel return action.
- Fixed mobile Browser history so system Back and `‹ KT Panel` return to the selected pane instead of jumping to the Session list.
- Moved the mobile Browser reopen tab to the right-side vertical center so it no longer overlaps the bottom composer.
- Preserved mobile pane output while Browser is open and refresh the selected pane immediately when returning to KT Panel.
- Reset Browser history when opening a URL from the KT Panel, so root Back returns to the KT Panel and unrelated pane/topic links do not share one Back stack.
- Split Browser URL-stack and Input Console Enter-key decisions into frontend helper modules to prepare for richer composer actions.
- Added first-pass image attachments in the Input Console, saving images on the active target and sending Markdown file references to the selected pane.
- Improved image-attachment composer layout and added a sending state to prevent duplicate image submissions while upload is in flight.
- Changed image upload storage to the user-visible target-side `~/Pictures/voxpress/YYYYMMDD/` directory, with `KRD_IMAGE_UPLOAD_DIR` support for overriding the root.
- Moved the desktop image picker to the Input Console header, kept the mobile image action in the bottom action row, and standardized user-facing UI copy in English.
- Added scoped Kitty creation controls for new OS windows, tabs, and tab-level splits.

## v0.1.0 - Initial Release

- Added local and SSH kitty target control.
- Added device-token authentication for exposed deployments.
- Added VS Code-style workbench layout with activity bar, primary sidebar, editor, bottom input console, and status bar.
- Added screen/all text modes, remote wheel scrolling, and scroll-position preservation.
- Added embedded Browser drawer with proxied URL loading, address bar, back/forward history, pinning, resize support, and in-frame link handling.
- Added documentation for setup, security, deployment, verification, and URL proxy behavior.
