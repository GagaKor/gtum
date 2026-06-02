# gtum 디자인 시스템 / Design System

## 문서 목적 / Document Purpose

### 한국어

이 문서는 `gtum`의 제품 UI 디자인 시스템 기준 문서다. `Sprint 15`의 `Mission Control`형 workbench 방향과 `/Users/kwon/Downloads/test (1)`의 발전 시안을 흡수해, 실제 구현에서 따라야 할 토큰, 레이아웃, 컴포넌트, 인터랙션 기준을 고정한다.

브랜드 로고와 심볼 자산은 `docs/brand-identity.md`를 따른다. 앱 내부 작업 UI의 표면, 상태색, 밀도, 컴포넌트 기준은 이 문서를 따른다.

### English

This document is the design-system source of truth for the `gtum` product UI. It absorbs the `Sprint 15` Mission Control workbench direction and the developed draft in `/Users/kwon/Downloads/test (1)`, then fixes the tokens, layout, components, and interaction rules for implementation.

Brand logo and symbol assets follow `docs/brand-identity.md`. In-app workspace surfaces, state colors, density, and component rules follow this document.

## 언제 읽는 문서인가 / When To Read This Document

### 한국어

아래 상황이면 이 문서를 읽는다.

- UI 토큰, 색상, 반경, 타이포그래피를 바꿀 때
- app shell, left rail, workbench, terminal, agent workspace의 시각 구조를 바꿀 때
- 새 UI 컴포넌트를 만들거나 기존 컴포넌트의 상태 표현을 바꿀 때
- 시안과 구현의 디자인 일관성을 검토할 때

### English

Read this document when:

- changing UI tokens, color, radius, or typography
- changing visual structure for the app shell, left rail, workbench, terminal, or agent workspace
- creating UI components or changing state representation
- checking design consistency between mockups and implementation

## 핵심 방향 / Core Direction

### 한국어

`gtum`의 기본 UI는 어두운 데스크톱 개발 도구다.

- 첫 화면은 설명 페이지가 아니라 실제 작업 공간이어야 한다.
- 정보 밀도는 높게 유지하되, 동일한 카드가 반복되는 대시보드처럼 보이지 않아야 한다.
- 프로젝트, 코드, 터미널, 에이전트는 한 작업 흐름 안에 있어야 한다.
- 장식은 줄이고 상태, 실행, 승인, 위험도, 활성 컨텍스트를 드러내는 데 시각 강조를 쓴다.
- `VS Code`의 편집기/분할 계층, `cmux`의 터미널 연속성, `conductor`의 에이전트 작업 흐름을 결합한다.

### English

The default `gtum` UI is a dark desktop developer tool.

- The first screen should be the real workspace, not an explanatory page.
- Keep information density high without turning the product into a repeated-card dashboard.
- Project, code, terminal, and agent surfaces must stay in one work flow.
- Reduce decoration and spend emphasis on state, execution, approvals, risk, and active context.
- Combine the editor/split hierarchy of `VS Code`, terminal continuity from `cmux`, and agent workflow clarity from `conductor`.

## 앱 셸 / App Shell

### 한국어

기본 화면은 아래 다섯 영역으로 구성한다.

- `Top mission header`
  - 앱 브랜드, 현재 프로젝트/경로, provider 상태, 현재 작업, 활성 세션, 연결 수, 대기 제안 수를 조밀하게 보여준다.
- `Left rail + side panel`
  - `프로젝트`, `탐색기`, `소스 제어`, `아웃라인`, `설정` view를 icon-only rail로 전환한다.
  - side panel은 compact row와 single-line ellipsis를 기본으로 한다.
  - side panel은 4px dock resize handle로 폭을 조절할 수 있어야 하며, 임계값 이하로 줄이면 collapsed rail 상태가 된다.
- `Center workbench`
  - 코드 surface와 terminal/diff/test/preview pane을 분할 가능한 workbench로 다룬다.
  - 각 pane은 자신의 tab strip을 가진다.
- `Right agent workspace`
  - provider, context, thread, activity log, composer approval, composer가 하나의 작업 흐름으로 이어져야 한다.
  - 활성 provider와 session/readiness 상태를 agent workspace 상단의 compact row로 먼저 읽을 수 있어야 한다. 모델 선택은 `read_agent_provider_capabilities`가 실제 모델 목록을 제공할 때 composer에서만 노출하고, 실행 모드는 런타임 정책이 없으면 노출하지 않는다.
- `Status/pill strip`
  - 하단 고정 패널보다 workbench 안의 작은 상태 pill을 우선한다.

### English

The default screen is composed of five areas:

- `Top mission header`
  - Compactly shows brand, current project/path, provider state, current task, active session, connection count, and pending suggestion count.
- `Left rail + side panel`
  - Switches `Project`, `Explorer`, `Source Control`, `Outline`, and `Settings` through an icon-only rail.
  - Side-panel rows default to compact height and single-line ellipsis.
  - The side panel must be horizontally resizable with a 4px dock resize handle, collapsing back to the rail below the threshold.
