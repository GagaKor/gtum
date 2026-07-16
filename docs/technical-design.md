# gtum 기술 설계서 / Technical Design

## 문서 목적 / Document Purpose

### 한국어

이 문서는 `gtum`의 1차 구현을 위한 기술 설계 기준 문서다.

이 문서의 목적은 다음과 같다.

- 제품 기획을 실제 구현 구조로 구체화한다.
- 프론트엔드와 런타임의 책임을 나눈다.
- 크로스 플랫폼 대응 방식을 미리 정의한다.
- 에이전트 실행, 인증, 터미널 세션 관리의 경계를 정한다.

### English

This document is the technical design reference for the first implementation of `gtum`.

Its purpose is to:

- translate the product plan into implementation structure
- divide responsibility between frontend and runtime layers
- define cross-platform handling up front
- establish boundaries for agent execution, authentication, and terminal session management

## 언제 읽는 문서인가 / When To Read This Document

### 한국어

아래 상황이면 이 문서를 읽는다.

- 아키텍처, 런타임 책임, 플랫폼 전략, auth 구조를 확인해야 할 때
- Tauri command, 상태 계약, PTY, filesystem, provider adapter 같은 기술 경계를 바꿀 때

### English

Read this document when:

- you need to confirm architecture, runtime ownership, platform strategy, or auth structure
- you are changing technical boundaries such as Tauri commands, state contracts, PTY, filesystem, or provider adapters

## 장문 문서 라우팅 / Long-Doc Routing

### 한국어

이 문서는 200줄을 넘는 장문 기술 문서다. 기본값은 전체 통독이 아니라 아래 경로만 읽는 것이다.

- 현재 구현 구조와 저장 경계가 궁금할 때
  - `architecture.md`를 먼저 읽는다.
- request, approval, restore, provider request envelope이 궁금할 때
  - `message-flow.md`를 먼저 읽는다.
- 구현 규칙, 문서 흡수, `WORKLOG` 수명 주기가 궁금할 때
  - `development-guide.md`를 먼저 읽는다.
- Tauri command, provider/auth, PTY, cross-platform 정책처럼 기술 경계 자체를 바꿀 때
  - 그때만 이 문서를 계속 읽는다.

### English

This document exceeds 200 lines. Do not reread it fully by default. Use one route below instead.

- when you need current implementation structure or persistence boundaries
  - read `architecture.md` first
- when you need request, approval, restore, or provider request-envelope behavior
  - read `message-flow.md` first
- when you need implementation rules, doc absorption, or `WORKLOG` lifecycle policy
  - read `development-guide.md` first
- only continue through this doc when you are changing technical boundaries such as Tauri commands, provider/auth, PTY, or cross-platform policy

## 관련 source of truth / Related Source Of Truth

### 한국어

이 문서는 기술 방향과 경계를 정의한다. 아래 문서는 함께 읽는다.

- [`architecture.md`](./architecture.md)
  - 현재 구현 구조, 모듈 책임, 저장 경계
- [`message-flow.md`](./message-flow.md)
  - request envelope, approval, restore, 주요 사용자 흐름
- [`development-guide.md`](./development-guide.md)
  - 구현 규칙, 문서 흡수 기준, `WORKLOG` 수명 주기 정책

### English

This document defines technical direction and boundaries. Read these alongside it:

- [`architecture.md`](./architecture.md)
  - current implementation structure, module ownership, and persistence boundaries
- [`message-flow.md`](./message-flow.md)
  - request envelope, approval, restore, and major user flows
- [`development-guide.md`](./development-guide.md)
  - implementation rules, doc-absorption policy, and the `WORKLOG` lifecycle policy

## Current Agent Runtime Contract (2026-07-16)

- The center terminal runtime is exclusively user-owned. Agent requests, review, approval, job polling, cancellation, and restore must not invoke terminal creation, focus, input, close, rename, or split commands.
- Approved commands use `AgentJobManager` and persist to `agent-jobs.json`. Create, list, read, and cancel all require canonical project ownership; session-filtered list requests also require the durable Agent session identifier.
- Job history is bounded to 100 persisted records. UI hydration defaults to 25 rows, structured log tails are bounded, and terminal visibility requires both process exit and completed stdout/stderr reader drains.
- Runtime states are `running`, `cancelling`, `completed`, `failed`, `cancelled`, and `interrupted`. On restart, persisted active states become `interrupted`; no process is resumed or relaunched.
- The frontend owns project/session generations, deduplicated reads and cancels, stale-response rejection, final-log polling, and a bounded right-panel job map. Agent session identifiers, their selected `providerId`, and trimmed provider-keyed `selectedModels`, `selectedReasoningLevels`, and `fastModes` are persisted separately from conversation content so restored request, model, option, and job ownership remain addressable.
- `Codex` is available only after local CLI-session validation. A request first obtains a stored-connection revision lease, then performs exactly one CLI validation and optional execution on a blocking worker. Validation results update auth state only while the lease is current, so late results cannot overwrite disconnect/reconnect. CLI discovery, login status, and catalog probes have bounded subprocess timeouts.
- `Claude` is exposed as an available, real provider through the same typed frontend auth and suggestion seams. A session can select and persist Claude independently from every other session; the request includes `agentSessionId`, and the frontend rejects blank ownership or a response from a different provider before rendering.
- Desktop startup treats auth discovery as authoritative before capability discovery. The auth manager may refresh a persisted real `Connected` provider or a persisted real Claude `Error`, but a Claude error can recover only through a fresh current CLI validation. Successful recovery publishes `Connected` with the validated credential source and source-specific scopes, a new connection timestamp, and no identity or error data. An explicit Claude `Disconnected` state is never eligible for automatic refresh, and a non-real or otherwise untrusted legacy Claude error normalizes to disconnected state instead of becoming trusted.
- Every Claude validation failure is replaced before runtime publication or persistence with one actionable generic message: ``Claude authentication could not be validated. Check Claude credentials or run `claude auth login` in your own terminal, then reconnect Claude.`` Raw validation diagnostics, identity-like values, and secrets cannot reach the snapshot or store. Codex validation-error behavior is unchanged.
- `read_agent_provider_capabilities` is the model-catalog authority. The Tauri command is asynchronous and moves provider capability work onto a blocking worker so a five-second CLI probe cannot block the IPC executor. The frontend rejects top-level or per-model provider mismatches, blank IDs/labels, and duplicate IDs before a catalog can affect UI or request state. The renderer waits until the active provider snapshot is exactly `Connected`: a deferred or disconnected startup performs zero capability reads, a connected startup performs exactly one, and a later successful Connect performs the first read for an initially disconnected provider. Provider-scoped connection and capability generations synchronously invalidate older catalogs and ignore stale success or stale rejection across startup, connect, disconnect, reconnect, provider-action error, and capability-read error boundaries. A selection is stored by `project + Agent session + provider`; it is removed only after a supported catalog definitively omits it, while unavailable or not-yet-loaded capability state preserves it. An ineffective selection is sent as `null` so the runtime default applies. Auth discovery and capability reads remain Agent-owned and never create, focus, write to, or otherwise mutate the center terminal.
- Claude capability discovery starts the authenticated installed CLI in isolated SDK stream mode, sends one serialized `control_request` with subtype `initialize`, closes stdin, and accepts only the matching successful `control_response.response.models`. The probe sends no user prompt, `--print`, assistant turn, or inference request. It is bounded to five seconds, 64 KiB of stdout, 32 models, 128-byte IDs, and 160-byte final labels.
- Only each sanitized returned `value` is a selectable Claude model ID. Human labels combine trimmed `displayName` with the leading human segment of `description`; `resolvedModel` is parsed only for bounds and does not become an alternate selectable ID. Blank, leading-dash, duplicate, control-bearing, excessive, malformed, multi-document, error, timeout, or spawn-failure results reject the complete catalog. Account, email, organization, subscription, and all other identity fields are neither modeled nor retained.
- Each returned Claude model also owns an `executionOptions` object. Its bounded returned effort IDs and `supportsFastMode` value are authoritative; the selected model overrides provider-level compatibility fields even when the object is empty/false. Claude never publishes a default effort. The renderer adds a UI-only `Default` row that resolves to `reasoningLevel: null`, while Codex continues to use provider-level reasoning defaults when model-owned options are absent.
- The raw native initialization envelope is intentionally version-coupled to Claude Code even though the model subset matches the public Agent SDK `ModelInfo` contract. Protocol drift therefore fails closed to an empty unsupported catalog and preserves the stored selection for a later valid read. No static, cached, historical, or entitlement-inferred fallback is allowed; exact versions, Fable, or extended-context variants appear only when their exact `value` is returned by the active account/policy response.
- A Claude request performs a fresh bounded catalog read after authentication and before inference whenever it carries an explicit model, an explicit effort, or enabled Fast. The exact selected/default model entry must still contain every requested option; discovery failure, drift, or unsupported values fail before the inference child starts. A validated model remains one separate `--model <value>` pair, and a validated effort becomes one separate `--effort <level>` pair. `model: null` adds no model flag, but advanced options still resolve against the returned `default` entry.
- Every Claude inference request receives exactly one sanitized `--settings` JSON object containing explicit `fastMode: true` or `false`; helper mode merges only its validated canonical `apiKeyHelper` into that same object. The runtime removes `CLAUDE_CODE_EFFORT_LEVEL` from the child environment, honors `CLAUDE_CODE_DISABLE_FAST_MODE=1` as a pre-inference cost-control rejection for enabled Fast, and never emits `--fast`, `/fast`, or `/effort`. Fast can require organization enablement and usage credits, so discovered support is not proof of billing eligibility.
- The Claude backend selects credentials in this order: a non-empty explicit `ANTHROPIC_API_KEY`, a valid top-level user `apiKeyHelper` containing one canonical absolute regular executable path, then an already authenticated session in the installed user-owned Claude Code CLI. The helper path accepts no arguments, whitespace, or shell syntax; callers that need arguments or secret lookup must provide a user-owned, cwd-independent executable wrapper. Bedrock, Vertex, Foundry, unknown providers, and credential-source mismatches fail closed.
- For CLI-session mode, auth status and requests run with `--safe-mode --setting-sources ""` and without `--bare`; the API-key/helper modes retain bare operation. The request writes the prompt only to stdin, disables model tools, MCP, slash commands, Chrome integration, and session persistence, and accepts only schema-validated `structured_output`. Safe mode excludes user/project customizations, but organization-managed policy can still supply hooks, status-line commands, or file-suggestion commands, so this is not an absolute process-level no-hooks guarantee.
- The adapter launches the validated Claude CLI by canonical absolute path, supplies an absolute-only child `PATH`, strips competing credentials, host-managed markers, custom headers, alternate hosts, cloud-provider modes, and inherited debug/telemetry/process-wrapper controls, then explicitly disables nonessential traffic and official-marketplace auto-install. An optional `CLAUDE_CONFIG_DIR` is accepted only as an existing canonical directory inside the canonical current-user home, pinned across validation/request, and revalidated before child launch. The adapter bounds process I/O under one deadline and discards stderr bytes after bounded draining. It never persists or exposes a key, helper output, identity, subscription metadata, token, or raw provider stderr.
- GTUM does not implement Claude.ai OAuth or capture credentials. A missing local session returns typed guidance to run `claude auth login` in the user's own terminal and reconnect; the CLI alone reads its credential store. Connect and request completion remain protected by revision leases, and reloaded state requires fresh runtime validation.
- The preceding Claude authentication correction has integrated evidence: Claude Code CLI 2.1.210 exact safe-mode status exits 0 with `loggedIn: true`, `authMethod: claude.ai`, `apiProvider: firstParty`, and zero stderr bytes; exact bare status exits 1 with `loggedIn: false`, `authMethod: none`, `apiProvider: firstParty`, and zero stderr bytes. That baseline passed lint, production build with only the existing greater-than-500-KB chunk warning, isolated serial Playwright 200/200, Rust formatting/check, focused Claude tests 42/42, and the full Rust suite 147/147.
- The earlier provider-aware alias slice is historical baseline evidence only: its Claude runtime module passed 44/44, runtime suggestion service 24/24, provider workspace/model UI slice 5/5, serial Playwright 210/210, and full Rust suite 149/149. Its static-alias and `--model opus` assertions are superseded by the account-catalog contract above. The completed account-catalog evidence passed Claude runtime 62/62 with the live smoke ignored by default, runtime suggestion service 24/24, Claude workspace/model UI 16/16, serial Playwright 221/221, Rust formatting/check, and the full Rust suite 169 passed / 1 ignored; its ignored production discovery smoke also passed separately. The completed effort/Fast slice passed serial Playwright 233/233, the full Rust suite with 179 passed / 1 ignored, and its exact clean-candidate prompt-free smoke 1/1. For the 2026-07-16 startup recovery, focused auth tests pass 21/21, the focused Claude workspace E2E passes 20/20, and lint passes; the final clean-tree full gate and a fresh bounded prompt-free smoke remain pending. Catalog smokes send no user prompt and perform no paid inference. No live `claude -p` inference or billing verification is claimed; Windows cross-target compilation remains blocked before crate compilation by missing `llvm-rc` on the macOS host.
- Technical support for a local CLI session does not authorize public third-party Claude.ai login routing. A public build must either pass an Anthropic approval/contract review for this use or keep Claude on API-key/supported-cloud credentials.

