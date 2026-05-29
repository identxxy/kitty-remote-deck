# Device Token Gateway Plan

## Goal

Expose Kitty Remote Deck through a Cloudflared hostname while requiring device-scoped tokens before any target/session/control API can be used.

## Non-Goals

- No public web UI for creating or revoking tokens.
- No third-party auth dependency inside the app.
- No native iOS or Android packaging in this iteration.

## Current Behavior

- `server.js` serves static files and all `/api/*` routes without authentication.
- The server listens on all interfaces when started with `server.listen(PORT)`.
- Cloudflared exists locally but only routes existing SSH/proxy hostnames.
- Runtime data under `data/` is ignored by Git.

## Proposed Design

- Add a zero-dependency auth module using Node `crypto`.
- Store device records in `data/auth.json`.
- Store only salted token hashes; raw tokens are shown once by a local CLI.
- A successful login creates one active session for that device and invalidates any previous session for the same token.
- Browser sessions use an HttpOnly cookie.
- Protect all control/data APIs except health and auth endpoints.
- Keep static assets public so unauthenticated browsers can load the login screen.
- Bind the local server to `127.0.0.1` by default and route Cloudflared to `http://127.0.0.1:3040`.

## Tasks

1. Add tests for token hashing, one-session replacement, and protected API behavior.
2. Implement `server/auth.js` and `scripts/auth-admin.js`.
3. Add `/api/auth/status`, `/api/auth/login`, and `/api/auth/logout`.
4. Gate existing `/api/*` routes behind session auth.
5. Add a compact login overlay and logout/device indicator in the UI.
6. Change server bind host default to `127.0.0.1`.
7. Add the Cloudflared hostname ingress to the local config.
8. Verify syntax, tests, local health, unauth/auth API behavior, and Cloudflared routing config.

## Verification

```bash
npm test
node --check server.js
node --check public/app.js
node --check scripts/auth-admin.js
curl -fsS http://127.0.0.1:3040/api/health
```

## Risks

- Cloudflare DNS/Access policy may need dashboard-side configuration that is not represented in local files.
- A device token is equivalent to control access for the configured SSH targets; tokens must be treated as secrets.
- If the app is exposed before auth is enabled, remote kitty control APIs are unsafe.
