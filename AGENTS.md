# AGENTS.md

## 1. 목적

이 문서는 `gtum` 저장소의 짧은 부트스트랩 라우터다.

목표는 세 가지다.

- 작업 시작 전에 최소한의 문서만 읽고 빠르게 방향을 잡는다.
- 어떤 작업이 어떤 source of truth 문서를 읽어야 하는지 라우팅한다.
- 구조, 정책, 계약이 바뀔 때 어떤 문서를 함께 갱신해야 하는지 놓치지 않게 한다.

상세 정책은 이 문서에 길게 반복하지 않고, 필요한 문서로 바로 라우팅한다.

## 2. 꼭 지킬 기본 원칙

- 이 프로젝트의 진입점은 항상 `docs/`다.
- 기본값은 `전체 문서 재독`이 아니라 `최소 읽기 팩 + 필요한 문서만 추가 읽기`다.
- 의미 있는 작업은 먼저 `planner`, `orchestrator`, `designer`, `frontend`, `backend`, `QA`, `tester` 역할로 팀빌딩한다.
- 의미 있는 작업은 현재 스프린트 문서, 검증 메모, task history를 함께 검토해 지금까지 밟아온 경로와 반복 문제를 먼저 파악한다.
- 구조, 흐름, 정책, 권한, 계약이 바뀌면 관련 문서를 같은 작업 안에서 함께 갱신한다.
- 문서와 코드가 다르면 실제 코드와 최신 결정을 기준으로 문서를 수정한다.
- 브랜치 운영 기본값은 `feature/* -> dev -> master`다.
- `WORKLOG`는 진행 중 스프린트의 임시 추적 문서로만 사용하고, 스프린트 종료 시 source-of-truth 문서에 흡수한 뒤 삭제한다.

## 3. 최소 읽기 팩

작업 시작 시 기본으로 먼저 읽는 문서는 아래 세 개다.

1. `AGENTS.md`
2. `docs/README.md`
3. `docs/DOCS_READING_ORDER.md`

그 다음에는 아래 라우팅 표를 보고 필요한 문서만 추가로 읽는다.

## 4. 문서 라우팅

- 제품 비전, 범위, 핵심 가치, provider 정책, 멀티 에이전트 제품 방향
  - `docs/product-plan.md`
- 아키텍처, 런타임 책임, 플랫폼 전략, auth 구조, contract 변경
  - `docs/technical-design.md`
- 현재 구현 구조, 모듈 책임, 저장 경계
  - `docs/architecture.md`
- 주요 데이터 흐름, request envelope, approval/restore 경계
  - `docs/message-flow.md`
- 역할 분리, 서브에이전트 팀빌딩, 파일 소유권, handoff, `planner`, `designer`, `QA`, `tester` 분리
  - `docs/agent-team-topology.md`
- 구현 규칙, 문서 흡수 기준, 검증 기록 기준
  - `docs/development-guide.md`
- 지금 무엇을 먼저 만들지, 현재 우선순위, 스프린트 산출물과 종료 기준
  - `docs/sprint-plan.md`
- MVP 범위, 우선순위, 완료조건, 제외 범위
  - `docs/mvp-backlog.md`
- UI 레퍼런스와 프론트엔드 품질 기준
  - `docs/frontend-design-benchmarks.md`
- 릴리스, 빌드, 배포, CI/CD
  - `docs/release-build-ci.md`
- 최신 실행 맥락, 체크리스트, 검증 근거
  - 현재 스프린트 체크리스트 또는 진행 중 `WORKLOG`
  - `docs/MVP_VALIDATION_NOTES.md`
  - UI의 task history

## 5. 문서 동기화 라우팅

아래 변경이 생기면 함께 갱신할 문서는 다음과 같다.

- 제품 비전, 범위, 에이전트 정책, 실행 모드 변경
  - `docs/product-plan.md`
- 기술 스택, 런타임 구조, PTY 설계, 플랫폼 전략, 상태 계약 변경
  - `docs/technical-design.md`
- 현재 구현 아키텍처, 모듈 책임, 저장 경계 변경
  - `docs/architecture.md`
