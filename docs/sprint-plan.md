# gtum 스프린트 계획 / Sprint Plan

## 문서 목적 / Document Purpose

### 한국어

이 문서는 `docs/mvp-backlog.md`를 바탕으로 `gtum`의 MVP 개발을 실제 스프린트 단위로 나눈 실행 계획 문서다.

이 문서의 목적은 다음과 같다.

- MVP 백로그를 구현 순서에 맞게 묶는다.
- 각 스프린트의 목표와 산출물을 분명히 한다.
- 의존성과 리스크를 앞당겨 검증한다.
- 사람과 에이전트가 같은 개발 리듬으로 움직일 수 있게 한다.

### English

This document turns `docs/mvp-backlog.md` into a sprint-by-sprint execution plan for the `gtum` MVP.

Its purpose is to:

- group backlog items into delivery order
- define sprint goals and deliverables clearly
- validate dependencies and risks early
- give humans and agents a shared implementation rhythm

## 언제 읽는 문서인가 / When To Read This Document

### 한국어

아래 상황이면 이 문서를 읽는다.

- 지금 무엇을 먼저 만들지, 어떤 스프린트가 현재 기준인지 확인해야 할 때
- 산출물, 종료 기준, 다음 스프린트로 넘길 작업을 정해야 할 때

### English

Read this document when:

- you need to determine what should be built next or which sprint is the active planning baseline
- you need to confirm deliverables, closing criteria, or handoff into the next sprint

## 현재 기준 메모 / Current Baseline Note

### 한국어

이 문서에는 과거 스프린트 기록이 함께 들어 있으므로, 예전 `terminal-first` 표현이 남아 있을 수 있다.

현재 UI 방향의 source of truth는 과거 스프린트 기록보다 아래 문서가 우선한다.

- [product-plan.md](/home/kwon/project/gtum/docs/product-plan.md)
- [design-system.md](/home/kwon/project/gtum/docs/design-system.md)
- [frontend-design-benchmarks.md](/home/kwon/project/gtum/docs/frontend-design-benchmarks.md)
- [ui-ux-wireframes.md](/home/kwon/project/gtum/docs/ui-ux-wireframes.md)
- [design-concepts-sprint-15.md](/home/kwon/project/gtum/docs/design-concepts-sprint-15.md)
- [New Product Design Implementation Plan](/home/kwon/project/gtum/docs/superpowers/plans/2026-05-28-new-product-design-implementation.md)

`Sprint 17`부터는 `/Users/kwon/Downloads/test (1)`의 새 디자인 시안이 기존 구현보다 우선한다. 기존 구조와 충돌하면 새 디자인을 기준으로 구현하고, 기존 UI는 필요한 경우 secondary surface로 내려야 한다.

### English

This document also contains historical sprint records, so older `terminal-first` phrasing may remain in past sprint sections.

For the current UI direction, treat the following documents as higher priority than historical sprint wording:

- [product-plan.md](/home/kwon/project/gtum/docs/product-plan.md)
- [design-system.md](/home/kwon/project/gtum/docs/design-system.md)
- [frontend-design-benchmarks.md](/home/kwon/project/gtum/docs/frontend-design-benchmarks.md)
- [ui-ux-wireframes.md](/home/kwon/project/gtum/docs/ui-ux-wireframes.md)
- [design-concepts-sprint-15.md](/home/kwon/project/gtum/docs/design-concepts-sprint-15.md)
- [New Product Design Implementation Plan](/home/kwon/project/gtum/docs/superpowers/plans/2026-05-28-new-product-design-implementation.md)

Starting with `Sprint 17`, the new design draft in `/Users/kwon/Downloads/test (1)` overrides the existing implementation. When old structure conflicts with the new design, implement the new design and move old UI into secondary surfaces when needed.

## Current Claude Model-Specific Effort And Fast Mode — 2026-07-15

Goal: expose only the reasoning and Fast options returned for the effective Claude model, preserve independent Codex/Claude preferences, and reject stale or unsupported combinations before inference.

Delivered contract:

- each prompt-free Claude catalog model carries bounded `executionOptions`; selected-model data overrides provider-level compatibility fields, and no alias or entitlement is inferred
- the compact composer renders only supported controls. Claude adds a UI-only `Default` effort row that sends `reasoningLevel: null`; unsupported models hide the controls without erasing saved provider preferences
- each project Agent session persists `selectedReasoningLevels` and `fastModes` under `codex`/`claude`. Stale provider-level Codex effort recovers to the current supported default, while stale Claude model-owned effort remains null
- send freezes provider, model, attachments, effort, and Fast with the original project/session owner before asynchronous work; Agent execution never mutates the user-visible center terminal
- an explicit Claude model, explicit effort, or enabled Fast triggers a fresh catalog read and exact effective-model validation before inference. Supported effort maps to separate `--effort <level>` arguments
- every inference request emits exactly one sanitized settings JSON with explicit `fastMode`; helper mode merges only `apiKeyHelper`. The child removes `CLAUDE_CODE_EFFORT_LEVEL`, and `CLAUDE_CODE_DISABLE_FAST_MODE=1` rejects enabled Fast before spawn

Verification state:

- malformed capability normalization, model switching, compact/narrow geometry, provider/project/session persistence, immutable request ownership, settings/argv mapping, policy-environment handling, and pre-spawn rejection have focused Rust and serial Playwright coverage; lint and production build passed during implementation
- catalog fixtures and the bounded prompt-free compatibility smoke are distinct from live inference. The preliminary initialize-only smoke run today passed (`1 passed, 0 failed`) through `live_catalog_compatibility_smoke_is_prompt_free`; the final clean-candidate rerun remains pending. No user prompt, paid Claude inference, billing, or response-quality validation ran for this slice
- Fast can require organization enablement and usage credits even when a model reports support; GTUM does not present discovered support as billing entitlement
- the active execution record is [Claude Effort and Fast Mode Implementation Plan](./superpowers/plans/2026-07-15-claude-effort-fast-mode.md); its final clean-tree full gate and exact-SHA integration record remain the closing step

## Completed Claude Account Model Catalog And Picker Repair — 2026-07-15

Goal: replace the clipped static Claude alias menu with the bounded model catalog returned by the authenticated installed CLI, then preserve each exact selectable value through renderer state and request-time validation.

Delivered scope:

- `read_agent_provider_capabilities` remains the provider-owned catalog boundary and runs blocking provider discovery away from the Tauri IPC executor.
- Claude starts the installed CLI in source-specific isolated SDK stream mode, sends exactly one serialized `initialize` control request, closes stdin, and parses only one bounded matching success response. Discovery sends no prompt, `--print`, assistant turn, or inference request.
- The catalog keeps only sanitized returned `value` IDs and one-line labels formed from `displayName` plus the leading description segment. It discards identity, email, organization, subscription, and unrelated response fields.
- The native control envelope is version-coupled to Claude Code. Wrong IDs, error or extra envelopes, malformed JSON, blank/control-bearing/leading-dash/duplicate/excessive fields, empty results, spawn failure, timeout, or oversized output reject the catalog atomically. There is no static, cached, historical, or inferred entitlement fallback.
- Historical versions, Fable, and extended-context variants are selectable only when the current account/policy response returns their exact `value`. `resolvedModel` never grants a second selectable identifier.
- Failed or unavailable discovery exposes no selectable catalog and preserves the stored per-project/session/provider value for a later valid read. A successful supported catalog may remove a definitively absent value.
- In this completed catalog slice, an explicit model refreshes the authenticated catalog before inference spawn, requires exact returned-value membership, and adds exactly one separate `--model <value>` pair after validation. `model: null` omits the model flag. The newer effort/Fast contract still refreshes and resolves the returned `default` entry when an explicit effort or enabled Fast is requested with a null model.
- Closed composer provider/model/reasoning/fast controls use compact non-wrapping icons or marks. Exact names and current state appear inside the opened lists, while exact accessible labels remain on the controls. Every popup stays within the Agent panel and viewport at the default, 260 px, and 240 px Agent widths. Current account labels remain one line at the default width; longer valid labels wrap inside their option without clipping or horizontal overflow. The model list scrolls internally and brings the selected row into view when reopened. Listbox semantics, one truthful selection, Escape focus restoration, provider-change close, persistence, and zero center-terminal mutation remain required.
- Provider capability state is generation-owned. Each successfully returned startup connection and every connect, disconnect, reconnect, provider-action error, or capability-read error invalidates the old provider catalog synchronously; a connected active provider schedules a fresh read, and a late success or rejection cannot overwrite a newer connection or catalog state.

Current-account investigation (environment evidence, not a product-owned list):

- a prompt-free CLI initialization response exposed `default`, `opus[1m]`, `claude-fable-5[1m]`, `sonnet`, and `haiku`, with labels identifying Opus 4.8 1M, Fable 5, Sonnet 5, and Haiku 4.5
- older Opus/Sonnet versions shown in external screenshots were not returned and therefore are not inferred as selectable entitlement
- no live Claude inference, command response, billing, or response-quality validation ran

Verification status:

- parser/protocol, exact-argv, request-time validation, async capability ownership, picker geometry, persistence, and center-terminal isolation pass the current focused and full gates
- focused evidence passes Claude runtime 62/62, Claude workspace UI 16/16, and runtime suggestion service 24/24; the fresh complete gate passes lint, production build, serial Playwright 221/221, Rust formatting/check, and Rust 169 passed / 1 ignored
- the ignored production discovery smoke passes explicitly against the authenticated installed CLI and returns the five sanitized current-account model pairs without a prompt or inference turn; independent runtime/UI reviews report no critical, important, or minor findings
- macOS-to-Windows cross-target checking remains blocked before GTUM crate compilation by Tauri `tauri-winres` because `llvm-rc` is unavailable; native Windows validation remains pending
- after a final fetch and ancestor proof, the verified slice advanced `origin/dev` from `5ff3fd2` to `fa56cbe` through a non-force `HEAD:dev` push without renaming the working branch
- the active execution record is [Claude Account Model Catalog and Picker Repair Implementation Plan](./superpowers/plans/2026-07-15-claude-account-model-catalog-picker.md)

## Provider-Aware Model Selection Slice — 2026-07-15 (Historical Baseline, Superseded)

Goal: make model choices follow the selected provider, survive project/session/provider switching, and reach the isolated provider process only after runtime-backed ownership validation.

Delivered scope:

- `read_agent_provider_capabilities` remains the catalog authority. The frontend rejects a top-level provider mismatch, cross-provider current/available models, blank IDs or labels, and duplicate model IDs.
- Claude exposes exactly `default`, `best`, `sonnet`, `opus`, and `haiku`. `best` delegates the entitlement-aware choice to Claude Code; direct Fable, exact-version, 1M-context, effort, and fast-mode controls remain deferred until structured entitlement discovery exists.
- Each project/Agent-session record persists `selectedModels` independently for Codex and Claude. Provider switching restores the matching choice without leaking one provider's model into the other.
- A supported catalog that definitively omits a stored model removes only that provider's value and sends `model: null`; unavailable or not-yet-loaded capability state preserves persistence but cannot forward the value until validation succeeds.
- Send snapshots the provider and its validated explicit model together. Claude accepts only bounded aliases, adds exactly one separate `--model <alias>` pair for an explicit choice, adds no model flag for implicit default, and rejects invalid values before child spawn.
- The model picker exposes provider-specific accessible naming, listbox semantics, one truthful selection, Escape close/focus behavior, and closes when the provider changes. These paths do not touch the user-owned center terminal.
- Account entitlement and organization-managed policy remain authoritative. This slice does not infer direct Fable availability and did not run live `claude -p` inference.

Verification evidence:

- the Claude Rust runtime module passes 44/44, including fake-child exact argv and pre-spawn invalid-value rejection
- `runtime-agent-suggestions-service.spec.ts` passes 24/24
- the provider-aware subset in `claude-provider-workspaces.spec.ts` passes 5/5, including reload, stale/unavailable behavior, request ownership, accessibility state, and zero center-terminal calls
- the complete post-change gate passes lint, production build with only the existing greater-than-500-KB chunk warning, serial Playwright 210/210, Rust formatting/check, and the full Rust suite 149/149
- an independent implementation review and a separate documentation review reported no critical, important, or minor findings
- `origin/dev` was re-fetched, verified as an ancestor, and advanced without force to tested evidence commit `8de8518`; the current branch name and the separate dirty worktree were left unchanged

## Current Claude CLI Session Correction — 2026-07-15

Goal: let GTUM validate an already authenticated, user-owned local Claude Code CLI session without reading or persisting its credentials, while retaining explicit API-key/helper support, fail-closed ownership, and the user-owned center-terminal boundary.

Delivered scope:

