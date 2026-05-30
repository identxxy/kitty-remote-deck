# Image Composer Plan

## Goal

Add first-pass image input to the Input Console.

Users should be able to choose, paste, or drop an image in the web composer, then send it to the selected kitty pane. The server saves the image on the active Local or SSH target and sends a Markdown image reference pointing at the target-side file.

## Non-goals

- Do not directly render images into kitty with `kitten icat` in this pass.
- Do not add persistent attachment management or cleanup UI.
- Do not introduce npm or Python package dependencies.
- Do not commit automatically after the image feature; wait for user testing.

## Design

- Frontend:
  - Add an Image button and hidden `image/*` file input.
  - Support file selection, paste, and drag/drop.
  - Show one pending image chip with thumbnail, filename, size, and remove action.
  - Reuse composer send behavior:
    - Send button sends the Markdown image reference without final terminal Enter.
    - Enter sends the image reference with final terminal Enter.
    - Empty text + image is valid.
- Server:
  - Add `POST /api/send-image`.
  - Accept a base64 image payload with max byte limit.
  - Save to the selected target:
    - Local target: write under `~/Pictures/voxpress/YYYYMMDD/` by default.
    - SSH target: stream bytes through `ssh target python3 -c ...` to the same target-side path pattern on the remote host.
    - `KRD_IMAGE_UPLOAD_DIR=/path/to/dir` can override the root directory for target-side uploads.
  - Send `![filename](file:///target/path)` plus optional user text through existing kitty `send_text`.
- Remote helper:
  - No large image bytes are passed through helper argv. The helper is only used for the final `send_text` call.

## Verification

```bash
node --check server.js
node --check server/image_upload.js
node --check public/app.js
node --check public/modules/composer-utils.js
node --check scripts/chrome-smoke.mjs
python -m py_compile server/remote_helper.py
git diff --check
npm test
npm run smoke:chrome
curl --http1.1 -fsS http://127.0.0.1:3040/api/health
```

## Risks

- Very large images can exceed HTTP/JSON limits, so enforce client and server limits.
- SSH upload depends on `python3` on the target, consistent with the existing helper requirement.
- Markdown image references rely on the foreground program understanding or acting on file references; direct kitty image rendering can be a later mode.
