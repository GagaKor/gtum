# gtum Product Plan

## Documentation Language Policy

This document uses English as the single canonical documentation language.

Rules:

- New documents and new sections must be written in English only.
- Do not maintain parallel Korean and English sections for the same meaning.
- Existing bilingual content below is legacy content and should be consolidated into English when the relevant section is materially edited.
- Korean may be used in user conversations, temporary notes, and UI copy when appropriate, but this source-of-truth document should avoid bilingual duplication.

## When To Read This Document

Read this document when:

- you need to confirm product vision, scope, core value, or user problem framing
- you are changing top-level policies such as provider direction, execution modes, or multi-agent product behavior

## Current Runtime Policy (2026-07-15)

- `Codex` and `Claude` are available, real provider choices. `Codex` requires a validated local Codex CLI ChatGPT session. Claude credential precedence is an explicit non-empty `ANTHROPIC_API_KEY`, then a valid top-level user `apiKeyHelper`, then an already authenticated session in the installed, user-owned Claude Code CLI. Bedrock, Vertex, Foundry, unknown providers, and source mismatches fail closed.
- GTUM does not implement Claude.ai OAuth, open an authentication browser, collect a token, or read a Keychain/credential file. When the CLI session is missing, the app instructs the user to run `claude auth login` in their own terminal and reconnect. The CLI alone reads its credential store; GTUM persists only the non-secret source label `claude_cli_session` or the corresponding API-credential label.
- The Claude runtime adapter and its fail-closed connect/request revision leases are implemented and covered by focused and full Rust verification. A non-billing auth-status smoke succeeded for the local CLI-session path. No live `claude -p` inference has been run because it would consume Agent SDK/subscription credit; live response quality and billing behavior remain an explicit user-approval gate rather than an implementation claim.
- Provider and model selections belong to each Agent session. The session directory persists `providerId` plus provider-keyed `selectedModels`, so switching projects, sessions, or providers restores only that owner’s prior choice.
- Provider capability catalogs are runtime-owned. The frontend accepts a catalog only when its top-level provider and every current/available model owner match the requested provider, and model IDs and labels are nonblank and IDs are unique.
- Claude advertises only the bounded aliases `default`, `best`, `sonnet`, `opus`, and `haiku`. `best` delegates the entitlement-aware choice to Claude Code (currently Fable for eligible accounts and Opus otherwise); direct `fable`, exact-version, 1M-context, effort, and fast-mode controls remain unavailable until structured entitlement discovery exists. Account entitlement and organization-managed policy remain authoritative.
- A stored model is removed only after a supported catalog definitively loads without it; unavailable or not-yet-loaded capabilities preserve the stored choice. A removed or otherwise ineffective choice sends `model: null` and uses the runtime default. An explicit validated Claude alias becomes exactly one separate `--model <alias>` CLI pair, while an implicit default adds no model flag.
- Every provider request captures `projectPath + agentSessionId + providerId`. Blank session ownership is rejected before IPC, a response whose provider does not match the request is discarded, and stale connection-lease completion must be rejected before any reply or permission card is rendered.
- Claude CLI-session requests use `--safe-mode --setting-sources ""`; API-key/helper requests retain the `--bare` path. Both use strict structured output, disable model tools, MCP, slash commands, Chrome integration, session persistence, nonessential traffic, and official-marketplace auto-install, and run independently of the user-owned center terminal. Safe mode excludes user/project customizations, but organization-managed policy still applies and can include policy hooks, status-line commands, or file-suggestion commands; GTUM therefore does not claim an absolute process-level "no hooks" boundary. GTUM executes the CLI and any configured helper by validated canonical absolute paths, does not interpret helper arguments or shell syntax, and does not accept, render, log, or persist a raw Anthropic key or helper output.
- Local technical support for a user-owned Claude CLI session is not permission to distribute third-party Claude.ai login routing. Public distribution remains blocked until Anthropic approval/contract review confirms this use; otherwise public builds must keep Claude on API-key or supported cloud-provider credentials.
- Command-bearing replies expose only `Allow once` and `Deny`. There is no auto-approval, persisted allow rule, or `Always allow` action.
- `Allow once` creates exactly one isolated, session-owned Agent job. The job is observed, cancelled, and restored only in the right Agent workspace; it never creates, focuses, writes to, or otherwise mutates the user-owned center terminal.
- Agent jobs have bounded durable history and structured logs with `running`, `cancelling`, `completed`, `failed`, `cancelled`, and `interrupted` states. Runtime restart marks unfinished persisted jobs `interrupted` and never relaunches them.
- MVP stabilization is not complete until the full automated gate and installed-app Windows sign-off pass. The current automated aging scenario is necessary evidence, not a substitute for native Windows validation or a longer manual soak.

## 장문 문서 라우팅 / Long-Doc Routing

### 한국어

이 문서는 200줄을 넘는 장문 기준 문서다. 기본값은 끝까지 읽는 것이 아니라 아래 경로 중 필요한 것만 읽는 것이다.

- 제품 비전, 핵심 문제, 핵심 원칙만 확인할 때
  - 이 문서의 앞부분만 읽는다.
- provider 정책, 플랫폼 기준, 실행 모드 정책을 확인할 때
  - 이 문서와 `technical-design.md`를 같이 읽는다.
- 현재 구현 구조나 데이터 흐름이 궁금할 때
  - 이 문서 대신 `architecture.md`, `message-flow.md`를 먼저 읽는다.
- 역할 분리나 팀 운영 모델이 궁금할 때
  - `agent-team-topology.md`를 먼저 읽는다.

### English

This document exceeds 200 lines. Do not read it end to end by default. Use only the route that matches your question.

- when you only need vision, problem framing, or core principles
  - read only the front portion of this doc
- when you need provider policy, platform baseline, or execution-mode policy
  - read this doc together with `technical-design.md`
- when you need current implementation structure or data flow
  - read `architecture.md` and `message-flow.md` first instead of continuing through this whole doc
- when you need role split or team-operating model
  - read `agent-team-topology.md` first

## 개요 / Overview

### 한국어

`gtum`은 프로젝트, 코드 에디터, AI 에이전트, 그리고 필요할 때 강하게 전환해 쓰는 터미널 세션을 하나의 로컬 데스크톱 워크스페이스에서 함께 다루기 위한 제품이다.

이 제품은 다음 세 가지 감각을 결합하는 것을 목표로 한다.

- `conductor`의 오케스트레이션 감각
- `cmux`의 터미널 멀티플렉싱 감각
- 프로젝트와 터미널 상태를 함께 읽는 에이전트 협업 레이어

즉, 단순한 터미널 에뮬레이터가 아니라 `VS Code`처럼 코드를 읽기 쉬운 editor surface와 `conductor`처럼 에이전트를 관리하는 orchestration surface를 중심에 두고, 필요할 때 강한 터미널 mode로 전환하는 작업 환경을 만드는 것이 핵심이다.

이 제품은 개인적인 실제 사용 경험에서 나온 문제를 해결하려는 시도이기도 하다.

- `cmux`는 멀티 터미널 사용감은 좋았지만, IDE 성격이 약해서 코드를 함께 읽고 판단하기에 불편했다.
- `conductor`는 에이전트 관리, 코드 열람, VS Code 연동은 좋았지만, 터미널 기능이 약해서 실제 테스트 중인 로그를 자연스럽게 공유하고 활용하기 어려웠다.

`gtum`은 이 둘의 장점을 결합하면서, 특히 "코드를 보면서 에이전트를 운영하고, 동시에 현재 테스트 중인 터미널 로그를 바로 공유하고 활용할 수 있는 환경"을 목표로 한다.

### English

`gtum` is a local desktop workspace for managing projects, code editors, AI agents, and strong on-demand terminal sessions together.

The product combines:

- the orchestration feel of `conductor`
- the terminal multiplexing feel of `cmux`
- an agent collaboration layer that can read both project and terminal state

The goal is not to build another terminal emulator. The goal is to center a `VS Code`-like editor surface and a `conductor`-like agent-orchestration surface, while letting users switch into a stronger terminal mode whenever execution work requires it.