- `Center workbench`
  - Treats code, terminal, diff, test, and preview panes as a split-capable workbench.
  - Each pane owns its own tab strip.
- `Right agent workspace`
  - Provider, context, thread, activity log, composer-level approval, and composer must read as one work flow.
  - Active provider and session/readiness state should be readable first through a compact row at the top of the agent workspace. Model picking appears in the composer only when `read_agent_provider_capabilities` provides runtime-synced models, and execution modes remain hidden until backed by runtime policy.
- `Status/pill strip`
  - Prefer small status pills inside the workbench over a permanent bottom panel.
- `Desktop launch geometry`
  - The uploaded-design baseline and default Tauri launch window are `1320x824`.
  - The frameless shell must fill the entire viewport at every restored, resized, and maximized desktop size.
  - Do not preserve the `1320x824` aspect ratio through fixed-canvas scaling when the window is larger; top, bottom, left, or right letterboxing is a regression.
  - Smaller windows should reflow through compact shell states and panel collapse rather than centered transform scaling.

## 토큰 / Tokens

### 한국어

구현 기본 토큰은 frontend reset 이후 `src/styles.css`의 CSS 변수다.

| Token | Value | Role |
| --- | --- | --- |
| `--accent` | `#5df18a` | 기본 액센트, 실행 중, primary action |
| `--accent-warm` | `#ffb85c` | 경고성 보조 포인트 |
| `--bg` | `oklch(0.165 0.006 250)` | 중앙 작업 배경 |
| `--bg-deep` | `oklch(0.135 0.005 250)` | rail, terminal, 깊은 표면 |
| `--surface-1` | `oklch(0.195 0.007 250)` | 기본 패널과 카드 |
| `--surface-2` | `oklch(0.225 0.008 250)` | 버튼, chip, 입력 |
| `--surface-3` | `oklch(0.27 0.009 250)` | hover, selected, active surface |
| `--border` | `oklch(0.285 0.011 250)` | 기본 구분선 |
| `--border-strong` | `oklch(0.36 0.012 250)` | 강조 구분선 |
| `--text-strong` | `oklch(0.95 0.004 250)` | 기본 텍스트 |
| `--muted` | `oklch(0.68 0.012 250)` | 보조 텍스트 |
| `--text-dim` | `oklch(0.5 0.012 250)` | 메타 정보 |
| `--text-faint` | `oklch(0.38 0.01 250)` | 낮은 대비 정보 |
| `--ok` | `#5df18a` | 성공, 연결됨, 통과 |
| `--warn` | `#ffb85c` | 대기, 경고, dirty |
| `--err` | `#ff6a6a` | 오류, 실패, 높은 위험 |
| `--info` | `#6eb3ff` | 정보성 상태 |

반경은 `--radius-sm: 6px`, `--radius-md: 9px`, `--radius-lg: 13px`, `--radius-xl: 18px`를 기준으로 한다. Workbench 내부 컴포넌트는 과한 라운딩을 피하고, chip/pill만 `999px`를 허용한다.

### English

Implementation tokens now live as CSS variables in `src/styles.css` after the frontend reset.

| Token | Value | Role |
| --- | --- | --- |
| `--accent` | `#5df18a` | Primary accent, running state, primary action |
| `--accent-warm` | `#ffb85c` | Warning-oriented secondary accent |
| `--bg` | `oklch(0.165 0.006 250)` | Main work background |
| `--bg-deep` | `oklch(0.135 0.005 250)` | Rail, terminal, deep surfaces |
| `--surface-1` | `oklch(0.195 0.007 250)` | Default panels and cards |
| `--surface-2` | `oklch(0.225 0.008 250)` | Buttons, chips, inputs |
| `--surface-3` | `oklch(0.27 0.009 250)` | Hover, selected, active surfaces |
| `--border` | `oklch(0.285 0.011 250)` | Default dividers |
| `--border-strong` | `oklch(0.36 0.012 250)` | Emphasized dividers |
| `--text-strong` | `oklch(0.95 0.004 250)` | Primary text |
| `--muted` | `oklch(0.68 0.012 250)` | Secondary text |
| `--text-dim` | `oklch(0.5 0.012 250)` | Metadata |
| `--text-faint` | `oklch(0.38 0.01 250)` | Low-contrast information |
| `--ok` | `#5df18a` | Success, connected, passing |
| `--warn` | `#ffb85c` | Waiting, warning, dirty |
| `--err` | `#ff6a6a` | Error, failed, high risk |
| `--info` | `#6eb3ff` | Informational state |

Radius tokens are `--radius-sm: 6px`, `--radius-md: 9px`, `--radius-lg: 13px`, and `--radius-xl: 18px`. Avoid oversized radii inside the workbench; reserve `999px` for chips and pills only.

## 컴포넌트 기준 / Component Rules

### 한국어

- `activity-button`
  - icon-only, `38px` 정사각형, active 상태는 왼쪽 액센트 라인과 accent text로 표시한다.
- `pill`, `status-badge`, `chip`
  - 작고 조밀하게 유지한다. 상태 의미는 색상과 텍스트를 함께 쓴다.
