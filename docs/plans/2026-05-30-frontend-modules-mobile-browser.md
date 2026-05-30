# Frontend Modules And Mobile Browser Plan

## Goal

Refactor the first layer of the frontend into small browser-loaded modules while improving the mobile Browser preview experience.

## Non-goals

- Do not introduce a build step.
- Do not change the server API contract.
- Do not rewrite the whole app into a framework.
- Do not remove existing desktop Browser drawer behavior.

## Current Behavior

- `public/app.js` owns auth, UI preferences, mobile navigation, sessions, terminal text, composer input, Browser preview, and debug logging.
- The Browser drawer works well on desktop.
- On mobile, URL clicks can technically open the Browser, but the drawer still behaves like a desktop right-side panel and lacks a deliberate mobile interaction model.

## Design

- Keep plain browser JavaScript.
- Add focused helper modules under `public/modules/` using classic scripts that attach `window.KRD*` namespaces. This avoids a bundler and preserves existing smoke-test access to globals.
- First extraction targets:
  - `browser-utils.js`: URL normalization, proxy URL creation, HTML escaping, terminal linkification.
  - `mobile-utils.js`: viewport and mobile history primitives.
- Keep stateful orchestration in `public/app.js` for this pass.
- Add a mobile Browser mode:
  - URL links in the terminal open a full-screen Browser overlay on phones.
  - The Browser has a visible Back-to-session button.
  - The floating reopen button is available in chat mode after a URL was opened.
  - Pinning remains mostly a desktop/tablet concept; on mobile the Browser is an overlay to preserve the chat layout.

## Steps

1. Extract pure Browser and mobile helpers to `public/modules/`.
2. Load helper scripts before `public/app.js`.
3. Replace duplicated helper code in `public/app.js` with namespace calls.
4. Add mobile Browser CSS and a mobile Browser back button.
5. Extend `scripts/chrome-smoke.mjs` to assert mobile URL click opens the Browser overlay and returns to chat.
6. Update README/CHANGELOG and run full verification.

## Verification

```bash
node --check public/modules/browser-utils.js
node --check public/modules/mobile-utils.js
node --check public/app.js
node --check server.js
node --check scripts/chrome-smoke.mjs
python -m py_compile server/remote_helper.py
git diff --check
npm test
npm run smoke:chrome
curl --http1.1 -fsS http://127.0.0.1:3040/api/health
```

## Risks

- Mobile history and Browser close behavior can conflict with chat/session browser back navigation. Keep Browser close explicit for this pass.
- Moving too much stateful code at once would increase regression risk. Keep the first pass mostly pure-helper extraction.