This product also comes from direct hands-on frustration with existing tools.

- `cmux` felt strong as a multi-terminal tool, but lacked enough IDE-like affordances to make code reading and inspection comfortable.
- `conductor` was strong at agent management, code visibility, and VS Code integration, but its terminal capabilities were weak enough that sharing and using live testing logs felt awkward.

`gtum` is intended to combine the strengths of both while specifically solving this gap: operating agents while reading code, and at the same time sharing and using live terminal logs from active testing workflows.

## 제품 비전 / Product Vision

### 한국어

`gtum`은 프로젝트를 중심으로 여러 터미널 세션과 여러 에이전트를 동시에 운영할 수 있는 로컬 워크스페이스다.

사용자는 이 앱에서 다음을 자연스럽게 수행할 수 있어야 한다.

- 로컬 프로젝트 열기
- 작업 목적에 따라 터미널 탭 분리하기
- 프로젝트 파일과 작업 상태를 터미널과 함께 관리하기
- 코드를 읽고 흐름을 추적할 수 있는 editor-like surface를 확보하기
- 에이전트가 프로젝트, 선택 파일, 터미널 맥락을 읽도록 하기
- 에이전트가 제안한 작업을 승인 후 실행하기
- 현재 테스트 중인 터미널 로그를 에이전트와 자연스럽게 공유하기
- 지금까지 밟아온 승인, 실패, 재시도 경로를 되짚어 문제를 파악하고 개선하기

### English

`gtum` is a local workspace where users can operate multiple terminal sessions and multiple agents around a single project context.

The app should make it easy to:

- open a local project
- split terminal tabs by task
- manage project files and task state alongside terminals
- keep an editor-like surface where users can read code and trace flow comfortably
- let agents read project, selected-file, and terminal context
- approve and execute agent-suggested actions
- share active testing logs with agents naturally inside the same workspace
- review the path of approvals, failures, and retries already taken so problems can be diagnosed and improved

## 해결하려는 문제 / Problem Statement

### 한국어

`gtum`이 해결하려는 핵심 문제는 다음과 같다.

1. 좋은 멀티 터미널 경험과 좋은 코드 탐색 경험이 하나의 앱 안에서 잘 결합되지 않는다.
2. 에이전트 관리가 잘 되는 도구는 있어도, 현재 실행 중인 터미널 로그를 작업 맥락으로 다루는 경험이 약하다.
3. 테스트와 디버깅 중 생성되는 실시간 로그를 코드, 프로젝트 구조, 에이전트 작업 흐름과 함께 연결하기 어렵다.
4. 에이전트에 일을 전임해도 사용자는 결국 코드를 읽고 흐름을 따라가야 하는데, 기존 도구는 코드 보기 surface나 대화 가시성이 불편한 경우가 많다.
5. 지금까지 어떤 시도와 승인, 실패, 우회가 있었는지 한눈에 재구성하기 어려우면 반복 문제를 개선하기 어렵다.

즉, `gtum`은 "프로젝트, 코드, 터미널, 에이전트"가 분리된 도구들 사이를 오가는 불편함을 줄이는 것을 목표로 한다.

### English

The core problems `gtum` is trying to solve are:

1. strong multi-terminal workflows and strong code-reading workflows are rarely combined well in a single app
2. some tools manage agents well, but do not treat live terminal logs as first-class working context
3. real-time logs produced during testing and debugging are hard to connect with code, project structure, and agent workflows
4. even when work is delegated to agents, users still need to read code and trace flow, but existing tools often make code-viewing surfaces or agent conversations uncomfortable
5. if users cannot reconstruct which attempts, approvals, failures, and detours already happened, recurring workflow problems are hard to improve

In short, `gtum` aims to reduce the friction of constantly switching between separate tools for projects, code, terminals, and agents.

## 핵심 원칙 / Core Principles

### 한국어

1. 프로젝트 우선
   모든 터미널 세션은 프로젝트 맥락 안에 존재한다.
2. 에이전트 보조 우선
   에이전트는 기본적으로 보조자이며, 사용자의 승인 없이 과도하게 행동하지 않는다.
3. 탭은 작업 경계
   각 탭은 `app`, `server`, `tests`, `deploy`처럼 명확한 작업 단위를 나타낸다.
4. 로컬 우선
   초기 버전은 원격 인프라 없이도 로컬 개발 환경에서 충분히 가치 있어야 한다.
5. 안전한 자동화
   읽기는 쉽게, 실행은 통제 가능하게 설계한다.
6. 팀빌딩 우선
   의미 있는 작업은 단일 에이전트보다 서브에이전트를 포함한 멀티 에이전트 팀빌딩을 기본값으로 삼고, `planner + orchestrator + designer + frontend + backend + QA + tester` 분업을 먼저 적용한다.
7. 코드 읽기 우선
   에이전트 위임이 있더라도 사용자가 코드를 읽고 흐름을 따라갈 수 있는 surface는 1급 작업 영역이어야 하며, 단순 사이드바나 하단 채팅 패널로 밀어넣지 않는다.
8. 경로 가시성 우선
   task history, validation notes, sprint 문서, path recap UI는 단순 기록이 아니라 사용자가 이미 밟아온 경로, 승인, 실패, 재시도를 재구성해 문제점을 파악하고 개선안을 만들 수 있는 입력이어야 한다.

### English

1. Project-first
   Every terminal session exists inside a project context.
2. Agent-assisted, not agent-dominant
   Agents help by default and should not take broad action without approval.
3. Tabs are work boundaries
   Each tab represents a focused work unit such as `app`, `server`, `tests`, or `deploy`.
4. Local-first
   The first version should be valuable in local development environments without remote infrastructure.
5. Safe automation
   Reading should be easy, execution should remain controlled.
6. Team-building first
   Non-trivial work should default to multi-agent team formation with sub-agents, starting from the `planner + orchestrator + designer + frontend + backend + QA + tester` split before any narrower path.
7. Code-reading first
   Even with agent delegation, the surface for reading code and tracing flow should remain first-class rather than collapsing into a sidebar-only or bottom-panel chat model.
8. Path-visibility first
   task history, validation notes, sprint docs, and path-recap UI should function as interpretable inputs that help users reconstruct prior approvals, failures, and retries so recurring problems can be improved.

## 대상 사용자 / Target Users

### 한국어

- 여러 서비스와 명령을 동시에 다루는 개발자
- editor 중심으로 코드를 읽으면서 에이전트를 운영하고 싶은 사용자
- 실행, 테스트, 디버깅, 배포 루틴을 필요할 때 터미널 mode로 전환해 다루고 싶은 사용자

### English

- developers working across multiple services and commands
- users who want to operate agents while staying inside an editor-first workflow
- users who want to switch into a strong terminal mode when execution, testing, debugging, or deployment needs it

## 지원 플랫폼 / Supported Platforms

### 한국어

`gtum`은 다음 데스크톱 플랫폼을 지원 대상으로 한다.

- Ubuntu
- Windows
- macOS

개발 편의상 Ubuntu를 주요 개발 환경으로 사용할 수 있지만, 첫 실사용 판단과 UX 마찰 측정은 Windows를 기준으로 삼는다.

초기 설계와 구현은 처음부터 크로스 플랫폼을 전제로 해야 한다.

- 특정 운영체제 전용 셸 동작에 지나치게 의존하지 않는다.
- 파일 경로, 프로세스 실행, PTY 처리, 단축키, 시스템 권한 차이를 구조적으로 흡수해야 한다.
- UI와 런타임 계층 모두 운영체제 차이를 고려한 추상화가 필요하다.

### English

`gtum` targets the following desktop platforms:

- Ubuntu
- Windows
- macOS

Ubuntu may remain the primary development environment, but first daily-use validation and UX-friction assessment are anchored on Windows.

The architecture and implementation should be cross-platform from the start.

- avoid over-depending on shell behavior from a single operating system
- absorb differences in file paths, process spawning, PTY handling, shortcuts, and system permissions
- introduce clear abstractions for OS differences in both the UI and runtime layers

## 브랜치 전략 / Branch Strategy

