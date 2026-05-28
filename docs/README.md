# 문서 / Docs

- [제품 기획서 / Product Plan](./product-plan.md)
- [기술 설계서 / Technical Design](./technical-design.md)
- [아키텍처 / Architecture](./architecture.md)
- [메시지 흐름 / Message Flow](./message-flow.md)
- [개발 가이드 / Development Guide](./development-guide.md)
- [MVP 백로그 / MVP Backlog](./mvp-backlog.md)
- [스프린트 계획 / Sprint Plan](./sprint-plan.md)
- [Sprint 15 디자인 시안 / Sprint 15 Design Concepts](./design-concepts-sprint-15.md)
- [디자인 시스템 / Design System](./design-system.md)
- [왼쪽 메뉴 뷰 설계 / Left Menu View Plan](./left-menu-views.md)
- [UI/UX 개선안과 와이어프레임 / UI/UX Improvements and Wireframes](./ui-ux-wireframes.md)
- [프론트엔드 디자인 벤치마크 / Frontend Design Benchmarks](./frontend-design-benchmarks.md)
- [브랜드 아이덴티티 / Brand Identity](./brand-identity.md)
- [Sprint 16 로고 결정 / Sprint 16 Logo Decision](./logo-concepts-sprint-16.md)
- [문서 읽기 순서 / Docs Reading Order](./DOCS_READING_ORDER.md)
- [에이전트 팀 토폴로지 / Agent Team Topology](./agent-team-topology.md)
- [작업 로그 템플릿 / Worklog Template](./WORKLOG_TEMPLATE.md)
- [새 제품 디자인 구현 계획 / New Product Design Implementation Plan](./superpowers/plans/2026-05-28-new-product-design-implementation.md)
- [릴리스, 빌드, CI / Release, Build, and CI](./release-build-ci.md)
- [MVP 검증 메모 / MVP Validation Notes](./MVP_VALIDATION_NOTES.md)
- [에이전트 운영 가이드 / Agent Operating Guide](../AGENTS.md)

## 빠른 시작 / Quick Start

- 시작 순서는 `AGENTS.md -> docs/README.md -> docs/DOCS_READING_ORDER.md`다.
- 그 다음에는 모든 문서를 펼쳐 읽지 말고, 현재 작업에 필요한 문서만 라우팅해서 읽는다.
- 의미 있는 작업은 항상 `planner + orchestrator + designer + frontend + backend + QA + tester` 기준으로 먼저 팀빌딩한다.

## 빠른 라우팅 / Quick Routes

- 제품 비전, 범위, 핵심 가치, provider 정책
  - [제품 기획서 / Product Plan](./product-plan.md)
- 아키텍처, 런타임 책임, 플랫폼 전략, auth와 contract
  - [기술 설계서 / Technical Design](./technical-design.md)
- 현재 구현 구조, 모듈 책임, 상태 저장 경계
  - [아키텍처 / Architecture](./architecture.md)
- request payload, approval, restore, 주요 사용자 흐름
  - [메시지 흐름 / Message Flow](./message-flow.md)
- 역할 분리, 서브에이전트 팀빌딩, handoff, `planner`, `designer`, `QA`, `tester` 분리
  - [에이전트 팀 토폴로지 / Agent Team Topology](./agent-team-topology.md)
- 구현 규칙, 문서 흡수 기준, 검증 기록 기준
  - [개발 가이드 / Development Guide](./development-guide.md)
- 지금 무엇을 먼저 만들지, 현재 우선순위, 스프린트 종료 기준
  - [스프린트 계획 / Sprint Plan](./sprint-plan.md)
  - [MVP 백로그 / MVP Backlog](./mvp-backlog.md)
  - [새 제품 디자인 구현 계획 / New Product Design Implementation Plan](./superpowers/plans/2026-05-28-new-product-design-implementation.md)
