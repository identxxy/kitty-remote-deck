# Changelog

## Unreleased

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
