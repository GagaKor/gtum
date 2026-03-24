# gtum 에이전트 팀 토폴로지 / Agent Team Topology

## 문서 목적 / Document Purpose

### 한국어

이 문서는 `gtum` 저장소에서 기본 개발 운영 모델로 사용할 멀티 에이전트 팀 구성을 정의한다.

목적은 다음과 같다.

- 에이전트 역할을 `orchestrator`, `frontend`, `backend`, `tester` 네 축으로 고정한다.
- 큰 작업을 병렬로 나누되, 충돌 없이 다시 통합하는 기준을 제공한다.
- 각 역할이 무엇을 읽고, 무엇을 수정하고, 무엇을 검증하는지 명확히 한다.
- 문서와 코드, 테스트가 같이 움직이도록 기본 handoff 규칙을 남긴다.

### English

This document defines the default multi-agent team topology for development work in the `gtum` repository.

Its goals are:

- fix the default role split to `orchestrator`, `frontend`, `backend`, and `tester`
- provide a way to parallelize larger tasks without integration chaos
- make it explicit what each role reads, edits, and validates
- keep code, docs, and tests moving together through clear handoff rules

## 기본 팀 편성 / Default Team Shape

### 한국어

기본 팀은 아래 네 역할로 구성한다.

- `Orchestrator`
  - 작업 목표를 해석하고, 문서와 코드 기준선을 맞추고, 역할별 작업을 분해한다.
- `Frontend`
  - `src/` 중심 UI, 상태, 사용자 흐름, 프론트 검증을 담당한다.
- `Backend`
  - `src-tauri/` 중심 런타임, 파일 시스템, PTY, provider, 시스템 계약을 담당한다.
- `Tester`
  - `tests/`, 재현 절차, 회귀 확인, E2E와 aging 관점의 검증을 담당한다.

작업이 작을 때는 한 에이전트가 여러 역할을 겸할 수 있다. 다만 작업이 프론트와 런타임, 또는 구현과 검증을 동시에 건드리면 이 네 역할을 분리하는 것을 기본값으로 본다.

### English

The default team has four roles:

- `Orchestrator`
  - interprets the goal, aligns docs and code, and decomposes the work
- `Frontend`
  - owns UI, state, user flows, and frontend validation around `src/`
- `Backend`
  - owns runtime, filesystem, PTY, provider, and system contracts around `src-tauri/`
- `Tester`
  - owns `tests/`, repro steps, regression checks, and E2E plus aging-style validation

For very small tasks, one agent may cover multiple roles. Once work spans frontend and runtime, or implementation and validation, this four-role split should become the default.

## 역할별 책임 / Role Responsibilities

### 한국어

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

1. `Orchestrator`가 요청을 읽고 관련 문서와 코드 기준선을 확인한다.
2. `Orchestrator`가 작업을 `frontend`, `backend`, `tester` 단위로 나눈다.
3. `Frontend`와 `Backend`는 서로 다른 파일 소유권으로 병렬 작업한다.
4. `Tester`는 구현과 병렬로 검증 시나리오, 회귀 포인트, 필요한 재현 절차를 준비한다.
5. 구현이 모이면 `Tester`가 실제 검증을 수행하고 결과를 정리한다.
6. `Orchestrator`가 결과를 통합하고, 문서 갱신 여부와 남은 리스크를 정리한다.

### English

1. The `Orchestrator` reads the request and checks the relevant doc and code baseline.
2. The `Orchestrator` splits the work into `frontend`, `backend`, and `tester` slices.
3. `Frontend` and `Backend` work in parallel with separate file ownership.
4. `Tester` prepares validation scenarios, regression focus, and repro steps in parallel with implementation.
5. Once implementation lands, `Tester` performs the actual validation and summarizes the result.
6. The `Orchestrator` integrates outcomes and closes the loop on docs and remaining risks.

## 파일 소유권 규칙 / File Ownership Rules

### 한국어

- `Frontend`
  - 기본적으로 `src/`만 수정한다.
- `Backend`
  - 기본적으로 `src-tauri/`만 수정한다.
- `Tester`
  - 기본적으로 `tests/`와 검증 관련 문서만 수정한다.
- `Orchestrator`
  - 문서, 통합 지점, 충돌 조정 파일을 맡는다.

같은 파일을 두 역할이 동시에 수정해야 할 것 같다면 먼저 `Orchestrator`가 구조를 다시 나눈다. 병렬성보다 충돌 회피가 우선이다.

### English

- `Frontend`
  - should edit `src/` by default
- `Backend`
  - should edit `src-tauri/` by default