## 설계 기준 / Design Constraints

### 한국어

이 문서는 아래 결정을 전제로 한다.

- 데스크톱 런타임은 `Tauri`
- 시스템 레이어는 `Rust`
- UI 레이어는 `React + TypeScript + Vite`
- 터미널 렌더링은 `xterm.js`
- 상태 관리는 `Zustand`
- 지원 플랫폼은 `Ubuntu`, `Windows`, `macOS`
- 첫 실사용 기준 플랫폼은 `Windows`
- 에이전트 제공자는 초기 기준 `Codex`, `Claude`
- 첫 실사용 `Codex` 경로의 source of truth는 `OAuth/session login`이다
- `OPENAI_API_KEY` 기반 bridge가 있더라도 개발용 임시 경로로만 취급한다

### English

This document assumes the following decisions:

- desktop runtime: `Tauri`
- system layer: `Rust`
- UI layer: `React + TypeScript + Vite`
- terminal rendering: `xterm.js`
- state management: `Zustand`
- supported platforms: `Ubuntu`, `Windows`, `macOS`
- first daily-use baseline platform: `Windows`
- initial agent providers: `Codex`, `Claude`
- the source-of-truth first daily-use `Codex` path is `OAuth/session login`
- any `OPENAI_API_KEY` bridge should be treated as a temporary development path only
- prototype or browser-preview fallbacks must not be treated as desktop-runtime success; installed-app provider and terminal flows should either use real runtime contracts or surface explicit unavailable/deferred states

## 전체 아키텍처 / High-Level Architecture

### 한국어

`gtum`은 크게 네 계층으로 나눈다.

1. `UI Layer`
   React 기반 화면, 탭, 패널, 승인 UI
2. `Application Layer`
   프로젝트 상태, 워크스페이스 상태, 작업 큐, 에이전트 오케스트레이션
3. `Runtime Layer`
   PTY 세션, 프로세스 실행, 파일 시스템, OS 차이 흡수
4. `Provider Layer`
   `Codex`, `Claude` 로그인 세션과 요청 어댑터

### English

`gtum` is divided into four major layers:

1. `UI Layer`
   React-based screens, tabs, panels, and approval UI
2. `Application Layer`
   project state, workspace state, task queue, and agent orchestration
3. `Runtime Layer`
   PTY sessions, process execution, filesystem access, and OS abstraction
4. `Provider Layer`
   `Codex` and `Claude` login sessions and request adapters

## 권장 폴더 구조 / Recommended Folder Structure

### 한국어

초기 구조는 아래와 같이 시작하는 것을 권장한다.

```text
src/
  app/
    App.tsx
  features/
    projects/
      model/
    workspace/
      model/
    terminals/
      model/
    agents/
      model/
    auth/
      model/
    tasks/
      model/
    telegram/
      model/
  widgets/
    project-sidebar/
      ui/
    workspace-stage/
      ui/
    agent-sidebar/
      ui/
  shared/
    lib/
    ui/
  stores/
  lib/
src-tauri/
  src/
    commands/
    runtime/
      pty/
      process/
      filesystem/
      platform/
    providers/
      auth/
      codex/
      claude/
    state/
  tauri.conf.json
docs/
```

### English

The recommended initial structure is:

```text
src/
  app/
    App.tsx
  features/
    projects/
      model/
    workspace/
      model/
    terminals/
      model/
    agents/
      model/
    auth/
      model/
    tasks/
      model/
    telegram/
      model/
  widgets/
    project-sidebar/
      ui/
    workspace-stage/
      ui/
    agent-sidebar/
      ui/
  shared/
    lib/
    ui/
  stores/
  lib/
src-tauri/
  src/
    commands/
    runtime/
      pty/
      process/
      filesystem/
      platform/
    providers/
      auth/
      codex/
      claude/
    state/
  tauri.conf.json
docs/
```

## 프론트엔드 구조 / Frontend Structure

### 한국어

프론트엔드는 기능 단위로 나누는 것이 좋다.

#### 주요 기능 모듈

- `projects`
  - 프로젝트 목록, 최근 프로젝트, Git 상태 요약, 브랜치 정보 표시
- `workspace`
  - 레이아웃, 패널 열기/닫기, 활성 컨텍스트
- `terminals`
  - 탭 바, 터미널 뷰, 세션 상태 표시
- `agents`
  - 에이전트 패널, 제안 카드, 실행 승인 UI
- `auth`
  - 제공자 로그인, 세션 상태, 권한 범위 표시
- `tasks`
  - 작업 큐, 실행 이력, 경로 요약, 상태 업데이트
- `settings`
  - 플랫폼 설정, 단축키, 셸 설정, 실험 기능

#### 현재 구현 기준선