- request payload, approval 흐름, restore 흐름 변경
  - `docs/message-flow.md`
- 멀티 에이전트 역할 분리, 팀빌딩 기본값, handoff 규칙 변경
  - `docs/agent-team-topology.md`
  - `docs/README.md`
  - `docs/DOCS_READING_ORDER.md`
  - 필요 시 `docs/sprint-plan.md`
- 개발 규칙, 기록 원칙, 문서 흡수 정책 변경
  - `docs/development-guide.md`
  - `docs/README.md`
- MVP 범위, 우선순위, 완료조건 변경
  - `docs/mvp-backlog.md`
  - 필요 시 `docs/product-plan.md`, `docs/technical-design.md`
- 스프린트 순서, 산출물, 완료조건 변경
  - `docs/sprint-plan.md`
  - `docs/mvp-backlog.md`
- 릴리스, 빌드, 배포, CI/CD 변경
  - `docs/release-build-ci.md`
  - 필요 시 `docs/README.md`, `docs/technical-design.md`
- 새로운 문서 추가 또는 문서 역할 변경
  - `docs/README.md`
  - 필요 시 `AGENTS.md`

이번 작업에서 못 고친 문서가 있으면 비동기 상태를 명시적으로 남긴다.

## 6. 멀티에이전트 기본값

- 기본 역할은 `planner + orchestrator + designer + frontend + backend + QA + tester`다.
- `planner`는 제품 목표, 다음 스프린트 범위, 과거 작업 경로, 스프린트 문서, 검증 메모, task history를 읽고 문제점과 개선 항목을 정리한다.
- `orchestrator`는 역할 분리, 파일 소유권, handoff, 최종 통합을 맡는다.
- `designer`는 `VS Code`, `conductor`, `cmux` 레퍼런스를 바탕으로 정보 계층, 코드 읽기 surface, 상호작용 디자인, 와이어프레임과 작업 경로 가시화 방향을 정리한다.
- `QA`는 완료조건, 품질 게이트, 회귀 체크리스트를 맡는다.
- `tester`는 E2E, 재현 절차, aging 관점 검증을 맡는다.
- 같은 파일을 여러 역할이 동시에 수정하지 않도록 먼저 분해한다.
- 상세 규칙은 `docs/agent-team-topology.md`를 기준으로 따른다.

## 7. 작업 순서

1. 최소 읽기 팩을 읽는다.
2. 라우팅 표를 보고 필요한 문서만 추가로 읽는다.
3. `planner`와 `orchestrator` 기준으로 역할과 파일 소유권을 먼저 정한다.
4. 현재 코드와 문서 기준선이 맞는지 빠르게 확인하고, 현재 스프린트 문서, 진행 중 `WORKLOG`, task history, 검증 메모에서 이미 시도한 것과 실패 패턴을 함께 정리한다.
5. 변경 대상을 수정한다.
6. 영향받는 문서를 함께 갱신한다.
7. 테스트 또는 검증을 수행한다.
8. 결과와 남은 리스크를 짧게 정리한다.

## 8. 한영 동기화 원칙

`AGENTS.md`는 한국어 단일 문서로 운영한다.

다만 아래 핵심 문서는 한국어와 영어를 함께 유지한다.

- `docs/product-plan.md`
- `docs/technical-design.md`
- `docs/mvp-backlog.md`
- `docs/sprint-plan.md`
- `docs/agent-team-topology.md`

## 9. 현재 저장소에서 특히 중요한 점

- 이 저장소는 아직 초기 단계라 문서가 곧 구조다.
- `docs/`는 참고 자료가 아니라 실제 작업 진입점이다.
- 항상 `AGENTS.md` 하나에 모든 정책을 밀어넣지 말고, 필요한 문서로 라우팅하는 구조를 유지한다.
- 현재 가장 자주 기준이 되는 source of truth는 `docs/product-plan.md`, `docs/technical-design.md`, `docs/architecture.md`, `docs/message-flow.md`, `docs/sprint-plan.md`다.