- approved commands create project- and Agent-session-scoped jobs in the isolated Agent runtime; `Always allow`, auto-approval, and terminal-target execution paths are removed
- `agent-jobs.json` stores at most 100 jobs with bounded structured logs; restart converts stored nonterminal work to `interrupted` without relaunching it
- the right Agent panel hydrates, polls, cancels, and renders job outcomes while prioritizing active work over terminal history
- session close and approval creation are protected in both event orders, stale hydration/cancel responses cannot regress terminal state, and completed jobs stop polling
- Codex requires a validated local CLI ChatGPT session; request validation runs once on a blocking worker and synchronizes through a revision lease so stale results cannot overwrite disconnect/reconnect
- Claude is exposed as an available, real provider; the auth and suggestion services no longer coerce it to deferred or short-circuit Connect/Disconnect IPC
- every Agent session persists its own `providerId`, and delayed provider requests are owned by captured `projectPath + agentSessionId + providerId`; blank ownership and provider-mismatched responses are rejected before rendering
- Claude selects credentials in the order `ANTHROPIC_API_KEY`, strict top-level user `apiKeyHelper`, then the installed CLI's existing first-party session. Helper arguments, whitespace, shell syntax, third-party provider authentication, unknown methods, and source mismatches fail closed
- GTUM never starts Claude.ai OAuth, captures a token, or reads the Keychain/credential store. Missing-login guidance tells the user to run `claude auth login` in their own terminal, then reconnect
- CLI-session status and requests use `--safe-mode --setting-sources ""`; API-key/helper requests retain `--bare`. The runtime resolves canonical executables, uses an absolute-only child `PATH`, removes competing credential/provider modes, bounds all child I/O under one deadline, discards stderr, disables model tools, MCP, slash commands, Chrome integration, and session persistence, and accepts only schema-valid `structured_output`
- safe mode excludes user/project customizations, but organization-managed policy hooks, status-line commands, or file-suggestion commands may still apply; this sprint does not claim an absolute process-level no-hooks boundary
- auth persistence contains only non-secret credential-source labels and source-specific scopes. CLI sessions use `credential:cli_session`; API-key/helper sources use `credential:api_key`; restored state is revalidated before trust
- connect and request results apply only while their captured revision lease is current; stale validation or completion cannot overwrite auth state, publish a reply, or create a permission card
- the repeated-use E2E scenario covers 30 approve/run/complete-fail-cancel cycles across project switching, session reopen, and reload while proving the center workbench and terminal call log remain unchanged

Current evidence and closing gates:

- superseded pre-correction frontend baseline: the auth/suggestion services passed 22/22 tests, the Agent-session/provider workspace coverage passed 19/19, and the modified design regression selection passed 2/2. These counts are historical comparison only; the integrated 200/200 result below is authoritative
- the focused Claude workspace path distinguishes CLI-session and API-credential labels and covers external missing-login guidance, stale discovery ordering, reverse-order request ownership, command review, `Allow once`, exactly one isolated Agent job, project switching, and a zero-call center-terminal assertion
- final integrated automated evidence: lint passes; the production build passes with only the existing greater-than-500-KB chunk warning; isolated serial Playwright passes 200/200; Rust formatting and check pass; focused Claude tests pass 42/42; and the full Rust suite passes 147/147
- non-billing local evidence with Claude Code CLI 2.1.210: exact safe-mode status exits 0 with `loggedIn: true`, `authMethod: claude.ai`, `apiProvider: firstParty`, and zero stderr bytes; exact bare status exits 1 with `loggedIn: false`, `authMethod: none`, `apiProvider: firstParty`, and zero stderr bytes. Only allowlisted classification fields were retained; no identity, raw status payload, Keychain data, or child stderr was recorded
- no live `claude -p` inference was run because it consumes Agent SDK/subscription credit. Run one minimal structured request only after explicit user approval, then verify project/session ownership and zero center-terminal mutation
- local technical support is not permission to ship third-party Claude.ai login routing. Public distribution is blocked until Anthropic approval/contract review confirms this use; otherwise the release provider must remain on API-key or supported cloud-provider credentials
- retain Windows cross-compilation evidence, then complete the still-pending Windows installed-app sign-off for folder picker, PTY commands, Codex connection, isolated Agent jobs, restart restore, and a first real suggestion
- run a longer manual soak; the bounded automated aging scenario is evidence of repeated-use stability, not a substitute for sustained native use

## 장문 문서 라우팅 / Long-Doc Routing

### 한국어

이 문서는 200줄을 넘는 장문 실행 문서다. 기본값은 현재 필요한 스프린트만 읽는 것이다.

- 지금 무엇을 먼저 해야 하는지 볼 때
  - 문서 앞부분과 현재 active sprint 섹션만 읽는다.
- 과거 스프린트 산출물이나 흐름을 확인할 때
  - 해당 sprint heading만 찾아서 읽는다.
- MVP 범위 자체를 바꿀 때
  - 이 문서보다 `mvp-backlog.md`를 먼저 읽는다.

### English

This document exceeds 200 lines. Do not read every sprint by default.

- when you need to know what to do next
  - read the front matter plus only the current active sprint section
- when you need a past sprint outcome or flow
  - jump straight to the matching sprint heading only
- when you are changing MVP scope itself
  - read `mvp-backlog.md` before continuing through this doc

## 계획 원칙 / Planning Principles

### 한국어

- `P0` 항목을 먼저 잠근다.
- 리스크가 큰 항목은 가능한 한 초반 스프린트에서 검증한다.
- 기본 화면에서는 `editor + agent orchestration`을 먼저 잠그고, 터미널은 필요 시 강하게 전환해 쓰는 mode로 설계한다.
- 스프린트마다 사용자에게 보이는 가치가 하나 이상 있어야 한다.
- 각 스프린트는 다음 스프린트의 기반을 남겨야 한다.
- 각 스프린트의 마지막에는 가능한 범위의 UI E2E 검증을 추가하거나 갱신한다.
- 각 스프린트의 마지막에는 새로 발견된 후속 작업을 다음 스프린트 문서나 백로그에 추가한다.
- 모든 작업은 먼저 서브에이전트를 포함한 `planner + orchestrator + designer + frontend + backend + QA + tester` 팀빌딩으로 분해하고, 필요하면 진행 중 스프린트용 `WORKLOG`를 만든다.
- 각 스프린트 동안 `planner`와 `designer`는 다음 스프린트 초안, 레퍼런스 분석, 디자인 문서도 병렬로 남긴다.
- 각 스프린트는 이전 스프린트의 작업 경로, 실패, 우회, 반복 마찰을 검토하고 다음 개선안으로 연결해야 한다.
- `planner`와 `designer`는 현재 스프린트 문서, task history, 검증 메모를 읽고 문제 분석 메모를 병렬 산출물로 남긴다.
- 프론트엔드 개편은 `VS Code`, `conductor`, `cmux` 레퍼런스와 `docs/frontend-design-benchmarks.md`를 기준으로 검토한다.
- 프론트엔드 구조는 사람이 아니라 에이전트가 지속적으로 수정하기 쉬운지까지 기준으로 본다.

### English

- lock down `P0` items first
- validate high-risk items as early as possible
- lock down the `editor + agent orchestration` baseline first, and design the terminal as a strong switchable mode rather than the default dominant surface
- each sprint should deliver at least one visible user-facing value
- each sprint should leave a clean foundation for the next one
- finish each sprint with a practical UI E2E pass added or updated for the delivered flow
- finish each sprint by adding newly discovered follow-up work into the next sprint plan or backlog
- first decompose every task into the sub-agent split `planner + orchestrator + designer + frontend + backend + QA + tester`, and create an active sprint `WORKLOG` when temporary traceability is needed
- during each sprint, `planner` and `designer` should also leave behind the next-sprint draft, reference analysis, and design documentation in parallel
- each sprint should review the prior path taken, including failures, detours, and repeated friction, and turn that into next-sprint improvements
- `planner` and `designer` should read the current sprint docs, task history, and validation notes and leave behind explicit problem-analysis notes
- review frontend redesign work against `VS Code`, `conductor`, `cmux`, and `docs/frontend-design-benchmarks.md`
- treat agent editability as a first-class frontend design and implementation constraint

## 스프린트 종료 규칙 / Sprint Closing Rules

### 한국어

각 스프린트는 아래를 만족해야 닫힌다.

1. 현재 스프린트 목표 구현 또는 명시적 블로커 기록
2. 관련 source-of-truth 문서와 검증 메모 동기화
3. 해당 스프린트 UI E2E 검증 추가 또는 갱신
4. 다음 스프린트에 들어가야 할 작업 항목 추가
5. 이번 스프린트에서 밟은 경로, 실패, 우회, 반복 문제 요약
6. 그 문제를 다음 스프린트에서 어떻게 개선할지에 대한 `planner`와 `designer` 메모
7. 진행 중 `WORKLOG`가 있었다면 흡수 후 삭제

이때 다음 스프린트 작업은 아래 중 한 곳 이상에 반영한다.

- `docs/mvp-backlog.md`
- `docs/sprint-plan.md`
- 해당 스프린트 체크리스트
- 필요 시 `docs/MVP_VALIDATION_NOTES.md`

추가로 UI와 runtime이 함께 바뀌는 스프린트라면 아래 산출물도 남겨야 한다.

- 명확한 frontend 소유 범위
- 명확한 backend 소유 범위
- planner 다음 스프린트 메모
- designer 레퍼런스/와이어프레임 메모
- QA acceptance 메모
- tester 검증 메모
- 변경된 구조가 있으면 `docs/architecture.md`
- 변경된 흐름이 있으면 `docs/message-flow.md`
- 변경된 규칙이 있으면 `docs/development-guide.md`
- 문서나 계약이 바뀐 경우 orchestrator 통합 메모

### English

Each sprint should be considered closed only when it includes:

1. implementation of the sprint goal or an explicit blocker record
2. synchronized source-of-truth docs and validation updates
3. added or updated UI E2E coverage for that sprint
4. newly discovered work items added for the next sprint
5. a summary of the path taken in the sprint, including failures, detours, and recurring friction
6. explicit `planner` and `designer` notes describing how those issues should be improved in the next sprint
7. deletion of the active `WORKLOG` if one existed

Those next-sprint items should be written into at least one of:

- `docs/mvp-backlog.md`
- `docs/sprint-plan.md`
- the relevant sprint checklist
- `docs/MVP_VALIDATION_NOTES.md` when needed

When a sprint changes both UI and runtime behavior, it should also leave behind:

- clear frontend ownership
- clear backend ownership
- planner problem-analysis notes
- planner next-sprint notes
- designer workflow-visibility improvement notes
- designer reference or wireframe notes
- explicit QA acceptance notes
- explicit tester verification notes
- `docs/architecture.md` when structure changed
- `docs/message-flow.md` when flow changed
- `docs/development-guide.md` when implementation or recording rules changed
- orchestrator-level integration notes when docs or contracts changed

## MVP 스프린트 개요 / MVP Sprint Overview

### 한국어

- `Sprint 0`
  - 개발 기반과 앱 셸
- `Sprint 1`
  - 프로젝트 열기, 파일 탐색, Git 상태
- `Sprint 2`
  - 멀티 탭 터미널과 활성 로그 기반 작업 흐름
- `Sprint 3`
  - 에이전트 로그인 연결과 provider 추상화
- `Sprint 4`
  - 에이전트 패널, 컨텍스트 읽기, 승인 기반 실행
- `Sprint 5`
  - 작업 이력, 워크스페이스 저장, 실행 모드, 크로스 플랫폼 검증, aging test
- `Sprint 6`
  - Post-MVP: Telegram 리포트와 제한된 원격 명령
- `Sprint 7`
  - Windows-first 실제 사용 피드백과 auth UX 재정리
- `Sprint 8`
  - backend-driven provider auth contract
- `Sprint 9`
  - workspace redesign과 approval 흐름 정렬
- `Sprint 10`
  - Codex preflight diagnostics와 bridge 정리
- `Sprint 11`
  - Codex CLI ChatGPT session 기반 real request path
- `Sprint 12`
  - read-only code surface와 selected-file agent context
- `Sprint 13`
  - line anchor, restore 강화, bounded file fallback
- `Sprint 14`
  - FSD frontend split과 app-shell orchestration 정리
- `Sprint 15`
  - Mission Control형 workbench baseline과 left rail / split workbench / agent workspace 정리
- `Sprint 16`
  - Concept A 브랜드 선택과 left-menu view baseline 정리
- `Sprint 17`
  - 새 제품 디자인 시안 기반 shell, left accordion, workbench, agent/settings/approval 구현 계획과 1차 shell 적용

### English

