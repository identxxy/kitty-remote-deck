# Public Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish Kitty Remote Deck as a clean public GitHub repository after proving the local app starts.

**Architecture:** Keep the current local Node server, static frontend, and Python remote helper. Make only release hygiene and documentation edits before initializing Git.

**Tech Stack:** Node.js built-in HTTP server, browser HTML/CSS/JS, Python 3 remote helper, GitHub CLI.

---

### Task 1: Release Hygiene

**Files:**
- Modify: `.gitignore`
- Modify: `README.md`

- [x] Add Python cache patterns to `.gitignore` so `server/__pycache__/` and `*.pyc` are not staged.
- [x] Rewrite README setup notes for a public clone: requirements, run command, endpoint, SSH/kitty target assumptions, ignored local state, and verification commands.

### Task 2: Local Verification

**Files:**
- Read: `server.js`
- Read: `server/remote_helper.py`
- Read: `public/index.html`

- [x] Run `node --check server.js`.
- [x] Run `python -m py_compile server/remote_helper.py`.
- [x] Start `npm start` on port `3040`.
- [x] Run `curl http://localhost:3040/api/health` and confirm JSON includes `"ok":true`.
- [x] Run a rendered frontend smoke check: load `http://localhost:3040`, confirm the title/content render, and exercise a visible button without console errors.

### Task 3: GitHub Publication

**Files:**
- Stage: `.gitignore`, `README.md`, `AGENTS.md`, `package.json`, `server.js`, `server/remote_helper.py`, `public/index.html`, `public/app.js`, `public/styles.css`, `docs/superpowers/specs/2026-05-28-public-release-design.md`, `docs/superpowers/plans/2026-05-28-public-release.md`

- [x] Run `git init`.
- [x] Set the default branch to `main`.
- [x] Stage only source and documentation files, excluding `data/`, `tmp/`, and generated caches.
- [x] Commit with message `Initial public release`.
- [x] Create public GitHub repo `kitty-remote-deck` for the authenticated account.
- [x] Push `main` to `origin`.
- [x] Verify the remote repository URL and pushed branch.
