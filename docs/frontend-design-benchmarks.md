# gtum 프론트엔드 디자인 벤치마크 / Frontend Design Benchmarks

## 문서 목적 / Document Purpose

### 한국어

이 문서는 `gtum` 프론트엔드가 UI를 설계할 때 반드시 참고해야 할 제품 레퍼런스와 금지 패턴을 정의한다.

목적은 다음과 같다.

- 프론트엔드가 임의의 카드형 대시보드 UI로 흐르지 않게 한다.
- `VS Code`, `conductor`, `cmux`에서 배워야 할 지점을 명확히 고정한다.
- 디자인 완성도와 UX 기준을 구현 전에 합의된 문서로 남긴다.
- 코드 읽기와 흐름 추적이 AI 대화보다 뒤로 밀리지 않게 한다.
- 사용자가 이미 밟아온 작업 경로와 반복 문제를 UI에서 복기할 수 있게 한다.

### English

This document defines the required product references and anti-patterns for the `gtum` frontend UI.

Its goals are:

- prevent the frontend from drifting into an arbitrary card-dashboard UI
- make the useful lessons from `VS Code`, `conductor`, and `cmux` explicit
- keep design quality and UX expectations documented before implementation
- keep code reading and flow tracing from being demoted behind the AI conversation surface
- make prior work paths and repeated-problem signals easy to reread in the UI

## 언제 읽는 문서인가 / When To Read This Document

### 한국어

아래 상황이면 이 문서를 읽는다.

- UI 구조, 정보 계층, 인터랙션 패턴, 금지 패턴을 검토하거나 수정해야 할 때
- 프론트엔드 개편이 `VS Code`, `conductor`, `cmux` 기준과 맞는지 확인해야 할 때

### English

Read this document when:

- you need to review or change UI structure, information hierarchy, interaction patterns, or anti-patterns
- you need to check whether a frontend redesign still aligns with `VS Code`, `conductor`, and `cmux`

## 장문 문서 라우팅 / Long-Doc Routing

### 한국어

이 문서는 200줄을 넘는 장문 디자인 문서다. 기본값은 필요한 기준만 읽는 것이다.

- 레퍼런스와 금지 패턴만 확인할 때
  - 앞부분의 reference와 anti-pattern 부분만 읽는다.
- 현재 active UI slice 기준만 볼 때
  - `Current Delivery Slice` 이후만 읽는다.
- 세부 화면 설계가 필요할 때
  - `ui-ux-wireframes.md`를 같이 읽는다.

### English

This document exceeds 200 lines. Read only the matching route first.

- when you only need references and anti-patterns
  - read the front reference and anti-pattern portions only
- when you only need the current active UI-slice guidance
  - jump to `Current Delivery Slice` and continue from there
- when you need concrete screen structure
  - read `ui-ux-wireframes.md` alongside this doc

## 필수 레퍼런스 / Required References

### 한국어

프론트엔드 UI를 설계할 때 아래 세 제품을 반드시 참고한다.

- `VS Code`
  - 정보 계층, 사이드바 밀도, 탭 구조, 상태바, 패널 분리
- `conductor`
  - 에이전트 orchestration, 작업 단위 시각화, 승인 흐름, 컨텍스트 연결
- `cmux`
  - 탭 중심 터미널 워크플로우, 빠른 세션 전환, 강한 세션 연속성

레퍼런스의 목적은 복제가 아니라 기준 추출이다. `gtum`은 세 제품의 장점을 합쳐야 한다.

### English

Frontend UI work must explicitly reference these three products:

- `VS Code`
  - information hierarchy, sidebar density, tab structure, status bar, and panel separation
- `conductor`
  - agent orchestration, task visibility, approval flow, and context linkage
- `cmux`
  - tab-driven terminal workflow, fast session switching, and strong session continuity

The goal is not visual copying. The goal is to extract the right product qualities and combine them inside `gtum`.

## 현재 구현 슬라이스 기준 / Current Delivery Slice

### 한국어

현재 active 슬라이스에서 프론트가 지켜야 할 기준은 아래와 같다.