- `Sprint 0`
  - foundation and app shell
- `Sprint 1`
  - project open, file exploration, and Git state
- `Sprint 2`
  - multi-tab terminal and active-log workflow
- `Sprint 3`
  - agent login connection and provider abstraction
- `Sprint 4`
  - agent panel, context reading, and approval-based execution
- `Sprint 5`
  - task history, workspace persistence, execution modes, cross-platform validation, and aging test
- `Sprint 6`
  - Post-MVP: Telegram reporting and limited remote commands
- `Sprint 7`
  - Windows-first usage feedback and auth UX reset
- `Sprint 8`
  - backend-driven provider auth contract
- `Sprint 9`
  - workspace redesign and approval-flow alignment
- `Sprint 10`
  - Codex preflight diagnostics and bridge cleanup
- `Sprint 11`
  - Codex CLI ChatGPT-session real request path
- `Sprint 12`
  - read-only code surface and selected-file agent context
- `Sprint 13`
  - line anchors, stronger restore, and bounded file fallback
- `Sprint 14`
  - FSD frontend split and app-shell orchestration cleanup
- `Sprint 15`
  - Mission Control workbench baseline plus left rail / split workbench / agent workspace alignment
- `Sprint 16`
  - Concept A brand selection and left-menu view baseline cleanup
- `Sprint 17`
  - new product design shell, left accordion, workbench, agent/settings/approval implementation planning and first shell slice

## Sprint 0

### 한국어

목표:

- 앱이 실행되고, 이후 기능을 올릴 수 있는 개발 기반을 만든다.

포함 범위:

- Tauri + React + Vite 초기화
- 기본 레이아웃
- Zustand 스토어 기본 구조
- Tauri command 통신 확인
- 개발 스크립트 정리

완료조건:

- 앱이 로컬에서 실행된다.
- 좌측, 중앙, 우측 패널 레이아웃이 뜬다.
- 프론트엔드와 Tauri 런타임 간 기본 통신이 된다.
- 기본 앱 셸 smoke test를 E2E 기준으로 실행할 수 있다.

리스크:

- Tauri와 프론트엔드 통합 기본 구조
- 향후 PTY와 auth를 수용할 수 있는 폴더 구조

### English

Goal:

- create the execution foundation that all later features will build on

Scope:

- bootstrap Tauri + React + Vite
- establish base layout
- initialize Zustand store structure
- verify Tauri command communication
- define development scripts

Acceptance Criteria:

- the app runs locally
- left, center, and right panel layout is visible
- basic frontend-to-runtime communication works
- a basic app-shell smoke test can run as E2E coverage

Risks:

- base Tauri/frontend integration
- folder structure flexibility for future PTY and auth work

## Sprint 1

### 한국어

목표:

- 프로젝트를 열고 코드와 저장소 상태를 읽는 기본 작업 공간을 만든다.

포함 범위:

- 프로젝트 열기
- 최근 프로젝트 목록
- 파일 트리 표시
- 프로젝트 메타데이터 표시
- 현재 Git 브랜치와 dirty state 표시

완료조건:

- 사용자가 로컬 프로젝트를 열고 다시 진입할 수 있다.
- 파일 트리가 정상적으로 표시된다.
- 현재 브랜치와 변경 상태가 UI에서 보인다.
- 프로젝트 열기와 Git 상태 표시 흐름이 UI E2E로 검증된다.

리스크:

- 파일 시스템 접근 권한
- 플랫폼별 경로 처리
- Git 상태 읽기 구조

### English

Goal:

- create the basic workspace for opening projects and reading repository state

Scope:

- open local projects
- recent project list
- file tree display
- project metadata display
- current Git branch and dirty-state visibility

Acceptance Criteria:

- users can open and re-enter local projects
- the file tree renders correctly
- current branch and working-tree state are visible in the UI
- the project-open and Git-status flow is covered by UI E2E verification

Risks:

- filesystem access permissions
- cross-platform path handling
- Git state read model

## Sprint 2

### 한국어

목표:

- `gtum`의 핵심 차별점인 멀티 탭 터미널과 활성 로그 활용 흐름을 만든다.

포함 범위:

- PTY 기반 멀티 탭 터미널
- 탭 생성, 이름 변경, 종료
- 터미널 출력 렌더링
- 활성 탭 로그 추출 구조
- 테스트 중인 터미널 로그를 컨텍스트로 넘길 준비

완료조건:

- 여러 개의 터미널 탭을 동시에 사용할 수 있다.
- 각 탭은 독립적인 셸 세션을 가진다.
- 활성 탭 최근 로그를 프로그램적으로 읽을 수 있다.
- "현재 테스트 로그를 가져온다"는 개념이 런타임과 상태 모델에 반영된다.

리스크:

- PTY 안정성
- Windows 셸 처리
- 로그 버퍼 성능

### English

Goal:

- deliver the core differentiator of `gtum`: multi-tab terminals plus active log workflow

Scope:

- PTY-backed multi-tab terminal
- create, rename, and close tabs
- terminal output rendering
- active-tab log extraction
- prepare live testing logs to become agent context

Acceptance Criteria:

- users can work with multiple terminal tabs simultaneously
- each tab has its own shell session
- recent logs from the active tab can be read programmatically
- the concept of "attach current testing logs" exists in the runtime and state model

Risks:

- PTY stability
- Windows shell handling
- log buffer performance

Sprint 2 completion update:

- runtime commands for PTY-backed terminal session lifecycle are now implemented
- the frontend can create, rename, close, and inspect terminal sessions
- active terminal logs can be captured into agent context
- a Playwright E2E scenario now covers the multi-tab terminal flow in mock runtime
- the next sprint should focus on provider login, callback state, and request contracts that can consume the captured terminal context

## Sprint 3

### 한국어

목표:

- Codex와 Claude를 로그인 기반으로 연결할 수 있는 기반을 만든다.

포함 범위:

- provider 선택 UI 초안
- 로그인 시작 흐름
- OAuth 또는 공식 로그인 콜백 구조
- 세션 저장 기본 구조
- provider 공통 인터페이스 초안
- 프로젝트 컨텍스트와 활성 로그 컨텍스트를 provider 요청 계약에 연결할 준비

완료조건:

- 사용자가 `Codex` 또는 `Claude` 연결을 시작할 수 있다.
- 로그인 완료 상태 또는 실패 상태를 UI에 반영할 수 있다.
- 애플리케이션 레이어에서 공통 provider interface를 인식한다.

리스크:

- 실제 공식 로그인 통합 가능성
- 데스크톱 앱 콜백 처리
- 세션 저장 보안성

### English

Goal:

- establish the login-based connection foundation for Codex and Claude

Scope:

- initial provider selection UI
- login initiation flow
- OAuth or official sign-in callback structure
- base session persistence structure
- first shared provider interface
- preparation for attaching project context and active-log context into provider request contracts

Acceptance Criteria:

- users can start connection for `Codex` or `Claude`
- login success and failure states can be reflected in the UI
- the application layer recognizes a shared provider interface

Risks:

- feasibility of official sign-in integration
- desktop callback handling
- secure session persistence

Sprint 3 completion update:

- provider selection UI and connection cards are now available for Codex and Claude
- the runtime and frontend share login start, completion, failure, and disconnect interfaces
- mock callback success and failure are covered by Playwright E2E
- a request-contract preview now shows how active project and terminal context will be handed to future agent requests
- the next sprint should connect provider state to agent request input, suggestion cards, and approval-based execution

## Sprint 4

### 한국어

목표:

- 에이전트가 프로젝트와 활성 터미널 로그를 읽고, 승인 기반으로 제안을 실행하는 흐름을 만든다.

포함 범위:

- 에이전트 패널 UI
- 작업 요청 입력
- 프로젝트 컨텍스트 읽기
- 활성 탭 로그 전달
- provider 연결 상태 반영
- 제안 카드 UI
- 승인 기반 명령 실행

완료조건:

- 사용자가 에이전트 패널에서 작업을 요청할 수 있다.
- 에이전트 요청에 프로젝트와 활성 로그 컨텍스트가 포함된다.
- 제안된 명령은 승인 후 현재 탭 또는 새 탭에서 실행된다.

리스크:

- provider 응답 정규화
- 승인 UX 설계
- 컨텍스트 길이 제한

### English

Goal:

- enable the agent flow that reads project context and active terminal logs, then executes suggestions through approval

Scope:

- agent panel UI
- task request input
- project context reading
- active-tab log attachment
- provider connection-state usage
- suggestion card UI
- approval-based command execution

Acceptance Criteria:

- users can submit work requests from the agent panel
- agent requests include project context and active logs
- suggested commands execute only after approval in the current tab or a new tab

Risks:

- provider response normalization
- approval UX design
- context length limits

Sprint 4 completion update:

- the agent panel now accepts task requests tied to provider state, project context, and active logs
- suggestion cards can be reviewed and approved into the current tab or a new tab
- the runtime now supports command submission into an existing PTY session
- Playwright coverage now includes the request-to-approval agent flow
- the next sprint should focus on history, restore, execution modes, cross-platform notes, and aging validation

## Sprint 5

### 한국어

목표:

- MVP를 데모 가능 상태로 안정화한다.

포함 범위:

- 작업 이력과 상태 표시
- 워크스페이스 기본 저장/복원
- `fast`, `balanced`, `deep` 초기 적용
- Ubuntu, Windows, macOS 기준 검증
- 알려진 제약 문서화
- aging test 초안 추가

완료조건:

- 사용자가 최근 작업과 상태를 확인할 수 있다.
- 최근 워크스페이스 상태가 기본적으로 복원된다.
- 실행 모드에 따라 컨텍스트 또는 워커 정책이 달라진다.
- 세 플랫폼에 대한 검증 메모 또는 제한사항이 정리된다.

리스크:

- 세션 복원 난이도
- 플랫폼별 차이
- 실행 모드 정책의 일관성

### English

Goal:

- stabilize the MVP into a demo-ready state

Scope:

- task history and status display
- basic workspace persistence and restore
- capability-backed model, reasoning, and fast request controls
- Ubuntu, Windows, and macOS validation
- documentation of known limitations
- initial aging-test coverage

Acceptance Criteria:

- users can inspect recent tasks and status
- basic workspace state is restored
- runtime-backed agent controls only expose options reported by provider capabilities
- validation notes or known constraints are documented for all three platforms

Risks:

- session restoration complexity
- platform-specific behavior
- consistency of execution-mode policy

Sprint 5 completion update:

- task history and recent activity are now visible in the app
- the workspace restores the last project path, selected provider, agent session state, and recorded task history
- model, reasoning, and fast controls now come from runtime provider capabilities; unsupported reasoning/fast controls stay hidden
- Playwright aging coverage now repeats the core flow across reloads
- MVP validation notes are documented and the MVP can now be treated as complete

## Sprint 6

### 한국어

목표:

- `Telegram`을 통한 외부 상태 리포트와 제한된 원격 명령 흐름을 추가한다.

단계:

- `Post-MVP`

포함 범위:

- 외부 채널 adapter 구조
- `Telegram` 연동 초안
- 작업 상태 리포트 발송
- 제한된 원격 명령 정책

완료조건:

- 최소한 하나의 외부 채널로 작업 상태 리포트를 보낼 수 있다.
- 승인 없이 허용되는 원격 명령 범위가 문서화되고 시스템에 반영된다.
- 민감한 명령은 제한되거나 추가 승인 절차를 요구한다.

리스크:

- 외부 채널 인증과 신뢰 경계
- 메시지 기반 명령의 오남용 가능성
- Telegram 채널 정책과 앱 승인 흐름의 정합성

### English

Goal:

- add external status reporting and limited remote-command flows through `Telegram`

Phase:

- `Post-MVP`

Scope:

- external channel adapter structure
- initial `Telegram` integration
- task-status report delivery
- restricted remote-command policy

Acceptance Criteria:

- at least one external channel can receive task status reports
- the remotely allowed command set is documented and enforced
- sensitive commands are restricted or require extra approval

Risks:

- authentication and trust boundaries for external channels
- misuse risk for message-based commands
- consistency between Telegram command policy and app approval flow

Sprint 6 progress update:

- a Telegram bridge prototype now exposes runtime state, report creation, and restricted remote-command approval flows
- the UI now supports Telegram draft reporting plus bridge connect/disconnect, report delivery, and pending remote-command review
- Playwright coverage now includes both Telegram report drafting and Telegram bridge execution approval
- the next step is connecting the prototype to a real Telegram transport and trust policy

## Sprint 7

### 한국어

목표:

- mock foundation을 실제 integration 방향으로 전환하면서, Windows 실사용 피드백 기준의 UX 마찰을 줄인다.

단계:

- `Post-MVP`