- `app`
  - `src/App.tsx`는 얇은 entrypoint이고 `src/app/App.tsx`가 composition root다.
- `features/*/model`
  - 프로젝트, terminal, auth, agent, Telegram 흐름 로직은 가능한 한 순수 `TypeScript` helper와 feature hook으로 내린다.
- `widgets/*/ui`
  - 좌측 project rail, 중앙 workspace stage, 우측 agent rail처럼 큰 workbench zone 단위로 자른다.
- `shared/lib`, `shared/ui`
  - tree recursion, file snippet, line reference, formatter 같은 cross-feature helper를 둔다.
- `stores`
  - layout visibility, active tab, captured agent context 같은 전역 workspace state만 남긴다.

#### UI 검증 원칙

- UI 핵심 흐름은 `Playwright` 같은 브라우저/앱 자동화 도구로 E2E 검증한다.
- 각 스프린트에서 사용자에게 새로 드러나는 흐름은 최소 1개 이상의 E2E 시나리오로 남긴다.
- smoke test와 기능별 시나리오를 구분하고, 스프린트 종료 시 smoke test는 항상 통과 상태를 목표로 한다.
- Tauri 데스크톱 런타임과 웹 프론트엔드 검증을 분리하되, 가능한 한 같은 사용자 흐름 이름을 유지한다.
- 프론트엔드 레이아웃과 상호작용은 `docs/frontend-design-benchmarks.md`를 기준으로 검토한다.
- UI 토큰, 색상, 반경, 컴포넌트 상태 표현은 `docs/design-system.md`를 기준으로 검토한다.
- 디자인 검토 시 `VS Code`의 editor hierarchy, `conductor`의 agent workflow, `cmux`의 tabbed terminal strength가 유지되는지 확인한다.
- UI는 task history와 실행 이력이 사용자가 밟아온 승인, 실패, 재시도 경로를 재구성할 수 있을 정도로 남는지 확인한다.
- 프론트엔드 구현은 프레임워크 관용성보다 에이전트가 수정하기 쉬운 단순한 `TypeScript` 구조를 우선할 수 있다.
- FSD-style 분해를 쓰더라도 기본 단위는 card fragment가 아니라 workbench zone이어야 한다.
- `app -> widgets -> features -> shared` 경계를 쓰더라도 `editor + agent-workbench`의 co-primary surface와 `tabbed terminal mode` 기준은 그대로 유지해야 한다.
- 중앙 workbench는 빈 상태, `+` 탭 생성, 상하좌우 pane split, pane 간 탭 이동을 모두 1급 기능으로 본다.
- 프로젝트 열기와 전환은 상단 project-tab manager보다 좌측 rail에서 처리하는 방향을 우선한다.
- 기본 레이아웃에서 하단 panel은 제거 가능한 대상으로 보고, 필요한 결과는 pane이나 contextual surface로 푼다.

#### 상태 관리 원칙

- 전역 상태는 `Zustand` 스토어로 관리한다.
- UI 일시 상태와 장기 워크스페이스 상태를 구분한다.
- 터미널 출력 전체를 React state에 직접 쌓지 않고, 버퍼 참조와 뷰 상태를 분리한다.
- 에이전트 응답 스트림과 작업 상태는 이벤트 기반으로 업데이트한다.

### English

The frontend should be organized by feature domain.

#### Main Feature Modules

- `projects`
  - project list, recent projects, Git status summary, branch visibility
- `workspace`
  - layout, panel visibility, active context
- `terminals`
  - tab bar, terminal view, session status
- `agents`
  - agent panel, suggestion cards, execution approval UI
- `auth`
  - provider login, session state, granted scope visibility
- `tasks`
  - task queue, execution history, path recap, and status updates
- `settings`
  - platform settings, shortcuts, shell settings, experimental features

#### Current Implemented Baseline

- `app`
  - `index.html` loads `src/app/main.tsx`.
  - `src/app/main.tsx` is the active TSX entrypoint for the uploaded design migration.
  - `src/app/providers/legacy-prototype.ts` imports the current uploaded JSX prototype until each workbench zone is extracted into TSX components.
- `entities/*/model`
  - hold reusable typed domain shapes for project, workspace, and agent data.
- `features/*/model`
  - hold feature contracts such as workbench tab layout and approval policy logic.
- `shared/api`
  - holds backend-facing service seams such as `src/shared/api/runtimeProjects.ts`, which wraps Tauri project overview and file-read commands with browser fallback.
  - includes `src/shared/api/runtimeWindow.ts`, the browser-safe seam for Tauri native window controls (`minimize`, `close`, `toggleMaximize`, `startDragging`, and `startResizeDragging`) used by the custom frameless chrome.
  - native maximize state is local UI state only. The frontend must not poll Tauri `isMaximized` or subscribe to resize-driven maximize synchronization because that path can trigger macOS `is_zoomed`/style-mask churn in installed builds.
- `shared/lib`, `shared/types`
  - hold cross-feature helpers and compatibility types needed while the uploaded design moves from JSX to TSX.
- `widgets/*/ui`
  - remains the target extraction layer for major workbench zones such as titlebar, sidebar, center workspace, right agent panel, and modals.

#### UI Verification Principles

- validate the installable Tauri desktop app before treating web/Vite preview results as release evidence
- validate core UI flows with an E2E automation tool such as `Playwright`
- each sprint should leave behind at least one E2E scenario for the new user-facing flow it delivers
- separate smoke tests from feature-specific scenarios, and aim to keep smoke tests green at the end of every sprint
- separate Tauri desktop verification from web-frontend verification, keep the user-flow naming aligned across both, and treat web preview as secondary fallback/design coverage
- review frontend layout and interaction quality against `docs/frontend-design-benchmarks.md`
- review UI tokens, colors, radius, and component state representation against `docs/design-system.md`
- check whether the UI still preserves the editor hierarchy of `VS Code`, the agent-workflow clarity of `conductor`, and the tabbed-terminal strength of `cmux`
- make sure task history and execution history remain legible enough for users to reconstruct approvals, failures, and retries
- prefer frontend implementation patterns that are easy for agents to edit, even if that means reducing framework-heavy abstractions in favor of simpler `TypeScript` structures
- when using an FSD-style split, prefer workbench-zone boundaries over fragmenting the UI into many small dashboard cards
- keep the co-primary `editor + agent-workbench` surface intact while decomposing widgets and features, and keep the terminal as a strong switchable mode

## 테스트 전략 / Testing Strategy

### 한국어

`gtum`은 최소한 아래 세 층의 검증을 가진다.

1. `Unit / Module`
   상태 스토어, 유틸리티, 런타임 헬퍼
2. `Integration`
   Tauri command와 프론트 연결, 파일 시스템 및 Git 읽기
3. `UI E2E`
   Playwright 기반 주요 사용자 흐름 검증

초기 E2E 기준은 다음을 권장한다.

- Sprint 0: 앱 셸 smoke test
- Sprint 1: 프로젝트 열기, 파일 트리, Git 상태 표시
- Sprint 2: 멀티 탭 터미널 생성과 활성 탭 전환
- 이후 스프린트: 로그인, 제안 확인, 승인 기반 실행, 작업 이력

### English

`gtum` should keep at least the following three testing layers:

1. `Unit / Module`
   state stores, utilities, and runtime helpers
2. `Integration`
   Tauri command-to-frontend wiring plus filesystem and Git reads
3. `UI E2E`
   major user-flow verification with Playwright

Recommended initial E2E coverage:

- Sprint 0: app-shell smoke test
- Sprint 1: project open, file tree, and Git status visibility
- Sprint 2: multi-tab terminal creation and active-tab switching
- later sprints: selected-file viewing, login, suggestion review, approval-based execution, and task history

### Aging Test Strategy

### 한국어

MVP 최종 검증에는 `aging test`를 포함한다. 목적은 짧은 데모에서는 보이지 않는 상태 누수, UI 누적 문제, 세션 불안정성을 드러내는 것이다.

초기 aging test 기준:

- 일정 시간 이상 앱을 유지 실행한다.
- 프로젝트 열기, 재진입, 탭 전환, 로그 확인을 반복한다.
- 메모리, 상태 꼬임, 패널 렌더링 이상, 세션 끊김 여부를 확인한다.

권장 위치:

- Sprint 5에서 크로스 플랫폼 검증과 함께 수행
- 필요 시 Sprint 2 이후 터미널 안정성에 대해 부분 aging test를 먼저 도입

### English

Final MVP validation should include an `aging test`. Its purpose is to reveal state leaks, UI accumulation issues, and session instability that may not appear in short demos.

Initial aging-test baseline:

- keep the app running for an extended period
- repeat project-open, re-entry, tab switching, and log inspection flows
- watch for memory growth, broken state, panel rendering issues, and session drops

Recommended placement:

- run it together with cross-platform validation in Sprint 5
- introduce partial aging coverage earlier after Sprint 2 if terminal stability needs earlier proof

#### State Management Principles

- manage shared app state with `Zustand`
- separate transient UI state from durable workspace state
- do not push full terminal output directly into React state; separate buffer ownership from view state
- update agent streams and task state through event-driven flows