- 중앙 workbench는 `Editor + Agent Management`의 co-primary surface여야 한다.
- code viewer는 사이드바가 아니라 메인 영역의 기본 surface여야 한다.
- agent board는 단순 채팅창이 아니라 roster, task status, plan, approval queue를 보여주는 메인 surface여야 한다.
- 좌측은 `VS Code`처럼 activity bar와 side panel로 나뉘고, 접기/펼치기와 폭 조절이 가능해야 한다.
- 프로젝트 열기와 전환 같은 project management는 상단이 아니라 좌측 rail에서 이뤄져야 한다.
- 중앙 workbench는 처음에 비어 있어야 하며, `+` 버튼으로 `코드`, `터미널`, `비교`, `테스트`, `미리보기` 같은 탭을 연다고 이해돼야 한다.
- 중앙 workbench는 `VS Code`처럼 상하좌우 pane 분할을 지원해야 한다.
- workbench 탭은 큰 CTA 버튼이 아니라 `VS Code`처럼 낮고 가로로 긴 compact tab 형태여야 한다.
- `비교` 탭은 변경 코드 비교용이다.
- `테스트` 탭은 raw shell 대신 구조화된 테스트 결과와 실패 목록을 보여주는 탭이다.
- `미리보기` 탭은 Markdown, HTML, 렌더링 결과 같은 preview surface다.
- agent board는 실제로 일을 주고 답변을 받고 승인하는 `에이전트 작업창`처럼 읽혀야 한다.
- terminal은 상단 고정 모드 버튼이 아니라 `+`로 여는 workbench tab 타입이어야 하며, 기본 화면을 점유하는 주인공은 아니어야 한다.
- 하단 패널은 기본 구조에서 제거하고, 필요 정보는 pane 또는 overlay로 푼다.
- approval rail은 editor와 agent board를 밀어내지 않으면서도, 어떤 파일, line anchor, 로그를 보고 제안이 나왔는지 보여줘야 한다.
- 첫 code-reading slice는 read-only viewer까지만 포함한다.
- line anchor와 restore 상태는 숨은 내부 상태가 아니라 사용자가 다시 읽을 수 있는 정보여야 한다.
- binary와 large-file fallback은 에러처럼 보이지 않고 bounded preview mode처럼 읽혀야 한다.
- task history, Telegram, runtime/debug는 2선 영역에 둔다.
- 구조를 `FSD`로 나누더라도 기준 단위는 `project rail / workspace stage / agent rail` 같은 workbench zone이어야 한다.

### English

For the current active slice, the frontend should follow these rules:

- the central workbench should act as a co-primary surface for `Editor + Agent Management`
- the code viewer should be the default main-workspace surface rather than a sidebar afterthought
- the agent board should be a first-class surface for roster, task state, plans, and approval queue instead of a simple chat rail
- the left side should follow a `VS Code`-style activity bar plus collapsible side panel
- project opening and switching should live in the left rail rather than in a top project-tab strip
- the center workbench should begin empty and make it obvious that `Code`, `Terminal`, `Diff`, `Test`, and `Preview` are tab types created from a `+` action
- the center workbench should support `VS Code`-style horizontal and vertical pane splits
- workbench tabs should read as compact horizontal tabs rather than large CTA buttons
- the `Diff` tab is for changed-code comparison
- the `Test` tab is for structured test results and failing-test focus views rather than raw shell output
- the `Preview` tab is for rendered surfaces such as Markdown, HTML, or generated output previews
- the agent board should read like an `agent work window` where users assign work, read replies, and approve actions
- the terminal should be a workbench-tab type opened from `+` rather than a permanently fixed mode strip, without dominating the default screen
- remove the default bottom panel from the primary layout and solve needed details through panes or overlays
- the approval rail should show which file, line anchor, and logs produced a suggestion without pushing the editor and agent board away
- the first code-reading slice should stop at a read-only viewer
- line-anchor state and restore state should stay legible to users rather than hidden as internal implementation
- binary and large-file fallback should read like bounded preview modes, not generic errors
- task history, Telegram, and runtime/debug belong in secondary zones

## 제품별로 배워야 할 점 / What To Borrow From Each Product

### 한국어

#### `VS Code`에서 배울 점

- 화면을 큰 구조 단위로 나누는 명확한 레이아웃
- 많은 정보를 보여줘도 우선순위가 흐려지지 않는 정보 계층
- 사이드바, 메인, 패널, 상태바가 각자 역할이 분명한 구조
- 자주 쓰는 액션이 과도한 카드 없이 가까운 곳에 배치되는 방식
- 코드를 읽고 흐름을 따라가기 편한 editor 중심성

#### `conductor`에서 배울 점

- 에이전트 상태와 작업 상태를 UI에서 한눈에 읽게 하는 구성
- 계획, 실행, 승인, 결과가 이어지는 흐름형 UX
- 무엇이 자동이고 무엇이 승인 필요인지 분명하게 보이는 표현
- 에이전트 orchestration은 강하지만 코드 읽기 surface 불편함은 반복하지 않는 기준
- 작업 경로와 승인/실패 이력을 문제 분석에 쓸 수 있게 드러내는 방식

#### `cmux`에서 배울 점