### 한국어

현재 저장소는 초기 상태이며 기본 브랜치로 `master`만 존재한다.

하지만 `gtum`은 앞으로 사람과 에이전트가 함께 작업하는 저장소가 될 예정이므로, 브랜치 전략을 미리 정의하는 것이 중요하다. 운영 개념은 `git flow`를 참고하되, 실제 사용은 지나치게 무겁지 않게 가져가는 방향을 권장한다.

권장 브랜치 역할은 다음과 같다.

- `master`
  - 안정 기준 브랜치
- `dev`
  - 통합 개발 브랜치
- `feature/*`
  - 기능 개발, 문서 작업, 기술 실험
- `release/*`
  - 릴리즈 준비와 안정화
- `hotfix/*`
  - 긴급 수정

초기에는 `master`만 있어도 괜찮지만, 실제 구현이 시작되면 최소한 `dev`와 `feature/*` 운영을 도입하는 것이 바람직하다.

### English

The repository is currently in an early state and only has `master` as its base branch.

However, `gtum` is expected to become a repository where humans and agents work in parallel, so branch strategy should be defined early. The workflow should follow the core ideas of `git flow`, while staying lightweight enough for everyday use.

The recommended branch roles are:

- `master`
  - stable baseline branch
- `dev`
  - integration branch
- `feature/*`
  - feature work, documentation work, and technical experiments
- `release/*`
  - release preparation and stabilization
- `hotfix/*`
  - urgent fixes

It is acceptable to start with only `master`, but once implementation begins, introducing at least `dev` and `feature/*` is recommended.

## 주요 사용 시나리오 / Main Use Cases

### 한국어

#### 1. 프로젝트 워크스페이스

사용자가 로컬 저장소를 열면 다음 정보를 볼 수 있다.

- 프로젝트 이름과 경로
- 파일 트리
- Git 브랜치와 변경 상태
- 저장된 터미널 탭
- 열린 editor/terminal 탭과 split group 상태
- 활성 에이전트 목록

#### 2. 멀티 탭 터미널 작업

사용자는 용도에 따라 다음과 같은 탭을 생성한다.

- `app`
- `server`
- `tests`
- `deploy`

각 탭은 독립적인 셸 세션과 출력 기록을 가진다.
새 디자인 기준에서는 터미널 탭뿐 아니라 read-only editor 탭도 같은 중앙 workbench 안에서 열리고, 사용자는 탭을 끌어 새 group으로 분리하거나 좌우/상하 split으로 배치할 수 있다.

#### 3. 에이전트 관찰

에이전트는 다음 정보를 읽을 수 있다.

- 현재 프로젝트 구조
- 선택된 파일
- 현재 탭의 터미널 출력
- 최근 작업 기록
- 승인, 실패, 재시도, 우회 경로 요약

이를 바탕으로 에러를 요약하거나, 문제 원인을 설명하거나, 다음 작업을 제안할 수 있다.
또한 사용자가 이미 밟은 경로를 다시 읽고 반복 문제를 드러낼 수 있어야 한다.

#### 4. 에이전트 보조 실행

에이전트는 다음과 같은 행동을 제안할 수 있다.

- 누락된 의존성 설치
- 실패한 테스트를 새 탭에서 재실행
- 특정 로그 파일 확인
- 디버깅 전용 탭 생성

실행은 항상 사용자 승인 이후에 이뤄진다.

#### 5. 에이전트 계정 연결

사용자는 에이전트 제공자를 앱이 관리하는 연결 경로로 연결한다.

초기 지원 대상은 다음과 같다.

- `Codex`
- `Claude`

인증 방식은 다음 원칙을 따른다.

- 첫 실사용 `Codex` 경로의 목표는 `Conductor`나 `Codex CLI`와 유사한 `OAuth/session login`이다.
- 장기 API 토큰이나 `OPENAI_API_KEY`를 최종 사용자 기본 연결 경로로 채택하지 않는다.
- 개발 중 임시로 env/API key bridge를 둘 수는 있지만, 이는 release target이 아니라 내부 브리지로만 취급한다.
- 연결된 계정 상태, 권한 범위, 연결 준비 상태를 앱 안에서 확인할 수 있어야 한다.

#### 6. 원격 명령 및 리포트 채널

사용자는 데스크톱 앱 안에서만 작업하는 것이 아니라, 외부 메시징 채널을 통해서도 상태를 받고 명령을 보낼 수 있으면 좋다.

초기 후보 채널은 다음과 같다.

- `SMS`
- `Telegram` 연동

이 기능의 목적은 다음과 같다.

- 현재 실행 중인 작업의 상태를 원격에서 확인
- 간단한 명령을 원격으로 전달
- 작업 완료, 실패, 승인 필요 상태를 메시지로 리포트

다만 이 기능은 보안과 인증 경계가 중요하므로, `MVP 완료 후` 다음 단계 확장 기능으로 도입하는 것이 바람직하다.

#### 7. 설정과 실행 정책

새 디자인 시안은 설정을 별도 보조 화면이 아니라 제품의 실행 통제면으로 본다.

설정은 최소한 다음을 다룬다.

- provider 연결과 세션 상태
- 런타임에서 실제로 동기화된 provider capability와 readiness
- accent 같은 외관 설정
- 병렬 worker 수와 응답 스트리밍
- 위험도별 승인 정책
- trusted directory와 forbidden pattern
- 자동 승인 이력과 undo 가능한 알림

### English

#### 1. Project Workspace

When a user opens a local repository, the app should show:

- project name and path
- file tree
- Git branch and working state
- saved terminal tabs
- open editor/terminal tabs and split-group state
- active agents

#### 2. Multi-Tab Terminal Work

The user creates task-focused tabs such as:

- `app`
- `server`
- `tests`
- `deploy`

Each tab has its own shell session and output history.
In the updated design baseline, read-only editor tabs and terminal tabs live inside the same center workbench. Users can drag tabs into new groups or split them horizontally and vertically.

#### 3. Agent Observation

An agent can read:

- current project structure
- selected files
- the active read-only code surface or excerpt from the selected file
- terminal output from the current tab
- recent task history
- summarized approvals, failures, retries, and detours

Based on that context, the agent can summarize issues, explain likely causes, or suggest next steps.
It should also help users reread the path already taken and expose recurring problems.

The first code-reading delivery should remain read-only.
Editing, saving, and diff application can follow later, but the MVP path should first prove that users can read code, compare it with live logs, and understand why an approval was suggested.

#### 4. Agent-Assisted Decisions

An agent can suggest actions such as:

- installing missing dependencies
- rerunning failed tests in a new tab
- inspecting a log file
- creating a dedicated debugging tab

The center terminal is user-owned. Agent conversations, command review, decisions, and isolated job activity stay in the right agent panel. `Allow once` records the decision and creates one agent-owned job without creating a terminal tab, writing into an existing terminal, or dispatching through the terminal runtime. `Deny` records the refusal and starts no process.

#### 5. Agent Account Connection

Users connect agent providers through app-managed connection paths rather than by pasting raw API tokens into the UI.

The initial supported providers are:

- `Codex`
- `Claude`

The authentication model follows these rules:

- the target first daily-use `Codex` path is `OAuth/session login`, similar in shape to `Conductor` or `Codex CLI`
- the `Claude` path uses an explicit API key first, then a strict top-level user `apiKeyHelper`, then an already authenticated local Claude Code CLI session; the CLI-session fallback is local/internal-use infrastructure pending Anthropic approval for third-party distribution
- GTUM never starts Claude.ai OAuth or captures a token. Users authenticate externally with `claude auth login`, and the installed CLI alone reads its credential store
- GTUM must not expose an in-app raw-key form or persist the key, helper command output, email, organization, token, or subscription metadata
- an `OPENAI_API_KEY` bridge may exist temporarily during development, but it is an internal Codex bridge rather than the release target
- the app should show connection state, granted scopes, and readiness diagnostics

#### 6. Remote Command and Report Channels

Users may also want to receive status updates and send commands through external messaging channels, not only from inside the desktop app.

The initial candidate channels are:

- `SMS`
- `Telegram`

The goals of this feature are:

- check the state of running work remotely
- send lightweight commands from outside the desktop app
- receive reports for completion, failure, or approval-required states

Because this adds important security and authentication boundaries, it should be introduced after the base desktop workflow is stable.

#### 7. Settings and Execution Policy

The updated design treats settings as an execution-control surface, not a secondary preferences page.

Current settings cover:

- provider connections and session state
- runtime-synced provider capabilities and readiness diagnostics
- appearance settings such as the accent color
- a read-only execution contract stating that every command requires review and approved work runs as an isolated Agent job

Parallel-worker tuning, risk-based policy, trusted directories, forbidden patterns, and auto-approval remain future work. They must not appear as functional controls before a persisted runtime contract exists.

Model, reasoning, attachment, and provider fast-mode request controls are exposed only when the runtime discovers provider capabilities. Fixed `Fast`/`Balanced`/`Deep` execution-policy controls remain deferred until scheduling policies are explicit; the Codex path must not display those fixed modes as if they were synchronized runtime state.

## 정보 구조 / Information Architecture

### 한국어

앱은 크게 네 가지 영역과 상단/하단 상태 shell로 구성된다.

#### Workbench Shell

역할:

- 현재 프로젝트, 브랜치, 활성 탭, split group 수를 상단 titlebar에서 표시
- 연결된 provider 수와 provider session/readiness 상태를 상단 또는 하단 상태 영역에서 표시
- branch, 변경 파일 수, ahead/behind, tab/group 상태를 status bar에서 빠르게 확인
- 큰 대시보드 카드 대신 editor/terminal/agent가 바로 작업 가능한 상태로 보이게 함

#### Projects

역할:

- 로컬 폴더 연결
- 파일 트리 및 메타데이터 표시
- Git 상태 요약
- 현재 프로젝트와 최근 프로젝트를 compact project row로 표시
- `Projects`와 `Files`를 독립적으로 접고 펼치는 accordion section으로 제공
- 저장된 워크스페이스와 실행 프리셋 관리
- 프로젝트 단위 작업 추적

#### Terminal Workspace

역할:

- read-only editor tab과 terminal tab을 같은 workbench tab model로 관리
- 터미널 탭 생성 및 관리
- tab drag/drop, context menu, 좌우/상하 split group 지원
- 명령 기록과 출력 로그 유지
- 세션 복원
- 현재까지의 실행 경로와 재시도 흐름을 다시 읽을 수 있게 유지

#### Agents

역할:

- 프로젝트와 터미널 상태 관찰
- 선택된 파일, 현재 탭 출력, 최근 명령을 context summary로 표시
- provider와 session/readiness 상태를 한 줄에서 확인하고, provider 전환만 현재 UI에서 지원
- 문제 설명
- 작업 제안
- 승인된 명령 실행
- 작업 진행 상태 추적
- 어떤 경로가 실패했고 어떤 개선이 필요한지 요약

#### Settings and Execution Policy

역할:

- provider 연결, 외관, 승인 정책, 제품 정보를 한 화면에서 관리
- 위험도별 승인 정책을 `always ask`, `auto`, `trusted dirs only`로 구분
- high-risk 명령은 항상 명시 승인으로 고정
- forbidden pattern은 정책과 무관하게 차단 또는 재확인
- 자동 실행된 low-risk 명령은 audit trail과 undo 가능한 toast로 남김

### English

The app is organized around four primary domains plus a top/bottom status shell.

#### Workbench Shell

Responsibilities:

- show current project, branch, active tab, and split-group count in the titlebar
- show connected provider count and provider session/readiness state in the top or bottom status area
- make branch, changed-file count, ahead/behind state, and tab/group state quickly readable in the status bar
- avoid a large dashboard-card default; editor, terminal, and agent surfaces should be immediately usable

#### Projects

Responsibilities:

- connect to local folders
- display file trees and metadata
- summarize Git state
- show the current project and recent projects as compact project rows
- provide `Projects` and `Files` as independently collapsible accordion sections
- manage saved workspaces and run presets
- track project-level tasks

#### Terminal Workspace

Responsibilities:

- manage read-only editor tabs and terminal tabs through the same workbench tab model
- create and manage terminal tabs
- support tab drag/drop, context menus, and horizontal/vertical split groups
- preserve command history and output logs
- restore sessions
- preserve a readable path of executions and retries so prior work can be reconstructed

#### Agents

Responsibilities:

- observe project and terminal state
- expose selected files, current tab output, and recent commands as a context summary
- let users inspect provider/session readiness and switch providers in one compact row
- explain problems
- suggest actions
- record approved command decisions without terminal execution
- track task progress
- summarize which paths failed and which improvements are worth trying next

#### Settings and Execution Policy

Responsibilities:

- manage available provider connections and appearance, and show the current execution contract and product information in one settings surface
- keep approval behavior in `always ask` mode for agent-suggested commands
- expose only `Allow once` and `Deny` for the current command-review contract
- create approved work through isolated Agent jobs without terminal side effects

## 권장 UI 구조 / Recommended UI Structure

### 한국어

#### 좌측 사이드바

- icon-only left rail과 접고 펼치는 side panel
- 4px dock resize handle을 통한 side panel 폭 조절과 임계값 기반 collapse
- `Projects`와 `Files`를 기본 accordion section으로 노출하고, 검색, 소스 제어, 아웃라인, 설정 view로 확장
- 현재 프로젝트, 최근 프로젝트, 폴더 열기 action을 compact project row로 표시
- 프로젝트 메타데이터, Git 브랜치 및 상태, 파일 트리, 변경 파일 수
- compact row와 single-line ellipsis 기반의 정보 구조

#### 중앙 작업 영역

- editor-like code surface와 terminal surface를 같은 tab model로 관리
- terminal, editor, diff, test, preview 탭 타입
- tab drag/drop과 context menu 기반의 상하좌우 split group
- pane-local tab strip, line anchor, active tab status, running banner
- 빈 group에서는 `+`를 통해 새 탭을 열 수 있는 명확한 empty state

#### 우측 패널

- 에이전트 작업창
- provider header와 session/readiness 상태를 먼저 읽는 compact provider row
- context summary, 요청 thread, quick prompts, composer
- 현재 pending suggestion과 승인 검토 진입점
- 워크플로우 문제 요약과 프로젝트 인사이트

#### 설정과 승인 정책

- `Connections`, `Models`, `Appearance`, `Execution`, `About` 탭을 가진 settings modal
- provider별 세션, scope, 만료 상태와 모델 기본값
- 병렬 worker 수, 응답 스트리밍 설정
- 위험도별 승인 정책, trusted dirs, forbidden patterns
- 자동 승인 이력과 undo 가능한 toast

#### 하단 패널 또는 드로어

- 기본 구조에서는 고정 하단 패널을 두지 않는다.
- 단, 1줄 status bar는 branch, 변경 수, tab/group 수 같은 메타 상태를 표시할 수 있다.
- 로그, 알림, 명령 기록, 경로 요약은 workbench pane, compact dock, contextual surface로 푼다.

구체적인 UI 토큰, 색상, 반경, 컴포넌트 상태 표현은 `docs/design-system.md`를 기준으로 한다.

### English

#### Left Sidebar

- icon-only left rail plus collapsible side panel
- side-panel width resizing through a 4px dock handle with threshold-based collapse
- expose `Projects` and `Files` as the default accordion sections, then extend into Search, Source Control, Outline, and Settings views
- show the current project, recent projects, and open-folder action as compact project rows
- project metadata, Git branch and state, file tree, and changed-file count
- compact rows and single-line ellipsis as the default information structure

#### Center Workspace

- manage editor-like code surfaces and terminal surfaces through the same tab model
- terminal, editor, diff, test, and preview tab types
- top/right/bottom/left split groups driven by tab drag/drop and context menus
- pane-local tab strips, line anchors, active-tab status, and running banners
- a clear empty state where users can open a new tab through `+`

#### Right Panel

- agent workspace
- provider header plus compact provider/session-readiness row
- context summary, request thread, quick prompts, and composer
- current pending suggestions and approval-review entry points
- workflow findings and project insights

