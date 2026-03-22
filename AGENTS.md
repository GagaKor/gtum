# AGENTS.md

## 1. 목적 / Purpose

### 한국어

이 문서는 `gtum` 저장소에서 작업하는 사람과 에이전트가 작업을 시작하기 전에 무엇을 읽고, 어떤 기준으로 판단하고, 변경이 생겼을 때 어떤 문서를 함께 갱신해야 하는지 정리한 운영 지침서다.

핵심 목표는 다음과 같다.

- 작업 시작 전에 문서로 현재 맥락을 빠르게 파악한다.
- 코드만 바꾸고 문서를 방치하지 않는다.
- 문서마다 역할을 분명히 구분해 중복과 충돌을 줄인다.
- 기능이 변할 때 관련 문서를 함께 갱신해 에이전트가 길을 잃지 않게 한다.
- 한국어와 영어 문서가 항상 같은 의미와 최신 상태를 유지하도록 한다.

### English

This document is an operating guide for both humans and agents working in the `gtum` repository. It explains what to read before starting work, how to make decisions, and which documents must be updated when changes are introduced.

Its goals are:

- understand the current context quickly through documentation before making changes
- avoid changing code while leaving documentation behind
- keep document roles clear to reduce duplication and conflict
- update related documents when behavior changes so agents do not lose context
- keep Korean and English documentation aligned in meaning and freshness

## 2. 기본 작업 원칙 / Core Working Principles

### 한국어

- 이 프로젝트는 `docs/`를 작업 진입점으로 사용한다.
- 작업 전에 필요한 문서를 먼저 읽고, 추측보다 문서와 코드 근거를 우선한다.
- 변경이 구조, 흐름, 정책, 권한, 계약에 영향을 주면 관련 문서를 같은 작업 안에서 함께 갱신한다.
- 브랜치 운영은 `git flow` 개념을 가볍게 적용하는 방향을 기본 협업 원칙으로 삼는다.
- 문서와 코드가 다르면 실제 코드와 최신 결정 내용을 기준으로 확인한 뒤 문서를 수정한다.
- 새로운 규칙을 만들었으면 메모로 흩어두지 말고 적절한 문서에 반영한다.
- 현재 없는 문서를 전제로 판단하지 말고, 실제 존재하는 문서를 기준으로 작업한다.

### English

- This project uses `docs/` as the entry point for work.
- Read the relevant documents before starting, and prefer documented and code-based evidence over guesswork.
- If a change affects structure, flow, policy, permissions, or contracts, update the related documents in the same task.
- Branch operations should follow a lightweight interpretation of `git flow` as the default collaboration model.
- If code and docs differ, verify against the actual code and latest decisions, then update the documentation.
- When a new rule appears, do not leave it as scattered notes; fold it into the appropriate document.
- Do not assume documents exist unless they are actually present in the repository.

## 3. 작업 시작 전 읽기 규칙 / What To Read Before Starting

### 한국어

현재 저장소 기준 기본 시작 순서는 아래와 같다.

1. `AGENTS.md`
2. `docs/DOCS_READING_ORDER.md`
3. `docs/README.md`
4. `docs/product-plan.md`
5. `docs/technical-design.md`
6. `docs/mvp-backlog.md`
7. `docs/sprint-plan.md`
8. `docs/sprint-0-checklist.md`

각 문서의 역할은 다음과 같다.

- `AGENTS.md`
  - 저장소 운영 규칙, 문서 동기화 원칙, 작업 절차를 안내한다.
- `docs/DOCS_READING_ORDER.md`
  - 길을 잃었을 때 어떤 문서를 어떤 순서로 다시 읽을지 안내한다.
- `docs/README.md`
  - 현재 문서 목록과 핵심 결정 사항을 빠르게 확인하게 해준다.
- `docs/product-plan.md`
  - 제품 비전, 핵심 기능, 멀티 에이전트 구조, 실행 모드, 기술 방향을 설명한다.
- `docs/technical-design.md`
  - 앱 구조, 런타임 책임, 크로스 플랫폼 전략, 인증 구조, 구현 순서를 설명한다.
- `docs/mvp-backlog.md`
  - MVP 범위, 우선순위, 완료조건, 제외 범위를 정의한다.
- `docs/sprint-plan.md`
  - MVP 백로그를 실제 스프린트 단위 실행 계획으로 변환한다.