## 런타임 구조 / Runtime Structure

### 한국어

Rust 런타임은 아래 책임을 가진다.

- PTY 생성과 종료
- 셸 프로세스 실행과 제어
- 파일 시스템 접근
- 크로스 플랫폼 차이 추상화
- 로그인 세션 저장과 보안 처리
- 프론트엔드에 안전한 Tauri command 제공

#### 권장 모듈

- `runtime/pty`
  - PTY 생성, 입출력 연결, resize, 종료 처리
- `runtime/process`
  - 일반 프로세스 실행, 권한 분기, 백그라운드 작업
- `runtime/filesystem`
  - 프로젝트 탐색, 파일 읽기, 메타데이터 수집
- `runtime/platform`
  - OS별 셸, 경로, 환경 변수, 권한 처리
- `providers/auth`
  - OAuth/session 로그인 시작, callback 처리, 세션 저장
- `providers/codex`
  - Codex provider adapter
- `providers/claude`
  - Claude provider adapter

### English

The Rust runtime is responsible for:

- PTY creation and teardown
- shell process execution and control
- filesystem access
- cross-platform abstraction
- login session storage and security handling
- exposing safe Tauri commands to the frontend

#### Recommended Modules

- `runtime/pty`
  - PTY creation, IO wiring, resize, termination
- `runtime/process`
  - generic process execution, permission routing, background jobs
- `runtime/filesystem`
  - project scanning, file reads, metadata collection
- `runtime/platform`
  - OS-specific shell, path, env, and permission handling
- `providers/auth`
  - OAuth/session login start, callback handling, session storage
- `providers/codex`
  - Codex provider adapter
- `providers/claude`
  - Claude provider adapter

## 코드 읽기 surface와 요청 envelope / Code-Reading Surface And Request Envelope

### 한국어

첫 code-reading 슬라이스는 full editor가 아니라 read-only viewer로 시작한다.

#### 목적

- 메인 워크스페이스에서 terminal과 code surface를 동시에 유지한다.
- 선택 파일을 agent request의 1급 컨텍스트로 올린다.
- approval review에서 어떤 파일 맥락을 보고 제안이 생성됐는지 다시 읽을 수 있게 한다.

#### 런타임 계약

- `read_project_overview(path, maxDepth)`
  - 프로젝트 메타데이터, 파일 트리, Git 개요
- `read_project_file(projectPath, filePath)`
  - 선택 파일 읽기 전용 snapshot 반환
  - project root 밖의 경로는 거부
  - binary 파일은 text preview 대신 bounded fallback 반환
  - 큰 파일은 제한된 크기만 읽고 `truncated` 상태를 반환

#### 프론트엔드 상태

- `selectedFilePath`
- `selectedFileLine`
- `selectedFileSnapshot`
- `isFileLoading`
- `fileError`

선택 파일 상태는 workspace restore와 함께 다시 열 수 있는 수준까지만 유지하고, 실제 편집 상태는 아직 들고 가지 않는다.

#### restore와 fallback 규칙

- restore는 `project + selectedFilePath + selectedFileLine` 기준으로 best-effort 복원을 시도한다.
- 복원 대상 파일이 사라졌거나 root 밖으로 벗어나면 first-file fallback으로 내려간다.
- line anchor가 현재 preview 범위 또는 line count를 벗어나면 가장 가까운 유효 line 또는 no-anchor 상태로 clamp한다.
- binary 파일은 viewer fallback을 보여주되 line anchor는 비활성화한다.
- large file은 bounded preview만 보여주며 `truncated` 상태를 유지한다.

#### provider request envelope

초기 request envelope은 아래 필드를 포함한다.

- `projectPath`
- `projectName`
- `activeTabId`
- `activeTabTitle`
- `activeFilePath`
- `activeFileLine`
- `activeFileSnippet`
- `lastNLogLines`
- `userTask`

`activeFileSnippet`은 선택 파일 전체가 아니라 preview용 excerpt일 수 있으며, terminal 로그와 같이 bounded size를 유지한다.
line anchor가 있으면 snippet은 anchor 근처 excerpt를 우선 사용한다.

### English

The first code-reading slice should start as a read-only viewer rather than a full editor.

#### Goals

- keep the editor surface primary while leaving the terminal reachable through workbench mode tabs
- promote the selected file into first-class agent-request context
- let the approval review restate which file context the suggestion was based on

#### Runtime Contract

- `read_project_overview(path, maxDepth)`
  - project metadata, file tree, and Git overview
- `read_project_file(projectPath, filePath)`
  - returns a read-only snapshot of the selected file
  - reject paths outside the active project root
  - return a bounded fallback instead of raw text for binary files
  - read only a limited amount for large files and surface `truncated`

#### Frontend State

- `selectedFilePath`
- `selectedFileLine`
- `selectedFileSnapshot`
- `isFileLoading`
- `fileError`

Selected-file state should be restorable at the workspace level, but should not introduce full editing state yet.

#### Restore And Fallback Rules

- restore should attempt best-effort recovery from `project + selectedFilePath + selectedFileLine`
- if the stored file is missing or outside the project root, fall back to the first readable file
- if the stored line anchor is outside the preview range or current line count, clamp to the nearest valid line or clear the anchor
- binary files should keep the viewer fallback and disable line anchors
- large files should keep a bounded preview and preserve the `truncated` state

#### Provider Request Envelope

The initial request envelope for this slice includes:

- `provider`
- `agentSessionId`
- `projectPath`
- `projectName`
- `activeTabId`
- `activeTabTitle`
- `activeFilePath`
- `activeFileLine`
- `activeFileSnippet`
- `lastNLogLines`
- `userTask`

`activeFileSnippet` may be a bounded preview excerpt rather than the full file and should stay size-limited in the same spirit as attached terminal logs.
When a line anchor exists, the snippet should prefer the anchored region rather than only the top of the file.
The frontend captures `projectPath + agentSessionId + provider` before every async request boundary. `agentSessionId` is required and trimmed before IPC, and every returned suggestion must identify the requested provider before it can enter conversation or permission state.

## 터미널 세션 설계 / Terminal Session Design

### 한국어

터미널은 단순 텍스트 뷰가 아니라 장기 세션 객체로 다뤄야 한다.

#### 핵심 요구사항

- 탭마다 독립적인 PTY 세션
- 탭 이름, 현재 경로, 상태 유지
- 스크롤백 유지
- resize 이벤트 반영
- 세션 종료 감지
- 재연결 또는 세션 복원 전략

#### 권장 데이터 모델

- `TerminalSession`
  - `id`
  - `projectId`
  - `tabId`
  - `shell`
  - `cwd`
  - `status`
  - `pid`
  - `platform`
- `TerminalBufferRef`
  - `sessionId`
  - `bufferKey`
  - `lineCount`
  - `lastUpdatedAt`

#### 구현 메모

- Ubuntu와 macOS는 POSIX 셸 기반 흐름을 공통화할 수 있다.
- Windows는 `powershell`, `pwsh`, `cmd` 차이를 흡수하는 별도 셸 전략이 필요하다.
- 운영체제마다 기본 셸 탐지 로직을 두고, 사용자가 설정에서 재정의할 수 있게 한다.

### English

The terminal should be treated as a long-lived session object, not just a text view.

#### Core Requirements

- one isolated PTY session per tab
- preserved tab title, cwd, and status
- scrollback retention
- resize handling
- session termination detection
- reconnection or restoration strategy

#### Recommended Data Model

- `TerminalSession`
  - `id`
  - `projectId`
  - `tabId`
  - `shell`
  - `cwd`
  - `status`
  - `pid`
  - `platform`
- `TerminalBufferRef`
  - `sessionId`
  - `bufferKey`
  - `lineCount`
  - `lastUpdatedAt`

#### Implementation Notes

- Ubuntu and macOS can share a common POSIX shell flow
- Windows needs a dedicated shell strategy that abstracts `powershell`, `pwsh`, and `cmd`
- detect default shells per OS and allow users to override them in settings
- The active frontend terminal seam is `src/shared/api/runtimeTerminals.ts`; it wraps `create_terminal_session`, `create_terminal_session_with_command`, `read_terminal_session_logs`, `execute_terminal_session_command`, and `close_terminal_session`.
- `src/prototype.jsx` now uses that seam only for user-owned terminal actions: creating terminal tabs, submitting user-typed terminal input, runtime log polling, and tab close termination. Agent approval decisions must not call this seam.
- On Windows, user-created center terminal tabs use a hidden persistent shell process, preferring `powershell.exe -NoLogo -NoProfile -NoExit` before `pwsh.exe` and `cmd.exe` fallback. User input is written to that shell over stdin and stdout/stderr are streamed back into the center terminal, so shell builtins and aliases such as `dir`, `cd`, `ls`, and `clear` work without opening an external console window. `clear` and `cls` clear the runtime log buffer as well as being submitted to the shell.
- The active frontend file-edit seam is `src/shared/api/runtimeProjects.ts`; it wraps `read_project_file`, `write_project_file`, and `apply_project_patch` so the center editor can save real files with a content-hash conflict guard and agent patch application can happen through an explicit file contract. Multi-file patch application must preflight every edit before writing any file, which prevents stale hashes or duplicate targets from producing partial writes.
- The active frontend agent-owned execution seam is `src/shared/api/runtimeAgentJobs.ts`; it wraps project-scoped `create_agent_job`, `list_agent_jobs`, `read_agent_job_logs`, and `cancel_agent_job` so approved agent commands run as hidden background jobs instead of mutating center terminal tabs.
- Browser preview remains deterministic through the same service fallback, while interactive terminal ownership and Windows shell sessions stay in `src-tauri/src/runtime/pty/mod.rs`.