#### Settings and Approval Policy

- settings modal with `Connections`, `Appearance`, `Execution`, and `About` tabs
- provider sessions, scopes, expiration state, and readiness diagnostics
- a truthful read-only Execution description until persisted scheduling and approval policies exist

#### Bottom Panel or Drawer

- no permanent bottom panel in the default structure
- a one-line status bar may show metadata such as branch, change count, and tab/group count
- logs, notifications, command history, and path recap should be handled through workbench panes, compact docks, or contextual surfaces

Use `docs/design-system.md` for concrete UI tokens, colors, radius, and component state representation.

## Core User Flow

#### Primary Flow

1. The user opens a project.
2. The user reviews the project and files through the left `Projects` and `Files` accordion.
3. The user opens editor or terminal tabs in the center workbench and arranges them into split groups when needed.
4. The user runs commands per tab or reads code.
5. The agent reads current project, selected-file, active-tab output, and recent-command context.
6. The agent suggests explanations or next actions.
7. Suggested commands open inline review inside the right agent panel.
8. `Allow once` creates one isolated Agent job. The right panel shows its status, bounded structured logs, exit metadata, and Cancel action while the center terminal remains unchanged.
9. The user reviews the agent decision, job outcome, failure, and retry path before deciding the next action.

#### Example Scenario

1. The user opens a monorepo.
2. The user creates `frontend`, `backend`, and `tests` tabs.
3. A startup error appears in the `backend` tab.
4. The agent reads the output and related config files.
5. The agent explains the likely cause and proposes a fix command.
6. The user selects `Allow once`; an isolated Agent job runs without opening a debugging tab in the center workbench.
7. The user compares the new result with prior attempts to see whether the problem is repeating.

## 에이전트 모델 / Agent Model

### 한국어

에이전트는 범위와 권한이 명확해야 한다.

#### 기본 동작

- 기본적으로 읽기 전용
- 명령 실행에는 명시적 승인 필요
- 프로젝트 단위 컨텍스트 보유
- 특정 탭 또는 전체 워크스페이스 단위로 관찰 가능

#### 추천 에이전트 역할

- `Observer`
  - 로그와 상태를 읽고 요약
- `Planner`
  - 다음 작업 순서 제안
- `Operator`
  - 승인된 명령 실행
- `Reviewer`
  - 변경사항과 위험 요소 점검

#### 권한 모델

최소한 다음 권한을 구분해야 한다.

- 파일 읽기
- 터미널 출력 읽기
- 명령 제안
- 명령 실행
- 파일 수정

MVP에서는 명령 실행과 파일 수정 모두 사용자 승인을 요구하는 것이 바람직하다.

새 디자인 시안 기준의 승인 정책은 다음을 제품 기본값으로 둔다.

- `low-risk`, `mid-risk`, `high-risk`를 구분한다.
- `low-risk`는 설정에 따라 자동 승인될 수 있지만, audit trail과 undo 가능한 알림을 남겨야 한다.
- `mid-risk`는 `always ask`, `auto`, `trusted dirs only` 중 정책으로 제어하되 기본값은 신중해야 한다.
- `high-risk`는 항상 명시 승인만 허용한다.
- trusted directory 밖의 자동 실행은 기본적으로 막거나 다시 확인한다.
- forbidden pattern은 위험도와 관계없이 항상 차단 또는 재확인한다.

### English

Agents should have clear scope and permissions.

#### Default Behavior

- read-only by default
- explicit approval required for command execution
- project-scoped context
- tab-scoped or workspace-scoped observation

#### Suggested Roles

- `Observer`
  - reads logs and summarizes state
- `Planner`
  - proposes next-step ordering
- `Operator`
  - records approved command decisions and keeps terminal execution user-owned
- `Reviewer`
  - reviews changes and risks

#### Permission Model

At minimum, the product should distinguish between:

- reading files
- reading terminal output
- suggesting commands
- executing commands
- editing files

In the MVP, command execution and file edits should both require user approval.

The updated design baseline sets the following approval-policy defaults:

- distinguish `low-risk`, `mid-risk`, and `high-risk`
- `low-risk` commands must still be reviewed in the Agent panel and must not auto-run
- `mid-risk` behavior remains explicit review only, with no automatic terminal execution
- `high-risk` always requires explicit approval
- terminal execution remains user-owned and is never triggered by an Agent-panel approval decision
- forbidden patterns are always blocked or reconfirmed regardless of risk level

## 멀티 에이전트 오케스트레이션 / Multi-Agent Orchestration

### 한국어

여러 에이전트가 하나의 프로젝트를 함께 담당하게 하려면, 핵심은 UI 형태가 아니라 실행 구조를 먼저 설계하는 것이다.

중심 개념은 다음과 같다.

- 하나의 상위 오케스트레이터가 전체 작업을 이해한다.
- 여러 하위 에이전트가 역할별로 하위 작업을 맡는다.
- 모든 에이전트는 같은 프로젝트 컨텍스트를 공유한다.
- 실제 실행과 수정은 권한 정책에 따라 통제된다.
- 최종 통합과 판단은 다시 상위 오케스트레이터가 맡는다.

#### 기본 구조

1. 사용자가 프로젝트 단위의 큰 작업을 요청한다.
2. 상위 오케스트레이터가 작업을 하위 단위로 분해한다.
3. 각 하위 작업을 적절한 에이전트에 배정한다.
4. 에이전트들은 병렬로 탐색, 구현, 테스트, 리뷰를 수행한다.
5. 상위 오케스트레이터가 결과를 모으고 최종 결정을 내린다.

#### 기본 역할 분리

- `Planner`
  - 현재 스프린트 목적 정리, 다음 스프린트 초안, 레퍼런스 분석, 작업 경로 분석, 기획 문서화
- `Orchestrator`
  - 전체 작업 분해, 우선순위 설정, 문서 기준선 정렬, 결과 통합
- `Designer`
  - `VS Code`, `conductor`, `cmux` 분석을 바탕으로 정보 계층, 코드 읽기 surface, 인터랙션, 와이어프레임, 작업 경로 가시화 설계
- `Frontend`
  - `src/` 중심 UI, 상태, 사용자 흐름 구현
- `Backend`
  - `src-tauri/` 중심 runtime, contract, provider, 시스템 로직 구현
- `QA`
  - 완료조건, 수용 기준, handoff 품질, 문서/계약 정합성 확인
- `Tester`
  - E2E, 회귀, 재현 절차, aging 관점 검증

기본 운영 모델은 위 일곱 역할로 항상 먼저 팀빌딩하고, 필요할 때만 탐색 전용 또는 리뷰 전용 역할을 추가한다.

#### 설계 원칙

- 하나의 파일을 여러 에이전트가 동시에 수정하지 않도록 책임 범위를 분리한다.
- 읽기 전용 탐색 에이전트와 실제 수정 에이전트를 구분한다.
- 공유 프로젝트 컨텍스트는 동일하게 보되, 쓰기 권한은 역할마다 제한한다.
- 테스트와 리뷰는 구현과 병렬로 수행할 수 있지만, 최종 병합 판단은 중앙에서 수행한다.
- 에이전트 수를 늘리는 것보다 작업 분해 품질이 더 중요하다.
- 작은 작업이라도 먼저 `planner + orchestrator + designer + frontend + backend + QA + tester` 기준으로 분해를 시도한다.

#### 프로젝트 컨텍스트 예시

멀티 에이전트 구조에서 공통으로 참조하는 프로젝트 컨텍스트는 다음을 포함할 수 있다.

- 프로젝트 경로와 파일 트리
- 현재 브랜치와 변경 상태
- 열려 있는 터미널 탭 목록
- 탭별 최근 로그
- 최근 명령 실행 기록
- 개선이 필요한 승인, 실패, 재시도, 우회 요약
- 작업 큐와 에이전트별 담당 상태

### English

To let multiple agents work on a single project effectively, the key is not the UI shape but the execution architecture.

The core idea is:

- one top-level orchestrator understands the whole task
- multiple worker agents handle scoped subtasks by role
- all agents share the same project context
- execution and edits remain controlled by permission policy
- final integration and judgment return to the orchestrator

#### Basic Structure

1. The user submits a project-level task.
2. A top-level orchestrator decomposes it into smaller subtasks.
3. Each subtask is assigned to an appropriate agent.
4. Agents work in parallel on exploration, implementation, testing, and review.
5. The orchestrator gathers results and makes the final decision.

#### Default Role Split

- `Planner`
  - frames the current sprint goal, drafts the next sprint, analyzes references, reviews the work path already taken, and updates planning docs
- `Orchestrator`
  - decomposes work, prioritizes tasks, aligns the doc baseline, and integrates results
- `Designer`
  - uses `VS Code`, `conductor`, and `cmux` to design hierarchy, code-reading surfaces, interactions, wireframes, and workflow-visibility patterns
- `Frontend`
  - implements UI, state, and user-facing flow changes around `src/`
- `Backend`
  - implements runtime, contract, provider, and system logic around `src-tauri/`
- `QA`
  - owns acceptance criteria, handoff quality, and doc/contract consistency checks
- `Tester`
  - validates E2E behavior, regressions, repro steps, and aging-sensitive areas

The default operating model should always build the team from these seven roles first, and only add read-only exploration or review specialists when needed.

#### Design Principles

- separate ownership so multiple agents do not edit the same file at the same time
- distinguish read-only exploration agents from editing agents
- share the same project context, but limit write permissions by role
- testing and review can run in parallel with implementation, but final integration should remain centralized
- increasing the number of agents matters less than improving task decomposition quality
- attempt decomposition with `planner + orchestrator + designer + frontend + backend + QA + tester` before adding more specialized roles

#### Example Project Context

A shared project context for multi-agent work may include:

- project path and file tree
- current branch and working state
- list of open terminal tabs
- recent logs per tab
- recent command execution history
- summarized approvals, failures, retries, and detours worth improving
- task queue and per-agent assignment state

## 실행 모드 / Execution Modes

Current status: deferred for fixed execution policies. The current app does not expose `Fast`, `Balanced`, or `Deep` execution-mode controls, does not persist execution mode in workspace state, and does not send execution mode in the Codex request envelope. It may expose provider-backed reasoning and fast-mode request options only when `read_agent_provider_capabilities` reports real support. Reintroduce fixed execution policies only after provider capability discovery and runtime scheduling policies exist.

### 한국어

`fast mode`는 단순한 UI 토글이 아니라, 어떤 깊이로 얼마나 넓은 컨텍스트를 읽고 몇 개의 에이전트를 어떤 모델로 돌릴지 정하는 실행 정책이다.

즉, 같은 질문이라도 실행 모드에 따라 다음 요소가 달라질 수 있다.

- 사용할 모델 크기
- 읽을 파일 수
- 읽을 로그 길이
- 병렬 에이전트 수
- 교차 리뷰 여부
- 응답 속도와 비용

#### Fast

목표:

- 빠른 응답
- 낮은 비용
- 얕은 분석

특징:

- 작은 모델 우선
- 적은 파일과 짧은 로그만 사용
- 짧은 작업 위주로 분해
- 교차 검토 생략 가능
- 초안, 요약, 빠른 명령 제안에 적합

#### Balanced

목표:

- 속도와 정확도의 균형

특징:

- 기본 모드로 사용하기 적합
- 필요한 파일과 로그를 적절히 포함
- 제한적인 병렬 에이전트 운영
- 간단한 검토 절차 포함 가능

#### Deep

목표:

- 더 높은 정확도와 신뢰도

특징:

- 더 큰 모델 사용 가능
- 더 넓은 파일 범위와 더 긴 로그 사용
- 더 많은 에이전트를 병렬로 운영
- 리뷰, 테스트, 교차 확인 포함
- 느리지만 복잡한 문제 해결에 적합

#### Fast Mode를 켜기 위해 필요한 것

제품 차원에서는 다음이 필요하다.

- 모드별 정책 정의
- 모드별 허용 컨텍스트 크기
- 모드별 병렬 에이전트 수 제한
- 모드별 승인 정책 또는 자동화 범위
- 모드 전환 시 사용자에게 예상 동작을 명확히 보여주는 UI

#### 예시 정책 항목

- `modelClass`
- `maxAgents`
- `maxFiles`
- `maxTerminalLines`
- `allowCrossReview`
- `approvalRequiredForExec`

### English

`fast mode` is not just a UI toggle. It is an execution policy that defines how deeply the system reasons, how much context it reads, how many agents it runs, and which models it uses.

That means the same user request may behave differently depending on:

- model size
- number of files read
- amount of log history read
- number of parallel agents
- whether cross-review is enabled
- speed and cost profile

#### Fast

Goals:

- fast response
- lower cost
- shallow analysis

Characteristics:

- prefer smaller models
- use fewer files and shorter logs
- decompose into shorter tasks
- skip cross-review when acceptable
- good for drafts, summaries, and quick command suggestions

#### Balanced

Goals:

- balance speed and accuracy

Characteristics:

- suitable as the default mode
- includes a practical amount of files and logs
- uses limited parallel agents
- may include lightweight review steps

#### Deep

Goals:

- higher accuracy and confidence

Characteristics:

- can use larger models
- reads broader file scope and longer logs
- runs more agents in parallel
- includes review, testing, and cross-checking
- slower, but better for complex problem solving

#### What Is Needed to Support Fast Mode

At the product level, the system needs:

- per-mode policy definitions
- per-mode context limits
- per-mode limits on parallel agents
- per-mode approval or automation rules
- UI that clearly communicates expected behavior when switching modes

#### Example Policy Fields

- `modelClass`
- `maxAgents`
- `maxFiles`
- `maxTerminalLines`
- `allowCrossReview`
- `approvalRequiredForExec`

## MVP 범위 / MVP Scope

### 한국어

첫 버전은 가장 작은 완결된 경험에 집중한다.

#### 포함 범위

- 로컬 프로젝트 열기
- 프로젝트 파일 트리 표시
- 현재 프로젝트와 최근 프로젝트를 좌측 accordion에서 관리
- read-only editor tab과 terminal tab을 같은 workbench 안에서 표시
- 기본적인 tab drag/drop과 split group 상태 표시
- 터미널 탭 생성, 이름 변경, 종료
- 탭별 출력 기록 유지
- 워크스페이스 상태 복원
- 에이전트 패널 제공
- 에이전트가 프로젝트 맥락과 현재 탭 출력을 읽을 수 있음
- 에이전트가 선택 파일과 최근 명령 맥락을 읽을 수 있음
- provider/session readiness를 오른쪽 agent workspace에서 확인하고 provider를 전환
- 에이전트가 명령을 제안할 수 있음
- Agent-panel approval records decisions without terminal execution
- Explicit review remains required for agent-suggested commands

#### 제외 범위

- 원격 협업
- 여러 장치 간 동기화
- 복잡한 Git 전용 UI
- 광범위한 권한을 가진 자율 에이전트
- 복잡한 pane layout 저장/복원과 고급 pane 관리
- 신뢰 경계 없는 자동 승인
- 완전한 IDE 대체

### English

The first version should focus on the smallest complete experience.

#### In Scope

- open a local project
- show the project file tree
- manage the current project and recent projects in the left accordion
- show read-only editor tabs and terminal tabs inside the same workbench
- show basic tab drag/drop and split-group state
- create, rename, and close terminal tabs
- preserve output history per tab
- restore workspace state
- provide an agent panel
- let the agent read project context and current tab output
- let the agent read selected-file and recent-command context
- inspect provider/session readiness and switch providers in the right agent workspace
- let the agent suggest commands
- keep command review and decisions in the right agent workspace
- execute approved agent commands only through isolated, observable Agent jobs; center terminal tabs remain user-owned

#### Out of Scope

- remote collaboration
- multi-device sync
- complex Git-focused UI
- autonomous agents with broad permissions
- complex pane layout persistence and advanced pane management
- auto-approval without trusted boundaries
- full IDE replacement