- 탭 단위 터미널 전환이 빠르고 가벼운 점
- 여러 세션을 오가도 실행 맥락이 끊기지 않는 점
- 로그와 실행 상태를 읽는 경험이 끊기지 않는 점
- 터미널을 선택했을 때는 강력하지만, 기본 화면을 terminal-first로 몰아가지 않는 기준
- 터미널 세션과 로그 경로를 끊지 않고 되짚어볼 수 있는 흐름

### English

#### What to borrow from `VS Code`

- a clear macro layout with well-defined zones
- strong information hierarchy even when the screen is dense
- sidebars, main surface, panels, and status areas with distinct roles
- frequent actions placed close to use instead of hidden inside decorative cards
- editor-centered code reading and flow tracing

#### What to borrow from `conductor`

- a UI that makes agent and task state scannable at a glance
- flow-oriented UX across planning, execution, approval, and result
- explicit distinction between what is automatic and what requires approval
- visible traces of prior approvals, failures, and retries that can drive improvement
- keep the orchestration strengths without inheriting uncomfortable code-reading surfaces

#### What to borrow from `cmux`

- lightweight tab-based terminal switching
- strong session continuity while moving across multiple executions
- uninterrupted reading of logs and execution state
- keep the terminal powerful when selected without forcing a terminal-first default layout
- preserve enough session continuity that users can retrace execution paths instead of guessing

## 반드시 지켜야 할 UI 원칙 / Non-Negotiable UI Rules

### 한국어

- editor와 agent management는 항상 메인 화면의 중심이어야 한다.
- 프로젝트, editor, agent flow는 순서가 보이도록 배치해야 한다.
- 터미널은 한 번의 전환으로 바로 들어갈 수 있어야 하며, 선택 시 충분히 강력해야 한다.
- 전역 상단 바는 project-tab manager가 아니라 `현재 작업`, `연결 상태`, `승인 대기`, `활성 에이전트` 같은 쉬운 현재 상태 언어를 우선한다.
- 좌측 rail은 `activity bar + side panel` 구조로 접고 펼칠 수 있어야 한다.
- 프로젝트 관리와 전환은 왼쪽 rail로 보낸다.
- 중앙 workbench는 비어 있는 상태에서 시작할 수 있고, `+`로 코드 탭과 터미널 탭을 추가할 수 있어야 한다.
- 중앙 workbench는 상하좌우 pane 분할이 1급 기능이어야 한다.
- 오른쪽 panel은 단순 상태판이 아니라 실제 작업 요청과 답변이 오가는 `에이전트 작업실`이어야 한다.
- 하단 panel은 기본 레이아웃에서 제거하는 것을 우선한다.
- 정보 계층은 `primary`, `secondary`, `debug` 세 단계 이상으로 나뉘어야 한다.
- 첫 진입 시 사용자가 해야 할 첫 액션이 한눈에 보여야 한다.
- 승인 필요 액션과 읽기 전용 상태는 시각적으로 분리되어야 한다.
- 디버그 정보, mock 세부정보, callback 값은 기본 화면의 주인공이 되면 안 된다.
- 코드 읽기, 흐름 추적, 테스트 확인은 AI 대화창보다 먼저 보이거나 최소한 같은 급의 작업 surface를 가져야 한다.
- 에이전트 대화는 보조 surface일 수 있지만, 코드 보기가 사이드바나 하단 패널에 종속되면 안 된다.
- 사용자는 현재 상태뿐 아니라 이미 밟은 승인, 실패, 재시도 경로를 한눈에 복기할 수 있어야 한다.
- task history와 실행 이력은 단순 로그가 아니라 문제 분석이 가능한 timeline 또는 trace 형태로 읽혀야 한다.
- 에이전트가 안정적으로 수정하기 어렵다면 React 추상화보다 더 단순한 `TypeScript` 중심 구조를 우선할 수 있다.

### English

- the editor and agent-management surface must remain the center of the product
- project, editor, and agent flow should be visually ordered
- the terminal should be reachable within one switch and feel powerful when selected
- the global top bar should stay thin and avoid becoming a project-tab manager
- the left rail should use a collapsible `activity bar + side panel` structure
- project management should move into the left rail
- the center workbench should support an empty state and allow users to add code tabs and terminal tabs from `+`
- the center workbench should support horizontal and vertical pane splits as a first-class feature
- the right panel should be an actual agent workspace for requests and replies rather than a passive status board
- avoid a default bottom panel in the primary layout
- information hierarchy should clearly separate `primary`, `secondary`, and `debug` levels
- the first useful action must be obvious on first entry
- approval-required actions must be visually distinct from read-only status
- debug data, mock details, and raw callback values must not dominate the default UI
- code reading, flow tracing, and test inspection should be at least as first-class as the AI conversation surface
- AI chat may be secondary, but code viewing must not be trapped inside a sidebar-only or bottom-panel-only interaction model
- users should be able to reread approvals, failures, retries, and detours without manually reconstructing the story from scattered logs
- task history should be readable as a scannable timeline or trace, not just as raw transcript fragments
- if React abstractions make agent-driven maintenance harder, prefer a simpler `TypeScript`-first structure over framework purity
- if the frontend adopts an FSD-style split, keep the boundaries aligned with workbench zones rather than decorative card fragments

