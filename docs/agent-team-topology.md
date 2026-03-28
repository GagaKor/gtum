# gtum 에이전트 팀 토폴로지 / Agent Team Topology

## 문서 목적 / Document Purpose

### 한국어

이 문서는 `gtum` 저장소에서 기본 개발 운영 모델로 사용할 멀티 에이전트 팀 구성을 정의한다.

목적은 다음과 같다.

- 에이전트 역할을 `planner`, `orchestrator`, `designer`, `frontend`, `backend`, `QA`, `tester` 일곱 축으로 고정한다.
- 큰 작업을 병렬로 나누되, 충돌 없이 다시 통합하는 기준을 제공한다.
- 각 역할이 무엇을 읽고, 무엇을 수정하고, 무엇을 검증하는지 명확히 한다.
- 문서와 코드, 테스트가 같이 움직이도록 기본 handoff 규칙을 남긴다.

### English

This document defines the default multi-agent team topology for development work in the `gtum` repository.

Its goals are:

- fix the default role split to `planner`, `orchestrator`, `designer`, `frontend`, `backend`, `QA`, and `tester`
- provide a way to parallelize larger tasks without integration chaos
- make it explicit what each role reads, edits, and validates
- keep code, docs, and tests moving together through clear handoff rules

## 언제 읽는 문서인가 / When To Read This Document

### 한국어

아래 상황이면 이 문서를 읽는다.

- 역할 분리, 서브에이전트 팀빌딩, 파일 소유권, handoff 규칙을 정해야 할 때
- `planner`, `designer`, `QA`, `tester` 책임을 어디서 나눌지, 어떤 역할을 축소할지 판단해야 할 때

### English

Read this document when:

- you need to define role split, sub-agent team formation, file ownership, or handoff rules
- you need to decide how `planner`, `designer`, `QA`, and `tester` responsibilities are separated or when roles can be collapsed

## 기본 팀 편성 / Default Team Shape

### 한국어

기본 팀은 아래 일곱 역할로 구성한다.

- `Planner`
  - 제품 목표, 현재 스프린트와 다음 스프린트 연결, 레퍼런스 분석, 기획 문서 갱신을 담당한다.
- `Orchestrator`
  - 작업 목표를 해석하고, 문서와 코드 기준선을 맞추고, 역할별 작업을 분해한다.
- `Designer`
  - `VS Code`, `conductor`, `cmux` 레퍼런스를 바탕으로 정보 계층, 코드 읽기 surface, 상호작용, 와이어프레임을 담당한다.
- `Frontend`
  - `src/` 중심 UI, 상태, 사용자 흐름, 프론트 검증을 담당한다.
- `Backend`
  - `src-tauri/` 중심 런타임, 파일 시스템, PTY, provider, 시스템 계약을 담당한다.
- `QA`
  - 완료조건, 수용 기준, 역할 간 handoff 품질, 문서/계약 정합성 확인을 담당한다.
- `Tester`
  - `tests/`, 재현 절차, 회귀 확인, E2E와 aging 관점의 검증을 담당한다.

모든 작업은 먼저 이 일곱 역할 기준으로 서브에이전트 팀빌딩한다. 작업이 작을 때는 한 에이전트가 여러 역할을 겸할 수 있지만, 그 경우에도 누가 `Planner` 판단을 하고 누가 `Designer`, `QA`, `Tester` 책임을 맡는지는 명시해야 한다.

### English

The default team has seven roles:

- `Planner`
  - owns product intent, current-to-next sprint continuity, reference analysis, and planning-document updates
- `Orchestrator`
  - interprets the goal, aligns docs and code, and decomposes the work
- `Designer`
  - owns information hierarchy, code-reading surface design, interactions, and wireframes using `VS Code`, `conductor`, and `cmux` as references
- `Frontend`
  - owns UI, state, user flows, and frontend validation around `src/`
- `Backend`
  - owns runtime, filesystem, PTY, provider, and system contracts around `src-tauri/`
- `QA`
  - owns acceptance criteria, handoff quality, and doc/contract consistency checks
- `Tester`
  - owns `tests/`, repro steps, regression checks, and E2E plus aging-style validation

Every task should first be decomposed into these seven sub-agent roles. For very small tasks, one agent may cover multiple roles, but planner judgment plus designer, QA, and tester responsibilities should still be assigned explicitly.