## 기능 요구사항 / Functional Requirements

### 한국어

#### 프로젝트 관리

- 사용자는 로컬 프로젝트를 추가하고 제거할 수 있어야 한다.
- 각 프로젝트는 최근 탭과 워크스페이스 메타데이터를 저장해야 한다.
- 시스템은 현재 브랜치와 기본적인 변경 상태를 보여줄 수 있어야 한다.
- 프로젝트 UI는 현재 브랜치와 Git 상태를 표시하고, 향후 `git flow` 스타일 브랜치 운영과도 자연스럽게 연결될 수 있어야 한다.
- 좌측 panel은 현재 프로젝트, 최근 프로젝트, 파일 트리를 accordion section으로 빠르게 접고 펼칠 수 있어야 한다.

#### 워크벤치 관리

- 중앙 workbench는 read-only editor tab과 terminal tab을 같은 tab model로 다뤄야 한다.
- 사용자는 tab을 다른 group으로 이동하거나 좌우/상하 split group을 만들 수 있어야 한다.
- 각 group은 독립적인 tab strip과 active tab state를 가져야 한다.
- editor tab은 최소한 line number, active line, syntax color, file path state를 보여줘야 한다.

#### 터미널 관리

- 각 탭은 독립적인 셸 세션을 실행해야 한다.
- 하나의 프로젝트 안에서 여러 탭을 만들 수 있어야 한다.
- 각 탭은 스크롤백과 명령 기록을 유지해야 한다.
- 앱을 다시 열어도 세션 상태를 복원할 수 있어야 한다.

#### 에이전트 통합

- 에이전트는 선택된 프로젝트 파일을 읽을 수 있어야 한다.
- 에이전트는 현재 또는 선택된 탭의 출력을 읽을 수 있어야 한다.
- 에이전트는 작업 제안을 생성할 수 있어야 한다.
- 명령 실행 전 사용자가 실행 대상과 명령 내용을 확인하고 승인할 수 있어야 한다.
- 사용자는 `Codex`와 `Claude` 제공자를 앱 안에서 연결할 수 있어야 한다.
- 첫 실사용 `Codex` 경로는 `OAuth/session login`을 사용해야 한다.
- env/API key bridge는 필요하더라도 개발용 임시 경로에 머물러야 한다.
- 앱은 연결 상태, 권한 범위, 연결 준비 상태와 진단 정보를 사용자에게 표시해야 한다.
- 앱은 provider capability discovery와 scheduling policy가 준비되기 전까지 provider별 모델 선택이나 실행 모드를 고정 값으로 보여주지 않아야 한다.
- 앱은 위험도별 승인 정책, trusted directory, forbidden pattern, 자동 승인 이력을 표시해야 한다.
- 향후 `SMS`와 `Telegram` 같은 외부 채널을 통해 상태 리포트와 제한된 원격 명령을 지원할 수 있어야 한다.

#### 작업 인식

- 앱은 제안된 작업과 실행 기록을 추적해야 한다.
- 프로젝트 단위로 진행 중인 작업과 완료된 작업을 구분해서 볼 수 있어야 한다.

### English

#### Project Management

- users should be able to add and remove local projects
- each project should store recent tabs and workspace metadata
- the system should show the current branch and basic dirty state
- the project UI should expose current branch and Git state while remaining compatible with a `git flow`-style branch model
- the left panel should let users collapse and expand current project, recent projects, and file tree sections quickly

#### Workbench Management

- the center workbench should treat read-only editor tabs and terminal tabs through the same tab model
- users should be able to move tabs between groups or create horizontal/vertical split groups
- each group should own an independent tab strip and active-tab state
- editor tabs should at least show line numbers, active line, syntax color, and file path state

#### Terminal Management

- each tab should run an isolated shell session
- users should be able to create multiple tabs per project
- each tab should preserve scrollback and command history
- session state should be restorable when reopening the app

#### Agent Integration

- agents should be able to read selected project files
- agents should be able to read current or selected tab output
- agents should be able to generate task suggestions
- users should be able to review commands before one-time execution in an isolated Agent job
- users should be able to connect `Codex` and `Claude` through their approved runtime credential contracts, and each Agent session should persist its own selected `providerId`
- the first daily-use `Codex` path should use `OAuth/session login`
- the `Claude` path should prefer an explicit `ANTHROPIC_API_KEY`, then a user-level `apiKeyHelper` containing one canonical absolute regular executable path, then an authenticated installed CLI session; it should never collect or persist raw credentials in GTUM
- a missing Claude session should direct the user to run `claude auth login` outside GTUM. GTUM must not initiate Claude.ai OAuth or capture tokens
- any `OPENAI_API_KEY` bridge should remain a temporary Codex development path rather than the default user route
- the app should display connection state, readiness diagnostics, and granted scopes
- the app should expose only model choices owned by the active provider’s runtime capability catalog; fixed execution-mode choices remain deferred until scheduling policy support exists
- risk-based policies, trusted-directory rules, and auto-approval history remain future work and must not appear as functional controls before a persisted runtime contract exists
- the product should remain extensible for external report and limited remote-command channels such as `SMS` and `Telegram`

#### Task Awareness

- the app should track suggested actions and execution history
- a project should show active and completed tasks

## 비기능 요구사항 / Non-Functional Requirements

### 한국어

- 로컬 프로젝트 기준 빠른 시작 속도
- 안정적인 PTY 처리
- 낮은 지연의 터미널 렌더링
- 명확한 에이전트 권한 경계
- 복원 가능한 세션 상태
- Ubuntu, Windows, macOS에서 일관된 동작
- 운영체제별 차이를 흡수하는 크로스 플랫폼 추상화
- session-based provider 인증과 재연결의 안정적인 상태 관리
- 다중 브랜치 작업에서도 명확한 Git 상태 표현

### English

- fast startup for local projects
- stable PTY handling
- low-latency terminal rendering
- clear permission boundaries for agent actions
- restorable session state
- consistent behavior across Ubuntu, Windows, and macOS
- cross-platform abstractions for OS-specific differences
- reliable state handling for session-based provider authentication and reconnects
- clear Git state representation across multi-branch workflows

## 기술 방향 / Technical Direction

### 한국어

#### 확정 기술 스택

`gtum`의 1차 구현 스택은 다음 조합으로 확정한다.

- 데스크톱 셸: `Tauri`
- 시스템 및 네이티브 레이어: `Rust`
- 프론트엔드: `React` + `TypeScript`
- 프론트엔드 빌드 도구: `Vite`
- 터미널 렌더링: `xterm.js`
- 프로세스 관리: PTY 기반 로컬 셸 세션
- 상태 관리: `Zustand`
- 로컬 저장: 초기에는 파일 기반 저장, 이후 필요 시 `SQLite`

플랫폼 기준은 다음과 같다.

- 1차 지원 플랫폼: `Ubuntu`, `Windows`, `macOS`
- 첫 실사용 기준: `Windows`
- 구현 원칙: 처음부터 크로스 플랫폼 기준으로 설계

에이전트 연결 기준은 다음과 같다.

- 초기 지원 제공자: `Codex`, `Claude`
- 첫 실사용 `Codex` 경로: `OAuth/session login`
- 개발용 임시 경로: 필요 시 `OPENAI_API_KEY` 기반 bridge를 둘 수 있지만 source of truth는 아님

한 줄로 정리하면 다음과 같다.

`UI와 오케스트레이션은 TypeScript/React, 시스템 제어와 터미널 런타임은 Rust/Tauri`

#### 선택 이유

`Tauri`는 이 제품에 필요한 다음 조건과 잘 맞는다.

- 로컬 파일 시스템 접근
- 로컬 프로세스 및 셸 관리
- 데스크톱 앱 패키징
- 브라우저 셸보다 가벼운 런타임

`xterm.js`는 UI 안에서 터미널을 안정적으로 렌더링하기에 적합하며, PTY 계층과 결합하면 실제 셸 동작에 가까운 경험을 제공할 수 있다.

`React`와 `TypeScript`는 탭, 패널, 작업 큐, 에이전트 상태, 승인 흐름처럼 상호작용이 많은 UI를 빠르게 구축하기 좋다.