- UI 참고 기준
  - [디자인 시스템 / Design System](./design-system.md)
  - [프론트엔드 디자인 벤치마크 / Frontend Design Benchmarks](./frontend-design-benchmarks.md)
  - [Sprint 15 디자인 시안 / Sprint 15 Design Concepts](./design-concepts-sprint-15.md)
  - [왼쪽 메뉴 뷰 설계 / Left Menu View Plan](./left-menu-views.md)
- 로고, 아이콘, favicon, 브랜드 사용 원칙
  - [브랜드 아이덴티티 / Brand Identity](./brand-identity.md)
  - [Sprint 16 로고 결정 / Sprint 16 Logo Decision](./logo-concepts-sprint-16.md)
- 릴리스, 빌드, 배포, CI/CD
  - [릴리스, 빌드, CI / Release, Build, and CI](./release-build-ci.md)
- 최신 실행 맥락과 체크리스트
  - 현재 스프린트 체크리스트 또는 진행 중 `WORKLOG`, [MVP 검증 메모 / MVP Validation Notes](./MVP_VALIDATION_NOTES.md), UI task history를 읽어 이미 수행한 경로, 실패, 보류, 다음 개선 포인트를 먼저 확인한다.

## 문서 역할 / What To Read When

- [문서 읽기 순서 / Docs Reading Order](./DOCS_READING_ORDER.md)
  - 길을 잃었을 때, 컨텍스트가 길어졌을 때, 어떤 문서를 읽을지 고를 때 읽는다.
- [제품 기획서 / Product Plan](./product-plan.md)
  - 제품 비전, 핵심 가치, 에이전트 정책, 지원 플랫폼 기준을 다룰 때 읽는다.
- [기술 설계서 / Technical Design](./technical-design.md)
  - `src-tauri/`, provider/auth, command contract, 플랫폼 처리 구조를 다룰 때 읽는다.
- [아키텍처 / Architecture](./architecture.md)
  - 현재 구현 구조, 모듈 책임, 저장 위치, command boundary를 파악할 때 읽는다.
- [메시지 흐름 / Message Flow](./message-flow.md)
  - 프로젝트 열기, file focus, provider connect, request, approval, restore 흐름을 볼 때 읽는다.
- [개발 가이드 / Development Guide](./development-guide.md)
  - 구현 규칙, 문서 흡수 기준, 진행 중 `WORKLOG`의 생성/삭제 기준을 판단할 때 읽는다.
- [MVP 백로그 / MVP Backlog](./mvp-backlog.md)
  - MVP 범위, 완료조건, 우선순위, 제외 범위를 확인할 때 읽는다.
- [스프린트 계획 / Sprint Plan](./sprint-plan.md)
  - 다음 작업 순서, 현재 스프린트 목표, 종료 조건, 직전 스프린트 경로를 다음 개선안으로 바꿀 때 읽는다.
- [새 제품 디자인 구현 계획 / New Product Design Implementation Plan](./superpowers/plans/2026-05-28-new-product-design-implementation.md)
  - `/Users/kwon/Downloads/test (1)` 새 디자인 시안을 실제 구현 스프린트로 나눠 실행할 때 읽는다.
- [에이전트 팀 토폴로지 / Agent Team Topology](./agent-team-topology.md)
  - 서브에이전트 팀빌딩, 역할 소유권, handoff, `planner`, `designer`, `QA`, `tester`가 작업 경로와 문제점을 어떻게 개선안으로 바꾸는지 정할 때 읽는다.
- [프론트엔드 디자인 벤치마크 / Frontend Design Benchmarks](./frontend-design-benchmarks.md)
  - UI 구조, 정보 계층, 인터랙션, 금지 패턴을 검토할 때 읽는다.
- [디자인 시스템 / Design System](./design-system.md)
  - UI 토큰, 색상, 반경, 타이포그래피, 컴포넌트 상태 표현을 바꿀 때 읽는다.
