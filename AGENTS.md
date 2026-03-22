# AGENTS.md

## 1. 목적

이 문서는 `gtum` 저장소에서 작업하는 사람과 에이전트가 작업을 시작하기 전에 무엇을 읽고, 어떤 기준으로 판단하고, 변경이 생겼을 때 어떤 문서를 함께 갱신해야 하는지 정리한 운영 지침서다.

핵심 목표는 다음과 같다.

- 작업 시작 전에 문서로 현재 맥락을 빠르게 파악한다.
- 코드만 바꾸고 문서를 방치하지 않는다.
- 문서마다 역할을 분명히 구분해 중복과 충돌을 줄인다.
- 기능이 변할 때 관련 문서를 함께 갱신해 에이전트가 길을 잃지 않게 한다.

## 2. 기본 작업 원칙

- 이 프로젝트는 `docs/`를 작업 진입점으로 사용한다.
- 작업 전에 필요한 문서를 먼저 읽고, 추측보다 문서와 코드 근거를 우선한다.
- 변경이 구조, 흐름, 정책, 권한, 계약에 영향을 주면 관련 문서를 같은 작업 안에서 함께 갱신한다.
- 브랜치 운영은 `feature/* -> dev -> master` 흐름을 기본 협업 원칙으로 삼는다.
- Codex 컨텍스트가 길어지거나 방향성이 흔들릴 수 있다고 느껴지면 즉시 `docs/` 문서를 다시 읽고 기준을 재정렬한다.
- 각 스프린트의 마지막에는 가능한 범위의 UI E2E 검증을 추가하거나 갱신하고 결과를 확인한다.
- 각 스프린트의 마지막에는 다음 스프린트에 추가되어야 할 작업을 백로그나 스프린트 문서에 반영한다.
- MVP 검증 단계에는 단발성 확인만이 아니라 `aging test`를 포함해 시간 경과 후 안정성도 확인한다.
- 문서와 코드가 다르면 실제 코드와 최신 결정 내용을 기준으로 확인한 뒤 문서를 수정한다.
- 새로운 규칙을 만들었으면 메모로 흩어두지 말고 적절한 문서에 반영한다.
- 현재 없는 문서를 전제로 판단하지 말고, 실제 존재하는 문서를 기준으로 작업한다.

## 3. 작업 시작 전 읽기 규칙

현재 저장소 기준 기본 시작 순서는 아래와 같다.

1. `AGENTS.md`
2. `docs/DOCS_READING_ORDER.md`
3. `docs/README.md`
4. `docs/product-plan.md`
5. `docs/technical-design.md`
6. `docs/mvp-backlog.md`
7. `docs/sprint-plan.md`
8. 현재 스프린트 체크리스트 또는 최신 `WORKLOG`

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

짧게 확인해야 할 때도 최소한 아래는 먼저 읽는다.

1. `AGENTS.md`
2. `docs/DOCS_READING_ORDER.md`
3. `docs/product-plan.md`
4. `docs/technical-design.md`
5. `docs/mvp-backlog.md`
6. `docs/sprint-plan.md`

또한 컨텍스트가 길어질 때마다 아래를 반복한다.

1. `docs/DOCS_READING_ORDER.md`
2. 현재 스프린트에 해당하는 체크리스트 또는 계획 문서
3. 관련 구현 문서와 최신 작업 로그

## 4. 현재 문서별 역할

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
- `docs/release-build-ci.md`
  - 빌드, 번들, GitHub Release, CI/CD 기준 문서
- `docs/WORKLOG_TEMPLATE.md`
  - 스프린트 작업 기록 템플릿

향후 구현이 더 커지면 아래 문서들을 추가하는 것을 권장한다.

- `docs/repository-map.md`
  - 디렉토리 구조와 주요 진입점
- `docs/architecture.md`
  - 시스템 경계와 모듈 책임
- `docs/message-flow.md`
  - 요청, 이벤트, 작업 orchestration 흐름
- `docs/development-guide.md`
  - 구현 규칙과 개발 패턴

## 5. 문서 동기화 규칙

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
  - `docs/technical-design.md`
