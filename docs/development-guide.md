# gtum 개발 가이드 / Development Guide

## 문서 목적 / Document Purpose

### 한국어

이 문서는 `gtum`에서 구현 규칙, 문서 흡수 기준, 검증 기록 기준을 정리하는 운영용 source of truth다.

목적은 다음과 같다.

- 무엇을 `git`에 맡기고 무엇을 문서에 남길지 구분한다.
- 아키텍처, 규칙, 데이터 흐름 같은 지속 정보를 어디에 흡수할지 정한다.
- `WORKLOG`를 진행 중 스프린트의 임시 추적 문서로 제한하고, 종료 후 삭제하는 수명 주기를 고정한다.

### English

This document is the source of truth for implementation rules, documentation absorption rules, and validation-recording policy in `gtum`.

Its goals are:

- define what belongs in `git` versus in docs
- define where durable knowledge such as architecture, rules, and data flow should be absorbed
- prevent `WORKLOG`s from growing back into active source-of-truth documents

## 언제 읽는 문서인가 / When To Read This Document

### 한국어

아래 상황이면 이 문서를 읽는다.

- 새로운 규칙, 개발 절차, 문서 정책을 정하거나 바꿀 때
- 어떤 변경을 어떤 문서에 반영해야 할지 애매할 때
- 진행 중 `WORKLOG`를 언제 만들고 언제 삭제할지 판단해야 할 때

### English

Read this document when:

- you are defining or changing development rules, process rules, or doc policy
- it is unclear which canonical doc should absorb a change
- you need to decide when to create, absorb, or delete an in-progress `WORKLOG`

## 기록 원칙 / Recording Policy

### 한국어

기록의 기본 분리는 아래처럼 유지한다.

- `git`
  - 시간순 변경 이력
  - 무엇을 바꿨는지
- 진행 중 `WORKLOG`
  - 현재 스프린트에서 어떤 순서로 시도하고 있는지
  - 아직 흡수되지 않은 작업 메모와 추적 정보
- source-of-truth 문서
  - 왜 그렇게 바꿨는지
  - 현재 구조와 규칙이 무엇인지
  - 다음 사람이 다시 읽어야 할 지속 정보
- 검증 문서와 테스트
  - 어떤 검증을 했는지
  - 무엇이 통과했고 무엇이 아직 비어 있는지

즉, 기본값은 `진행 중엔 WORKLOG로 추적하고, 종료 시 기준 문서에 흡수한 뒤 삭제`다.

### English

The default split is:

- `git`
  - chronological change history
  - what changed
- active `WORKLOG`
  - the sequence of attempts during the current sprint
  - temporary tracking notes that have not yet been absorbed
- source-of-truth docs
  - why it changed
  - what the current structure and rules now are
  - durable knowledge that later workers must reread
- validation docs and tests
  - what was verified
  - what passed and what still remains uncovered

The default is therefore `track with an active WORKLOG during the sprint, then absorb into canonical docs and delete it at sprint close`.

## 어떤 정보를 어디에 흡수할지 / Where Durable Knowledge Goes

### 한국어

- 제품 방향, 사용자 문제, provider 정책
  - [`product-plan.md`](./product-plan.md)
- 기술 스택, 경계, 플랫폼 전략, auth 방향
  - [`technical-design.md`](./technical-design.md)
- 현재 구현 구조, 모듈 책임, 저장 경계
  - [`architecture.md`](./architecture.md)
- 요청/승인/restore 같은 주요 데이터 흐름
  - [`message-flow.md`](./message-flow.md)
- 팀 운영 규칙, handoff, 역할 분리
  - [`agent-team-topology.md`](./agent-team-topology.md)
- 작업 순서, 다음 스프린트, 우선순위
  - [`sprint-plan.md`](./sprint-plan.md)
  - [`mvp-backlog.md`](./mvp-backlog.md)
- UI 원칙, 정보 계층, 코드 읽기 surface
  - [`frontend-design-benchmarks.md`](./frontend-design-benchmarks.md)
  - 필요 시 [`ui-ux-wireframes.md`](./ui-ux-wireframes.md)
- 검증 근거와 빈 테스트 영역
  - [`MVP_VALIDATION_NOTES.md`](./MVP_VALIDATION_NOTES.md)
  - `tests/e2e/*`

### English

- product direction, user problem, provider policy
  - [`product-plan.md`](./product-plan.md)
- tech stack, boundaries, platform strategy, auth direction
  - [`technical-design.md`](./technical-design.md)
- current implementation structure, module ownership, persistence boundaries
  - [`architecture.md`](./architecture.md)
- key data flows such as request, approval, and restore
  - [`message-flow.md`](./message-flow.md)
- team operation rules, handoff, role split
  - [`agent-team-topology.md`](./agent-team-topology.md)