## 크로스 플랫폼 전략 / Cross-Platform Strategy

### 한국어

지원 플랫폼이 `Ubuntu`, `Windows`, `macOS`인 만큼 OS 차이를 분리하는 추상화가 필요하다.

구조적 지원 범위는 세 플랫폼 전체를 포함하지만, 첫 실사용 기준 흐름과 UX 마찰 평가는 Windows를 우선 기준으로 둔다.

#### 추상화 대상

- 기본 셸 탐지
- 경로 구분자와 홈 디렉토리 해석
- PTY 라이브러리 차이
- 환경 변수 접근 방식
- 단축키와 시스템 메뉴 동작
- 파일 열기, URL 열기, 브라우저 로그인 리디렉션 처리

#### 설계 원칙

- UI는 가능한 한 OS 세부사항을 직접 알지 않게 한다.
- 플랫폼 분기는 Rust 런타임 계층에 최대한 모은다.
- 프론트엔드에는 정규화된 정보만 전달한다.
- OS별 예외 처리는 기능 구현 시점이 아니라 기본 인프라 단계에서 정의한다.
- Windows의 경로, 셸, 폴더 선택기, 줄바꿈 차이는 첫 실사용 기준 항목으로 우선 검증한다.

### English

Because `gtum` supports `Ubuntu`, `Windows`, and `macOS`, OS differences need explicit abstraction.

The structural support scope still covers all three platforms, but the first daily-use flow and UX-friction baseline are evaluated on Windows first.

#### What Must Be Abstracted

- default shell detection
- path separators and home directory resolution
- PTY library differences
- environment variable access
- shortcuts and system menu behavior
- opening files, opening URLs, and provider diagnostics or setup affordances

#### Design Principles

- the UI should avoid knowing OS-specific details directly
- platform branching should live primarily in the Rust runtime layer
- only normalized information should be exposed to the frontend
- OS-specific exception handling should be designed into the infrastructure layer early
- Windows path handling, shell behavior, folder-picker behavior, and newline differences should be validated first as part of the initial daily-use baseline
- home-directory expansion for runtime paths must accept `HOME`, `USERPROFILE`, and `HOMEDRIVE` plus `HOMEPATH`, because installed Windows app launches may not provide `HOME`
- runtime behavior should branch inside the Rust `platform` module with `cfg(target_os = "...")` rather than scattering OS checks through feature modules
- build-time bundle differences should live in Tauri platform config files such as `tauri.windows.conf.json` and `tauri.macos.conf.json`; release artifacts should be produced on native OS runners instead of relying on cross-compilation for Windows/macOS
- Windows user-created center terminal sessions prefer a hidden persistent PowerShell shell process, then `pwsh.exe`, then `cmd.exe /D /Q /K` through `ComSpec`. This user-owned shell path supports shell builtins and persistent cwd. Windows-approved agent commands must not use that center terminal shell path: they run as hidden shell-free process sessions, resolve only direct `.exe` or `.com` programs, capture stdout/stderr into runtime logs, and reject `cmd.exe`, `powershell.exe`, `.cmd`, `.bat`, shell syntax, and shell builtins into the app log.

## Git 워크플로우 설계 / Git Workflow Design

### 한국어

현재 저장소는 `master`만 존재하지만, 구현이 시작되면 `git flow` 개념을 반영한 브랜치 운영을 도입하는 것을 권장한다.

#### 권장 브랜치 역할

- `master`
  - 안정 기준 브랜치
- `dev`
  - 통합 개발 브랜치
- `feature/*`
  - 기능 개발과 문서 작업
- `release/*`
  - 릴리즈 안정화
- `hotfix/*`
  - 긴급 수정

#### 애플리케이션 관점 요구사항

- 프로젝트 패널은 현재 브랜치와 dirty state를 표시해야 한다.
- 에이전트 제안은 현재 브랜치 컨텍스트를 함께 참조해야 한다.
- 작업 이력과 제안 로그는 가능하면 브랜치 맥락과 연결되는 것이 좋다.
- 브랜치 전환과 생성은 초기에는 필수 기능이 아니지만, 후속 확장 가능성을 열어둔다.

#### 구현 메모

- MVP에서는 읽기 중심 Git 상태 표시를 우선한다.
- 브랜치 생성, 머지, 릴리즈 보조 UI는 후속 단계로 미룬다.
- 내부 상태 모델은 처음부터 `feature/*`, `release/*`, `hotfix/*` 같은 패턴을 수용할 수 있어야 한다.

### English

The repository currently only has `master`, but once implementation begins, the product should adopt a workflow compatible with lightweight `git flow` concepts.

#### Recommended Branch Roles

- `master`
  - stable baseline branch
- `dev`
  - integration branch
- `feature/*`
  - feature and documentation work
- `release/*`
  - release stabilization
- `hotfix/*`
  - urgent fixes

#### Application-Level Requirements

- the project panel should show current branch and dirty state
- agent suggestions should include current branch context
- task history and suggestion logs should ideally be tied to branch context
- branch switching and creation are not required for MVP, but should remain future-compatible

#### Implementation Notes

- for MVP, prioritize read-only Git status visibility
- branch creation, merge support, and release helper UI can come later
- internal state models should support patterns such as `feature/*`, `release/*`, and `hotfix/*` from the start

## Git 상태 모델 / Git State Model

### 한국어

프로젝트 상태에는 최소한 아래 Git 정보를 포함하는 것이 좋다.

- `currentBranch`
- `isDirty`
- `changedFilesCount`
- `aheadCount`
- `behindCount`
- `branchType`

`branchType`은 아래 값으로 정규화할 수 있다.

- `master`
- `dev`
- `feature`
- `release`
- `hotfix`
- `other`

### English

Project state should include at least the following Git metadata:

- `currentBranch`
- `isDirty`
- `changedFilesCount`
- `aheadCount`
- `behindCount`
- `branchType`

`branchType` may be normalized into:

- `master`
- `dev`
- `feature`
- `release`
- `hotfix`
- `other`

## 에이전트 제공자 구조 / Agent Provider Architecture

### 한국어

초기 제공자는 `Codex`와 `Claude` 두 가지다.

#### 핵심 원칙

- UI는 provider-specific API를 직접 다루지 않는다.
- 애플리케이션 레이어는 공통 인터페이스만 사용한다.
- 실제 로그인 세션, 권한 상태, 요청 전송은 provider adapter가 담당한다.
- 개발용 임시 bridge가 있더라도 앱의 기본 UX와 release contract를 정의하지 않는다.

#### 공통 인터페이스 예시

- `connect()`
- `disconnect()`
- `getSession()`
- `sendTask()`
- `streamResponse()`
- `listCapabilities()`

#### provider별 책임

- `CodexAdapter`
  - OAuth/session login 처리
  - callback 또는 desktop sign-in completion 처리
  - 작업 요청 전송
  - 응답 스트리밍 정규화
- `ClaudeAdapter`
  - 작업 요청 전송
  - 응답 스트리밍 정규화

### English

The initial providers are `Codex` and `Claude`.

#### Core Principles

- the UI should not deal with provider-specific APIs directly
- the application layer should depend on a shared interface only
- real login session handling, scope state, and request transport belong to provider adapters
- even if a temporary development bridge exists, it should not define the default UX or release contract

#### Example Shared Interface

- `connect()`
- `disconnect()`
- `getSession()`
- `sendTask()`
- `streamResponse()`
- `listCapabilities()`

#### Per-Provider Responsibilities

- `CodexAdapter`
  - handle OAuth/session login
  - handle callback or desktop sign-in completion
  - send task requests
  - normalize response streaming
- `ClaudeAdapter`
  - discover the Claude CLI as a canonical absolute regular executable and select an explicit API key, then a strict user-level `apiKeyHelper` executable path, then a first-party authenticated local CLI session
  - never initiate Claude.ai OAuth or read a Keychain/credential file; return external `claude auth login` guidance when the installed CLI has no valid first-party session
  - reject third-party provider modes, unknown auth methods, and credential-source mismatches
  - discover the current account/policy model catalog through one bounded, prompt-free SDK initialization control request on a blocking worker and discard all non-model identity data
  - retain each returned model's bounded `executionOptions` as the sole authority for model-specific effort/Fast visibility and request validation
  - run a no-model-tools, no-MCP, no-slash-commands, no-Chrome, non-persistent structured-output request without using the center terminal
  - parse only schema-valid `structured_output`, discard bounded stderr, enforce one all-I/O deadline, and return the shared provider response format
  - protect connect and request completion with the same fail-closed revision-lease semantics used at the application boundary
  - expose only sanitized model `value` fields returned by the current catalog, then refresh and validate an explicit selection against those exact values before inference spawn

