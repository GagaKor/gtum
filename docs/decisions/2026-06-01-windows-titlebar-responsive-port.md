# Windows titlebar + responsive: phased visual port

**Date:** 2026-06-01
**Status:** Accepted
**Scope:** `src/widgets/app-shell/ui/Titlebar.tsx`, `src/prototype.jsx`, `src/shared/lib/os/detectOs.ts`, `src/styles.css`

## Context

The `~/Downloads/gtum` design draft (the source design for the app's current shell) newly added a Windows titlebar (OS-switchable caption buttons) and a width-based responsive layout. Verification confirmed neither was present in the repo: the extracted `Titlebar.tsx` rendered macOS-only static traffic lights, and there was no OS detection, `winW`/`widthClass`, or auto-collapse. The task was to port those two additions into the running Tauri app.

## Decision

Port in one phase: OS auto-detection + the macOS/Windows titlebar visual variants + the responsive width-class reflow. Defer real OS window control (frameless `decorations:false` + wiring buttons to the Tauri window API) to a follow-up. Integrate by extending the existing `Titlebar.tsx` + `prototype.jsx` rather than adopting the full draft.

## Alternatives Considered

### Real window control now (frameless + Tauri window API)
- **Description:** `decorations:false`, wire minimize/maximize/close to `getCurrentWindow()`, add drag region + `core:window:*` capabilities.
- **Pros:** Correct desktop behavior immediately.
- **Cons:** Larger, riskier change (frameless window, permissions, browser-preview fallback); the user explicitly chose to defer it.

### Visual/mock only, no OS detection
- **Description:** Hardcode both layouts behind a manual toggle like the draft.
- **Cons:** A real app should detect its actual platform; a manual-only toggle is dev-only.

### Adopt the full `Downloads/gtum` draft (replace prototype.jsx)
- **Description:** Bring the entire restructured draft (app/workspace/modals/etc.) in.
- **Cons:** Out of scope; the draft's winState→dock/taskbar mock simulates OS window states inside the webview and conflicts with the real OS window.

## Reasoning

The user selected a phased approach (design approval + the "단계 분리" answer). Extending `Titlebar.tsx`/`prototype.jsx` keeps the change small, aligns with the in-progress FSD extraction, and reuses the existing scaler/panel-collapse infrastructure. OS is auto-detected from the backend `get_runtime_info` (already exposed) with a navigator fallback and a `window.__GTUM_OS__` override for deterministic E2E.

## Trade-offs Accepted

- The caption/traffic buttons are visual for this phase: maximize toggles an in-canvas `is-max` (scaler fills the stage 1:1), while minimize/close are no-ops with TODO markers. This accepted short-term trade-off was resolved by `2026-06-01-native-window-controls.md`.
- Responsive reflow (width class + auto-collapse) only engages meaningfully when maximized, because the non-maximized window is a fixed 1320px design canvas that is merely scaled to fit.

## Related Code Paths

- `src/shared/lib/os/detectOs.ts` — `initialOs()` (sync guess + `__GTUM_OS__` override) and `detectRuntimeOs()` (Tauri `get_runtime_info`)
- `src/widgets/app-shell/ui/Titlebar.tsx` — `os`/`maximized` props + `WinControls` + os-mac/os-windows layouts; `shellTypes.ts` gains `ShellOs`
- `src/prototype.jsx` — os/maximized/winW state, `windowRef`, scale + width-measure effects, edge-triggered auto-collapse, `os-<os> w-<x> [is-max]` classes
- `src/styles.css` — `.titlebar.os-mac/.os-windows`, `.traffic.mac`, `.win-controls .winbtn`, `.gtum-window.os-windows/.is-max`, `.gtum-scaler.is-max`, responsive `.w-md/.w-sm`
- `tests/e2e/design-prototype.spec.ts` — Windows/mac variant + responsive-collapse coverage

## Consequences

- Follow-up resolved: real OS window control was implemented in the native-window-controls slice (`decorations:false`, Tauri window API wiring, and explicit window-control capability entries).
- This is the first item of the broader "make it actually-working software" action plan.

## Decision Journey

### Initial Request
User: the `Downloads/gtum` design includes a Windows titlebar + responsiveness — apply it. Then clarified the design was newly added and not yet in the app.

### Plan Evolution
- Scope narrowed from "apply the whole design" to a targeted graft of the two new features (user choice).
- Window-control behavior set to phased: visual + OS auto-detect + responsive now, real frameless control later (user choice).