- `Tester`
  - should edit `tests/` and validation docs by default
- `Orchestrator`
  - owns docs, integration points, and conflict resolution

If two roles appear to need the same file at the same time, the `Orchestrator` should split the work again first. Avoiding collisions matters more than maximizing parallelism.

## Handoff 규칙 / Handoff Rules

### 한국어

- `Backend -> Frontend`
  - 새 command, snapshot, enum, status field, contract 변화가 있으면 이름과 의미를 먼저 고정한다.
- `Frontend -> Tester`
  - 사용자 기준 클릭 경로와 기대 결과를 짧게 넘긴다.
- `Backend -> Tester`
  - mock/runtime 차이, 플랫폼 리스크, 재현 조건을 짧게 넘긴다.
- `Tester -> Orchestrator`
  - 통과 여부, 실패 조건, 미검증 영역, 후속 권고를 남긴다.

핵심은 긴 설명보다 재현 가능한 계약과 검증 조건을 넘기는 것이다.

### English

- `Backend -> Frontend`
  - lock the names and meanings of any new command, snapshot, enum, status field, or contract change first
- `Frontend -> Tester`
  - hand off the user-facing click path and expected outcome in short form
- `Backend -> Tester`
  - hand off mock/runtime differences, platform risks, and repro conditions in short form
- `Tester -> Orchestrator`
  - report pass/fail status, failure conditions, unverified areas, and follow-up recommendations

The goal is not long prose. The goal is to pass along reproducible contracts and validation conditions.

## 작업 분해 기본 템플릿 / Default Decomposition Template

### 한국어

작업이 들어오면 기본적으로 아래 형태를 먼저 검토한다.

- `Orchestrator`
  - 관련 문서 확인
  - 현재 코드 기준선 확인
  - 역할별 소유 파일 지정
- `Frontend`
  - UI 변경점 구현
  - 프론트 상태 및 표시 로직 정리
- `Backend`
  - 런타임/계약 변경 구현
  - 필요한 mock 또는 snapshot 정리
- `Tester`
  - E2E 또는 회귀 시나리오 추가
  - 테스트 결과와 재현 절차 정리

### English

When a new task arrives, start by checking this decomposition:

- `Orchestrator`
  - verify relevant docs
  - verify the current code baseline
  - assign per-role file ownership
- `Frontend`
  - implement UI changes
  - align frontend state and rendering logic
- `Backend`
  - implement runtime and contract changes
  - align any required mock or snapshot behavior
- `Tester`
  - add E2E or regression coverage
  - summarize validation results and repro steps

## 언제 네 역할을 모두 쓰는가 / When To Use All Four Roles

### 한국어

아래 중 둘 이상에 해당하면 네 역할 편성을 기본값으로 사용한다.

- UI와 런타임 계약이 함께 바뀐다.
- `src/`와 `src-tauri/`를 동시에 수정해야 한다.
- 새 E2E 시나리오가 필요하다.
- 회귀 위험이 높다.
- 문서 source of truth도 같이 갱신해야 한다.

### English

Default to all four roles when at least two of the following are true:

- UI and runtime contracts both change
- both `src/` and `src-tauri/` need edits
- a new E2E scenario is needed
- regression risk is high
- source-of-truth docs also need updates

## 언제 축소하는가 / When To Collapse Roles

### 한국어

- 문서만 수정하는 작업
  - `Orchestrator` 단독 또는 `Orchestrator + Tester`
- 순수 프론트 작업
  - `Orchestrator + Frontend + Tester`
- 순수 런타임 작업
  - `Orchestrator + Backend + Tester`
- 아주 작은 수정
  - 한 에이전트가 구현하고, 별도 검증 관점만 체크한다.

### English

- docs-only work
  - `Orchestrator` alone or `Orchestrator + Tester`
- frontend-only work
  - `Orchestrator + Frontend + Tester`
- runtime-only work
  - `Orchestrator + Backend + Tester`
- very small fixes
  - one agent may implement while still checking validation from a separate perspective

## 검증 원칙 / Validation Rules

### 한국어

- 구현 에이전트가 자기 작업을 설명하는 것만으로 완료로 보지 않는다.
- `Tester` 관점의 검증 결과가 있어야 스프린트를 닫는다.
- 새 사용자 흐름은 가능한 범위에서 `Playwright` E2E에 남긴다.
- MVP 또는 안정성 관련 변경은 필요 시 `aging test` 후보로 기록한다.

### English

- implementation is not complete just because the implementing agent says it is
- a sprint should close only with validation from the `Tester` perspective
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
