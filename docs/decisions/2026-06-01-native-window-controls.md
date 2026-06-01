# Native frameless window controls

**Date:** 2026-06-01
**Status:** Accepted
**Scope:** `src/prototype.jsx`, `src/widgets/app-shell/ui/Titlebar.tsx`, `src/shared/api/runtimeWindow.ts`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`

## Context

The previous Windows-titlebar/responsive slice intentionally shipped the custom titlebar as a visual shell only. The user then asked to continue the action plan toward actually-working software, with the direct follow-up being real OS window control. Leaving the native titlebar enabled would show duplicate chrome, while the custom caption buttons would still be misleading because minimize and close were no-ops.

## Decision

Make the app window frameless and treat the custom titlebar as the real desktop chrome:

- set the main Tauri window `decorations` flag to `false`
- route custom minimize, close, maximize/restore, and titlebar drag actions through Tauri `getCurrentWindow()`
- keep browser preview safe through `src/shared/api/runtimeWindow.ts`, which exposes no-op browser fallbacks and an injected test bridge
- add explicit capability entries for the window commands used by the custom chrome

## Alternatives Considered

### Keep visual controls only until all runtime features are real
- **Cons:** The app would keep duplicate native/custom titlebars and misleading controls, which blocks first-use polish even before terminal/agent runtime work lands.

### Use only `data-tauri-drag-region`
- **Cons:** The current implementation needs deterministic browser E2E coverage and explicit parity with the planned `startDragging` API path, so an injected bridge is a better seam.

### Add custom Rust commands for window control
- **Cons:** Tauri already exposes the required window API and permissions. Extra Rust commands would duplicate framework behavior without improving the product contract.

## Consequences

- The custom titlebar is now responsible for native window behavior in desktop builds.
- Browser preview keeps the same visual experience and uses no-op controls unless tests inject a mock runtime window bridge.
- Follow-up work can move from window chrome into the higher-value runtime slices: real PTY wiring, real Codex suggestions, approval-to-execution, and workspace restore.
