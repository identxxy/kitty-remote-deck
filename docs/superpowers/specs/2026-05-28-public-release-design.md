# Public Release Design

## Goal

Prepare Kitty Remote Deck for a first public GitHub push with the smallest set of changes needed to run locally, document the app clearly, and avoid publishing local runtime state.

## Scope

- Keep the existing zero-dependency Node HTTP server and browser UI.
- Keep local target persistence in `data/targets.json`, but exclude user-specific runtime data from Git.
- Improve repository hygiene for generated Python cache files and local logs.
- Update README language so a fresh public reader can clone, run, and understand the SSH/kitty assumptions.
- Verify local syntax and health endpoints before committing and pushing.

## Architecture

The app remains a local-only control plane. `server.js` serves static assets and API routes, persists target settings under `data/`, and streams `server/remote_helper.py` over SSH for remote `kitty @` actions. The browser UI in `public/` consumes those APIs directly; no bundler or package install step is required.

## Release Strategy

Initialize Git in the existing local directory, stage only source/docs files, create a single initial commit, create a public GitHub repository named `kitty-remote-deck`, set it as `origin`, and push `main`.

## Validation

- `node --check server.js`
- `python -m py_compile server/remote_helper.py`
- `npm start` plus `curl http://localhost:3040/api/health`
- A rendered frontend smoke check for initial page load and at least one visible control interaction