## 역할별 책임 / Role Responsibilities

### 한국어

#### `Planner`

- 먼저 읽는다:
  - `docs/product-plan.md`
  - `docs/mvp-backlog.md`
  - `docs/sprint-plan.md`
- 결정한다:
  - 현재 작업의 제품 목적
  - 다음 스프린트로 넘길 기획 항목
  - 레퍼런스 분석 결과를 어디에 반영할지
- 직접 맡는다:
  - 제품 범위와 우선순위 정리
  - 다음 스프린트 초안과 후속 작업 문서화
  - `VS Code`, `conductor`, `cmux` 분석을 backlog와 계획으로 연결

#### `Orchestrator`

- 먼저 읽는다:
  - `AGENTS.md`
  - `docs/DOCS_READING_ORDER.md`
  - 관련 source of truth 문서
- 결정한다:
  - 작업 목표
  - 역할별 범위
  - 병렬 가능 여부
  - 통합 순서
- 직접 맡는다:
  - 전체 계획
  - 파일 소유권 충돌 방지
  - 문서 동기화 판단
  - 최종 통합과 결과 보고

#### `Designer`

- 주 소유 범위:
  - `docs/frontend-design-benchmarks.md`
  - `docs/ui-ux-wireframes.md`
  - UI 구조와 상호작용 설계 메모
- 직접 맡는다:
  - 코드 읽기 surface와 작업 흐름 설계
  - `VS Code`, `conductor`, `cmux` 레퍼런스 분석
  - 사용자 가시성과 테스트 용이성을 기준으로 디자인 정리
  - 다음 스프린트에서 구현해야 할 디자인 문서화

#### `Frontend`

- 주 소유 범위:
  - `src/`
  - 프론트엔드 상태 모델과 UI 계약 소비부
- 직접 맡는다:
  - 사용자에게 보이는 흐름 구현
  - 상태 반영
  - backend contract 소비
  - 필요한 UI smoke 또는 interaction 검증 보강
  - `docs/frontend-design-benchmarks.md`와 `docs/ui-ux-wireframes.md`를 기준으로 UI 품질 유지
  - `VS Code`, `conductor`, `cmux` 레퍼런스를 바탕으로 정보 계층과 작업 흐름 정리

#### `Backend`

- 주 소유 범위:
  - `src-tauri/`
  - 시스템 계약, runtime state, command interface
- 직접 맡는다:
  - Tauri command 추가/수정
  - PTY, filesystem, auth, workspace, provider 로직
  - frontend가 의존할 snapshot/contract 안정화

#### `QA`

- 주 소유 범위:
  - 완료조건 정의
  - 수용 기준과 검증 우선순위
  - 역할 간 handoff 품질과 문서/계약 정합성
- 직접 맡는다:
  - 작업 시작 시 acceptance 기준 정리
  - frontend/backend 변경이 source of truth 문서와 맞는지 교차 확인
  - tester가 실행할 검증 포인트와 우선순위 정리
  - release readiness와 잔여 리스크 판단 보조

#### `Tester`

- 주 소유 범위:
  - `tests/`
  - 검증 절차 문서화
  - 재현 로그와 리스크 정리
- 직접 맡는다:
  - 새 흐름 E2E 추가 또는 기존 시나리오 갱신
  - 실패 원인 분류
  - 최소 repro 정리
  - aging test나 반복 검증 필요 여부 판단

### English

#### `Planner`

- reads first:
  - `docs/product-plan.md`
  - `docs/mvp-backlog.md`
  - `docs/sprint-plan.md`
- decides:
  - the product intent of the current task
  - what should be handed into the next sprint
  - where reference analysis must be reflected
- owns directly:
  - product scope and priority framing
  - drafting the next sprint and follow-up planning notes
  - turning `VS Code`, `conductor`, and `cmux` analysis into backlog and planning updates

#### `Orchestrator`

- reads first:
  - `AGENTS.md`
  - `docs/DOCS_READING_ORDER.md`
  - relevant source-of-truth docs
- decides:
  - the actual task goal
  - per-role scope
  - what can run in parallel
  - integration order
- owns directly:
  - the overall plan
  - file-ownership conflict prevention
  - document-sync decisions
  - final integration and reporting

#### `Designer`

- primary ownership:
  - `docs/frontend-design-benchmarks.md`
  - `docs/ui-ux-wireframes.md`
  - UI-structure and interaction-design notes