- [Sprint 15 디자인 시안 / Sprint 15 Design Concepts](./design-concepts-sprint-15.md)
  - 현재 UI가 왜 헷갈리는지 설명하고, 다음 메인 화면 구조의 선택안을 고를 때 읽는다.
- [왼쪽 메뉴 뷰 설계 / Left Menu View Plan](./left-menu-views.md)
  - `프로젝트`, `탐색기`, `소스제어`, `아웃라인`, `설정`의 view별 정보 구조와 interaction을 정할 때 읽는다.
- [브랜드 아이덴티티 / Brand Identity](./brand-identity.md)
  - 로고, 아이콘, favicon, 시각 언어를 다룰 때 읽는다.
- [Sprint 16 로고 결정 / Sprint 16 Logo Decision](./logo-concepts-sprint-16.md)
  - 로고 선택 근거와 대안 비교를 다시 확인할 때 읽는다.
- [릴리스, 빌드, CI / Release, Build, and CI](./release-build-ci.md)
  - 릴리스, 번들, 태그, 배포, CI/CD를 다룰 때 읽는다.

## 문서 갱신 맵 / Documentation Sync Map

- 제품 비전, 범위, 에이전트 정책 변경
  - `product-plan`
- 런타임 구조, auth/provider, 플랫폼 처리, contract 변경
  - `technical-design`
- 현재 구현 구조, 모듈 책임, 저장 경계 변경
  - `architecture`
- request payload, approval 경계, restore 흐름 변경
  - `message-flow`
- 개발 규칙, 기록 원칙, 문서 흡수 정책 변경
  - `development-guide`
- MVP 우선순위, 완료조건, 제외 범위 변경
  - `mvp-backlog`
- 스프린트 순서, 다음 작업, 체크리스트 변경
  - `sprint-plan`
  - 관련 체크리스트
- 멀티 에이전트 운영 모델, 라우팅 규칙 변경
  - `agent-team-topology`
  - `DOCS_READING_ORDER`
  - `README`
- 새 문서 추가 또는 문서 역할 변경
  - `README`
  - 필요 시 `AGENTS.md`
- UI 토큰, 앱 셸 시각 기준, 주요 컴포넌트 상태 표현 변경
  - `design-system`
  - `frontend-design-benchmarks`
  - 필요 시 `brand-identity`

## Working Rule

- Source-of-truth docs use English as the single canonical documentation language.
- Do not duplicate the same policy, plan, or decision in Korean and English; this wastes context and creates drift.
- Existing bilingual sections are legacy content and should be migrated to English-only when materially edited.
- Korean may still be used in user conversation, temporary notes, and UI copy when appropriate.
- 컨텍스트가 길어질 때마다 `docs/DOCS_READING_ORDER.md`를 기준으로 다시 문서를 읽는다.
- 기본값은 전체 문서 재독이 아니라 `AGENTS.md + docs/README.md + docs/DOCS_READING_ORDER.md`를 먼저 읽고 필요한 문서만 추가로 읽는 것이다.
- 의미 있는 작업은 항상 서브에이전트를 포함한 멀티 에이전트 팀빌딩으로 시작하며, 기본 편성은 `planner + orchestrator + designer + frontend + backend + QA + tester`다.
- `planner`와 `designer`는 매 스프린트마다 작업 경로 요약, 문제점, 다음 개선안을 문서로 남긴다.
- 진행 중 스프린트는 `WORKLOG`로 추적할 수 있지만, 닫힌 스프린트의 `WORKLOG`는 source-of-truth 문서에 흡수한 뒤 삭제한다.
- 200줄을 넘는 기준 문서는 상단 `Long-Doc Routing`만 먼저 읽고 필요한 범위만 내려가는 것을 기본값으로 한다.

## 현재 결정 / Current Decisions

