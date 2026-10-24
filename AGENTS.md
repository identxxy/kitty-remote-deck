# AGENTS.md

This project is a local web app for browsing and controlling GUI `kitty` sessions, or headless `tmux` servers, on the same machine or over SSH.

## Project root

Work from the repository root:

```text
kitty-remote-deck
```

## Quick start

```bash
npm start
```

Then open:

```text
http://localhost:3040
```

## Main files

- `server.js`: local HTTP server and API routes
- `server/kitty_runner.js`: local/SSH helper invocation wrapper
- `server/tmux_watcher.js`: control-mode tmux clients (`tmux -C attach`, local or over ssh) shared per target/socket/session; `GET /api/events` turns their `%output` and layout notifications into server-sent `screen`/`tree`/`reset` events for the page, which then re-fetches `/api/screen`
- `server/url_proxy.js`: URL proxy rewriting helpers for HTML/CSS resources
- `server/remote_helper.py`: Python helper used locally or streamed over SSH to run `kitty @` or `tmux` actions and URL resource fetches; `PAYLOAD["backend"]` selects the action set, and the tmux tree is mapped onto kitty's shape (session -> OS window, window -> tab, pane -> window)
- `public/index.html`: app layout
- `public/app.js`: UI state, events, font-size preference, session actions, embedded Browser drawer
- `public/styles.css`: workbench styling
- `data/targets.json`: saved connection targets

## Expected workflow

1. Start the local server from this directory.
2. Use the seeded `Local Kitty` target for same-machine kitty, or create an SSH target in Connect.
3. Local targets call the Python helper directly; SSH targets stream the helper to the target host.
   Each target also has a `backend` (`kitty` or `tmux`). tmux pane ids start at `%0`, so ids must be checked with `hasSelectedWindow()` / `!== null`, never for truthiness.
4. `Enter` in the composer:
   - sends text if the textbox has content
   - sends `Enter` if the textbox is empty
5. `Shift+Enter` inserts a newline in the composer. Arrow keys and `Esc` on an empty composer are sent to the pane (`getPassthroughKeyOnKeydown` in `composer-utils.js`).
6. Terminal `http://`, `https://`, and `file://` URLs are clickable and open in the right-side Browser drawer. Browser address input, forward/back history, in-frame links, and GET forms are fetched through the active target and proxied through `/api/url-resource`.

## Verification

Useful checks:

```bash
node --check server.js
node --check public/app.js
python -m py_compile server/remote_helper.py
```

Useful API smoke test:

```bash
curl http://localhost:3040/api/health
```

## Deploy / sync

Sync to the remote playground directory with:

```bash
rsync -av --exclude data --exclude tmp ./ user@example-host:/path/to/kitty-remote-deck/
```

If you want saved local targets or logs copied too, remove the excludes deliberately.