## 에이전트 친화적 구현 원칙 / Agent-Friendly Implementation Rules

### 한국어

- 이 프로젝트는 사람이 아니라 에이전트가 주 개발 주체라는 전제를 둔다.
- 프론트엔드 구현은 프레임워크 유행보다 에이전트가 읽고 수정하기 쉬운 구조를 우선한다.
- `React`는 현재 구현 기반이지만, source of truth는 "에이전트가 빠르게 안전하게 수정 가능한가"다.
- hook, derived state, UI heuristic이 복잡해질수록 순수 `TypeScript` 함수나 더 얇은 구조로 내리는 쪽을 우선 검토한다.
- 이후 필요하면 `React` 내부에서도 프레임워크 의존을 줄이고 `TypeScript` 중심 렌더링 구조로 더 단순화할 수 있다.

### English

- assume that agents, not humans, are the primary developers of this project
- prefer frontend structures that agents can read and edit quickly over framework fashion
- `React` is the current implementation base, but the real source of truth is whether agents can modify it safely and quickly
- when hooks, derived state, or UI heuristics grow too complex, prefer moving logic into plain `TypeScript` functions or thinner structures
- if needed later, the frontend may be simplified further toward a more `TypeScript`-first rendering structure even while staying inside the current stack

## 금지 패턴 / Anti-Patterns

### 한국어

- 의미 없이 큰 카드들을 여러 개 나열하는 대시보드형 화면
- 같은 중요도의 박스를 화면 전체에 퍼뜨리는 구성
- 터미널보다 보조 카드가 더 시선을 끄는 배치
- provider 상태, Telegram, debug, runtime 정보가 동시에 1차 영역을 차지하는 구조
- 현재 무엇을 해야 하는지보다 현재 가능한 기능 목록이 먼저 보이는 구조
- AI 대화가 메인인데 코드 보기와 테스트 확인이 사이드바나 하단 패널에 눌리는 구조
- 코드 흐름을 따라가야 하는 순간에도 editor-like surface가 부족한 구조
- 이미 밟아온 작업 경로와 실패 기록이 흩어져 있어 사용자가 무엇이 있었는지 재구성해야 하는 구조

### English

- dashboard-like grids of oversized cards without clear hierarchy
- layouts where every box competes at the same visual priority
- supporting cards drawing more attention than the terminal surface
- provider state, Telegram, debug, and runtime details all competing in the primary zone
- layouts that emphasize feature inventory before the next user action
- AI conversation dominating while code viewing and test inspection are squeezed into a sidebar or bottom panel
- layouts that lack an editor-like surface when users need to trace code flow
- layouts where prior work paths and failure evidence are scattered badly enough that users must reconstruct them manually

## 프론트엔드 작업 체크리스트 / Frontend Review Checklist

### 한국어

프론트 작업 전에 아래를 확인한다.

1. 이 화면이 `VS Code`처럼 구조가 명확한가
2. 이 흐름이 `conductor`처럼 에이전트 상태와 승인 단계를 읽기 쉬운가
3. 터미널이 `cmux`처럼 빠르고 강한 mode로 동작하면서도 editor와 agent board를 밀어내지 않는가
4. 카드 수를 줄이고 패널 구조로 바꿀 수 없는가
5. debug/mock 정보를 한 단계 더 뒤로 보낼 수 없는가
6. 에이전트 대화와 별개로 사용자가 코드를 읽고 흐름을 따라가기 편한 editor-like surface가 있는가
7. 사용자가 승인, 실패, 재시도 경로를 별도 추리 없이 복기하고 문제를 파악할 수 있는가

### English

Before shipping frontend work, check:

1. is the structure as clear as a `VS Code`-style workspace
2. is the agent and approval flow as legible as a `conductor`-style workflow
3. does the terminal feel as strong and fast as `cmux` without displacing the editor and agent board
4. can this be expressed with fewer cards and stronger panel layout
5. can debug or mock details be pushed one level further back
6. does the user still have an editor-like surface for reading code and tracing flow apart from the agent conversation
7. can the user quickly reread approvals, failures, retries, and detours to diagnose recurring problems