- Documentation language policy is English-only for source-of-truth docs; existing bilingual content is legacy and should be migrated opportunistically.
- 기본 기술 스택은 `Tauri + Rust + React + TypeScript + Vite + xterm.js + Zustand`
- 기본 개발 운영 모델은 서브에이전트 기반 멀티 에이전트 구조이며, `planner`, `orchestrator`, `designer`, `frontend`, `backend`, `QA`, `tester` 역할 분리를 우선 사용한다
- 지원 플랫폼은 `Ubuntu + Windows + macOS`이며, 첫 실사용 기준은 `Windows`, 주요 개발 기준 환경은 `Ubuntu`다
- 에이전트 제공자는 우선 `Codex + Claude`이며, 첫 실사용 `Codex` 경로의 source of truth는 `OAuth/session login`이다
- 현재 저장소의 `OPENAI_API_KEY` 기반 bridge는 개발용 임시 브리지로만 취급하며, 최종 사용자 기본 경로로 간주하지 않는다
- 현재 Sprint 5 기준으로 task history, workspace restore, execution mode, aging test까지 포함한 MVP 흐름이 구현되어 있다
- Sprint 7에서는 폴더 선택기 중심 프로젝트 열기, UI 정보 구조 재배치, provider auth mock/prototype/real 구분이 반영되어 있다
- Sprint 10에서는 개발용 `Codex` bridge와 diagnostics 보강이 반영되어 있지만, 이는 최종 auth 방향이 아니라 임시 연결 슬라이스다
- Sprint 11 첫 슬라이스에서는 `Codex CLI`의 ChatGPT session과 `codex exec`를 활용해 API key가 아닌 session-backed real path를 앱 안에서 시작할 수 있게 한다
- Sprint 12에서는 read-only code surface와 selected-file agent context가 메인 workspace에 반영되어 있다
- Sprint 13에서는 line anchor, selected-file restore 강화, binary/large-file bounded fallback을 기준으로 editor-like surface를 더 깊게 다듬는다
- Sprint 14에서는 `FSD` 기준의 `app / widgets / features / shared` 구조로 프론트 orchestration을 분해하고, `src/App.tsx`를 얇은 entrypoint로 낮춘다
- Sprint 15에서는 `left rail + split workbench + agent workspace`를 기준으로 `Mission Control`형 workbench baseline을 잠근다
- Sprint 16에서는 `Concept A` 로고 방향과 왼쪽 메뉴 5개 view baseline을 기준 문서로 확정한다
- 현재 앱 UI 디자인 시스템은 `/Users/kwon/Downloads/test (1)` 발전 시안 기준의 `cool dark desktop shell + green execution accent`, 좌우 dock resize, compact agent model row를 기본값으로 사용한다
- Sprint 17부터는 `/Users/kwon/Downloads/test (1)` 새 제품 디자인 시안이 기존 구현과 충돌할 때 우선하며, 상세 실행 순서는 [새 제품 디자인 구현 계획 / New Product Design Implementation Plan](./superpowers/plans/2026-05-28-new-product-design-implementation.md)을 따른다
- Telegram은 현재 post-MVP 브리지 프로토타입 단계로, 상태 리포트 초안, 런타임 기반 브리지 상태, 제한된 원격 명령 승인 흐름을 앱 안에서 검증한다
- 브랜치 전략은 `feature/* -> dev -> master` 흐름을 따른다
- 릴리스와 배포 정책은 `master` 머지 시 자동 GitHub Release를 생성하는 방향으로 `docs/release-build-ci.md`를 기준으로 한다
- 스프린트 종료 시 `Playwright` 기반 UI E2E와 다음 스프린트 작업 추가를 함께 진행한다
- 현재 구현 구조와 흐름은 `architecture`, `message-flow`, `development-guide`를 통해 유지하고, 닫힌 스프린트의 `WORKLOG`는 저장소에 남기지 않는다

## Sprint Trace

- 진행 중 스프린트에서는 임시 `WORKLOG`를 둘 수 있다.
- 스프린트 종료 시 지속 정보는 관련 기준 문서에 흡수하고, 해당 `WORKLOG`와 오래된 체크리스트는 삭제한다.