The implemented Claude CLI-session status check is constrained to this shape:

```text
claude --safe-mode --setting-sources "" auth status --json
```

The CLI-session model-catalog probe uses the same isolation prefix, then this SDK stream shape:

```text
claude --safe-mode --setting-sources "" --strict-mcp-config
       --disable-slash-commands --no-chrome --no-session-persistence
       --permission-mode dontAsk --tools "" --output-format stream-json
       --verbose --input-format stream-json
stdin: one {"type":"control_request","request_id":"gtum-claude-model-catalog-v1",
            "request":{"subtype":"initialize"}} line, then EOF
```

API-key/helper catalog probes use the same stream suffix after the isolated `--bare --safe-mode` prefix, and only helper mode may append its sanitized settings document. Catalog discovery never passes `--print`, a prompt, `--model`, a resume/session argument, a tool, MCP configuration, or a center-terminal path. The parser accepts one matching success envelope only. Because this native wire shape is version-coupled, any drift fails closed rather than presenting a remembered or fabricated catalog.

The corresponding CLI-session request is constrained to this shape:

```text
claude --safe-mode --setting-sources "" --strict-mcp-config
       --disable-slash-commands --no-chrome --no-session-persistence
       --permission-mode dontAsk --tools "" --print
       --output-format json --json-schema <compact-schema>
```

API-key and helper requests retain the isolated bare shape:

```text
claude --bare --safe-mode --strict-mcp-config --disable-slash-commands
       --no-chrome --no-session-persistence --permission-mode dontAsk
       --tools "" --print --output-format json --json-schema <compact-schema>
```

An implicit runtime-default request adds no `--model` or `--effort` flag. An explicit model, explicit effort, or enabled Fast first refreshes the authenticated catalog and validates the exact effective model entry. A valid model appends separate `--model`, `<value>` arguments; a valid effort appends separate `--effort`, `<level>` arguments. A `resolvedModel` string, historical version, Fable variant, extended-context value, effort, or Fast state is not selectable unless the current response returns support for it; Claude Code account entitlement and organization-managed policy remain authoritative.

Every inference invocation appends exactly one sanitized `--settings <json>` pair. The JSON always contains explicit `fastMode: true` or `false`; helper mode adds only the validated `apiKeyHelper` key to the same object. The top-level `apiKeyHelper` value is not a command line: it must be a single absolute path that canonicalizes to a regular executable, with a Unix execute bit where applicable, and it may contain no arguments, whitespace, or shell syntax. A caller that needs arguments or a secret lookup must provide a user-owned, cwd-independent executable wrapper. On Windows, a local-drive extended prefix such as `\\?\C:\...` is normalized to its drive path; UNC, volume-GUID, whitespace-bearing, and shell-bearing forms fail closed. An optional custom Claude config root must canonicalize to an existing directory inside the canonical current-user home; the adapter pins that approved root for helper discovery and CLI-session child setup, then fails closed if the path changes before launch.

The Claude CLI itself is also selected and launched only as a canonical absolute regular executable. The child receives only absolute `PATH` entries and a credential-specific environment: competing credentials, host-managed markers, custom headers, alternate Anthropic hosts, cloud modes, and inherited debug/telemetry/process-wrapper controls are removed. Nonessential traffic and official-marketplace auto-install are explicitly disabled. One deadline covers child completion plus stdin, stdout, and stderr workers; timeout kills the owned child, stdout remains bounded, and stderr is bounded-drained and discarded instead of being returned through diagnostics or errors.

The prompt is written to stdin, the child cwd is the captured canonical project, and the adapter does not pass `--file`, `--add-dir`, MCP config, browser-enable flags, resume/session flags, or provider-side write/terminal tools. Credential precedence is explicit API key, valid helper, then CLI session. A CLI-session status payload with no login becomes typed `MissingCliSession` guidance to run `claude auth login` externally; malformed or mismatched status remains a redacted fail-closed error.

`--safe-mode --setting-sources ""` prevents user/project customizations from loading while leaving official CLI authentication available. It does not override organization-managed policy. Policy-configured hooks, status-line commands, or file-suggestion commands may still apply, although model tools and MCP remain disabled by the request flags; this design therefore makes no absolute no-hooks claim.

## 로그인 및 세션 설계 / Login and Session Design

### 한국어

첫 실사용 릴리스의 목표 경로는 `Codex`의 `OAuth/session login`이다. 현재 저장소에 env/API key bridge가 남아 있더라도 이는 개발용 임시 경로로만 간주한다.

#### 목표

- 사용자가 앱 안에서 제공자 계정을 연결할 수 있어야 한다.
- 인앱 토큰 입력 대신 브라우저 또는 데스크톱 세션 기반 로그인으로 연결한다.
- 세션 만료, 취소, scope 부족을 연결 단계와 재접속 단계에서 분명히 드러낸다.

#### 권장 흐름

1. 사용자가 `Codex` 또는 `Claude` 연결 버튼을 누른다.
2. 앱이 시스템 브라우저 또는 제공자 승인 경로를 통해 로그인 플로우를 시작한다.
3. 런타임이 callback, deep link, 또는 데스크톱 sign-in 완료를 처리한다.
4. 런타임이 세션 상태와 기본 진단 정보를 저장한다.
5. UI는 연결 상태, 권한 범위, 만료/재연결 상태를 표시한다.

#### 세션 저장 원칙

- 가능하면 운영체제의 보안 저장소를 우선 사용한다.
- 민감한 인증 정보는 평문 설정 파일에 저장하지 않는다.
- 세션 만료 또는 권한 오류를 감지하면 재로그인 상태를 UI에 명확히 표시한다.

### English

The target `Codex` path is `OAuth/session login`. Claude selects an explicit first-party API credential, then a strict top-level user `apiKeyHelper`, then the already authenticated session of the installed user-owned CLI. GTUM does not start Claude.ai OAuth or capture its token. The local CLI-session path remains internal-use infrastructure until Anthropic approval/contract review authorizes third-party distribution. Any `OPENAI_API_KEY` bridge that remains in the repository is a temporary Codex development path rather than the release design.

#### Goals

- users should be able to connect provider accounts from within the app
- use the provider-approved credential path without an in-app raw-token form
- store connection state securely and detect expiry, cancellation, or missing-scope errors

#### Recommended Flow

1. the user clicks Connect for the provider selected by the active Agent session
2. Codex validates the local CLI ChatGPT session; Claude selects an explicit API key, then a valid helper, then validates the installed CLI's first-party session through safe mode
3. if the Claude CLI session is missing, the runtime tells the user to run `claude auth login` in their own terminal. It never opens a login browser, captures a token, reads the credential store, or mutates the center terminal
4. the runtime stores only non-secret connection state and baseline diagnostics
5. the UI shows connection state, reconnect state, and non-secret credential readiness while the session keeps its own `providerId`

#### Session Storage Rules

- prefer OS-level secure storage when available
- do not store sensitive credentials in plain-text config files
- persist only the non-secret credential-source label and documented scopes; do not persist or render an Anthropic API key, helper output, email, organization, OAuth token, or subscription metadata
- if the session expires or loses scope, show a clear reconnect state in the UI

#### Current Implementation Notes

- The active frontend auth seam is `src/shared/api/runtimeAgentAuth.ts`; it wraps `list_agent_connections`, `begin_agent_login`, `disconnect_agent_provider`, and `agent_auth_runtime_snapshot`.
- In the desktop runtime path, clicking `Connect Codex` calls `begin_agent_login` so the Rust auth manager can validate the local ChatGPT-backed Codex CLI session. It does not open a terminal tab or run `codex login`; setup guidance stays in the right Agent panel and provider row.
- Claude now survives frontend normalization as `available + real`; connect and disconnect use the same runtime IPC boundary instead of a local deferred shortcut. The Rust API-key/helper/CLI-session adapter and stale-completion rejection are implemented and Rust-verified. Frontend availability still must not be read as proof of a connected credential or a live inference request.
- A successful CLI-session validation persists only `credentialSource: "claude_cli_session"` and the scopes `provider:request` plus `credential:cli_session`. API-key/helper connections retain `credential:api_key`; restored records are not trusted until fresh runtime validation.
- Public distribution of the CLI-session path is blocked pending Anthropic approval/contract review. The fallback public-release contract is API-key or supported cloud-provider authentication.
- The Rust Codex runtime resolves the CLI from `PATH` first and then known macOS `Codex.app` bundle locations. PTY shells also receive existing Codex app resource directories in `PATH`, which keeps user-owned terminal sessions and `codex exec` working when the installed app is launched from Finder with a limited environment.
- The current Codex runtime scope contract is `project:read` and `terminal:read`; missing or expired session state maps to provider `error` and can be retried by reconnecting after the CLI login finishes.
- Browser preview keeps only explicit no-runtime fallbacks. It does not load a bundled project fixture, fabricate provider answers, or treat simulated browser-only UI as desktop-runtime success.

