# Workbench Layout Redesign

## Goal

Reshape Kitty Remote Deck into a VS Code-inspired remote terminal workbench that fills tall portrait screens and keeps the pane viewer as the dominant surface.

## Reference Model

The layout borrows the workbench structure documented by VS Code: Activity Bar, Primary Side Bar, Editor, Panel, Status Bar, plus a top control/title area. It does not copy VS Code branding, icons, colors, or exact product UI.

## Required Shell

- **Top control bar:** app identity, UI configuration controls, refresh/connect actions.
- **Activity Bar:** exactly two primary entries: SSH and Session.
- **Primary Sidebar:** switches between an SSH target-management view and a KT session-selection view.
- **Editor:** central terminal screen viewer with selected pane metadata; this must take the largest area.
- **Bottom Panel:** Input Console with composer plus common key/action buttons.
- **Status Bar:** compact connection/session facts: SSH health, target, socket, selected pane, auto-refresh.

## Interaction Requirements

- Resize controls are disabled by default.
- A top-bar resize toggle enables drag handles for sidebar width and bottom panel height.
- UI controls include font size and theme selection.
- Common bottom-panel actions include Send, Enter, Esc, Ctrl+C, and Ctrl+D.
- Tall/narrow screens must remain a full-height workbench instead of collapsing into a half-page flow layout.

## Validation

- Static structure check for the required workbench regions and controls.
- Syntax checks for server and client JavaScript.
- Rendered Chrome smoke checks at desktop and portrait viewports for full-height shell, visible editor, visible bottom panel, and no console errors.