- `docs/sprint-0-checklist.md`
  - 지금 바로 시작할 Sprint 0 실행 체크리스트다.

짧게 확인해야 할 때도 최소한 아래는 먼저 읽는다.

1. `AGENTS.md`
2. `docs/DOCS_READING_ORDER.md`
3. `docs/product-plan.md`
4. `docs/technical-design.md`
5. `docs/mvp-backlog.md`
6. `docs/sprint-plan.md`
7. `docs/sprint-0-checklist.md`

### English

Given the current state of the repository, the default reading order is:

1. `AGENTS.md`
2. `docs/DOCS_READING_ORDER.md`
3. `docs/README.md`
4. `docs/product-plan.md`
5. `docs/technical-design.md`
6. `docs/mvp-backlog.md`
7. `docs/sprint-plan.md`
8. `docs/sprint-0-checklist.md`

The role of each document is:

- `AGENTS.md`
  - explains repository operating rules, documentation sync rules, and working procedures
- `docs/DOCS_READING_ORDER.md`
  - explains which docs to reread when direction becomes unclear
- `docs/README.md`
  - gives a quick view of the available docs and current decisions
- `docs/product-plan.md`
  - explains product vision, core capabilities, multi-agent structure, execution modes, and technical direction
- `docs/technical-design.md`
  - explains implementation structure, runtime responsibilities, and platform strategy
- `docs/mvp-backlog.md`
  - defines MVP scope, priorities, and acceptance criteria
- `docs/sprint-plan.md`
  - turns the MVP backlog into sprint sequencing
- `docs/sprint-0-checklist.md`
  - gives the immediate execution checklist for the first sprint

Even in a time-constrained situation, read at least:

1. `AGENTS.md`
2. `docs/DOCS_READING_ORDER.md`
3. `docs/product-plan.md`
4. `docs/technical-design.md`
5. `docs/mvp-backlog.md`
6. `docs/sprint-plan.md`
7. `docs/sprint-0-checklist.md`

## 4. 현재 문서별 역할 / Current Document Roles

### 한국어

- `AGENTS.md`
  - 저장소 운영 원칙과 에이전트 행동 규칙
- `docs/DOCS_READING_ORDER.md`
  - 문서 복귀 순서 기준 문서
- `docs/README.md`
  - 문서 인덱스와 현재 핵심 결정 요약
- `docs/product-plan.md`
  - 제품 기획의 기준 문서
- `docs/technical-design.md`
  - 구현 구조의 기준 문서
- `docs/mvp-backlog.md`
  - MVP 실행 범위의 기준 문서
- `docs/sprint-plan.md`
  - 스프린트 실행 순서의 기준 문서
- `docs/sprint-0-checklist.md`
  - 첫 실행 체크리스트 문서
- `docs/WORKLOG_TEMPLATE.md`
  - 스프린트 작업 기록 템플릿

향후 구현이 진행되면 아래 문서들을 추가하는 것을 권장한다.

- `docs/technical-design.md`
  - 앱 구조, 폴더 구조, PTY 세션, 상태 모델, 에이전트 통합 경계
- `docs/repository-map.md`
  - 디렉토리 구조와 주요 진입점
- `docs/architecture.md`
  - 시스템 경계와 모듈 책임
- `docs/message-flow.md`
  - 요청, 이벤트, 작업 orchestration 흐름
- `docs/development-guide.md`
  - 구현 규칙과 개발 패턴

### English

- `AGENTS.md`
  - repository operating principles and agent behavior rules
- `docs/DOCS_READING_ORDER.md`
  - recovery guide for what to reread when direction is unclear
- `docs/README.md`
  - document index and summary of current decisions
- `docs/product-plan.md`
  - canonical product planning document
- `docs/technical-design.md`
  - canonical implementation structure document
- `docs/mvp-backlog.md`
  - canonical MVP scope, priority, and acceptance criteria document
- `docs/sprint-plan.md`
  - canonical sprint sequencing and delivery plan document
- `docs/sprint-0-checklist.md`
  - canonical immediate execution checklist for Sprint 0
- `docs/WORKLOG_TEMPLATE.md`
  - worklog template for sprint progress recording

As implementation grows, the following documents should be added:

- `docs/technical-design.md`
  - app structure, folder structure, PTY sessions, state model, and agent boundaries