- owns directly:
  - code-reading surface and workflow design
  - reference analysis across `VS Code`, `conductor`, and `cmux`
  - designing for user visibility and testing comfort
  - documenting the design inputs for the next sprint

#### `Frontend`

- primary ownership:
  - `src/`
  - frontend state and consumers of UI-facing contracts
- owns directly:
  - user-visible flow implementation
  - state updates
  - consumption of backend contracts
  - added frontend smoke or interaction checks when needed
  - keeping UI quality aligned with `docs/frontend-design-benchmarks.md` and `docs/ui-ux-wireframes.md`
  - using `VS Code`, `conductor`, and `cmux` as product references for hierarchy and workflow

#### `Backend`

- primary ownership:
  - `src-tauri/`
  - system contracts, runtime state, and command interfaces
- owns directly:
  - Tauri command additions or changes
  - PTY, filesystem, auth, workspace, and provider logic
  - stabilizing snapshots and contracts that frontend consumes

#### `QA`

- primary ownership:
  - acceptance criteria
  - validation priorities and acceptance summaries
  - cross-role handoff quality and doc/contract consistency
- owns directly:
  - defining acceptance criteria at task start
  - cross-checking frontend/backend changes against source-of-truth docs
  - translating acceptance goals into concrete validation focus for the tester
  - helping judge release readiness and residual risk

#### `Tester`

- primary ownership:
  - `tests/`
  - validation procedures
  - repro logs and risk summaries
- owns directly:
  - adding or updating E2E coverage for new flows
  - classifying failures
  - writing minimal repro steps
  - deciding when aging-style or repeated validation is needed

## 기본 작업 흐름 / Default Workflow

### 한국어

1. `Planner`와 `Orchestrator`가 요청을 읽고 제품 문서, 관련 코드, 현재 스프린트 기준선을 확인한다.
2. `Planner`는 다음 스프린트로 이어질 기획 항목을 정리하고, `Designer`는 필요한 레퍼런스와 디자인 포인트를 고정한다.
3. `Orchestrator`가 작업을 `designer`, `frontend`, `backend`, `QA`, `tester` 단위로 나누고 파일 소유권을 먼저 정한다.
4. `QA`는 구현과 병렬로 완료조건, acceptance 기준, handoff 체크포인트를 정리한다.
5. `Designer`, `Frontend`, `Backend`는 서로 다른 파일 소유권으로 병렬 작업한다.
6. `Tester`는 `QA` 기준을 바탕으로 검증 시나리오, 회귀 포인트, 필요한 재현 절차를 준비하고 실행한다.
7. `QA`가 결과를 acceptance 기준에 대조해 남은 리스크와 release readiness를 정리한다.
8. `Orchestrator`가 결과를 통합하고, `Planner`와 `Designer` 산출물을 포함해 문서 갱신 여부와 남은 리스크를 정리한다.

### English

1. The `Planner` and `Orchestrator` read the request and check the product docs, relevant code, and sprint baseline.
2. The `Planner` frames next-sprint implications, while the `Designer` locks the needed references and design direction.
3. The `Orchestrator` splits the work into `designer`, `frontend`, `backend`, `QA`, and `tester` slices and locks file ownership first.
4. `QA` defines acceptance criteria and handoff checkpoints in parallel with implementation.
5. `Designer`, `Frontend`, and `Backend` work in parallel with separate file ownership.
6. `Tester` prepares and executes validation scenarios, regression focus, and repro steps from the QA criteria.
7. `QA` reviews the result against acceptance criteria and summarizes release readiness plus residual risk.
8. The `Orchestrator` integrates outcomes and closes the loop on docs, including planner and designer outputs.

## 파일 소유권 규칙 / File Ownership Rules

### 한국어

- `Planner`
  - 기본적으로 `docs/product-plan.md`, `docs/mvp-backlog.md`, `docs/sprint-plan.md`, 기획 메모를 수정한다.
- `Designer`
  - 기본적으로 `docs/frontend-design-benchmarks.md`, `docs/ui-ux-wireframes.md`, 디자인 메모를 수정한다.
- `Frontend`
  - 기본적으로 `src/`만 수정한다.
- `Backend`
  - 기본적으로 `src-tauri/`만 수정한다.
- `QA`
  - 기본적으로 검증 기준 문서, 체크리스트, 검증 메모를 수정한다.