- 새로운 문서 추가 또는 문서 역할 변경
  - `docs/README.md`
  - 필요 시 `AGENTS.md`
- 체크리스트나 작업 로그 기준 변경
  - 해당 스프린트 문서
  - `docs/WORKLOG_TEMPLATE.md`
  - 필요 시 `docs/sprint-plan.md`
- 릴리스 빌드, 배포, CI/CD 흐름 변경
  - `docs/release-build-ci.md`
  - 필요 시 `docs/README.md`, `docs/technical-design.md`

문서 갱신이 필요한데 이번 작업에서 반영하지 못했다면 어떤 문서가 비동기 상태인지 명시적으로 남긴다.

## 6. 한영 동기화 규칙

`AGENTS.md`는 한국어 단일 문서로 운영한다.

다만 핵심 제품 문서와 기술 문서는 한영 동기화를 유지한다.

- `docs/product-plan.md`
- `docs/technical-design.md`
- `docs/mvp-backlog.md`
- `docs/sprint-plan.md`
- 필요 시 다른 source of truth 문서

원칙은 다음과 같다.

- 한국어는 사람이 읽기 좋은 기준 문서 역할을 한다.
- 영어는 에이전트가 안정적으로 참조하는 기준 문서 역할을 한다.
- 어느 한 언어만 먼저 수정된 상태로 오래 두지 않는다.
- 느슨한 번역을 피하고 두 언어가 같은 정책과 결정을 담도록 유지한다.

## 7. 작업 절차

가능하면 아래 순서를 따른다.

1. 관련 문서를 먼저 읽는다.
2. 현재 코드와 문서가 얼마나 맞는지 빠르게 확인한다.
3. 변경 대상 코드를 수정한다.
4. 영향받는 문서를 함께 갱신한다.
5. 테스트 또는 검증을 수행한다.
6. 결과와 남은 리스크를 짧게 정리한다.

문서 갱신은 선택 사항이 아니라 구조나 동작이 바뀐 경우 작업의 일부다.

## 8. 에이전트 행동 규칙

이 저장소에서 작업하는 에이전트는 다음을 따른다.

- 작업 전에 관련 문서를 먼저 읽는다.
- 문서만 믿지 말고 실제 코드도 함께 확인한다.
- 코드 변경이 문서 성격 중 하나에 영향을 주면 해당 문서를 업데이트한다.
- 어떤 문서를 갱신해야 할지 애매하면 `docs/README.md`와 이 파일의 문서 역할 정의를 기준으로 판단한다.
- 문서 간 충돌이 보이면 조용히 지나가지 말고 코드와 최신 결정 근거를 바탕으로 정리한다.
- 큰 변경을 했으면 필요 시 새 문서를 추가하거나 문서 구조 개편을 제안한다.

## 9. 새 문서 추가 규칙

아래 중 하나에 해당하면 새 문서 추가를 고려한다.

- 같은 설명을 반복해서 여러 번 하게 될 때
- 특정 기능 영역이 커져서 기존 문서 하나에 담기 어려울 때
- 구조 설명이나 흐름 설명이 반복적으로 필요할 때
- 구현 규칙과 설계 규칙을 분리할 필요가 생길 때

새 문서를 추가했다면 함께 수행한다.

1. `docs/README.md`에 링크를 추가한다.
2. 필요하면 `AGENTS.md`의 읽기 순서와 문서 역할을 갱신한다.
3. 기존 문서의 중복 설명은 제거하거나 링크로 대체한다.

## 10. 현재 저장소에서 특히 중요한 점

- 이 저장소는 아직 초기 단계이므로 문서가 곧 구조다.
- `docs/`는 참고 자료가 아니라 실제 작업 진입점이다.
- 현재는 `docs/product-plan.md`, `docs/technical-design.md`, `docs/sprint-plan.md`가 가장 중요한 기준 문서다.
- 브랜치 전략은 `feature/* -> dev -> master` 흐름을 유지한다.
- 앞으로 기술 설계와 코드 구조가 더 생기면 문서 체계도 함께 확장해야 한다.
- 문서 품질은 개발 속도와 에이전트 정확도에 직접 영향을 준다.