- `pane-tab`
  - 큰 CTA가 아니라 낮은 compact tab이어야 한다.
- `code-window`, `terminal-window`, `diff-window`
  - `--bg-deep` 기반의 어두운 surface를 쓰고, 모노스페이스와 줄 단위 상태색을 유지한다.
- `agent-card`, `side-section`
  - 동일한 카드 반복처럼 보이지 않게 role별 밀도와 내부 구성을 다르게 한다.
- `dock-resize-handle`
  - 좌우 panel 안쪽 edge에 붙는 4px vertical handle이다. hover와 drag 중에는 `--accent`로만 강조하고, 별도 텍스트 버튼처럼 보이면 안 된다.
- `agent-model-row`
  - 오른쪽 agent workspace 첫 줄에서 현재 provider와 session/readiness 상태를 조밀하게 보여준다. 모델 선택은 composer의 runtime-backed capability UI가 담당하고, 실행 모드 선택은 현재 UI 계약에 포함하지 않는다.
- `agent-log-item`
  - 실행 제안은 큰 카드가 아니라 요약, 명령 수, 위험도, 결정 상태를 보여주는 가벼운 activity row로 표시한다.
- `composer-approval`
  - 현재 검토 중인 제안에만 composer 바로 위에서 명령, 대상, 위험도, 사유, 결정 버튼을 보여준다.

### English

- `activity-button`
  - Icon-only, `38px` square, active state shown with a left accent line and accent text.
- `pill`, `status-badge`, `chip`
  - Keep them compact. Use text and color together for state meaning.
- `pane-tab`
  - Must read as a low compact tab, not a large CTA.
- `code-window`, `terminal-window`, `diff-window`
  - Use dark `--bg-deep` surfaces, monospace text, and line-level state colors.
- `agent-card`, `side-section`
  - Avoid repeated generic card treatment; vary density and structure by role.
- `dock-resize-handle`
  - A 4px vertical handle pinned to the inner edge of each side panel. Highlight it with `--accent` on hover and drag; it must not look like a separate text button.
- `titlebar`
  - The app uses custom frameless desktop chrome. macOS renders traffic lights on the left; Windows renders caption buttons on the right. Titlebar dragging and edge/corner resizing must call the native window API, while browser preview keeps safe no-op fallbacks.
- `agent-model-row`
  - Compactly shows the current provider and session/readiness state as the first row of the right agent workspace. Composer-level model picking is allowed only from runtime-backed provider capabilities, while execution-mode selection is not part of the current UI contract.
- `agent-turn`
  - Shows live agent work as one conversational assistant turn. Pending runtime progress appears inside the turn with concrete operation labels instead of generic lifecycle copy, and those labels reveal sequentially rather than all at once. After success the progress clears so the completed turn shows answer-time metadata and reads like normal assistant copy. Numbered reply choices become selectable decision event cards. Command-bearing responses become permission event cards with clear labels, reason copy, command preview, risk, and direct `Allow once`, `Always allow`, and `Deny` actions.
- `agent-event-card`
  - Lives inside the conversational agent turn and must be fully visible by auto-scrolling the agent thread to the bottom when it appears or changes height. Permission cards decide directly in the card; they must not require an intermediate composer-level review panel.

## 인터랙션 기준 / Interaction Rules

### 한국어

- 패널 접기/펼치기, 탭 전환, provider 선택, line anchor 이동은 즉시 반응해야 한다.
- 좌우 패널 폭 조절은 pointer drag로 즉시 반응해야 하며, drag 중에는 grid transition을 끄고 cursor와 selection 상태를 고정한다.
- 명령 실행은 항상 승인 전 검토와 승인 후 실행 단계를 분리한다.
- 좁은 화면에서는 side panel을 먼저 접고, 그 다음 agent workspace를 줄인다.
- 코드 줄은 강제 wrap보다 pane 내부 horizontal scroll을 우선한다.
- agent workspace의 pending suggestion은 분리된 큰 카드가 아니라 하나의 대화형 agent turn 안에서 진행 상태와 결과로 다루고, 선택된 검토는 composer 바로 위 approval panel로 연다.

### English

- Panel collapse, tab switching, provider selection, and line-anchor navigation must respond immediately.
- Dragging the titlebar background should move the native window; clicks on titlebar buttons or settings controls must not start window dragging.
- Dragging the outer frameless window edges and corners should start native window resize dragging; these hit zones must not be confused with the inner side-panel resize handles.
- Side-panel resizing must respond immediately to pointer drag; disable grid transition during drag and lock cursor/selection state.
- Agent command review and decisions stay in the right agent workspace. The center terminal is user-owned, so agent UI must not execute commands or create terminal tabs.
- On narrow screens, collapse the side panel first, then reduce the agent workspace.
- Code lines prefer horizontal scrolling inside the pane over forced wrapping.
- Pending suggestions in the agent workspace should stay inside conversational agent turns with live progress while running and normal conversational results after completion, not large fixed cards or detached activity rows. The selected review opens as a composer-level approval panel directly above the composer.