- `Tester`
  - 기본적으로 `tests/`와 검증 관련 문서만 수정한다.
- `Orchestrator`
  - source of truth 문서, 통합 지점, 충돌 조정 파일을 맡는다.

같은 파일을 두 역할이 동시에 수정해야 할 것 같다면 먼저 `Orchestrator`가 구조를 다시 나눈다. 병렬성보다 충돌 회피가 우선이다.

### English

- `Planner`
  - should edit `docs/product-plan.md`, `docs/mvp-backlog.md`, `docs/sprint-plan.md`, and planning notes by default
- `Designer`
  - should edit `docs/frontend-design-benchmarks.md`, `docs/ui-ux-wireframes.md`, and design notes by default
- `Frontend`
  - should edit `src/` by default
- `Backend`
  - should edit `src-tauri/` by default
- `QA`
  - should edit acceptance docs, checklists, and validation notes by default
- `Tester`
  - should edit `tests/` and validation docs by default
- `Orchestrator`
  - owns source-of-truth docs, integration points, and conflict resolution

If two roles appear to need the same file at the same time, the `Orchestrator` should split the work again first. Avoiding collisions matters more than maximizing parallelism.

## Handoff 규칙 / Handoff Rules

### 한국어

- `Planner -> Designer`
  - 다음 스프린트에서 구현해야 할 제품 목표와 레퍼런스 분석 포인트를 짧게 넘긴다.
- `Designer -> Frontend`
  - 코드 읽기 surface, 정보 계층, 인터랙션 의도를 짧게 넘긴다.
- `Backend -> Frontend`
  - 새 command, snapshot, enum, status field, contract 변화가 있으면 이름과 의미를 먼저 고정한다.
- `Frontend -> QA`
  - 사용자 기준 클릭 경로와 기대 결과를 짧게 넘긴다.
- `Backend -> QA`
  - contract 변화, 플랫폼 리스크, 재현 조건을 짧게 넘긴다.
- `QA -> Tester`
  - acceptance 기준, 우선 회귀 포인트, 실패 시 분류 기준을 넘긴다.
- `Tester -> QA`
  - 통과 여부, 실패 조건, 최소 repro, 미검증 영역을 남긴다.
- `QA -> Orchestrator`
  - acceptance 충족 여부, release readiness, 후속 권고를 남긴다.

핵심은 긴 설명보다 재현 가능한 계약과 검증 조건을 넘기는 것이다.

### English

- `Planner -> Designer`
  - hand off next-sprint product goals and reference-analysis points in short form
- `Designer -> Frontend`
  - hand off the intended code-reading surface, hierarchy, and interaction direction in short form
- `Backend -> Frontend`
  - lock the names and meanings of any new command, snapshot, enum, status field, or contract change first
- `Frontend -> QA`
  - hand off the user-facing click path and expected outcome in short form
- `Backend -> QA`
  - hand off contract changes, platform risks, and repro conditions in short form
- `QA -> Tester`
  - hand off acceptance criteria, regression priorities, and failure classification rules
- `Tester -> QA`
  - report pass/fail status, failure conditions, minimal repros, and unverified areas
- `QA -> Orchestrator`
  - report acceptance status, release readiness, and follow-up recommendations

The goal is not long prose. The goal is to pass along reproducible contracts and validation conditions.

## 작업 분해 기본 템플릿 / Default Decomposition Template

### 한국어

작업이 들어오면 기본적으로 아래 형태를 먼저 검토한다.

- `Planner`
  - 관련 제품 문서 확인
  - 현재 작업 목적과 다음 스프린트 carry-over 정리
- `Orchestrator`
  - 관련 문서 확인
  - 현재 코드 기준선 확인
  - 역할별 소유 파일 지정
- `Designer`
  - `VS Code`, `conductor`, `cmux` 분석
  - 코드 읽기와 테스트 가시성 기준 UI 설계 정리
- `Frontend`
  - UI 변경점 구현
  - 프론트 상태 및 표시 로직 정리
- `Backend`
  - 런타임/계약 변경 구현
  - 필요한 mock 또는 snapshot 정리
- `QA`
  - acceptance 기준 정의
  - handoff와 문서/계약 정합성 확인
- `Tester`
  - E2E 또는 회귀 시나리오 추가
  - 테스트 결과와 재현 절차 정리

