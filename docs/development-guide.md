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

## 장문 문서 라우팅 / Long-Doc Routing

### 한국어

이 문서는 200줄을 넘는 장문 운영 문서다. 기본값은 아래 경로만 읽는 것이다.

- 기록 원칙과 문서 흡수 기준만 볼 때
  - `Recording Policy`와 `Where Durable Knowledge Goes`만 읽는다.
- 장문 문서 규칙이나 `WORKLOG` 수명 주기가 궁금할 때
  - `Long-Doc Rule`과 `WORKLOG Lifecycle`만 읽는다.
- 테스트와 검증 기록 기준만 볼 때
  - 문서 후반의 `Test And Validation Recording`만 읽는다.

### English

This document exceeds 200 lines. Read only the matching route first.

- when you only need recording policy or doc-absorption rules
  - read `Recording Policy` and `Where Durable Knowledge Goes`
- when you need long-doc or `WORKLOG` lifecycle rules
  - read `Long-Doc Rule` and `WORKLOG Lifecycle`
- when you only need validation-recording rules
  - jump to `Test And Validation Recording`

## 장문 문서 규칙 / Long-Doc Rule

### 한국어

기준 문서가 200줄을 넘으면 아래 둘 중 하나를 반드시 만족해야 한다.

1. 문서 상단 80줄 안에 `Long-Doc Routing` 섹션을 두고, 어떤 질문이면 어디까지만 읽는지 분기한다.
2. 내용이 안정적인 하위 도메인으로 나뉘면 별도 문서로 분리하고 `README`, `DOCS_READING_ORDER`에 반영한다.

추가 원칙은 다음과 같다.

- 200줄 초과 문서는 기본값이 `전체 통독`이 아니다.
- 400줄을 넘고 서로 다른 도메인이 섞이면 분리를 우선 검토한다.
- 장문 문서를 분리하거나 라우팅했으면 라우팅 문서도 함께 갱신한다.

### English

When a canonical doc exceeds 200 lines, it must satisfy at least one of these:

1. include a `Long-Doc Routing` section within the top 80 lines that tells readers which path to follow for which question
2. split stable subdomains into separate docs and reflect that split in `README` and `DOCS_READING_ORDER`

Additional rules:

- a 200-plus-line doc should not default to full rereads
- once a doc exceeds 400 lines and mixes distinct domains, splitting should be preferred
- whenever a long doc is routed or split, the routing docs must be updated too

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

## Agent / User Terminal Boundary

This is a hard implementation and validation rule.

- The center workbench terminal is exclusively user-owned.
- Agent-tab requests, permission cards, and approved agent work must never create, select, rename, split, focus, write into, close, or otherwise mutate user-visible center terminal tabs or panes.
- Do not route agent approval through `create_terminal_session`, `create_terminal_session_with_command`, `execute_terminal_session_command`, or a future equivalent when the result appears in the center workbench terminal.
- Approved agent work may run only through the separately designed agent-owned background execution contract exposed by `create_agent_job`, `read_agent_job_logs`, and `cancel_agent_job`; its state is shown in the right agent workspace and task history.
- If that agent-owned execution contract is missing, unsupported, or unsafe for the proposed command, show an explicit unavailable/manual-run state and leave the user's terminal untouched.
- User-owned terminal input may call `execute_terminal_session_command` only from center terminal UI actions initiated by the user.
- File edits must use `write_project_file` or `apply_project_patch` with project-root checks and content-hash guards instead of synthetic editor state. Multi-file patch application must validate every edit before the first write so stale or invalid edits cannot leave a partial patch on disk.
- App-first validation must prove this boundary in the installed/native app. Browser or service tests may support the finding, but they are not sufficient evidence for this boundary.

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

1. validate the installable Tauri desktop path first when the change affects release readiness, native runtime behavior, persistence, or provider login
2. add automation under `tests/` whenever possible
3. reflect coverage expectations in canonical docs
4. record non-automatable real-device validation in [`MVP_VALIDATION_NOTES.md`](./MVP_VALIDATION_NOTES.md)

`WORKLOG` is not the default place for validation evidence.
