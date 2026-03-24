# gtum 프론트엔드 디자인 벤치마크 / Frontend Design Benchmarks

## 문서 목적 / Document Purpose

### 한국어

이 문서는 `gtum` 프론트엔드가 UI를 설계할 때 반드시 참고해야 할 제품 레퍼런스와 금지 패턴을 정의한다.

목적은 다음과 같다.

- 프론트엔드가 임의의 카드형 대시보드 UI로 흐르지 않게 한다.
- `VS Code`, `conductor`, `cmux`에서 배워야 할 지점을 명확히 고정한다.
- 디자인 완성도와 UX 기준을 구현 전에 합의된 문서로 남긴다.

### English

This document defines the required product references and anti-patterns for the `gtum` frontend UI.

Its goals are:

- prevent the frontend from drifting into an arbitrary card-dashboard UI
- make the useful lessons from `VS Code`, `conductor`, and `cmux` explicit
- keep design quality and UX expectations documented before implementation

## 필수 레퍼런스 / Required References

### 한국어

프론트엔드 UI를 설계할 때 아래 세 제품을 반드시 참고한다.

- `VS Code`
  - 정보 계층, 사이드바 밀도, 탭 구조, 상태바, 패널 분리
- `conductor`
  - 에이전트 orchestration, 작업 단위 시각화, 승인 흐름, 컨텍스트 연결
- `cmux`
  - 멀티 터미널 중심성, 탭 중심 워크플로우, 빠른 세션 전환

레퍼런스의 목적은 복제가 아니라 기준 추출이다. `gtum`은 세 제품의 장점을 합쳐야 한다.

### English

Frontend UI work must explicitly reference these three products:

- `VS Code`
  - information hierarchy, sidebar density, tab structure, status bar, and panel separation
- `conductor`
  - agent orchestration, task visibility, approval flow, and context linkage
- `cmux`
  - terminal-first workflow, tab-driven work, and fast session switching

The goal is not visual copying. The goal is to extract the right product qualities and combine them inside `gtum`.

## 제품별로 배워야 할 점 / What To Borrow From Each Product

### 한국어

#### `VS Code`에서 배울 점

- 화면을 큰 구조 단위로 나누는 명확한 레이아웃
- 많은 정보를 보여줘도 우선순위가 흐려지지 않는 정보 계층
- 사이드바, 메인, 패널, 상태바가 각자 역할이 분명한 구조
- 자주 쓰는 액션이 과도한 카드 없이 가까운 곳에 배치되는 방식

#### `conductor`에서 배울 점

- 에이전트 상태와 작업 상태를 UI에서 한눈에 읽게 하는 구성
- 계획, 실행, 승인, 결과가 이어지는 흐름형 UX
- 무엇이 자동이고 무엇이 승인 필요인지 분명하게 보이는 표현

#### `cmux`에서 배울 점

- 터미널이 주변 장식이 아니라 메인 작업 표면인 점
- 탭 단위 작업 전환이 빠르고 가벼운 점
- 로그와 실행 상태를 읽는 경험이 끊기지 않는 점

### English

#### What to borrow from `VS Code`

- a clear macro layout with well-defined zones
- strong information hierarchy even when the screen is dense
- sidebars, main surface, panels, and status areas with distinct roles
- frequent actions placed close to use instead of hidden inside decorative cards

#### What to borrow from `conductor`

- a UI that makes agent and task state scannable at a glance
- flow-oriented UX across planning, execution, approval, and result
- explicit distinction between what is automatic and what requires approval

#### What to borrow from `cmux`

- terminal as the main working surface rather than a supporting widget
- lightweight tab-based task switching
- uninterrupted reading of logs and execution state

## 반드시 지켜야 할 UI 원칙 / Non-Negotiable UI Rules

### 한국어

- 터미널은 항상 메인 화면의 중심이어야 한다.
- 프로젝트, 터미널, 에이전트는 순서가 보이도록 배치해야 한다.
- 정보 계층은 `primary`, `secondary`, `debug` 세 단계 이상으로 나뉘어야 한다.
- 첫 진입 시 사용자가 해야 할 첫 액션이 한눈에 보여야 한다.
- 승인 필요 액션과 읽기 전용 상태는 시각적으로 분리되어야 한다.
- 디버그 정보, mock 세부정보, callback 값은 기본 화면의 주인공이 되면 안 된다.
- 에이전트가 안정적으로 수정하기 어렵다면 React 추상화보다 더 단순한 `TypeScript` 중심 구조를 우선할 수 있다.

### English

- the terminal must remain the central working surface
- project, terminal, and agent flow should be visually ordered
- information hierarchy should clearly separate `primary`, `secondary`, and `debug` levels
- the first useful action must be obvious on first entry
- approval-required actions must be visually distinct from read-only status
- debug data, mock details, and raw callback values must not dominate the default UI
- if React abstractions make agent-driven maintenance harder, prefer a simpler `TypeScript`-first structure over framework purity

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

### English

- dashboard-like grids of oversized cards without clear hierarchy
- layouts where every box competes at the same visual priority
- supporting cards drawing more attention than the terminal surface
- provider state, Telegram, debug, and runtime details all competing in the primary zone
- layouts that emphasize feature inventory before the next user action

## 프론트엔드 작업 체크리스트 / Frontend Review Checklist

### 한국어

프론트 작업 전에 아래를 확인한다.

1. 이 화면이 `VS Code`처럼 구조가 명확한가
2. 이 흐름이 `conductor`처럼 에이전트 상태와 승인 단계를 읽기 쉬운가
3. 이 작업 표면이 `cmux`처럼 터미널 중심인가
4. 카드 수를 줄이고 패널 구조로 바꿀 수 없는가
5. debug/mock 정보를 한 단계 더 뒤로 보낼 수 없는가

### English

Before shipping frontend work, check:

1. is the structure as clear as a `VS Code`-style workspace
2. is the agent and approval flow as legible as a `conductor`-style workflow
3. is the working surface still terminal-first like `cmux`
4. can this be expressed with fewer cards and stronger panel layout
5. can debug or mock details be pushed one level further back