### English

When a new task arrives, start by checking this decomposition:

- `Planner`
  - verify relevant product docs
  - define the current-task purpose and next-sprint carryover
- `Orchestrator`
  - verify relevant docs
  - verify the current code baseline
  - assign per-role file ownership
- `Designer`
  - analyze `VS Code`, `conductor`, and `cmux`
  - document UI hierarchy and code-reading design points
- `Frontend`
  - implement UI changes
  - align frontend state and rendering logic
- `Backend`
  - implement runtime and contract changes
  - align any required mock or snapshot behavior
- `QA`
  - define acceptance criteria
  - check handoff quality and doc/contract consistency
- `Tester`
  - add E2E or regression coverage
  - summarize validation results and repro steps

## 언제 일곱 역할을 유지하는가 / When To Keep All Seven Roles

### 한국어

모든 작업은 먼저 일곱 역할 편성으로 분해한다. 아래 중 하나라도 해당하면 일곱 역할을 유지한다.

- UI와 런타임 계약이 함께 바뀐다.
- `src/`와 `src-tauri/`를 동시에 수정해야 한다.
- 새 E2E 시나리오가 필요하다.
- 회귀 위험이 높다.
- 문서 source of truth도 같이 갱신해야 한다.
- acceptance 기준과 실제 검증을 분리해야 한다.
- 다음 스프린트 기획이나 디자인 문서도 같이 남겨야 한다.

### English

Start from all seven roles for every task. Keep all seven roles when any of the following are true:

- UI and runtime contracts both change
- both `src/` and `src-tauri/` need edits
- a new E2E scenario is needed
- regression risk is high
- source-of-truth docs also need updates
- acceptance review should stay separate from test execution
- next-sprint planning or design documentation should also be left behind

## 예외적으로 축소하는가 / When To Collapse Roles Exceptionally

### 한국어

기본값은 일곱 역할 유지이며, 아래는 예외적으로 역할을 줄일 때의 기준이다.

- 문서만 수정하는 작업
  - `Planner + Orchestrator + QA` 또는 `Planner + Orchestrator + QA + Tester`
- 순수 프론트 작업
  - `Orchestrator + Designer + Frontend + QA + Tester`
- 순수 런타임 작업
  - `Planner + Orchestrator + Backend + QA + Tester`
- 아주 작은 수정
  - 한 에이전트가 구현할 수 있지만, `Planner`, `Designer`, `QA`, `Tester` 책임 중 생략된 것이 무엇인지 명시한다.

### English

The default is to keep all seven roles. The following cases describe exceptional role collapse only.

- docs-only work
  - `Planner + Orchestrator + QA` or `Planner + Orchestrator + QA + Tester`
- frontend-only work
  - `Orchestrator + Designer + Frontend + QA + Tester`
- runtime-only work
  - `Planner + Orchestrator + Backend + QA + Tester`
- very small fixes
  - one agent may implement, but skipped planner, designer, QA, and tester responsibilities should still be acknowledged explicitly

## 검증 원칙 / Validation Rules

### 한국어

- 구현 에이전트가 자기 작업을 설명하는 것만으로 완료로 보지 않는다.
- `QA`의 acceptance 판단과 `Tester` 관점의 검증 결과가 함께 있어야 스프린트를 닫는다.
- 새 사용자 흐름은 가능한 범위에서 `Playwright` E2E에 남긴다.
- MVP 또는 안정성 관련 변경은 필요 시 `aging test` 후보로 기록한다.

### English

- implementation is not complete just because the implementing agent says it is
- a sprint should close only with both QA acceptance review and tester validation
- new user-facing flows should leave behind `Playwright` E2E coverage whenever practical
- MVP or stability-sensitive changes should be recorded for aging-test consideration when needed

## 문서 동기화 / Documentation Sync

### 한국어

이 운영 모델이 바뀌면 최소한 아래 문서를 함께 본다.

- `AGENTS.md`
- `docs/DOCS_READING_ORDER.md`
- `docs/README.md`
- `docs/product-plan.md`
- `docs/technical-design.md`
- `docs/sprint-plan.md`

### English

When this operating model changes, review at least these documents together:

- `AGENTS.md`
- `docs/DOCS_READING_ORDER.md`
- `docs/README.md`
- `docs/product-plan.md`
- `docs/technical-design.md`
- `docs/sprint-plan.md`