`Rust`는 PTY, 프로세스 제어, 파일 시스템 접근, 세션 복원처럼 안정성과 성능이 중요한 런타임 계층에 적합하다.

이 조합은 Ubuntu, Windows, macOS를 함께 지원하는 데 필요한 크로스 플랫폼 추상화를 설계하기에도 유리하다.

또한 에이전트 로그인, 세션 보관, 보안 경계 처리를 런타임과 UI 계층으로 나눠 다루기에도 적합하다.

#### 이 선택이 gtum에 잘 맞는 이유

`gtum`은 일반적인 웹앱보다 다음 능력이 더 중요하다.

- 로컬 프로젝트를 안정적으로 읽고 관리하는 능력
- 장시간 유지되는 터미널 세션을 다루는 능력
- 여러 에이전트 실행을 위한 안전한 시스템 경계
- 가벼운 데스크톱 배포와 빠른 시작 속도

위 요구사항 기준에서 `Tauri + Rust + React + TypeScript` 조합이 가장 균형이 좋다.

#### 채택하지 않은 대안

- `Electron + React + TypeScript`
  - 개발 진입은 더 쉬울 수 있지만, 앱 무게와 런타임 효율 측면에서 우선순위가 낮다.
- `Wails + Go + React`
  - 충분히 가능한 선택지지만, 현재 목표와 생태계 성숙도를 고려하면 Tauri 쪽이 더 유리하다.
- `Flutter`
  - UI 프레임워크로는 강점이 있지만, 개발자용 터미널 중심 도구를 만드는 데는 상대적으로 비효율적일 수 있다.

### English

#### Chosen Stack

The implementation stack for the first version of `gtum` is finalized as:

- desktop shell: `Tauri`
- systems and native layer: `Rust`
- frontend: `React` + `TypeScript`
- frontend build tool: `Vite`
- terminal rendering: `xterm.js`
- process management: PTY-backed local shell sessions
- state management: `Zustand`
- local persistence: file-based storage first, with `SQLite` as a later option

Platform targets are:

- first-class desktop targets: `Ubuntu`, `Windows`, `macOS`
- first daily-use baseline: `Windows`
- implementation rule: design for cross-platform behavior from day one

Agent connection rules are:

- initial providers: `Codex`, `Claude`
- first daily-use `Codex` path: `OAuth/session login`
- temporary development path: an `OPENAI_API_KEY`-backed bridge may exist, but it is not the source-of-truth release path
- `Claude`: an implemented real-provider path that selects an explicit first-party Anthropic API key, then a strict top-level user `apiKeyHelper`, then an already authenticated user-owned local CLI session. No in-app OAuth/token handling exists, no live inference has been run without explicit user approval, and public CLI-session distribution remains blocked pending Anthropic approval/contract review

In one sentence:

`TypeScript/React for UI and orchestration, Rust/Tauri for system control and terminal runtime`

#### Why This Stack Was Chosen

`Tauri` is a strong fit because the product needs:

- local filesystem access
- local process and shell management
- desktop-native packaging
- a lighter runtime than a browser-first shell

`xterm.js` is a practical foundation for terminal rendering, and a PTY layer can preserve real shell behavior.

`React` and `TypeScript` are well suited for building highly interactive UI such as tabs, panels, task queues, agent state, and approval workflows.

`Rust` is a strong fit for the runtime layer where PTY handling, process control, filesystem access, and session restoration require performance and reliability.

This stack is also well suited to designing the abstractions needed to support Ubuntu, Windows, and macOS together.

It also fits a split responsibility model where login, session storage, and security boundaries for agent providers are handled across the runtime and UI layers.

#### Why This Fits gtum

Compared with a typical web app, `gtum` cares more about:

- reliably reading and managing local projects
- handling long-lived terminal sessions
- enforcing safe system boundaries for agent execution
- lightweight desktop packaging and fast startup

Against those requirements, `Tauri + Rust + React + TypeScript` provides the best balance.

#### Alternatives Not Chosen

- `Electron + React + TypeScript`
  - easier to start with, but lower priority due to heavier runtime characteristics
- `Wails + Go + React`
  - viable, but less attractive than Tauri for the current goals and ecosystem maturity
- `Flutter`
  - strong as a UI framework, but less efficient for a developer-facing terminal-centric tool

## 초기 도메인 모델 / Initial Domain Model

### 한국어

#### Project

- id
- name
- path
- git metadata
- workspace ids

#### Workspace

- id
- project id
- layout state
- open tab ids
- active tab id

#### TerminalTab

- id
- workspace id
- title
- shell
- cwd
- session id
- output buffer

#### Agent

- id
- project id
- role
- scope
- permission state

#### Task

- id
- project id
- source agent id
- status
- summary

#### CommandRun

- id
- task id
- target tab id
- command
- status
- output summary

### English

#### Project

- id
- name
- path
- git metadata
- workspace ids

#### Workspace

- id
- project id
- layout state
- open tab ids
- active tab id

#### TerminalTab

- id
- workspace id
- title
- shell
- cwd
- session id
- output buffer

#### Agent

- id
- project id
- role
- scope
- permission state

#### Task

- id
- project id
- source agent id
- status
- summary

#### CommandRun

- id
- task id
- target tab id
- command
- status
- output summary

## 제안 마일스톤 / Proposed Milestones

#### Milestone 1: Local Project Shell

- open a project
- render the file tree
- show basic project metadata

#### Milestone 2: Terminal Workspace

- PTY-backed tabs
- persistent tab state
- stable terminal rendering

#### Milestone 3: Agent Panel

- agent chat UI
- project and tab context reading
- suggestion UI

#### Milestone 4: Approval-Based Actions

- command proposal flow
- user approval UI
- isolated Agent-job execution with right-panel lifecycle visibility and no center-terminal mutation

#### Milestone 5: Project Task Layer

- task feed
- command history
- lightweight project summaries

## 리스크와 오픈 질문 / Risks and Open Questions

### 한국어

#### 1. PTY와 데스크톱 런타임 복잡도

이 제품은 로컬 셸 관리의 안정성에 크게 의존하므로 초기에 기술 검증이 꼭 필요하다.

#### 2. 에이전트 권한 UX

승인이 너무 많으면 답답하고, 너무 적으면 불안하다. 적절한 균형이 중요하다.

#### 3. 범위 확장 위험

제품이 IDE 전체를 대체하는 방향으로 흐르지 않도록, 프로젝트 오케스트레이션과 터미널 워크플로우에 집중해야 한다.

#### 4. 세션 복원 난이도

탭과 셸 상태를 얼마나 자연스럽게 복원하느냐가 핵심 사용자 경험이 될 가능성이 높다.

### English

#### 1. PTY and Desktop Runtime Complexity

The product depends heavily on robust local shell management, so early technical validation is important.

#### 2. Agent Permission UX

If approvals are too frequent, the product will feel slow. If they are too loose, the product will feel unsafe.

#### 3. Scope Creep

The product should avoid drifting into a full IDE and stay focused on project orchestration and terminal workflows.

#### 4. Session Restoration Difficulty

How naturally the product restores tabs and shell state may become a core user experience differentiator.

## 한 줄 제품 정의 / One-Line Product Definition

### 한국어

`gtum`은 프로젝트를 중심으로 여러 터미널 세션과 여러 에이전트를 함께 운영하는 로컬 데스크톱 워크스페이스다.

### English

`gtum` is a local desktop workspace for operating multiple terminal sessions and multiple agents around a project context.

## 다음 단계 제안 / Recommended Next Step

### 한국어

다음 문서로 아래 내용을 다루는 기술 설계서를 작성하는 것이 좋다.

- 앱 셸과 폴더 구조
- PTY 세션 아키텍처
- 프론트엔드 레이아웃 및 상태 모델
- 에이전트 통합 경계

### English

The next document should be a technical design covering:

- app shell and folder structure
- PTY session architecture
- frontend layout and state model
- agent integration boundaries

현재 기준으로는 위 기술 스택을 전제로 설계를 진행한다.