포함 범위:

- `Open Project`를 경로 입력 대신 네이티브 폴더 선택기로 전환
- 프로젝트, 터미널, 에이전트, 보조 패널의 정보 구조 재설계
- 핵심 작업 흐름 기준의 데스크톱 와이어프레임 정리
- provider auth UI에서 `mock`, `prototype`, `real` 상태 구분
- callback URL 직접 노출 축소 또는 제거
- 최소 1개 provider에 대한 실제 daily-use 연결 경로 착수
- agent suggestion의 실제 provider 응답 계약 초안
- Windows 실사용 기준 UX 이슈 기록

완료조건:

- 사용자가 경로를 수동 입력하지 않고 프로젝트를 열 수 있다.
- 첫 화면에서 무엇을 먼저 해야 하는지 더 쉽게 이해할 수 있다.
- 터미널이 메인 작업 영역으로 명확하게 보인다.
- provider auth가 실제 연결인지 mock인지 UI에서 즉시 구분된다.
- callback URL 같은 내부 값이 일반 사용자 UX에 그대로 노출되지 않는다.
- 다음 스프린트에서 실제 provider 연동 구현에 들어갈 수 있는 연결/response 계약이 문서 또는 코드로 정리된다.
- 정보 구조와 와이어프레임이 문서로 정리되어 구현 기준이 된다.

리스크:

- 실제 daily-use 연결 경로가 provider별로 다를 수 있다.
- 플랫폼별 폴더 선택기 동작 차이가 프로젝트 열기 UX를 다시 복잡하게 만들 수 있다.
- mock과 real 흐름이 함께 남아 있는 동안 상태 관리가 더 복잡해질 수 있다.

### English

Goal:

- begin converting mock foundations toward real integrations while reducing UX friction exposed by real Windows usage

Phase:

- `Post-MVP`

Scope:

- replace manual path entry with a native folder picker for `Open Project`
- redesign the information architecture across project, terminal, agent, and supporting panels
- document desktop wireframes around the core workflow
- distinguish `mock`, `prototype`, and `real` provider-auth states in the UI
- reduce or remove direct callback URL exposure
- begin a real daily-use connection path for at least one provider
- draft a real provider-response contract for agent suggestions
- record Windows real-usage UX issues as explicit follow-up items

Acceptance Criteria:

- users can open projects without manually typing paths
- users can understand the first action more easily from the initial screen
- the terminal is clearly presented as the main working surface
- the UI clearly distinguishes real provider connections from mock ones
- internal callback URLs are not exposed as normal end-user UX
- auth and response contracts are ready in docs or code for the next sprint to start real provider integration work
- documented information architecture and wireframes exist as implementation references

Risks:

- real daily-use connection paths may differ by provider
- platform-specific folder-picker behavior may reintroduce UX inconsistency
- mixed mock and real flows may complicate state management while both coexist

Sprint 7 initial backlog:

- `P0` replace manual project path entry with a native folder picker
- `P0` redesign the UI information hierarchy around the primary workflow
- `P0` document desktop wireframes for the main workspace states
- `P0` add explicit mock/prototype/real auth state labels
- `P0` remove raw callback URL exposure from normal provider UI
- `P0` start the real `Codex` daily-use connection path
- `P0` define a real provider request/response contract for agent suggestions
- `P1` improve active-log attachment ergonomics
- `P1` rewrite auth and runtime errors in more user-facing language
- `P1` record Windows real-device validation findings
- `P2` draft a settings panel for shell, provider, and experimental features

Sprint 7 additional CI/CD requirement:

- add an auto-update specification based on comparing the installed version against GitHub Releases
- prepare the Tauri updater path, signed updater artifacts, and `latest.json` metadata strategy
- keep the updater policy aligned with the master-merge release workflow

Sprint 7 completion update:

- the default project-open flow now uses a native folder-picker-first CTA with manual path entry demoted into a fallback disclosure
- the workspace is reorganized around a clearer hierarchy: left project rail, center terminal focus, right agent panel, and bottom support drawers
- provider cards now distinguish `Mock`, `Prototype`, and `Real` through explicit badges and friendlier connection wording
- raw callback URLs are moved out of the default provider UI and exposed only through diagnostics disclosures
- Playwright coverage is updated for the folder-picker flow and the new Telegram support-panel layout
- the next sprint should reduce frontend heuristics by adding explicit backend auth-mode metadata and start replacing mock suggestion generation with real provider contracts

## Sprint 8

### 한국어

목표:

- provider auth 상태를 frontend 추측이 아니라 명시 계약으로 바꾸고, 실제 provider 연동을 위한 다음 단계를 준비한다.

단계:

- `Post-MVP`

포함 범위:

- auth snapshot에 `connectionKind` 같은 명시 필드 추가
- frontend provider badge가 해당 필드를 기준으로 동작하도록 정리
- raw callback URL은 기본 UI가 아니라 diagnostics에만 남기기
- mock suggestion 대체를 위한 실제 provider request/response contract 준비 착수

완료조건:

- provider UI가 URL heuristic 없이 `mock`, `prototype`, `real`을 구분한다.
- 관련 E2E가 새 계약을 기준으로 통과한다.
- 다음 단계의 실제 provider contract 작업을 이어갈 기준 source-of-truth 문서가 갱신된다.

### English

Goal:

- replace frontend auth guessing with an explicit provider-auth contract and prepare the next step toward real provider integration

Phase:

- `Post-MVP`

Scope:

- add an explicit auth field such as `connectionKind` to the auth snapshot
- make frontend provider badges use that field as the source of truth
- keep raw callback URLs only in diagnostics instead of default UI
- begin preparation for replacing mock suggestions with a real provider request/response contract

Acceptance Criteria:

- the provider UI distinguishes `mock`, `prototype`, and `real` without URL heuristics
- the relevant E2E coverage passes against the new contract
- the source-of-truth docs are updated enough to hand off the next real-provider contract step

Sprint 8 completion update:

- auth snapshots now expose explicit provider connection-kind metadata instead of leaving frontend to infer it from URLs
- provider badges render from the contract field rather than frontend heuristics
- the next sprint should stop treating the current workspace layout as good enough and execute the documented redesign against the new frontend design benchmarks

## Sprint 9

### 한국어

목표:

- 현재 카드 중심 UI를 실제 작업용 워크스페이스 구조로 다시 짜서, `VS Code`, `conductor`, `cmux` 레퍼런스를 구현으로 옮긴다.

단계:

- `Post-MVP`

포함 범위:

- 상단 바, 좌측 프로젝트 레일, 중앙 터미널 스테이지, 우측 에이전트 패널 구조 재구성
- 요약 카드 축소 또는 제거
- Task History, Telegram, Runtime/Debug를 기본 2선 영역으로 재배치
- 에이전트 요청, 컨텍스트, 제안, 승인 흐름을 단계형 UI로 재구성
- 활성 로그가 어떤 요청에 붙는지 더 분명하게 보이도록 개선
- backend snapshot, status field, action gating과 frontend UI 동작을 같은 계약으로 정렬
- 새 레이아웃 기준으로 UI E2E 갱신

권장 역할 분리:

- `Orchestrator`
  - 범위 고정, 문서 동기화, 통합 판단
- `Frontend`
  - 레이아웃 재구성, 스타일 시스템 정리, 인터랙션 정리
- `Backend`
  - 새 UI가 요구하는 context/snapshot 표시 필드 보강과 display contract 정렬
- `Tester`
  - 핵심 사용자 흐름 회귀와 레이아웃 전환 후 E2E 갱신

완료조건:

- 첫 화면에서 사용자가 프로젝트 열기, 터미널 작업, 에이전트 요청 순서를 바로 읽을 수 있다.
- 터미널이 가장 강한 1차 작업 영역으로 보인다.
- 에이전트 패널이 요청, 컨텍스트, 제안, 승인 순서를 자연스럽게 보여준다.
- Task History, Telegram, Runtime/Debug가 기본 화면을 어지럽히지 않는다.
- backend 상태와 frontend 버튼, 뱃지, 패널 동작이 같은 조건으로 설명된다.
- `docs/frontend-design-benchmarks.md` 기준 리뷰와 관련 UI E2E 갱신이 남는다.

리스크:

- 레이아웃 재구성이 크면 기존 테스트 셀렉터와 상호작용 흐름이 많이 깨질 수 있다.
- 시각 개선만 하고 실제 작업 흐름은 그대로 두는 반쪽짜리 개편으로 끝날 수 있다.
- frontend만 바꾸고 backend 표시 계약이 따라오지 않으면 UX 설명력이 약해질 수 있다.
- 화면은 좋아졌지만 action gating과 status semantics가 여전히 어긋날 수 있다.

Sprint 9 initial backlog:

- `P0` rebuild the workspace into top bar, left rail, terminal-first center stage, and right agent panel
- `P0` reduce summary-card density and demote support surfaces by default
- `P0` make active-log attachment state clearer inside the agent flow
- `P0` align backend snapshot semantics with frontend UI behavior and action gating
- `P0` update Playwright coverage for the redesigned main workspace
- `P1` add a status-bar-like summary strip inspired by `VS Code`
- `P1` improve approval-card readability inspired by `conductor`
- `P1` make terminal tab switching feel lighter and more focused, inspired by `cmux`
- `P2` refine visual polish after the workflow hierarchy is stable

### English

Goal:

- replace the current card-heavy UI with a real working workspace and turn the `VS Code`, `conductor`, and `cmux` references into implementation

Phase:

- `Post-MVP`

Scope:

- rebuild the top bar, left project rail, center terminal stage, and right agent panel structure
- reduce or remove summary-heavy cards
- move Task History, Telegram, and Runtime/Debug into secondary areas by default
- restructure the agent request, context, suggestion, and approval flow into a more staged UI
- make it much clearer which active logs are attached to which request
- align backend snapshots, status fields, and action gating with the frontend UI contract
- update UI E2E coverage against the new layout

Recommended Role Split:

- `Orchestrator`
  - locks scope, synchronizes docs, and makes integration calls
- `Frontend`
  - rebuilds layout, styling system, and interactions
- `Backend`
  - strengthens any context or snapshot fields needed by the redesigned UI and aligns the display contract
- `Tester`
  - updates regression coverage and verifies the new workspace flow

Acceptance Criteria:

- users can immediately read the order of project open, terminal work, and agent request from the first screen
- the terminal is clearly the strongest primary work surface
- the agent panel presents request, context, suggestion, and approval in a natural order
- Task History, Telegram, and Runtime/Debug no longer clutter the default screen
- backend state is reflected consistently in frontend buttons, badges, panel visibility, and action gating
- review against `docs/frontend-design-benchmarks.md` and updated UI E2E coverage are left behind

Risks:

- a large layout refactor may break existing test selectors and interaction paths
- the work may drift into visual polish without materially improving workflow clarity
- frontend-only changes may still feel weak if backend display contracts do not support the new UX
- visual redesign alone may hide unresolved mismatch between backend semantics and frontend behavior

Sprint 9 initial backlog:

- `P0` rebuild the workspace into top bar, left rail, terminal-first center stage, and right agent panel
- `P0` reduce summary-card density and demote support surfaces by default
- `P0` make active-log attachment state clearer inside the agent flow
- `P0` align backend snapshot semantics with frontend UI behavior and action gating
- `P0` update Playwright coverage for the redesigned main workspace
- `P1` add a status-bar-like summary strip inspired by `VS Code`
- `P1` improve approval-card readability inspired by `conductor`
- `P1` make terminal tab switching feel lighter and more focused, inspired by `cmux`
- `P2` refine visual polish after the workflow hierarchy is stable

## Sprint 10

### 한국어

목표:

- 개발용 `Codex` bridge와 diagnostics를 통해 real 요청 파이프라인의 임시 기반을 정리한다.

단계:

- `Post-MVP`

포함 범위:

- `Codex` env-backed OpenAI API bridge 진단 정보 추가
- connect 시 preflight 성공/실패 상태를 실제 연결 상태에 반영
- `Claude` deferred 상태를 diagnostics와 연결 UI에 명시
- 활성 로그 최근 50줄 자동 첨부 기준을 UI에서 더 분명하게 노출
- provider diagnostics 관련 E2E 갱신
- Windows 실사용 검증 전 필요한 문서 기준 정리

권장 역할 분리:

- `Planner`
  - Sprint 10 결과를 다음 스프린트 기획 메모와 fallback 정책으로 정리
- `Orchestrator`
  - 범위 고정, 역할 분리, 문서 동기화, 최종 통합
- `Designer`
  - diagnostics UI와 active-log preview가 다음 editor/design 방향과 어떻게 연결될지 정리
- `Frontend`
  - diagnostics UI, 연결 안내 문구, active-log preview 정리
