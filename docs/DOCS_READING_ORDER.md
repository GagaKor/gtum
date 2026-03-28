# gtum 문서 읽기 순서 / Docs Reading Order

## 문서 목적 / Document Purpose

### 한국어

이 문서는 `gtum`에서 작업하다가 방향이 흐려질 때 어떤 문서를 어떤 순서로 다시 읽어야 하는지 안내하는 빠른 복귀 문서다.

### English

This document is a fast recovery guide for deciding which documents to reread, and in what order, when work on `gtum` starts losing direction.

## 기본 복귀 순서 / Default Recovery Order

### 한국어

길을 잃었다고 느껴지면 아래 순서로 다시 읽는다.

1. `AGENTS.md`
2. `docs/README.md`
3. `docs/product-plan.md`
4. `docs/technical-design.md`
5. `docs/frontend-design-benchmarks.md`
6. `docs/agent-team-topology.md`
7. `docs/mvp-backlog.md`
8. `docs/sprint-plan.md`
9. `docs/release-build-ci.md`
10. 현재 스프린트 체크리스트 또는 작업 로그

### English

If you feel lost, reread documents in this order:

1. `AGENTS.md`
2. `docs/README.md`
3. `docs/product-plan.md`
4. `docs/technical-design.md`
5. `docs/frontend-design-benchmarks.md`
6. `docs/agent-team-topology.md`
7. `docs/mvp-backlog.md`
8. `docs/sprint-plan.md`
9. `docs/release-build-ci.md`
10. the current sprint checklist or worklog

## 작업 시작 전 팀빌딩 규칙 / Team Formation Before Execution

### 한국어

의미 있는 구현 작업이나 source of truth 문서 변경을 시작하기 전에는 아래 순서를 먼저 수행한다.

1. `AGENTS.md`
2. `docs/agent-team-topology.md`
3. `docs/sprint-plan.md`

그 다음 `orchestrator`, `frontend`, `backend`, `QA`, `tester` 역할로 먼저 팀을 나누고 파일 소유권과 handoff를 정한다.

### English

Before starting non-trivial implementation work or source-of-truth documentation changes, do this first:

1. `AGENTS.md`
2. `docs/agent-team-topology.md`
3. `docs/sprint-plan.md`

Then split the work into `orchestrator`, `frontend`, `backend`, `QA`, and `tester` roles first, and lock file ownership plus handoff expectations before editing.

## 컨텍스트 초과 시 규칙 / Rule For Context Overflow

### 한국어

Codex 컨텍스트가 길어져서 앞선 판단 근거를 잊을 수 있다고 느껴지면, 작업을 밀어붙이지 말고 아래 순서로 다시 읽는다.

1. `docs/DOCS_READING_ORDER.md`
2. `docs/product-plan.md`
3. `docs/technical-design.md`
4. `docs/frontend-design-benchmarks.md`
5. `docs/agent-team-topology.md`
6. `docs/mvp-backlog.md`
7. 현재 스프린트 문서
8. 최신 `WORKLOG`

이 규칙의 목적은 기억에 의존하지 않고 문서 기준으로 방향을 복구하는 것이다.

### English

If Codex context grows long enough that earlier reasoning may drift or be forgotten, do not push forward from memory alone. Reread in this order:

1. `docs/DOCS_READING_ORDER.md`
2. `docs/product-plan.md`
3. `docs/technical-design.md`
4. `docs/frontend-design-benchmarks.md`
5. `docs/agent-team-topology.md`
6. `docs/mvp-backlog.md`
7. the current sprint document
8. the latest `WORKLOG`

The purpose of this rule is to restore direction from documentation rather than memory.

## 상황별 읽기 순서 / Situation-Based Reading Order

### 한국어

### 제품 방향이 헷갈릴 때

1. `docs/product-plan.md`
2. `docs/mvp-backlog.md`

### 구현 구조가 헷갈릴 때

1. `docs/technical-design.md`
2. `docs/frontend-design-benchmarks.md`
3. `docs/agent-team-topology.md`
4. `docs/sprint-plan.md`

### 역할 분담이 헷갈릴 때

1. `docs/agent-team-topology.md`
2. `AGENTS.md`
3. `docs/sprint-plan.md`
4. `docs/frontend-design-benchmarks.md`
5. `docs/technical-design.md`

### 지금 무엇부터 만들어야 할지 헷갈릴 때

1. `docs/mvp-backlog.md`
2. `docs/sprint-plan.md`
3. `docs/sprint-0-checklist.md`

### 문서가 서로 충돌해 보일 때

1. `AGENTS.md`
2. `docs/product-plan.md`
3. `docs/technical-design.md`
4. 관련 구현 파일

### 릴리스/빌드/CI가 헷갈릴 때

1. `docs/release-build-ci.md`
2. `docs/technical-design.md`
3. `docs/README.md`

### English

### When product direction feels unclear

1. `docs/product-plan.md`
2. `docs/mvp-backlog.md`

### When implementation structure feels unclear

1. `docs/technical-design.md`
2. `docs/frontend-design-benchmarks.md`
3. `docs/agent-team-topology.md`
4. `docs/sprint-plan.md`

### When role ownership feels unclear

1. `docs/agent-team-topology.md`
2. `AGENTS.md`
3. `docs/sprint-plan.md`
4. `docs/frontend-design-benchmarks.md`
5. `docs/technical-design.md`

### When it is unclear what to build next

1. `docs/mvp-backlog.md`
2. `docs/sprint-plan.md`
3. `docs/sprint-0-checklist.md`

### When documents appear to conflict

1. `AGENTS.md`
2. `docs/product-plan.md`
3. `docs/technical-design.md`
4. related implementation files

### When release, build, or CI flow feels unclear

1. `docs/release-build-ci.md`
2. `docs/technical-design.md`
3. `docs/README.md`

## 짧은 복귀 질문 / Quick Recovery Questions

### 한국어

문서를 다시 읽기 전에 아래 질문을 스스로 확인하면 좋다.

- 지금 내가 풀려는 문제가 제품 문제인가, 구현 문제인가, 실행 순서 문제인가
- 지금 이 작업을 `orchestrator`, `frontend`, `backend`, `QA`, `tester` 중 어떤 역할로 나눌 것인가
- 지금 작업이 MVP에 직접 들어가는가
- 지금 작업이 활성 터미널 로그 활용이라는 핵심 가치를 강화하는가
- 지금 작업이 어느 스프린트에 속하는가

### English

Before rereading, it helps to ask:

- is the current confusion about product direction, implementation, or execution order
- how should this task be split across `orchestrator`, `frontend`, `backend`, `QA`, and `tester`
- is this task directly inside the MVP scope
- does this task strengthen the core value of using active terminal logs
- which sprint does this task belong to
