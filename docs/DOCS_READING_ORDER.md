# gtum 문서 읽기 순서 / Docs Reading Order

## 문서 목적 / Document Purpose

### 한국어

이 문서는 `gtum`에서 작업할 때 필요한 문서만 빠르게 고르기 위한 라우팅 문서다.

목표는 세 가지다.

- 작업 시작 시 전체 문서를 다 읽지 않게 한다.
- 현재 문제 유형에 맞는 source of truth로 바로 이동하게 한다.
- 컨텍스트가 길어졌을 때 전체 재독이 아니라 필요한 부분만 다시 읽게 한다.

### English

This document is a routing guide for choosing only the docs needed for work in `gtum`.

Its goals are:

- avoid rereading the entire doc set at task start
- route quickly to the right source of truth for the current problem
- recover context by rereading only what is relevant, not everything

## 장문 문서 라우팅 / Long-Doc Routing

### 한국어

이 문서도 200줄을 넘는 장문 라우팅 문서다. 아래 중 필요한 경로만 읽는다.

- 새 작업을 시작할 때
  - `Quick Start Route`와 `Task-Based Routing`만 읽는다.
- 길을 잃었거나 직전 맥락이 흐려졌을 때
  - `Context Overflow Recovery`만 읽는다.
- 정말 방향이 안 잡힐 때
  - 마지막에만 `Full Recovery Order`까지 내려간다.

### English

This document also exceeds 200 lines. Read only the route that matches your need.

- when starting a new task
  - read only `Quick Start Route` and `Task-Based Routing`
- when context has drifted or recent reasoning is unclear
  - read only `Context Overflow Recovery`
- only when direction is still unclear
  - continue into `Full Recovery Order` as a last step

## 빠른 시작 라우트 / Quick Start Route

### 한국어

새 작업을 시작할 때는 아래까지만 먼저 읽는다.

1. `AGENTS.md`
2. `docs/README.md`
3. 현재 작업 유형에 맞는 문서만 아래 라우트에서 고른다.

문서를 고른 뒤에는 바로 수정하지 말고, 먼저 `planner`, `orchestrator`, `designer`, `frontend`, `backend`, `QA`, `tester` 기준으로 역할을 나누고 파일 소유권과 handoff를 정한다.

문서가 200줄을 넘으면 기본값은 전체 통독이 아니라 상단 `Long-Doc Routing` 섹션만 먼저 읽고 필요한 경로로 내려가는 것이다.

### English

When starting a new task, read only this first:

1. `AGENTS.md`
2. `docs/README.md`
3. only the task-specific docs selected from the routes below

After choosing the docs, do not edit immediately. First split the work into `planner`, `orchestrator`, `designer`, `frontend`, `backend`, `QA`, and `tester`, then lock file ownership and handoff expectations.

If a document exceeds 200 lines, do not read it end to end by default. Read only its top `Long-Doc Routing` section first and continue into the matching route.

## 작업별 라우팅 / Task-Based Routing

### 한국어

### 제품 방향, 범위, 정책이 문제일 때

1. `docs/product-plan.md`
2. `docs/mvp-backlog.md`

### 다음 스프린트 기획이나 디자인 방향이 문제일 때

1. `docs/sprint-plan.md`
2. `docs/product-plan.md`
3. `docs/frontend-design-benchmarks.md`
4. 새 제품 디자인 구현이면 `docs/superpowers/plans/2026-05-28-new-product-design-implementation.md`
5. `docs/agent-team-topology.md`

### 런타임 구조, provider/auth, contract가 문제일 때

1. `docs/technical-design.md`
2. `docs/architecture.md`
3. 필요 시 `docs/message-flow.md`
4. 필요 시 `docs/product-plan.md`

### 현재 구현 구조나 저장 경계가 문제일 때

1. `docs/architecture.md`
2. `docs/technical-design.md`

### request payload, approval, restore, 데이터 흐름이 문제일 때

1. `docs/message-flow.md`
2. `docs/technical-design.md`
3. 필요 시 `docs/architecture.md`

### 프론트엔드 UI/UX가 문제일 때

1. `docs/design-system.md`
2. `docs/frontend-design-benchmarks.md`
3. UI 방향 자체를 골라야 하면 `docs/design-concepts-sprint-15.md`
4. 필요 시 `docs/ui-ux-wireframes.md`
5. 필요 시 `docs/technical-design.md`

### 왼쪽 rail, side panel, settings UX가 문제일 때