- `docs/repository-map.md`
  - directory structure and major entry points
- `docs/architecture.md`
  - system boundaries and module responsibilities
- `docs/message-flow.md`
  - request, event, and orchestration flows
- `docs/development-guide.md`
  - implementation rules and development patterns

## 5. 문서 동기화 규칙 / Documentation Sync Rules

### 한국어

아래와 같은 변경이 생기면 문서도 함께 갱신해야 한다.

- 브랜치 전략 또는 협업 워크플로우 변경
  - `docs/product-plan.md`
  - `docs/technical-design.md`
- 제품 비전, 범위, 에이전트 정책, 실행 모드 변경
  - `docs/product-plan.md`
- MVP 범위, 우선순위, 완료조건 변경
  - `docs/mvp-backlog.md`
  - 필요 시 `docs/product-plan.md`, `docs/technical-design.md`
- 스프린트 순서, 산출물, 완료조건 변경
  - `docs/sprint-plan.md`
  - `docs/mvp-backlog.md`
  - 필요 시 `docs/product-plan.md`, `docs/technical-design.md`
- 기술 스택, 런타임 구조, PTY 설계, 상태 모델 확정 또는 변경
  - `docs/product-plan.md`
  - `docs/technical-design.md`가 있으면 함께 갱신
- 새로운 문서 추가 또는 문서 역할 변경
  - `docs/README.md`
  - 필요 시 `AGENTS.md`
- 체크리스트나 작업 로그 기준 변경
  - `docs/sprint-0-checklist.md`
  - `docs/WORKLOG_TEMPLATE.md`
  - 필요 시 `docs/sprint-plan.md`
- 저장소 구조가 커져 주요 경로 설명이 필요해짐
  - `docs/repository-map.md` 추가 검토
- 구조적 설계나 흐름 설명이 반복적으로 필요해짐
  - `docs/architecture.md`, `docs/message-flow.md` 추가 검토

문서 갱신이 필요한데 이번 작업에서 반영하지 못했다면, 어떤 문서가 비동기 상태인지 명시적으로 남긴다.

### English

The following kinds of changes require documentation updates:

- branch strategy or collaboration workflow changes
  - update `docs/product-plan.md`
  - update `docs/technical-design.md`
- product vision, scope, agent policy, or execution mode changes
  - update `docs/product-plan.md`
- MVP scope, backlog priority, or acceptance criteria changes
  - update `docs/mvp-backlog.md`
  - update `docs/product-plan.md` and `docs/technical-design.md` when needed
- sprint order, deliverables, or sprint acceptance criteria changes
  - update `docs/sprint-plan.md`
  - update `docs/mvp-backlog.md`
  - update `docs/product-plan.md` and `docs/technical-design.md` when needed
- technical stack, runtime structure, PTY design, or state model decisions
  - update `docs/product-plan.md`
  - update `docs/technical-design.md` as well if it exists
- adding a new document or changing document responsibilities
  - update `docs/README.md`
  - update `AGENTS.md` when needed
- checklist or worklog baseline changes
  - update `docs/sprint-0-checklist.md`
  - update `docs/WORKLOG_TEMPLATE.md`
  - update `docs/sprint-plan.md` when needed
- repository growth that requires path-level guidance
  - consider adding `docs/repository-map.md`
- repeated need for structural or flow explanations
  - consider adding `docs/architecture.md` and `docs/message-flow.md`

If documentation should be updated but cannot be completed in the same task, explicitly note which document is now out of sync.

## 6. 한영 동기화 규칙 / Korean-English Sync Rules

### 한국어

이 저장소의 핵심 문서는 한국어와 영어를 함께 유지한다.

- 한국어는 사람이 읽기 좋은 기준 문서 역할을 한다.
- 영어는 에이전트가 더 안정적으로 참조하는 기준 문서 역할을 한다.
- 어느 한 언어만 먼저 수정된 상태로 오래 두지 않는다.
- 의미가 달라지는 느슨한 번역을 피하고, 두 언어가 같은 정책과 결정을 담도록 유지한다.
- 핵심 문서를 수정할 때는 가능하면 같은 커밋 또는 같은 작업 단위 안에서 두 언어를 함께 갱신한다.

### English

Core documents in this repository are maintained in both Korean and English.

