# Browser And Composer Refactor Plan

## Goal

Reduce `public/app.js` coupling before adding image sending to the Input Console.

This pass should keep behavior unchanged while moving pure Browser URL-stack logic and composer-submit decisions into small browser-loaded helper modules.

## Non-goals

- Do not add image sending in this pass.
- Do not change server APIs.
- Do not introduce a frontend build step or framework.
- Do not commit automatically after the refactor; wait for manual user testing.

## Relevant Files

- `public/app.js`: owns state, event wiring, Browser preview, session refresh, and text/key sending.
- `public/modules/browser-utils.js`: URL normalization and terminal linkification helpers.
- `public/modules/mobile-utils.js`: mobile viewport/history helpers.
- `public/index.html`: script loading order.
- `scripts/chrome-smoke.mjs`: regression coverage for mobile Browser, Browser history, and composer Enter behavior.

## Proposed Design

- Add `public/modules/preview-history.js`.
  - Own pure operations over `{ items, index, url }`.
  - Support `push`, `replace`, `reset`, `none`, `goBack`, `goForward`, and `jump`.
  - Keep root-page Back behavior in `app.js`, because closing Browser is UI state, not pure history state.
- Add `public/modules/composer-utils.js`.
  - Decide whether Enter should send text with a final newline or send a terminal `enter` key.
  - Keep API calls and DOM mutation in `app.js`.
- Load these modules before `app.js`.
- Keep persisted state shape unchanged: `previewHistory`, `previewHistoryIndex`, `previewUrl`.

## Task List

1. Add helper modules with small, pure functions.
2. Replace `rememberPreviewUrl`, `replaceLoadedPreviewUrl`, `goBackPreview`, `goForwardPreview`, `jumpPreviewHistory`, and `sendComposerShortcut` internals with module calls.
3. Update script version query strings.
4. Extend smoke checks enough to prove existing Browser stack and composer behavior still work.
5. Run syntax checks, unit tests, smoke test, and restart the local service.

## Verification

```bash
node --check public/app.js
node --check public/modules/browser-utils.js
node --check public/modules/mobile-utils.js
node --check public/modules/preview-history.js
node --check public/modules/composer-utils.js
node --check scripts/chrome-smoke.mjs
git diff --check
npm test
npm run smoke:chrome
curl --http1.1 -fsS http://127.0.0.1:3040/api/health
```

## Risks And Rollback

- Browser history is user-visible. Keep the old persisted shape and verify terminal-root Back, in-frame navigation, address-bar navigation, and mobile Back.
- Composer behavior is high-frequency. Verify multiline, newline-only, and empty composer Enter paths.
- Rollback is contained to script loading and helper calls in `public/app.js`.