- `Backend`
  - preflight 검증, provider diagnostics contract, 연결 상태 저장 보강
- `QA`
  - source of truth 문서와 런타임 계약 일치 여부 확인
- `Tester`
  - provider auth 및 request-flow 회귀 E2E 갱신

완료조건:

- 개발용 `Codex` bridge connect 액션이 실제 preflight 결과에 따라 성공 또는 실패로 표시된다.
- provider card에서 setup state, connection path, env 상태를 확인할 수 있다.
- `Claude` deferred path가 실연결처럼 보이지 않는다.
- 활성 로그 최근 50줄이 다음 요청에 자동 첨부된다는 점이 UI에 보인다.
- 관련 E2E와 빌드 검증이 통과한다.

리스크:

- 실제 provider base URL이나 model 접근 정책이 환경마다 다를 수 있다.
- preflight 성공이 suggestion 성공을 완전히 보장하지는 않는다.
- Windows 실기 환경에서는 셸, 네트워크, 환경변수 주입 차이로 추가 이슈가 생길 수 있다.

Sprint 10 initial backlog:

- `P0` add runtime diagnostics for the env-backed `Codex` connection path
- `P0` gate `Codex` connection state on connect-time preflight validation
- `P0` make `Claude` explicitly deferred in diagnostics and connection UX
- `P0` surface the latest 50 active log lines as the default request attachment window
- `P0` update provider-auth E2E around diagnostics and connection state
- `P1` refine user-facing preflight error copy for common provider failures
- `P1` record the Windows real-device validation checklist for the next pass

주의:

- 이 스프린트는 최종 auth 방향이 아니라 개발용 bridge를 정리한 임시 슬라이스다.
- source of truth 기준의 실사용 provider 연결 방향은 다음 스프린트의 `OAuth/session login` 구현이다.

### English

Goal:

- stabilize the temporary development `Codex` bridge and diagnostics so the request pipeline can be exercised end to end

Phase:

- `Post-MVP`

Scope:

- add diagnostics for the env-backed `Codex` OpenAI API bridge
- reflect connect-time preflight success or failure directly in provider connection state
- make the deferred `Claude` path explicit in diagnostics and connection UX
- surface the latest 50 active log lines as the default request attachment window
- update E2E coverage for provider diagnostics
- align documentation before Windows real-device validation

Recommended Role Split:

- `Planner`
  - turns Sprint 10 outputs into next-sprint planning notes and fallback-policy guidance
- `Orchestrator`
  - locks scope, splits roles, syncs docs, and integrates the final slice
- `Designer`
  - explains how diagnostics UI and active-log preview feed the next editor and design direction
- `Frontend`
  - refines diagnostics UI, connection guidance, and active-log preview
- `Backend`
  - implements preflight validation, provider diagnostics contract, and stronger connection-state persistence
- `QA`
  - verifies that source-of-truth documents and runtime contracts still match
- `Tester`
  - updates provider-auth and request-flow regression coverage

Acceptance Criteria:

- the temporary `Codex` bridge connect action resolves to success or failure based on preflight validation
- provider cards expose setup state, connection path, and env-status details
- the deferred `Claude` path does not look like a live real-provider connection
- the UI makes it clear that the latest 50 active log lines will auto-attach to the next request
- related E2E and build validation pass

Risks:

- real provider base-URL or model access policy may differ across environments
- preflight success does not fully guarantee suggestion success
- Windows real-device environments may still reveal shell, network, or env-injection issues

Sprint 10 initial backlog:

- `P0` add runtime diagnostics for the env-backed `Codex` connection path
- `P0` gate `Codex` connection state on connect-time preflight validation
- `P0` make `Claude` explicitly deferred in diagnostics and connection UX
- `P0` surface the latest 50 active log lines as the default request attachment window
- `P0` update provider-auth E2E around diagnostics and connection state
- `P1` refine user-facing preflight error copy for common provider failures
- `P1` record the Windows real-device validation checklist for the next pass

Note:

- this sprint is an interim bridge slice, not the final auth direction
- the source-of-truth daily-use provider path moves to `OAuth/session login` in the next sprint

## Sprint 11

### 한국어

목표:

- 첫 real daily-use `Codex` 경로를 `OAuth/session login`으로 전환한다.

단계:

- `Post-MVP`

포함 범위:

- provider 승인 경로 또는 시스템 브라우저 로그인 시작
- callback, deep link, 또는 desktop sign-in 완료 처리
- 세션 저장, 만료, 재연결, 취소 상태 처리
- 워크스페이스 안에서 `codex login --device-auth`를 시작할 수 있는 로그인 런처
- `Codex CLI` ChatGPT session과 `codex exec` 기반 첫 desktop session-backed adapter
- `Codex` account/session/scopes UI 표시
- `Claude` deferred path 유지
- Windows 기준 로그인 UX와 실패 상태 검증

권장 역할 분리:

- `Planner`
  - provider 정책, 다음 스프린트 backlog, Windows login 검증 계획 정리
- `Orchestrator`
  - 범위 고정, provider 정책 정리, 문서 동기화, 최종 통합
- `Designer`
  - 로그인 시작 UX, 코드 읽기 surface, agent interaction 배치, 다음 디자인 문서 정리
- `Frontend`
  - 로그인 시작 UX, reconnect/expiry/cancel 상태, account/session 표시 정리
- `Backend`
  - callback/session 처리, secure storage, session lifecycle 구현
- `QA`
  - source of truth와 구현 계약 일치 여부, 실패/취소/만료 상태 점검
- `Tester`
  - 로그인 성공, 취소, 만료, reconnect, Windows 기준 회귀 시나리오 갱신

완료조건:

- 최소 1개 provider가 실제 `OAuth/session login`으로 연결된다.
- 사용자가 로그인 성공, 취소, 만료, reconnect 상태를 UI에서 이해할 수 있다.
- `OPENAI_API_KEY` 기반 bridge는 개발용 fallback으로만 남거나 2선 설정으로 내려간다.
- Windows 기준 핵심 로그인 흐름과 실패 상태가 문서와 테스트에 남는다.

리스크:

- provider의 공식 desktop login 지원 범위가 제한적일 수 있다.
- callback/deep-link 처리 방식이 플랫폼마다 다를 수 있다.
- secure session storage와 refresh 정책이 provider별로 다를 수 있다.

Sprint 11 initial backlog:

- `P0` launch the official `Codex` OAuth/session login flow
- `P0` surface a workspace-native `codex login --device-auth` launcher
- `P0` route the first real request path through `Codex CLI` ChatGPT session and `codex exec`
- `P0` implement callback or desktop sign-in completion handling
- `P0` persist session state and show reconnect/expiry/cancel status
- `P0` update provider-auth E2E around success, cancel, and reconnect
- `P1` demote the API-key bridge into a dev-only fallback path
- `P1` record Windows-first login UX findings

### English

Goal:

- switch the first real daily-use `Codex` path to `OAuth/session login`

Phase:

- `Post-MVP`

Scope:

- launch the provider-approved path or system-browser login flow
- handle callback, deep link, or desktop sign-in completion
- implement session persistence plus expiry, reconnect, and cancellation handling
- provide a workspace-native launcher for `codex login --device-auth`
- use `Codex CLI` ChatGPT session plus `codex exec` as the first desktop session-backed adapter
- expose `Codex` account, session, and scopes in the UI
- keep `Claude` on the deferred path
- validate login UX and failure states with Windows as the baseline

Recommended Role Split:

- `Planner`
  - aligns provider policy, next-sprint backlog, and the Windows login-validation plan
- `Orchestrator`
  - locks scope, aligns provider policy, syncs docs, and integrates the final slice
- `Designer`
  - shapes login start UX, code-reading surfaces, agent interaction layout, and follow-up design docs
- `Frontend`
  - refines login start UX, reconnect/expiry/cancel state, and account/session display
- `Backend`
  - implements callback/session handling, secure storage, and session lifecycle
- `QA`
  - checks source-of-truth alignment and failure/cancel/expiry semantics
- `Tester`
  - updates login success, cancellation, expiry, reconnect, and Windows-first regression coverage

Acceptance Criteria:

- at least one provider connects through a real `OAuth/session login` path
- users can understand success, cancellation, expiry, and reconnect states in the UI
- the `OPENAI_API_KEY` bridge remains only as a dev fallback or secondary setting
- Windows-baseline login flows and failure states are captured in docs and tests

Risks:

- provider support for official desktop login may be limited
- callback or deep-link handling may differ by platform
- secure session storage and refresh policy may vary by provider

Sprint 11 initial backlog:

- `P0` launch the official `Codex` OAuth/session login flow
- `P0` surface a workspace-native `codex login --device-auth` launcher
- `P0` route the first real request path through `Codex CLI` ChatGPT session and `codex exec`
- `P0` implement callback or desktop sign-in completion handling
- `P0` persist session state and show reconnect/expiry/cancel status
- `P0` update provider-auth E2E around success, cancel, and reconnect
- `P1` demote the API-key bridge into a dev-only fallback path
- `P1` record Windows-first login UX findings

## Sprint 12

### 한국어

목표:

- selected file를 active log와 같은 급의 컨텍스트로 승격하고, 메인 워크스페이스에 read-only code surface를 올린다.

단계:

- `Post-MVP`

포함 범위:

- file tree에서 선택 가능한 파일 노드
- 메인 워크스페이스의 read-only code viewer
- `read_project_file` 기반 파일 읽기 runtime contract
- project root 밖 경로 차단, binary fallback, large file truncation
- 선택 파일 상태 복원
- provider request preview에 `selected file + active terminal log` 동시 노출
- real provider request envelope에 `activeFilePath`, `activeFileSnippet` 포함
- approval 카드에서 file context 재표시
- browser preview와 desktop runtime contract 동기화

권장 역할 분리:

- `Planner`
  - 이번 슬라이스를 `selected-file context promotion`으로 정의하고 다음 스프린트 범위를 정리
- `Orchestrator`
  - runtime/UI 계약을 잠그고 source-of-truth 문서를 동기화
- `Designer`
  - terminal + code dual-primary surface와 approval rail 가시성 기준을 정리
- `Frontend`
  - file selection, code viewer, request preview, approval card 반영
- `Backend`
  - 안전한 file read command와 provider request envelope 확장
- `QA`
  - read-only viewer, selected-file visibility, log-context 무회귀 확인
- `Tester`
  - file select, request preview, approval, restore, Windows path/newline 확인

완료조건:

- 파일 트리에서 선택한 파일이 메인 workspace의 read-only viewer에 표시된다.
- terminal과 code surface가 동시에 유지된다.
- request preview와 approval review에서 selected file context를 다시 읽을 수 있다.
- real provider request path가 selected file snippet과 active log를 함께 받는다.
- binary/large file이 bounded fallback 또는 truncation으로 안전하게 처리된다.
- 관련 E2E가 추가 또는 갱신된다.

리스크:

- 빠른 파일 전환 중 stale context가 남을 수 있다.
- large file 또는 binary file 처리에서 UI 성능이 흔들릴 수 있다.
- Windows 경로 구분자와 CRLF 차이로 preview와 runtime 값이 어긋날 수 있다.
- viewer만 생기고 approval/review contract가 따라오지 않으면 가치가 낮아진다.

Sprint 12 initial backlog:

- `P0` add safe `read_project_file` runtime command
- `P0` render a read-only code viewer in the main workspace
- `P0` persist and restore the selected file path
- `P0` include `activeFilePath` and `activeFileSnippet` in the provider request envelope
- `P0` show selected-file context in request preview and approval review
- `P0` update project-workspace and agent-request-flow E2E coverage
- `P1` add bounded binary/large-file fallback messaging
- `P1` record Windows path and CRLF verification notes

### English

Goal:

- promote the selected file to the same level of context as active logs and add a read-only code surface to the main workspace

Phase:

- `Post-MVP`

Scope:

- selectable file nodes in the file tree
- a read-only code viewer in the main workspace
- a `read_project_file` runtime contract
- project-root boundary checks, binary fallback, and large-file truncation
- selected-file restore behavior
- provider request preview showing both `selected file + active terminal log`
- real provider request envelope fields for `activeFilePath` and `activeFileSnippet`
- approval cards that restate the file context
- synchronized browser-preview and desktop-runtime contracts

Recommended Role Split:

- `Planner`
  - frames this slice as selected-file context promotion and drafts the next sprint scope
- `Orchestrator`
  - locks the runtime/UI contract and syncs the source-of-truth docs
- `Designer`
  - defines the terminal + code dual-primary surface and approval-rail visibility rules
- `Frontend`
  - implements file selection, code viewer, request preview, and approval-card updates