1. `docs/left-menu-views.md`
2. `docs/frontend-design-benchmarks.md`
3. 필요 시 `docs/ui-ux-wireframes.md`
4. 필요 시 `docs/design-concepts-sprint-15.md`

### 구현 규칙이나 문서 흡수 기준이 문제일 때

1. `docs/development-guide.md`
2. `docs/README.md`
3. 필요 시 `AGENTS.md`

### 멀티 에이전트 역할 분리와 handoff가 문제일 때

1. `docs/agent-team-topology.md`
2. `docs/sprint-plan.md`

### MVP 범위, 완료조건, 우선순위가 문제일 때

1. `docs/mvp-backlog.md`
2. `docs/sprint-plan.md`

### 지금 무엇을 먼저 해야 할지 문제일 때

1. `docs/sprint-plan.md`
2. 현재 스프린트 체크리스트 또는 진행 중 `WORKLOG`
3. `docs/mvp-backlog.md`
4. `docs/MVP_VALIDATION_NOTES.md`

다음 작업을 정하기 전, 현재 스프린트 문서, 진행 중 `WORKLOG`, 검증 메모, UI task history에서 이미 시도한 경로와 반복 실패를 먼저 확인한다.

### 이미 밟아온 작업 경로를 검토하고 문제점을 찾을 때

1. `docs/sprint-plan.md`
2. 현재 스프린트 체크리스트 또는 진행 중 `WORKLOG`
3. `docs/MVP_VALIDATION_NOTES.md`
4. `docs/agent-team-topology.md`
5. 필요 시 UI task history

### 릴리스, 빌드, CI가 문제일 때

1. `docs/release-build-ci.md`
2. 필요 시 `docs/technical-design.md`

### 최신 상태와 직전 맥락이 필요할 때

1. 현재 스프린트 체크리스트 또는 진행 중 `WORKLOG`
2. `docs/sprint-plan.md`
3. `docs/MVP_VALIDATION_NOTES.md`
4. 필요 시 UI task history

### English

### When the issue is product direction, scope, or policy

1. `docs/product-plan.md`
2. `docs/mvp-backlog.md`

### When the issue is next-sprint planning or design direction

1. `docs/sprint-plan.md`
2. `docs/product-plan.md`
3. `docs/frontend-design-benchmarks.md`
4. `docs/superpowers/plans/2026-05-28-new-product-design-implementation.md` when implementing the new product design
5. `docs/agent-team-topology.md`

### When the issue is runtime structure, provider/auth, or contracts

1. `docs/technical-design.md`
2. `docs/architecture.md`
3. `docs/message-flow.md` if needed
4. `docs/product-plan.md` if needed
5. `docs/superpowers/plans/2026-07-16-claude-startup-capability-recovery.md` for authoritative startup auth, recovery of a persisted real Claude error, explicit-disconnect preservation, and connected-only capability discovery
6. `docs/superpowers/plans/2026-07-15-claude-cli-session-auth.md` for the active Claude CLI-session correction, safe-mode boundary, and public-distribution gate
7. `docs/superpowers/plans/2026-07-15-claude-effort-fast-mode.md` for model-specific effort/Fast capabilities, persistence, UI semantics, and request mapping

The 2026-07-15 plan supersedes `docs/superpowers/plans/2026-07-14-claude-api-provider.md` for current Claude authentication policy. Read the 2026-07-14 file only when historical API-only implementation context is needed.

The 2026-07-16 recovery plan extends the current authentication and effort/Fast contracts; use it first when startup shows a previously connected Claude provider without model, reasoning, or Fast controls.

For Claude execution options, the effort/Fast plan extends the account-catalog plan: the same prompt-free returned model catalog is authoritative for each model's `executionOptions`, and no static alias or entitlement inference is allowed.

### When the issue is current implementation structure or persistence boundaries

1. `docs/architecture.md`
2. `docs/technical-design.md`
3. `docs/superpowers/plans/2026-07-16-claude-startup-capability-recovery.md` when tracing startup auth/capability ownership or persisted Claude error recovery

### When the issue is request payloads, approval, restore, or data flow

1. `docs/message-flow.md`
2. `docs/technical-design.md`
3. `docs/architecture.md` if needed
4. `docs/superpowers/plans/2026-07-15-claude-effort-fast-mode.md` when the request includes Claude reasoning or Fast mode

### When the issue is frontend UI/UX

1. `docs/design-system.md`
2. `docs/frontend-design-benchmarks.md`
3. `docs/design-concepts-sprint-15.md` when the screen direction itself needs to be chosen
4. `docs/ui-ux-wireframes.md` if needed
5. `docs/technical-design.md` if needed