## 외부 채널 연동 설계 / External Channel Integration Design

### 한국어

`gtum`은 향후 데스크톱 앱 밖에서도 상태를 확인하고 제한된 명령을 전달할 수 있도록 외부 채널 연동을 확장 가능하게 설계하는 것이 좋다.

초기 후보 채널은 다음과 같다.

- `Telegram`

#### 목표

- 작업 완료, 실패, 승인 필요 이벤트를 외부로 전달
- 제한된 원격 명령을 수신
- 데스크톱 앱을 열지 못하는 상황에서도 최소한의 운영 가능성 제공

#### 설계 원칙

- 외부 채널은 기본 에이전트 provider와 분리된 `notification/control adapter` 계층으로 다룬다.
- 외부 채널에서 허용하는 명령은 강하게 제한한다.
- 민감한 명령은 여전히 승인 흐름 또는 2차 확인을 요구한다.
- 로그 전체를 무제한 전송하지 않고, 요약 또는 제한된 발췌를 우선한다.

#### 권장 구성요소

- `ChannelAdapter`
  - Telegram 같은 외부 채널을 위한 공통 인터페이스
- `NotificationDispatcher`
  - 작업 상태에 따라 외부 채널에 리포트 발송
- `RemoteCommandGate`
  - 외부 채널에서 들어온 명령을 검증하고 제한

### English

`gtum` should remain extensible for external channels so users can inspect status and send limited commands outside the desktop app.

The initial candidate channel is:

- `Telegram`

#### Goals

- deliver completion, failure, and approval-required events externally
- receive limited remote commands
- provide minimal operational visibility when the desktop app is not open

#### Design Principles

- treat external channels as a separate `notification/control adapter` layer, not as part of the core agent-provider layer
- strictly limit which remote commands are allowed
- sensitive commands should still require approval or a second confirmation step
- avoid streaming full logs by default; prefer summaries or bounded excerpts

#### Recommended Components

- `ChannelAdapter`
  - shared interface for channels such as Telegram
- `NotificationDispatcher`
  - sends reports to external channels based on task state
- `RemoteCommandGate`
  - validates and constrains commands arriving from external channels

## 멀티 에이전트 실행 구조 / Multi-Agent Execution Structure

### 한국어

멀티 에이전트 실행은 애플리케이션 레이어에서 오케스트레이션한다.

#### 핵심 구성요소

- `Conductor`
  - 사용자 요청을 작업 그래프로 분해
- `Task Scheduler`
  - 실행 모드에 따라 워커 수와 우선순위 결정
- `Agent Worker`
  - provider와 연결된 실제 작업 실행 단위
- `Context Store`
  - 프로젝트, 파일, 터미널, 작업 상태와 경로 요약 공유
- `Approval Gate`
  - 명령 실행과 파일 수정 전 사용자 승인 요구

#### 기본 워커 역할

- `Planner Worker`
  - 현재 스프린트 목적 정리, 다음 스프린트 초안, 레퍼런스 분석, 작업 경로 분석, 기획 문서 담당
- `Orchestrator Worker`
  - 문서/코드 기준선 확인, 작업 분해, 통합 담당
- `Designer Worker`
  - `VS Code`, `conductor`, `cmux` 기준의 정보 계층, 코드 읽기 surface, 상호작용, 와이어프레임, 작업 경로 가시화 담당
- `Frontend Worker`
  - `src/` 범위 UI와 상태 변경 담당
- `Backend Worker`
  - `src-tauri/` 범위 runtime과 contract 변경 담당
- `QA Worker`
  - 완료조건, acceptance 기준, handoff 품질, 문서/계약 정합성, 문제 분석 반영 여부 담당
- `Tester Worker`
  - `tests/` 범위 E2E, 회귀, repro, 반복 실패 근거 정리 담당

기본 스케줄링은 위 일곱 역할을 서브에이전트 기준으로 먼저 편성하고, 필요한 경우에만 탐색 전용 워커나 리뷰 전용 워커를 추가한다.

#### 실행 흐름

1. 사용자가 작업을 요청한다.
2. `Conductor`가 `planner`, `orchestrator`, `designer`, `frontend`, `backend`, `QA`, `tester` 역할 기준으로 먼저 팀을 구성하며 계획을 세운다.
3. `Task Scheduler`가 `fast`, `balanced`, `deep` 정책을 적용한다.
4. 각 워커가 provider adapter를 통해 요청을 수행한다.
5. 결과는 공통 이벤트 형식으로 정규화되어 UI로 전달된다.

#### 소유권 경계

- `Planner Worker`는 기본적으로 제품/스프린트 문서와 레퍼런스 분석 메모를 맡는다.
- `Designer Worker`는 기본적으로 디자인 기준 문서와 와이어프레임 메모를 맡는다.
- `Frontend Worker`는 기본적으로 `src-tauri/`를 수정하지 않는다.
- `Backend Worker`는 기본적으로 `src/`를 수정하지 않는다.
- `QA Worker`는 기본적으로 acceptance 문서, 체크리스트, 검증 메모를 맡는다.
- `Tester Worker`는 `tests/`와 검증 산출물에 집중한다.
- `Orchestrator Worker`는 문서, 통합, 충돌 조정을 맡는다.

병렬성은 위 소유권 경계가 선명할 때만 늘린다.

#### UI Behavior Contract Alignment

- backend status fields, snapshot meaning, and action availability must map cleanly to frontend buttons, badges, disclosures, and disabled states
- frontend should not invent UI-only heuristics when backend can expose the contract explicitly
- when UI behavior changes, confirm whether the runtime contract or snapshot schema must also change
- treat display semantics as a shared contract, not as separate frontend and backend interpretations

### English

Multi-agent execution should be orchestrated in the application layer.

#### Core Components

- `Conductor`
  - decomposes user requests into task graphs
- `Task Scheduler`
  - will eventually decide worker count and priority based on runtime-backed scheduling policies
- `Agent Worker`
  - execution unit connected to a provider
- `Context Store`
  - shared state for project, file, terminal, task context, and path recap
- `Approval Gate`
  - requires user approval before command execution or file edits

#### Default Worker Roles

- `Planner Worker`
  - owns sprint framing, next-sprint planning, reference analysis, work-path analysis, and planning docs
- `Orchestrator Worker`
  - checks the doc and code baseline, decomposes work, and integrates results
- `Designer Worker`
  - owns hierarchy, code-reading surfaces, interactions, wireframes, and workflow visibility using `VS Code`, `conductor`, and `cmux` as references
- `Frontend Worker`
  - owns UI and state changes inside `src/`
- `Backend Worker`
  - owns runtime and contract changes inside `src-tauri/`
- `QA Worker`
  - owns acceptance criteria, handoff quality, doc/contract consistency, and whether findings are reflected in validation gates
- `Tester Worker`
  - owns E2E, regression, repro work, and recurring-failure evidence inside `tests/`

Default scheduling should start from these seven sub-agent roles and add exploration-only or review-only workers only when needed.

#### Execution Flow

1. the user submits a task
2. the `Conductor` builds a plan by first forming `planner`, `orchestrator`, `designer`, `frontend`, `backend`, `QA`, and `tester` roles
3. the `Task Scheduler` applies `fast`, `balanced`, or `deep` policy
4. workers execute through provider adapters
5. results are normalized into a shared event format and sent to the UI

#### Ownership Boundary

- `Planner Worker` should focus on product docs, sprint docs, reference-analysis notes, and problem-analysis notes by default.
- `Designer Worker` should focus on design-guideline docs, wireframes, interaction notes, and workflow-visibility improvements by default.
- `Frontend Worker` should avoid editing `src-tauri/` by default.
- `Backend Worker` should avoid editing `src/` by default.
- `QA Worker` should focus on acceptance docs, checklists, validation notes, and whether findings are reflected in acceptance gates.
- `Tester Worker` should focus on `tests/`, validation artifacts, and repro evidence for recurring failures.
- `Orchestrator Worker` owns docs, integration, and conflict resolution.

Parallelism should be increased only when these ownership boundaries stay clear.

#### UI Behavior Contract Alignment

- backend status fields, snapshot meaning, and action availability must map cleanly to frontend buttons, badges, disclosures, and disabled states
- frontend should not rely on UI-only heuristics when backend can expose the contract explicitly
- when UI behavior changes, verify whether the runtime contract or snapshot schema must change too
- treat display semantics as a shared contract rather than separate frontend and backend interpretations

## Deferred Execution Policy

Fixed execution mode is a future scheduling-policy concept. Provider-backed `reasoningLevel` and `fastMode` are implemented UI, persistence, and request fields; they are model/provider request options, not `Fast`/`Balanced`/`Deep` scheduling policies.

Current contract:

- Only the fixed `Fast`, `Balanced`, and `Deep` scheduling presets are absent from the agent panel, settings modal, statusbar, workspace persistence, and `request_agent_suggestions` envelope. Capability-backed provider Fast is implemented as `fastMode` in the composer, provider-scoped session persistence, and request envelope.
- Provider model selection is exposed only when `read_agent_provider_capabilities` returns a supported, provider-owned catalog. Codex models come from the local Codex CLI catalog/config path; Claude models are the sanitized exact `value` fields in the current authenticated CLI initialization response. The selected ID is persisted by project, Agent session, and provider, then forwarded only while it remains valid for that provider. A definitively stale value is removed and sent as `null`; unavailable or not-yet-loaded capability state does not erase it. Codex forwards an explicit ID as `codex exec --model <id>`, while Claude refreshes its catalog, validates exact membership, and appends one `--model <value>` pair. `model: null` omits only the model flag; an explicit effort or enabled Fast still refreshes the catalog and resolves the returned `default` entry. Attachment controls follow the same capability contract; Codex image attachments selected through the composer are forwarded as `codex exec --image <path>`.
- Provider reasoning controls are capability-backed request options, not fixed frontend modes. Claude model rows carry optional `executionOptions`; when present, the effective selected model's effort list and Fast flag override provider-level compatibility fields even when empty/false. The composer prepends a UI-only `Default` effort row for model-owned options and sends it as `null`. Codex models omit `executionOptions` and continue to use provider-level `reasoningLevels`, `defaultReasoningLevel`, and `supportsFastMode`.
- Codex reasoning levels come from the local Codex model catalog/config path. When the user selects one of those supported values, the runtime forwards it through `codex exec -c model_reasoning_effort="<level>"`. Fast mode remains capability-gated in the UI and request envelope, but the runtime must not invent an unchecked Codex CLI config override for it.
- Reasoning/Fast persistence is keyed only by `codex` and `claude` inside each project Agent session. Explicitly selecting Claude's UI-only `Default` deletes that provider's `selectedReasoningLevels` entry. By contrast, temporarily selecting a model that cannot use the saved effort makes the effective request `null` without deleting the preference, so switching back can restore it. A stale Codex provider-level reasoning value recovers to the current provider default/first supported value; a stale Claude model-owned effort remains `null`/`Default` because no Claude default may be inferred. Send constructs one immutable provider/model/attachment/reasoning/Fast snapshot before state mutation or any asynchronous boundary.
- Future execution policies must be backed by explicit runtime policy definitions and provider capability discovery before any UI control is reintroduced.

## 상태 모델 / State Model

### 한국어

최소한 아래 상태 단위를 분리해야 한다.

- `ProjectState`
- `WorkspaceState`
- `TerminalState`
- `AgentSessionState`
- `TaskState`
- `AuthState`
- `SettingsState`

#### 상태 분리 원칙

- 인증 상태와 작업 상태를 분리한다.
- 터미널 버퍼 자체와 터미널 UI 상태를 분리한다.
- 프로젝트 메타데이터와 현재 활성 워크스페이스 상태를 분리한다.
- provider 세션 상태는 공통 타입으로 정규화한다.

### English

At minimum, the following state domains should be separated:

- `ProjectState`
- `WorkspaceState`
- `TerminalState`
- `AgentSessionState`
- `TaskState`
- `AuthState`
- `SettingsState`

#### Separation Rules

- separate auth state from task state
- separate terminal buffers from terminal UI state
- separate project metadata from active workspace state
- normalize provider session state into shared types
- include normalized Git branch metadata in project state

## 보안 경계 / Security Boundaries

### 한국어

`gtum`은 로컬 파일과 셸 실행을 다루기 때문에 보안 경계를 분명히 해야 한다.

#### 원칙

- 명령 실행은 항상 사용자 승인 경로를 거친다.
- 파일 수정은 승인 또는 명시적 작업 흐름 안에서만 허용한다.
- 로그인 세션과 민감 정보는 안전한 저장 계층을 사용한다.
- provider 응답은 공통 내부 포맷으로 정규화한 뒤 UI에 노출한다.

### English

Because `gtum` interacts with local files and shell execution, security boundaries must be explicit.

#### Principles

- command execution in the center workbench terminal is exclusively user-owned. Agent-tab requests, permission cards, and approved agent work must never create, select, rename, split, focus, write into, close, or otherwise mutate user-visible center terminal tabs or panes.
- approval in the right agent workspace only records a decision. If approved agent work needs execution, it must use an isolated agent-owned background job surface or hidden runtime record that is visible in the right agent workspace and task history. If that execution contract does not exist, the app must show an explicit unavailable/manual-run state instead of touching the center terminal.
- file edits are allowed only through approval or explicit editing flows
- login sessions and sensitive data must use secure storage
- provider responses should be normalized into shared internal formats before being exposed to the UI
- the first desktop `Codex` session-backed slice may reuse local `Codex CLI` login state and `codex exec` before deeper in-app callback handling is complete
- The active frontend provider seam is `src/shared/api/runtimeAgentSuggestions.ts`; it wraps `read_agent_provider_capabilities`, `read_agent_provider_diagnostics`, and `request_agent_suggestions`, requires `agentSessionId`, rejects provider-mismatched responses and malformed/cross-provider model catalogs, and normalizes either provider into a reply-only assistant turn or a command-bearing turn that requires review.
- `src/prototype.jsx` uses that seam only when the desktop runtime is available, the selected session provider is connected, and the project is runtime-backed. Pending requests render concrete operation progress sequentially in the owning Agent session, completed turns record answer-time metadata, numbered replies can become selectable decision event cards, and command-bearing responses become explicit permission event cards with direct `Allow once` and `Deny` actions. Browser preview must not keep a canned agent response path; it surfaces an explicit runtime-unavailable state instead.
- The right Agent workspace owns provider conversation, command review, decision recording, and Agent-job activity. `Deny` keeps the refusal in the Agent panel. `Allow once` is guarded so one decision creates at most one job, and it must not dispatch work to user-visible center terminal tabs or panes. Existing interactive runtime tabs may receive command writes only from explicit user terminal actions, not from agent approval.
- Agent-owned execution is modeled as a separate background contract through `src-tauri/src/runtime/agent_jobs.rs` and `src/shared/api/runtimeAgentJobs.ts`. It must not reuse `create_terminal_session`, `create_terminal_session_with_command`, `execute_terminal_session_command`, or a future equivalent when that command creates or mutates the center workbench terminal surface.
- The Codex `command` response is a gtum permission-card preview until the user approves it. Provider-side approval or sandbox settings, including `approval_policy=never`, must not be treated as a reason to refuse harmless permission-card suggestions.
- Desktop `request_agent_suggestions` runs Codex response generation in a blocking worker task rather than the command handler path. The `codex exec` child process has a 60-second timeout and is killed before returning a visible error if it hangs.
- Windows `Codex` suggestion requests must avoid passing the full prompt as a `codex.cmd` batch-file argument. The runtime sends the prompt over stdin and, when the npm shim can be resolved, executes `node.exe <codex.js>` directly before falling back to `codex.cmd`. Windows runtime subprocesses must be launched with no console window so Codex probes, model catalog reads, `codex exec`, and Git metadata reads do not flash terminal windows over the desktop UI.
- Claude subprocesses execute the CLI and optional helper only by validated canonical absolute executable paths. Helper command lines, arguments, whitespace, and shell syntax are rejected; Windows extended local-drive paths are normalized while UNC and volume paths fail closed. The child uses an absolute-only `PATH`, strips alternate provider/host/authentication environment variables, applies one deadline to all process I/O, and never exposes drained stderr.

## MVP 구현 순서 / MVP Implementation Order

### 한국어

1. Tauri + React + Vite 앱 셸 초기화
2. 프로젝트 열기와 파일 트리 기본 UI
3. PTY 기반 터미널 탭
4. 워크스페이스 상태 저장
5. 에이전트 패널 UI
6. OAuth/session 기반 provider 연결 구조
7. provider adapter 공통 인터페이스
8. 멀티 에이전트 오케스트레이션 초안
9. 실행 모드 정책 적용

### English

1. bootstrap the Tauri + React + Vite app shell
2. build project open flow and basic file tree UI
3. add PTY-backed terminal tabs
4. persist workspace state
5. add the agent panel UI
6. implement OAuth/session-based provider connection structure
7. add a shared provider adapter interface
8. implement read-only Git branch and dirty-state visibility
9. implement a first multi-agent orchestration layer
10. define runtime-backed scheduling policies before exposing execution-mode controls

## 오픈 질문 / Open Questions

### 한국어

- `Codex`와 `Claude`의 실제 공식 로그인 통합 방식이 데스크톱 앱에서 어떤 제약을 가지는가
- provider별 세션 저장 전략을 어느 수준까지 공통화할 수 있는가
- Windows PTY 계층에서 어떤 라이브러리 조합이 가장 안정적인가
- 터미널 세션 복원을 어디까지 완전 복원으로 볼 것인가

### English

- what constraints apply to the official desktop login integration paths for `Codex` and `Claude`
- how far provider session storage can be unified across providers
- which Windows PTY stack is most stable for the runtime layer
- how far terminal restoration should aim for full restoration versus partial recovery