- build order, next sprint, priorities
  - [`sprint-plan.md`](./sprint-plan.md)
  - [`mvp-backlog.md`](./mvp-backlog.md)
- UI principles, hierarchy, code-reading surface
  - [`frontend-design-benchmarks.md`](./frontend-design-benchmarks.md)
  - [`ui-ux-wireframes.md`](./ui-ux-wireframes.md) when needed
- validation evidence and uncovered test surface
  - [`MVP_VALIDATION_NOTES.md`](./MVP_VALIDATION_NOTES.md)
  - `tests/e2e/*`

## WORKLOG 수명 주기 / WORKLOG Lifecycle

### 한국어

앞으로 `WORKLOG`는 진행 중 스프린트의 임시 추적 문서다.

원칙은 다음과 같다.

- 스프린트가 시작되면 필요 시 `WORKLOG`를 만들어 진행 경로를 추적한다.
- 스프린트가 진행되는 동안만 `WORKLOG`를 유지한다.
- 스프린트가 닫히기 전에 지속 정보는 source-of-truth 문서와 검증 문서에 흡수한다.
- 흡수와 검증 반영이 끝나면 해당 `WORKLOG`는 삭제한다.
- 닫힌 스프린트의 `WORKLOG`가 저장소에 남아 있으면 문서 부채로 본다.

### English

Going forward, a `WORKLOG` is a temporary tracking document for an active sprint.

The rules are:

- create a `WORKLOG` when an active sprint needs traceability
- keep it only while the sprint is in progress
- before the sprint closes, absorb durable knowledge into source-of-truth docs and validation docs
- delete the `WORKLOG` once absorption and validation updates are complete
- if a closed sprint `WORKLOG` remains in the repository, treat it as documentation debt

## 스프린트 종료 시 필수 출력 / Required Sprint Outputs

### 한국어

각 스프린트가 끝나면 아래를 남긴다.

1. 코드 변경
2. 관련 source-of-truth 문서 갱신
3. 테스트 또는 검증 결과
4. 다음 스프린트 입력
5. 진행 중 `WORKLOG`가 있었다면 흡수 후 삭제

상황에 따라 추가한다.

- architecture 변화
  - `architecture.md`
- flow 변화
  - `message-flow.md`
- 규칙 변화
  - `development-guide.md`
- 제품/백로그 변화
  - `product-plan.md`, `mvp-backlog.md`, `sprint-plan.md`

### English

Each sprint should leave behind:

1. code changes
2. updated source-of-truth docs
3. test or validation results
4. next-sprint inputs
5. deletion of the active `WORKLOG` if one existed

Add these when needed:

- architecture changes
  - `architecture.md`
- flow changes
  - `message-flow.md`
- rule changes
  - `development-guide.md`
- product or backlog changes
  - `product-plan.md`, `mvp-backlog.md`, `sprint-plan.md`

## 문서 동기화 결정 규칙 / Doc Sync Decision Rule

### 한국어

변경 내용을 보고 아래처럼 판단한다.

- "왜 이 제품을 이렇게 만드는가"가 바뀌었는가
  - `product-plan`
- "현재 구조와 책임이 어떻게 나뉘는가"가 바뀌었는가
  - `architecture`
- "데이터가 어디서 어디로 어떻게 흐르는가"가 바뀌었는가
  - `message-flow`
- "어떤 규칙으로 구현하고 기록하는가"가 바뀌었는가
  - `development-guide`
- "다음에 무엇을 해야 하는가"가 바뀌었는가
  - `sprint-plan`, `mvp-backlog`

애매하면 여러 문서를 동시에 갱신하고, 중복 설명은 링크로 정리한다.

### English

Use these questions:

- did the answer to "why do we build the product this way" change
  - `product-plan`
- did the answer to "how is the current structure and ownership split" change
  - `architecture`
- did the answer to "how does data move through the system" change
  - `message-flow`
- did the answer to "what implementation and recording rules do we follow" change
  - `development-guide`
- did the answer to "what should we do next" change
  - `sprint-plan`, `mvp-backlog`

If it is ambiguous, update more than one canonical doc and reduce repeated explanation through links.

## 테스트와 검증 기록 / Test And Validation Recording

### 한국어

검증 결과는 아래 순서로 남긴다.

1. 가능한 한 `tests/`에 자동화 추가
2. 자동화 범위 요약을 기준 문서에 반영
3. 자동화할 수 없는 실기 검증은 [`MVP_VALIDATION_NOTES.md`](./MVP_VALIDATION_NOTES.md)에 남김

`WORKLOG`는 검증 기록의 기본 장소가 아니다.

### English

Record verification in this order:

1. add automation under `tests/` whenever possible
2. reflect coverage expectations in canonical docs
3. record non-automatable real-device validation in [`MVP_VALIDATION_NOTES.md`](./MVP_VALIDATION_NOTES.md)

`WORKLOG` is not the default place for validation evidence.