- `Backend`
  - implements safe file reads and extends the provider request envelope
- `QA`
  - verifies the read-only viewer, selected-file visibility, and no regression in log context
- `Tester`
  - validates file selection, request preview, approval, restore behavior, and Windows path/newline handling

Acceptance Criteria:

- selecting a file from the file tree shows it in a read-only viewer in the main workspace
- the terminal and code surface remain visible together
- selected-file context can be reread in both request preview and approval review
- the real provider request path receives both selected-file snippet and active logs
- binary or large files are handled through bounded fallback or truncation
- relevant E2E coverage is added or updated

Risks:

- stale context may linger during rapid file switching
- large or binary file handling may shake UI performance
- Windows path separators and CRLF differences may drift between preview and runtime values
- the slice loses value if the viewer exists but approval/review contracts do not expose the file context

Sprint 12 initial backlog:

- `P0` add a safe `read_project_file` runtime command
- `P0` render a read-only code viewer in the main workspace
- `P0` persist and restore the selected file path
- `P0` include `activeFilePath` and `activeFileSnippet` in the provider request envelope
- `P0` show selected-file context in request preview and approval review
- `P0` update project-workspace and agent-request-flow E2E coverage
- `P1` add bounded binary/large-file fallback messaging
- `P1` record Windows path and CRLF verification notes

## Sprint 13

### 한국어

목표:

- selected-file context를 `file + line anchor + restore + bounded fallback` 수준으로 고정한다.

단계:

- `Post-MVP`

포함 범위:

- code viewer line anchor 선택과 강조
- request preview와 approval review에 line anchor 재표시
- `activeFileLine` 기반 provider request envelope 확장
- reload 후 `selectedFilePath + selectedFileLine` 복원
- invalid anchor, missing file, binary file, truncated preview fallback
- terminal log의 file:line reference에서 code surface jump
- browser preview fixture에 binary/large-file 회귀 경로 추가
- Windows path, newline, 가독성 기준 문서화

권장 역할 분리:

- `Planner`
  - 이번 슬라이스를 `selected-file stability sprint`로 정리하고 다음 symbol/range 단계 초안을 남긴다
- `Orchestrator`
  - line anchor contract, restore semantics, fallback 기준을 잠그고 문서를 동기화한다
- `Designer`
  - anchor 표시, restore 표시, bounded fallback의 시각 규칙을 정리한다
- `Frontend`
  - line anchor UI, restore 표시, log jump, fallback 표현을 구현한다
- `Backend`
  - provider request envelope에 `activeFileLine`을 추가하고 file-read fallback semantics를 유지한다
- `QA`
  - anchor 정확도, restore 신뢰성, fallback 안전성, log-context 무회귀를 확인한다
- `Tester`
  - reload, binary, large-file, Windows newline/path 시나리오를 검증한다

완료조건:

- 사용자가 code surface에서 line anchor를 선택하고 다시 읽을 수 있다.
- request preview와 approval review에서 `selected file + line anchor + active logs`가 함께 보인다.
- reload 후 선택 파일과 line anchor가 best-effort로 복원된다.
- binary와 large file은 bounded fallback으로 처리되고 UI가 깨지지 않는다.
- terminal log의 file:line reference에서 code surface로 점프할 수 있다.
- 관련 E2E가 갱신된다.

리스크:

- 빠른 파일/line 전환 중 stale anchor가 남을 수 있다.
- truncation과 anchor가 섞일 때 실제 line 의미가 흐려질 수 있다.
- Windows CRLF와 경로 구분자로 인해 anchor 또는 restore 값이 어긋날 수 있다.
- viewer와 request envelope이 line anchor에서 다시 어긋나면 승인 UX 가치가 낮아진다.

Sprint 13 initial backlog:

- `P0` persist and restore `selectedFileLine`
- `P0` add `activeFileLine` to the provider request envelope
- `P0` make line anchors visible in request preview and approval review
- `P0` support terminal log file:line jumps into the code surface
- `P0` add binary and large-file regression fixtures to browser preview
- `P0` update aging and project-workspace E2E coverage around anchors and restore
- `P1` document Windows path, newline, and readability checks
- `P1` prepare the follow-up slice for symbol/range anchors

### English

Goal:

- lock selected-file context into a `file + line anchor + restore + bounded fallback` workflow

Phase:

- `Post-MVP`

Scope:

- line-anchor selection and highlighting in the code viewer
- restating line anchors in request preview and approval review
- extending the provider request envelope with `activeFileLine`
- restoring `selectedFilePath + selectedFileLine` after reload
- fallback handling for invalid anchors, missing files, binary files, and truncated previews
- jumping from terminal-log `file:line` references into the code surface
- adding binary and large-file regression fixtures to browser preview
- documenting Windows path, newline, and readability expectations

Recommended Role Split:

- `Planner`
  - frames this slice as a selected-file stability sprint and leaves the next symbol/range draft
- `Orchestrator`
  - locks line-anchor contracts, restore semantics, and fallback rules while syncing docs
- `Designer`
  - defines the visual rules for anchors, restore state, and bounded fallback
- `Frontend`
  - implements line-anchor UI, restore visibility, log jumps, and fallback presentation
- `Backend`
  - extends the provider request envelope with `activeFileLine` and preserves file-read fallback semantics
- `QA`
  - checks anchor accuracy, restore reliability, fallback safety, and no regression in log context
- `Tester`
  - validates reload, binary, large-file, and Windows newline/path scenarios

Acceptance Criteria:

- users can select and reread a line anchor in the code surface
- request preview and approval review show `selected file + line anchor + active logs` together
- selected file and line anchor restore through best-effort recovery after reload
- binary and large files use bounded fallback without breaking the UI
- terminal log `file:line` references can jump into the code surface
- related E2E coverage is updated

Risks:

- stale anchors may remain during rapid file and line switching
- truncation plus anchors may blur the meaning of original line positions
- Windows CRLF and path separators may drift anchor or restore values
- the slice loses approval value if the viewer and request envelope diverge again on line-anchor semantics

Sprint 13 initial backlog:

- `P0` persist and restore `selectedFileLine`
- `P0` add `activeFileLine` to the provider request envelope
- `P0` make line anchors visible in request preview and approval review
- `P0` support terminal-log file:line jumps into the code surface
- `P0` add binary and large-file regression fixtures to browser preview
- `P0` update aging and project-workspace E2E coverage around anchors and restore
- `P1` document Windows path, newline, and readability checks
- `P1` prepare the follow-up slice for symbol/range anchors

## Sprint 14

### 한국어

목표:

- 프론트엔드 구조를 `FSD` 기준의 `app / widgets / features / shared`로 재정렬하고, `src/App.tsx`를 얇은 entrypoint로 낮춘다.

단계:

- `Post-MVP`

포함 범위:

- `src/App.tsx`를 얇은 엔트리 파일로 전환
- `src/app/App.tsx`를 composition root로 도입
- `projects`, `terminals`, `auth`, `agents`, `telegram`, `tasks`, `workspace` 흐름을 feature hook과 순수 `TypeScript` helper로 분리
- 좌측 project rail, 중앙 workspace stage, 우측 agent rail을 widget으로 분리
- persisted UI state 저장 로직을 feature 모듈로 이동
- 기존 runtime contract와 사용자-visible layout은 유지

권장 역할 분리:

- `Planner`
  - 이번 슬라이스를 `frontend structure sprint`로 정리하고, 다음 widget 세분화와 symbol/range anchor 초안을 남긴다
- `Orchestrator`
  - `app -> widgets -> features -> shared` 경계를 잠그고 source-of-truth 문서를 동기화한다
- `Designer`
  - FSD 분해가 workbench-first layout을 해치지 않는지 확인하고, 다음 `code-stage / terminal-stage / support` 분해 기준을 정리한다
- `Frontend`
  - composition root, feature hook, widget 분리와 기존 selector/copy contract 유지
- `Backend`
  - runtime contract 무변경을 확인하고 frontend split과 충돌하지 않게 한다
- `QA`
  - restore, request envelope, approval, provider gating 무회귀를 확인한다
- `Tester`
  - 기존 E2E selector와 핵심 flow가 그대로 유지되는지 검증한다

완료조건:

- `src/App.tsx`는 얇은 엔트리 파일이 된다.
- 주요 orchestration은 `features/*/model`과 `shared/lib`로 이동한다.
- 좌측 project rail, 중앙 workspace stage, 우측 agent rail이 widget 경계로 분리된다.
- 기존 request payload와 approval semantics는 유지된다.
- 기존 E2E suite가 통과한다.

리스크:

- restore ordering이 바뀌면 selected file, provider, execution mode가 어긋날 수 있다.
- terminal polling이나 provider bootstrap effect가 중복되면 stale state나 duplicate interval이 생길 수 있다.
- UI를 card 단위로 과분해하면 workbench-first 구조가 다시 약해질 수 있다.
- widget 분해 뒤 selector/copy contract가 바뀌면 E2E false red가 발생할 수 있다.

Sprint 14 initial backlog:

- `P0` thin entry `src/App.tsx` and introduce `src/app/App.tsx`
- `P0` extract `useProjectWorkspace`
- `P0` extract `useTerminalWorkspace`
- `P0` extract `useProviderAuth`
- `P0` extract `useAgentSuggestions`
- `P0` extract persisted UI state and task-history helpers
- `P0` keep current Playwright selectors and labels stable
- `P1` extract `useTelegramWorkspace`
- `P1` prepare `code-stage`, `terminal-stage`, `workspace-support` follow-up widget split

### English

Goal:

- reorganize the frontend into an `FSD`-style `app / widgets / features / shared` structure and reduce `src/App.tsx` to a thin entrypoint

Phase:

- `Post-MVP`

Scope:

- convert `src/App.tsx` into a thin entry file
- introduce `src/app/App.tsx` as the composition root
- move `projects`, `terminals`, `auth`, `agents`, `telegram`, `tasks`, and `workspace` flow logic into feature hooks and pure `TypeScript` helpers
- split the left project rail, center workspace stage, and right agent rail into widgets
- move persisted UI-state handling into a feature module
- preserve the current runtime contracts and user-visible layout

Recommended Role Split:

- `Planner`
  - frames this slice as a frontend-structure sprint and leaves the next widget-splitting and symbol/range-anchor draft
- `Orchestrator`
  - locks the `app -> widgets -> features -> shared` boundaries and syncs the source-of-truth docs
- `Designer`
  - checks that the FSD split preserves the workbench-first layout and defines the next `code-stage / terminal-stage / support` split
- `Frontend`
  - implements the composition root, feature-hook split, widget split, and preserves the existing selector/copy contract
- `Backend`
  - confirms that runtime contracts remain unchanged and do not conflict with the frontend split
- `QA`
  - checks no regression in restore, request-envelope, approval, and provider-gating behavior
- `Tester`
  - validates that the existing E2E selectors and critical flows remain intact

Acceptance Criteria:

- `src/App.tsx` becomes a thin entry file
- major orchestration moves into `features/*/model` plus `shared/lib`
- the left project rail, center workspace stage, and right agent rail are split as widget boundaries
- the existing request payload and approval semantics remain stable
- the existing E2E suite stays green

Risks:

- restore ordering may drift selected file, provider choice, or execution mode
- duplicate terminal polling or provider bootstrap effects may create stale state or repeated intervals
- over-fragmenting the UI into cards may weaken the workbench-first structure again
- selector or copy drift after widget splitting may create false-red E2E failures

Sprint 14 initial backlog:

- `P0` thin entry `src/App.tsx` and introduce `src/app/App.tsx`
- `P0` extract `useProjectWorkspace`
- `P0` extract `useTerminalWorkspace`
- `P0` extract `useProviderAuth`
- `P0` extract `useAgentSuggestions`
- `P0` extract persisted UI-state and task-history helpers
- `P0` keep current Playwright selectors and labels stable
- `P1` extract `useTelegramWorkspace`
- `P1` prepare the follow-up widget split into `code-stage`, `terminal-stage`, and `workspace-support`

## Sprint 15

### 한국어

목표:

- `Mission Control`형 workbench baseline을 고정하고, `left rail + split workbench + agent workspace`를 현재 UI source of truth로 정리한다.

단계:

- `Post-MVP`

포함 범위:

- 하단 패널 제거와 `top header / left rail / split workbench / agent workspace` 구조 고정
- pane-local tab strip, compact tab, split gutter 기준 확정
- `thread + composer first`, `pending dock second` 규칙 고정
- light/dark 분리, scrollbar theme, compact typography 기준 정리
- left rail을 `프로젝트 / 탐색기 / 소스 / 아웃라인 / 설정` 구조로 정리
- `프로젝트`를 project hub, `탐색기`를 current-project text search로 재정의
- responsive에서 전체 vertical stacking보다 panel collapse를 우선하는 규칙 정리

