# Workbench Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the current card-like layout into a fixed-height VS Code-inspired workbench for remote kitty control.

**Architecture:** Reuse the existing zero-dependency HTML/CSS/JS app. Move SSH target controls and session selection into switchable Primary Sidebar views; make the editor and bottom input panel the core workbench; persist UI preferences in localStorage.

**Tech Stack:** Static HTML, CSS grid/flex layout, browser DOM APIs, Node syntax checks, local Chrome smoke validation.

---

### Task 1: RED Structure Check

**Files:**
- Create: `tmp/workbench-layout-check.mjs`

- [ ] Create a temporary Node script that asserts the new workbench regions and controls exist.
- [ ] Run it before implementation and confirm it fails because the old layout lacks the new regions.

### Task 2: Workbench Markup

**Files:**
- Modify: `public/index.html`

- [ ] Replace the card-like shell with a top control bar, two-item Activity Bar, switchable Primary Sidebar, Editor region, Bottom Panel, and Status Bar.
- [ ] Preserve existing element IDs where the JavaScript depends on them.
- [ ] Add new IDs for `showSshViewBtn`, `showSessionsViewBtn`, `themeSelect`, `resizeToggle`, `sendEnterBtn`, `sendCtrlDBtn`, `sidebarResizeHandle`, and `panelResizeHandle`.

### Task 3: Workbench Styling

**Files:**
- Modify: `public/styles.css`

- [ ] Define fixed full-height `100dvh` shell tracks.
- [ ] Remove the narrow-viewport `height:auto` behavior.
- [ ] Add workbench region styling, themes, status bar, activity bar, resize handles, and portrait-safe grid behavior.

### Task 4: UI State and Actions

**Files:**
- Modify: `public/app.js`

- [ ] Persist active sidebar view, theme, resize toggle, sidebar width, and panel height.
- [ ] Wire Activity Bar view switching.
- [ ] Wire top-bar theme/font/resize controls.
- [ ] Wire Bottom Panel Enter, Esc, Ctrl+C, Ctrl+D actions through existing `/api/send-key`.
- [ ] Update status bar fields whenever target/session/socket state changes.

### Task 5: Verification

**Files:**
- Modify: `tmp/chrome-smoke.mjs`

- [ ] Update smoke validation for the new workbench shell.
- [ ] Run static checks, syntax checks, health check, and Chrome smoke.