### When the issue is left-rail, side-panel, or settings UX

1. `docs/left-menu-views.md`
2. `docs/frontend-design-benchmarks.md`
3. `docs/ui-ux-wireframes.md` if needed
4. `docs/design-concepts-sprint-15.md` if needed

### When the issue is implementation rules or doc-absorption policy

1. `docs/development-guide.md`
2. `docs/README.md`
3. `AGENTS.md` if needed

### When the issue is multi-agent ownership or handoff

1. `docs/agent-team-topology.md`
2. `docs/sprint-plan.md`

### When the issue is MVP scope, acceptance, or priority

1. `docs/mvp-backlog.md`
2. `docs/sprint-plan.md`

### When the issue is what to do next

1. `docs/sprint-plan.md`
2. the current sprint checklist or active `WORKLOG`
3. `docs/mvp-backlog.md`
4. `docs/MVP_VALIDATION_NOTES.md`

Before choosing the next task, review the current sprint docs, active `WORKLOG`, validation notes, and UI task history for the path already taken and repeated failures first.

### When the issue is reviewing the path already taken and finding problems

1. `docs/sprint-plan.md`
2. the current sprint checklist or active `WORKLOG`
3. `docs/MVP_VALIDATION_NOTES.md`
4. `docs/agent-team-topology.md`
5. UI task history if needed

### When the issue is release, build, or CI

1. `docs/release-build-ci.md`
2. `docs/technical-design.md` if needed

### When you need the latest state and recent context

1. the current sprint checklist or active `WORKLOG`
2. `docs/sprint-plan.md`
3. `docs/MVP_VALIDATION_NOTES.md`
4. UI task history if needed

## 컨텍스트 초과 시 복구 규칙 / Context Overflow Recovery

### 한국어

컨텍스트가 길어져서 앞선 판단 근거가 흐려지면 아래 순서로 복구한다.

1. `docs/DOCS_READING_ORDER.md`
2. `docs/README.md`
3. 현재 작업 유형에 맞는 source of truth 1개 또는 2개
4. 현재 스프린트 문서, 진행 중 `WORKLOG`, 또는 `docs/MVP_VALIDATION_NOTES.md`

그래도 방향이 안 잡히면 그때만 아래 `전체 복구 순서`로 넓힌다.

### English

If context grows long enough that earlier reasoning starts to drift, recover in this order:

1. `docs/DOCS_READING_ORDER.md`
2. `docs/README.md`
3. one or two source-of-truth docs that match the current task type
4. the current sprint doc, active `WORKLOG`, or `docs/MVP_VALIDATION_NOTES.md`

Only if direction is still unclear should you expand into the full recovery order below.

## 전체 복구 순서 / Full Recovery Order

### 한국어

아직도 방향이 안 잡힐 때만 아래 순서로 넓게 다시 읽는다.

1. `AGENTS.md`
2. `docs/README.md`
3. `docs/product-plan.md`
4. `docs/technical-design.md`
5. `docs/architecture.md`
6. `docs/message-flow.md`
7. `docs/agent-team-topology.md`
8. `docs/mvp-backlog.md`
9. `docs/sprint-plan.md`
10. `docs/development-guide.md`

### English

Only when direction is still unclear should you widen out and reread in this order:

1. `AGENTS.md`
2. `docs/README.md`
3. `docs/product-plan.md`
4. `docs/technical-design.md`
5. `docs/architecture.md`
6. `docs/message-flow.md`
7. `docs/agent-team-topology.md`
8. `docs/mvp-backlog.md`
9. `docs/sprint-plan.md`
10. `docs/development-guide.md`

## 짧은 복귀 질문 / Quick Recovery Questions

### 한국어

문서를 다시 읽기 전에 아래 질문을 확인한다.

- 지금 문제는 제품, 구현, 우선순위, 릴리스 중 무엇인가
- 지금 필요한 source of truth는 1개인가 2개인가
- 이 작업은 `planner`, `orchestrator`, `designer`, `frontend`, `backend`, `QA`, `tester` 중 어떻게 나눌 것인가
- 지금 당장 체크리스트, 검증 메모, task history도 같이 봐야 하는가
- 이미 시도한 경로와 실패 패턴을 확인했는가

### English

Before rereading, ask:

- is the issue about product, implementation, priority, or release
- do I need one source of truth, or two
- how should this task be split across `planner`, `orchestrator`, `designer`, `frontend`, `backend`, `QA`, and `tester`
- do I also need the checklist, validation notes, or task history right now
- have I reviewed the path already taken and repeated failure patterns