완료조건:

- `Sprint 15` 시안이 더 이상 terminal-first shell처럼 읽히지 않는다.
- 하단 패널이 기본 구조에서 제거된다.
- 오른쪽 패널은 `mission summary -> thread -> composer -> pending dock` 흐름으로 읽힌다.
- 중앙은 pane-local tab strip과 split 가능한 workbench로 정의된다.
- 관련 source-of-truth 문서가 동기화된다.

리스크:

- 시안 품질이 올라가도 실제 앱 구현이 따라오지 않으면 문서와 제품이 다시 벌어질 수 있다.
- approval이나 status copy가 과하게 크면 thread 중심 흐름이 다시 무너질 수 있다.
- responsive에서 panel collapse 우선 규칙이 구현되지 않으면 IDE-like composition이 깨질 수 있다.

Sprint 15 initial backlog:

- `P0` lock `left rail + split workbench + agent workspace` baseline
- `P0` remove default bottom panel from the primary layout
- `P0` make the right panel `thread/composer first`
- `P0` move project switching into the left rail
- `P0` define pane-local tabs and split behavior
- `P1` sync compact density, theme, and scrollbar rules
- `P1` document responsive collapse order

### English

Goal:

- lock the `Mission Control` workbench baseline and promote `left rail + split workbench + agent workspace` into the current UI source of truth

Phase:

- `Post-MVP`

Scope:

- remove the default bottom panel and fix the `top header / left rail / split workbench / agent workspace` structure
- define pane-local tab strips, compact tabs, and split-gutter rules
- lock `thread + composer first`, `pending dock second`
- document light/dark separation, scrollbar theming, and compact typography
- define the left rail as `Project / Explorer / Source / Outline / Settings`
- redefine `Project` as the project hub and `Explorer` as current-project text search
- document responsive collapse before full vertical stacking

Acceptance Criteria:

- the `Sprint 15` baseline no longer reads like a terminal-first shell
- the bottom panel is removed from the default layout
- the right panel reads as `mission summary -> thread -> composer -> pending dock`
- the center is defined as a split workbench with pane-local tabs
- related source-of-truth docs are synchronized

Risks:

- the docs and the real app may drift again if the visual baseline is not implemented soon
- oversized approval or status copy can weaken the thread-first flow
- IDE-like composition will break if responsive behavior stacks everything too early

Sprint 15 initial backlog:

- `P0` lock the `left rail + split workbench + agent workspace` baseline
- `P0` remove the default bottom panel from the primary layout
- `P0` make the right panel `thread/composer first`
- `P0` move project switching into the left rail
- `P0` define pane-local tabs and split behavior
- `P1` sync compact density, theme, and scrollbar rules
- `P1` document the responsive collapse order

## Sprint 16

### 한국어

목표:

- `Concept A` 로고 방향을 현재 브랜드 기준으로 확정하고, 왼쪽 메뉴 5개 view의 기획과 디자인을 source of truth로 정리한다.

단계:

- `Post-MVP`

포함 범위:

- logo concept 비교와 선택 기록
- `Concept A` 자산을 현재 web brand asset 기준으로 승격
- `프로젝트`, `탐색기`, `소스제어`, `아웃라인`, `설정`의 view model 문서화
- `프로젝트 허브`와 `탐색기`의 역할 경계 정리
- UI 기준 문서와 스프린트 문서에 Sprint 15/16 결과 흡수

완료조건:

- `Concept A`가 현재 브랜드 기준으로 문서에 명시된다.
- active web logo asset이 선택된 방향과 맞는다.
- 왼쪽 메뉴 view별 목적, 표시 정보, interaction, density 규칙이 문서화된다.
- `Sprint 15`와 `Sprint 16` 결과가 `sprint-plan`, `brand-identity`, UI 기준 문서에 흡수된다.

리스크:

- `src-tauri/icons`와 같은 desktop bundle icon은 별도 갱신이 필요하다.
- left-menu view가 문서에는 정리돼도 실제 구현에서 다시 하나의 placeholder panel로 뭉개질 수 있다.

Sprint 16 initial backlog:

- `P0` choose and record the logo baseline
- `P0` promote `Concept A` into active web brand assets
- `P0` add a dedicated left-menu view design doc
- `P0` sync `README`, routing docs, and UI benchmark docs
- `P1` refresh desktop launcher and bundle icons from the selected mark
- `P1` prepare implementation tasks for explorer, search, source control, outline, and settings views

### English

Goal:

- formalize `Concept A` as the current brand baseline and document the five left-menu views as source-of-truth design guidance

Phase:

- `Post-MVP`

Scope:

- record the logo-concept comparison and selection
- promote `Concept A` into the active web brand assets
- document the view models for `Project`, `Explorer`, `Source Control`, `Outline`, and `Settings`
- clarify the boundary between the project hub and the text-search explorer
- absorb Sprint 15 and Sprint 16 decisions into sprint and UI source docs

Acceptance Criteria:

- `Concept A` is explicitly documented as the current brand baseline
- the active web logo assets match the selected direction
- each left-menu view has documented purpose, visible content, interaction, and density rules
- Sprint 15 and Sprint 16 outcomes are absorbed into `sprint-plan`, `brand-identity`, and the UI source docs

Risks:

- desktop bundle icons such as `src-tauri/icons` still need a separate refresh pass
- the real implementation may still collapse the left-menu views into a generic placeholder panel if the next sprint is not explicit

Sprint 16 initial backlog:

- `P0` choose and record the logo baseline
- `P0` promote `Concept A` into active web brand assets
- `P0` add a dedicated left-menu view design doc
- `P0` sync `README`, routing docs, and UI benchmark docs
- `P1` refresh desktop launcher and bundle icons from the selected mark
- `P1` prepare implementation tasks for explorer, search, source control, outline, and settings views

## Sprint 17

Goal:

- lock the new product design draft in `/Users/kwon/Downloads/test (1)` as the development baseline above the existing implementation
- split the implementation into executable slices, starting with the title/status shell, left `Projects/Files` accordion, and right agent model row

Current status:

- Sprint 17 is active.
- The detailed implementation plan is committed in [New Product Design Implementation Plan](/home/kwon/project/gtum/docs/superpowers/plans/2026-05-28-new-product-design-implementation.md).
- The first code slice now replaces the old `mission-header` with `Titlebar` and `StatusBar`, exposes `app-titlebar` and `app-statusbar`, and the right Agent Bar now uses a compact model header plus workspace-scoped agent session strip instead of the retired `agent-model-row`.
- The left project panel now uses independent `Projects` and `Files` accordion sections with `left-projects-section` and `left-files-section` landmarks.
- The follow-up refit applies the uploaded draft source directly: `gtum-stage`, `gtum-scaler`, `gtum-window`, `body-grid`, `sidebar`, `agent`, and `statusbar` now follow the `/Users/kwon/Downloads/test (1)` JSX/CSS proportions.
- The old activity rail is removed from the rendered DOM. Panel resize handles are owned by the shell grid instead of the side panels.
- The frontend has now been fully reset because the prior implementation continued to overlap the design draft. The old `src/app`, `src/features`, `src/widgets`, `src/shared`, `src/stores`, and `src/lib` frontend implementation is deleted.
- The active frontend now starts at `src/app/main.tsx`, which mounts the uploaded design prototype through `src/app/providers/legacy-prototype.ts` while the design is migrated into reusable TSX/FSD components.
- Sprint 18 extraction has started: `Titlebar` and `StatusBar` now live in `src/widgets/app-shell/ui` as TSX components while preserving the uploaded design class names, anchors, visible copy, and settings entry behavior.
- The first backend reconnection slice is active through `src/shared/api/runtimeProjects.ts`: the sidebar can open a real project folder in Tauri, route project overview and file reads through the typed service, render the runtime file tree, and keep browser/Vite preview on an empty no-runtime fallback instead of a bundled project fixture.
- `src/prototype.jsx` now consumes the reusable backend contract seam instead of duplicating Tauri `invoke` mapping logic; future TSX components should use the same service.
- The native window-control slice is active through `src/shared/api/runtimeWindow.ts`: the Tauri window is frameless, custom macOS/Windows titlebar controls call the native window API, browser preview keeps injectable/no-op fallbacks for E2E, and native maximize polling is intentionally disabled to avoid macOS installed-app resize/style-mask churn.
- The Tauri launch window starts at the uploaded-design baseline (`1320x824`), and the shell now fills the entire viewport after native resize or maximize instead of preserving a fixed canvas with letterboxing.
- The terminal runtime slice is active through `src/shared/api/runtimeTerminals.ts`: user-created terminal tabs create real Tauri PTY sessions when desktop runtime is available, runtime logs poll back into the tab body, and closing runtime-backed tabs terminates the PTY session. Agent command review and decisions stay in the right panel until approval, then approved commands dispatch through the same terminal runtime.
- The agent suggestion runtime slice is active through `src/shared/api/runtimeAgentSuggestions.ts`: desktop-runtime Codex requests call `read_agent_provider_capabilities` for runtime-backed model/attachment metadata, then call `request_agent_suggestions` with project, active tab, selected file, recent log lines, user task, and an optional selected model id.
- Provider flows now reject silent mock fallback: deferred providers such as Claude show an explicit unavailable state, browser preview no longer fabricates agent replies, and Codex command review/decisions stay in the right agent panel instead of creating user terminal tabs.
- Windows Codex suggestion execution now avoids passing the full prompt through `codex.cmd`; the runtime sends the prompt over stdin and prefers the direct Node `codex.js` entrypoint when available.
- Windows release-executable smoke now launches successfully and initializes app-data state after migrating a legacy `%APPDATA%\com.gagakor.gtum` file into a sibling `.legacy-file-<timestamp>.json` backup.
- Browser/Vite preview starts from the empty `Open a project` state and exposes `window.__GTUM_BACKEND_BRIDGE__` so E2E can verify the bridge without requiring Tauri or bundled project data.
- Validation priority is now installable-desktop first: Windows manual install/launch smoke and native runtime behavior must be checked before using web/Vite preview as secondary regression evidence.
- Legacy frontend E2E tests have been removed with the deleted frontend. The active UI smoke coverage is now `tests/e2e/design-prototype.spec.ts`.
- Verification passed on 2026-06-01 with `npm run lint`, `npm run build`, `npm run test:e2e`, `cargo check --manifest-path src-tauri/Cargo.toml`, `git diff --check`, and a macOS DMG smoke from `npx tauri build --bundles dmg --verbose`.

Phase:

- `Post-MVP`

Detailed execution plan:

- [New Product Design Implementation Plan](/home/kwon/project/gtum/docs/superpowers/plans/2026-05-28-new-product-design-implementation.md)
- [Real Runtime Loop Implementation Plan](/home/kwon/project/gtum/docs/superpowers/plans/2026-06-01-real-runtime-loop.md)

Scope:

- document the new-design override policy
- identify conflicts between the new design and the existing `mission-header`, card-heavy support surfaces, and terminal-first structure
- `Sprint 17`: new shell, left accordion, compact agent model row
- `Sprint 18`: unified editor/terminal workbench tabs and split groups
- `Sprint 19`: settings modal, provider model selection, and risk-based approval policy
- `Sprint 20`: responsive/collapse stabilization and source-of-truth documentation sync

Acceptance Criteria:

- the detailed implementation plan is documented by file, test, and sprint
- the sprint plan explicitly says the new design wins when it conflicts with old structure
- Sprint 17 is scoped to `titlebar/statusbar`, `Projects/Files` accordion, and agent model row
- verification commands and E2E coverage are listed for each sprint

Risks:

- preserving too much of the old implementation may leave the new design only partially applied
- mixing the new workbench tab model with the current terminal/session model can break restore and E2E flows
- approval auto-run can reduce trust if trusted boundaries are not explicit

Sprint 17 initial backlog:

- `P0` done: create and commit the detailed new-design implementation plan
- `P0` done: declare the new design override policy in sprint planning
- `P0` done: prepare failing E2E coverage for the new shell landmarks
- `P0` done: implement titlebar/statusbar and left `Projects/Files` accordion
- `P0` done: refit the shell, left sidebar, right agent panel, and statusbar to the uploaded JSX/CSS source structure
- `P0` done: replace the right agent provider/readiness row with the standalone Agent Bar baseline: compact selected-model header, per-workspace agent session tabs, composer-level model/reasoning/fast-mode controls, and no detached context summary card
- `P0` done: delete the previous frontend implementation and replace it with the uploaded design prototype as the only active frontend
- `P0` done: reconnect the clean prototype to the Tauri filesystem backend for project overview and file reads
- `P0` done: add the TSX app entry and FSD-style type/service seams without changing the uploaded design DOM
- `P0` done: route the legacy prototype's project overview and file-open behavior through `src/shared/api/runtimeProjects.ts` while keeping browser preview on an empty runtime-required fallback
- `P0` done: make the custom titlebar the real frameless desktop window chrome through `src/shared/api/runtimeWindow.ts` and Tauri window-control permissions
- `P0` done: wire terminal tabs to real PTY create/read/write/terminate behavior through `src/shared/api/runtimeTerminals.ts`
- `P0` done: wire agent suggestions to the real Codex session-backed request path and diagnostics through `src/shared/api/runtimeAgentSuggestions.ts`
- `P0` done: surface Codex suggestion runtime failures as visible messages instead of approval cards, covering CLI failures, unstructured output, error-only responses, and empty-command responses
- `P0` done: remove browser-preview canned agent replies and show a desktop-runtime-required state for Codex requests without Tauri
- `P0` done: fix the Windows Codex request launch path that failed with `batch file arguments are invalid` by moving the prompt to stdin and bypassing the npm `.cmd` shim when possible
- `P0` done: fix Windows installed-app startup when a legacy file occupies the app-data root, including Rust unit coverage and release-executable launch smoke
- `P0` done: replace the simulated Codex provider-login path in the runtime desktop flow with `src/shared/api/runtimeAgentAuth.ts`, a `codex login --device-auth` terminal launcher, runtime connection hydration, disconnect handling, and Codex reconnect/error display
- `P0` done: approved commands run only as isolated Agent-owned jobs with right-panel status/log/cancel visibility; the user-visible center terminal is never created, selected, written, or otherwise mutated by Agent approval
- `P0` partial: run an installable desktop smoke pass first; Windows build/launch/state-file initialization is covered, while native folder picker, PTY terminal, Codex login launcher, and first real suggestion request still need manual sign-off
- `P0` next: re-establish workspace snapshot/restore on the new shell using the fixed per-store state files after the installed-app smoke baseline is captured
- `P1` done: extract `Titlebar` and `StatusBar` into TSX app-shell components with E2E shell contract coverage
- `P1` start workbench tab model design for Sprint 18
- `P1` extract the legacy `Titlebar`, `Sidebar`, `Workspace`, `AgentPanel`, and modal surfaces into TSX components that consume typed runtime services
- `P1` identify docs that must be synchronized after each implementation slice

## 스프린트 간 의존성 / Cross-Sprint Dependencies

### 한국어

- `Sprint 2`는 `Sprint 0`의 앱 셸과 `Sprint 1`의 프로젝트 열기 구조가 필요하다.
- `Sprint 3`는 `Sprint 0`의 런타임 통신 구조가 필요하다.
- `Sprint 4`는 `Sprint 2`의 활성 로그 읽기와 `Sprint 3`의 provider 연결이 필요하다.
- `Sprint 5`는 앞선 모든 스프린트 결과를 통합하는 단계다.
- `Sprint 6`는 `Sprint 4`의 승인 흐름과 `Sprint 5`의 작업 상태 모델이 필요하다.
- `Sprint 7`은 `Sprint 3`의 provider foundation, `Sprint 4`의 approval flow, `Sprint 5`의 workspace restore, 그리고 실제 Windows 사용 피드백이 필요하다.
- `Sprint 8`은 `Sprint 7`의 UX 재정리 결과를 바탕으로 auth contract를 heuristic 없는 명시 계약으로 바꾸는 단계다.
- `Sprint 9`는 `Sprint 7`의 와이어프레임과 `Sprint 8`의 auth contract 명시화를 바탕으로 실제 워크스페이스 리디자인을 구현하는 단계다.
- `Sprint 10`은 `Sprint 8`의 auth contract와 `Sprint 9`의 워크스페이스 리디자인 위에서 개발용 bridge와 diagnostics를 정리한 임시 슬라이스다.
- `Sprint 11`은 `Sprint 10`의 임시 bridge 경험을 바탕으로 source of truth인 `OAuth/session login`을 실제 경로로 전환하는 단계다.
- `Sprint 12`는 `Sprint 9`의 워크스페이스 구조와 `Sprint 11`의 real request path 위에서 selected-file context를 실사용 가능한 수준으로 연결하는 단계다.
- `Sprint 13`은 `Sprint 12`의 selected-file surface 위에서 line anchor, restore semantics, bounded fallback을 안정화하는 단계다.
- `Sprint 14`는 `Sprint 13`의 editor-like surface 위에서 frontend 구조를 FSD 기준으로 재정렬해 이후 widget 세분화와 symbol/range 확장을 쉽게 만드는 단계다.
- `Sprint 15`는 `Sprint 14`의 FSD 구조 위에서 실제 UI baseline을 `Mission Control`형 workbench로 다시 고정하는 단계다.
- `Sprint 16`은 `Sprint 15`의 화면 baseline을 바탕으로 브랜드와 left-menu view model을 source of truth로 굳히는 단계다.
- `Sprint 17`은 `Sprint 16`의 브랜드/left-menu 기준과 새 제품 디자인 시안을 바탕으로 기존 구현과 충돌하는 구조를 새 디자인 쪽으로 정리하는 단계다.
- `Sprint 18`은 `Sprint 17`의 shell/left/right baseline 위에서 중앙 workbench tab model을 구현하는 단계다.
- `Sprint 19`는 `Sprint 17`의 agent model row와 `Sprint 18`의 workbench context 위에서 settings와 approval policy를 구현하는 단계다.
- `Sprint 20`은 `Sprint 17-19` 구현을 responsive, E2E, source-of-truth 문서로 안정화하는 단계다.

### English

- `Sprint 2` depends on the app shell from `Sprint 0` and project open flow from `Sprint 1`
- `Sprint 3` depends on the runtime communication model from `Sprint 0`
- `Sprint 4` depends on active log reading from `Sprint 2` and provider connection from `Sprint 3`
- `Sprint 5` integrates and stabilizes results from all previous sprints
- `Sprint 6` depends on the approval flow from `Sprint 4` and the task-state model from `Sprint 5`
- `Sprint 7` depends on the provider foundation from `Sprint 3`, approval flow from `Sprint 4`, workspace restore from `Sprint 5`, and real Windows usage feedback
- `Sprint 8` turns the `Sprint 7` auth UX into an explicit backend-driven contract
- `Sprint 9` implements the real workspace redesign using the wireframes from `Sprint 7` and the auth contract clarified in `Sprint 8`
- `Sprint 10` depends on the explicit auth contract from `Sprint 8` and the workspace redesign from `Sprint 9` to stabilize the temporary bridge and diagnostics slice
- `Sprint 11` uses the contract from `Sprint 8`, the workspace from `Sprint 9`, and the bridge learnings from `Sprint 10` to implement the real `OAuth/session login` path
- `Sprint 12` uses the workspace structure from `Sprint 9` and the real request path from `Sprint 11` to make selected-file context usable in daily work
- `Sprint 13` stabilizes line anchors, restore semantics, and bounded fallback on top of the selected-file surface from `Sprint 12`
- `Sprint 14` reorganizes the frontend into an FSD-style structure on top of the editor-like surface from `Sprint 13` so later widget splitting and symbol/range expansion become safer
- `Sprint 15` uses the `Sprint 14` structure to relock the UI as a Mission Control-style workbench baseline
- `Sprint 16` uses the `Sprint 15` workbench baseline to formalize the brand and left-menu view model as source-of-truth docs
- `Sprint 17` uses the `Sprint 16` brand/left-menu baseline plus the new product design draft to resolve implementation conflicts in favor of the new design
- `Sprint 18` builds the center workbench tab model on top of the `Sprint 17` shell/left/right baseline
- `Sprint 19` implements settings and approval policy on top of the `Sprint 17` agent model row and `Sprint 18` workbench context
- `Sprint 20` stabilizes the `Sprint 17-19` implementation through responsive behavior, E2E coverage, and source-of-truth docs

## 스프린트별 성공 질문 / Sprint Success Questions

### 한국어

- `Sprint 0`
  - 앱 뼈대가 이후 확장을 감당할 만큼 정리되었는가
- `Sprint 1`
  - 사용자가 프로젝트와 코드 구조를 읽기 시작할 수 있는가
- `Sprint 2`
  - 테스트 중인 로그를 실제 앱 맥락 안에서 붙잡을 수 있는가
- `Sprint 3`
  - API 토큰 없이 provider 연결 방향이 성립하는가
- `Sprint 4`
  - 코드와 활성 로그를 읽는 에이전트 흐름이 실제로 동작하는가
- `Sprint 5`
  - MVP 데모에서 `gtum`의 차별점이 분명하게 드러나는가
- `Sprint 6`
  - 데스크톱 밖에서도 안전하게 상태를 보고 제한된 명령을 보낼 수 있는가
- `Sprint 7`
  - 사용자가 mock과 real의 경계를 헷갈리지 않고, 경로 입력 없이 프로젝트를 열며, 실제 provider 연동 다음 단계로 자연스럽게 넘어갈 수 있는가
- `Sprint 8`
  - provider auth 상태가 frontend 추측이 아니라 backend 계약으로 설명되는가
- `Sprint 9`
  - 현재 UI가 정말 작업용 워크스페이스처럼 느껴지고, 터미널과 에이전트 흐름이 한 화면에서 자연스럽게 읽히는가
- `Sprint 10`
  - 임시 bridge와 diagnostics가 실제 요청 파이프라인을 검증하는 데 충분한가
- `Sprint 11`
  - real provider login이 API key가 아니라 `OAuth/session` 기준으로 동작하는가
- `Sprint 12`
  - 사용자가 코드 surface와 활성 로그를 함께 보면서, 어떤 파일 맥락으로 제안이 나왔는지 승인 전에 분명히 이해할 수 있는가
- `Sprint 13`
  - 사용자가 같은 파일의 같은 지점으로 다시 돌아오고, line anchor가 request와 approval에서도 일관되게 읽히는가
- `Sprint 14`
  - 에이전트가 프론트 구조를 더 작고 명확한 단위로 수정할 수 있으면서도, workbench 가시성과 핵심 흐름은 그대로 유지되는가
- `Sprint 15`
  - 현재 메인 화면이 `VS Code`와 `conductor`의 강점을 섞은 IDE-like workspace로 읽히는가
- `Sprint 16`
  - 브랜드와 왼쪽 메뉴 view model이 더 이상 임시 시안이 아니라 구현 가능한 기준 문서로 정리되었는가
- `Sprint 17`
  - 새 제품 디자인 시안이 기존 구현보다 우선한다는 기준이 명확하고, 첫 구현 slice가 작고 검증 가능하게 잡혔는가

### English

- `Sprint 0`
  - is the app foundation organized enough to support later expansion
- `Sprint 1`
  - can users begin reading projects and code structure in the workspace
- `Sprint 2`
  - can the app truly capture live testing logs as working context
- `Sprint 3`
  - is provider connection feasible without manual API tokens
- `Sprint 4`
  - does the agent flow truly work with code and active logs together
- `Sprint 5`
  - does the MVP demo clearly show what makes `gtum` different
- `Sprint 6`
  - can users safely inspect status and send limited commands outside the desktop app
- `Sprint 7`
  - can users avoid confusing mock and real flows, open projects without typing paths, and move naturally into the next stage of real provider integration
- `Sprint 8`
  - can provider-auth state now be explained by backend contract instead of frontend guesswork
- `Sprint 9`
  - does the UI now feel like a real working workspace where the terminal and agent flow read naturally together
- `Sprint 10`
  - is the temporary bridge sufficient to exercise the request pipeline while the real auth path is prepared
- `Sprint 11`
  - does real provider login work through `OAuth/session` instead of API-key setup
- `Sprint 12`
  - can users understand which file context produced a suggestion while reading code and active logs together before approval
- `Sprint 13`
  - can users return to the same location in a file and reread that line-anchor context consistently in request and approval flows
- `Sprint 14`
  - can agents edit the frontend in smaller, clearer units while preserving workbench visibility and the core user flow
- `Sprint 15`
  - does the main screen now read like an IDE-style workspace that combines the strengths of `VS Code` and `conductor`
- `Sprint 16`
  - are the brand and left-menu view model now documented as implementable source of truth rather than temporary concept notes
- `Sprint 17`
  - is the new product design clearly prioritized over the existing implementation, with a small and testable first implementation slice

## Recommended Next Action

Resolve the Anthropic approval/contract gate (or restrict public Claude releases to API/cloud credentials), complete the Windows installed-app sign-off, and record a sustained manual soak. Do not run live `claude -p` inference without explicit user approval. Auto-approval remains out of scope.