- Korean is the primary human-readable view.
- English is the primary agent-readable view.
- Do not leave one language updated while the other remains stale for long.
- Avoid loose translation drift; both language sections should express the same policies and decisions.
- When editing a core document, update both language sections within the same task whenever possible.

## 7. 작업 절차 / Working Procedure

### 한국어

가능하면 아래 순서를 따른다.

1. 관련 문서를 먼저 읽는다.
2. 현재 코드와 문서가 얼마나 맞는지 빠르게 확인한다.
3. 변경 대상 코드를 수정한다.
4. 영향받는 문서를 함께 갱신한다.
5. 테스트 또는 검증을 수행한다.
6. 결과와 남은 리스크를 짧게 정리한다.

문서 갱신은 선택 사항이 아니라 구조나 동작이 바뀐 경우 작업의 일부다.

### English

Follow this sequence whenever possible:

1. read the relevant documents first
2. quickly compare the current code and docs
3. change the target code
4. update affected documents in the same task
5. run tests or verification
6. summarize the result and remaining risks

Documentation updates are not optional when structure or behavior changes.

## 8. 에이전트 행동 규칙 / Agent Behavior Rules

### 한국어

이 저장소에서 작업하는 에이전트는 다음을 따른다.

- 작업 전에 관련 문서를 먼저 읽는다.
- 문서만 믿지 말고 실제 코드도 함께 확인한다.
- 코드 변경이 문서 성격 중 하나에 영향을 주면 해당 문서를 업데이트한다.
- 어떤 문서를 갱신해야 할지 애매하면 `docs/README.md`와 이 파일의 문서 역할 정의를 기준으로 판단한다.
- 문서 간 충돌이 보이면 조용히 지나가지 말고, 코드와 최신 결정 근거를 바탕으로 정리한다.
- 큰 변경을 했으면 필요 시 새 문서를 추가하거나 문서 구조 개편을 제안한다.

### English

Agents working in this repository must:

- read relevant documents before starting
- verify against actual code, not docs alone
- update documentation when code changes affect documented behavior
- use `docs/README.md` and this file when unsure which document should be updated
- resolve documentation conflicts based on code and latest project decisions
- propose new documents or document structure updates when the repository grows

## 9. 새 문서 추가 규칙 / When To Add New Documents

### 한국어

아래 중 하나에 해당하면 새 문서 추가를 고려한다.

- 같은 설명을 반복해서 여러 번 하게 될 때
- 특정 기능 영역이 커져서 기존 문서 하나에 담기 어려울 때
- 구조 설명이나 흐름 설명이 반복적으로 필요할 때
- 구현 규칙과 설계 규칙을 분리할 필요가 생길 때

새 문서를 추가했다면 함께 수행한다.

1. `docs/README.md`에 링크를 추가한다.
2. 필요하면 `AGENTS.md`의 읽기 순서와 문서 역할을 갱신한다.
3. 기존 문서의 중복 설명은 제거하거나 링크로 대체한다.

### English

Consider adding a new document when:

- the same explanation must be repeated often
- one feature area has grown too large for a single document
- structural or flow explanations are repeatedly needed
- implementation rules and design rules should be separated

When adding a new document:

1. add it to `docs/README.md`
2. update reading order and document roles in `AGENTS.md` when needed
3. remove duplicated explanations from older documents or replace them with links

## 10. 현재 저장소에서 특히 중요한 점 / What Matters Most Right Now

### 한국어

- 이 저장소는 아직 초기 단계이므로 문서가 곧 구조다.
- `docs/`는 참고 자료가 아니라 실제 작업 진입점이다.
- 현재는 `docs/product-plan.md`가 가장 중요한 기준 문서다.
- 브랜치 전략은 현재 `master`만 존재하더라도 `git flow` 개념을 기준으로 확장 가능하게 유지한다.
- 앞으로 기술 설계와 코드 구조가 생기면 문서 체계도 함께 확장해야 한다.
- 문서 품질은 개발 속도와 에이전트 정확도에 직접 영향을 준다.

### English

- This repository is still in an early stage, so documentation is effectively part of the structure.
- `docs/` is not optional reference material; it is the real work entry point.
- Right now, `docs/product-plan.md` is the most important source of truth.
- Even though only `master` exists right now, branch strategy should stay compatible with `git flow` concepts as the repository grows.
- As technical design and code structure emerge, the documentation system should grow with them.
- Documentation quality directly affects development speed and agent accuracy.
