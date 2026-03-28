# gtum 메시지 흐름 / Message Flow

## 문서 목적 / Document Purpose

### 한국어

이 문서는 현재 `gtum`의 주요 사용자 흐름과 runtime 메시지 흐름을 정리하는 source of truth다.

목적은 다음과 같다.

- 사용자가 보는 흐름과 시스템이 처리하는 흐름을 같은 문서에서 맞춘다.
- request payload, approval boundary, restore 경로를 진행 중 `WORKLOG`가 아니라 기준 문서에 남긴다.
- UI 변경과 runtime contract 변경이 어느 지점에서 만나야 하는지 분명히 한다.

### English

This document is the source of truth for the major user-facing and runtime-facing flows in `gtum`.

Its goals are:

- align what the user sees with what the system actually does
- preserve request payloads, approval boundaries, and restore behavior in canonical docs rather than leaving them inside temporary sprint `WORKLOG`s
- make it clear where UI changes and runtime-contract changes must meet

## 언제 읽는 문서인가 / When To Read This Document

### 한국어

아래 상황이면 이 문서를 읽는다.

- 프로젝트 열기, code surface, provider connect, suggestion request, approval 실행, restore 흐름을 바꿀 때
- 어떤 데이터가 어떤 순서로 이동하는지 확인해야 할 때
- E2E 시나리오와 실제 사용자 흐름 이름을 맞춰야 할 때

### English

Read this document when:

- you are changing project-open, code-surface, provider-connect, suggestion-request, approval, or restore behavior
- you need to confirm the order in which data moves through the system
- you need to align E2E scenario names with real user flows

## 장문 문서 라우팅 / Long-Doc Routing

### 한국어

이 문서는 200줄을 넘는 장문 흐름 문서다. 기본값은 필요한 flow만 읽는 것이다.

- 프로젝트 열기와 파일 복원이 궁금할 때
  - `Flow 1`과 `Flow 2`만 읽는다.
- provider 연결과 request/approval가 궁금할 때
  - `Flow 3`, `Flow 4`, `Flow 5`만 읽는다.
- restore와 반복 사용이 궁금할 때
  - `Flow 6`과 테스트 연결 부분만 읽는다.

### English

This document exceeds 200 lines. Do not reread every flow by default.

- when you need project-open or file-restore behavior
  - read only `Flow 1` and `Flow 2`
- when you need provider connect or request-and-approval behavior
  - read only `Flow 3`, `Flow 4`, and `Flow 5`
- when you need restore or repeated-use behavior
  - read only `Flow 6` plus the linked test section

## Flow 1. 프로젝트 열기와 기본 복원 / Project Open And Baseline Restore

### 한국어

1. 앱 시작 시 프론트엔드는 `localStorage`에서 마지막 UI 상태를 읽는다.
2. 마지막 프로젝트 경로가 있으면 [`src/app/App.tsx`](../src/app/App.tsx)가 persisted UI state를 읽고 [`src/features/projects/model/useProjectWorkspace.ts`](../src/features/projects/model/useProjectWorkspace.ts)의 `openProject`를 자동 실행한다.
3. 프론트엔드는 [`src/lib/runtime.ts`](../src/lib/runtime.ts)를 통해 `read_project_overview`를 요청한다.
4. 런타임 [`src-tauri/src/runtime/filesystem/mod.rs`](../src-tauri/src/runtime/filesystem/mod.rs)가 프로젝트 metadata, 파일 트리, Git overview를 반환한다.
5. 프론트엔드는 프로젝트 상태를 갱신하고, 복원 가능한 선택 파일이 있으면 그 파일을 먼저 읽는다.
6. 워크스페이스용 PTY 세션이 없으면 생성하고, 있으면 첫 세션을 활성 탭으로 맞춘다.
7. task history에 `Project opened`가 기록된다.

### English

1. On startup, the frontend reads the last UI state from `localStorage`.
2. If a last project path exists, [`src/app/App.tsx`](../src/app/App.tsx) reads the persisted UI state and automatically runs `openProject` from [`src/features/projects/model/useProjectWorkspace.ts`](../src/features/projects/model/useProjectWorkspace.ts).
3. The frontend requests `read_project_overview` through [`src/lib/runtime.ts`](../src/lib/runtime.ts).
4. [`src-tauri/src/runtime/filesystem/mod.rs`](../src-tauri/src/runtime/filesystem/mod.rs) returns project metadata, file tree, and Git overview.
5. The frontend updates project state and restores a preferred selected file if possible.
6. If no workspace PTY exists, one is created; otherwise the first session becomes the active tab.
7. `Project opened` is recorded into task history.

## Flow 2. 파일 선택과 code surface / File Focus And Code Surface

### 한국어

1. 사용자가 파일 트리에서 파일을 선택하거나 terminal log의 `file:line` 참조를 누른다.
2. 프론트엔드는 `read_project_file`을 호출한다.
3. 런타임은 project root 밖 경로를 거부하고, file snapshot을 반환한다.
4. 프론트엔드는 selected file, display path, binary 여부, truncation 여부, line count를 갱신한다.
5. line anchor가 있으면 해당 줄로 스크롤하고 강조한다.
6. text file이면 request용 snippet을 만들고, binary 또는 large file이면 bounded fallback UI를 보여준다.
7. task history에는 `Code surface focused` 또는 `Line anchor focused`가 남는다.

### English

1. The user selects a file from the tree or jumps from a `file:line` terminal reference.
2. The frontend calls `read_project_file`.
3. The runtime rejects paths outside the project root and returns a file snapshot.
4. The frontend updates selected file state, display path, binary flag, truncation flag, and line count.
5. If a line anchor exists, the code view scrolls to and highlights that line.
6. For text files, a request snippet is prepared; for binary or large files, a bounded fallback UI is shown.
7. Task history records `Code surface focused` or `Line anchor focused`.

## Flow 3. Provider 진단과 Codex 연결 / Provider Diagnostics And Codex Connect

### 한국어

1. 앱은 초기 로드 시 provider connection 목록과 provider diagnostics를 함께 읽는다.
2. `Codex`는 [`src-tauri/src/runtime/codex.rs`](../src-tauri/src/runtime/codex.rs)에서 아래를 검사한다.
   - `codex` CLI 존재
   - `~/.codex/auth.json` 존재
   - ChatGPT session 사용 가능 여부
3. 사용자가 `Connect Codex`를 누르면 `begin_agent_login`이 호출된다.
4. auth manager는 현재 real path가 callback 기반이 아니라 local `Codex CLI` session 검증 기반임을 반영해 상태를 갱신한다.
5. 사용자가 `Open Codex Login`을 누르면 앱은 새 terminal session에서 `codex login --device-auth`를 실행한다.
6. 연결 성공 시 provider status는 `connected`, 실패 시 `error`, `Claude`는 `deferred/error` 성격의 비실사용 상태로 남는다.

### English

1. On initial load, the app reads both provider connections and provider diagnostics.
2. `Codex` diagnostics in [`src-tauri/src/runtime/codex.rs`](../src-tauri/src/runtime/codex.rs) check:
   - whether the `codex` CLI exists
   - whether `~/.codex/auth.json` exists
   - whether a ChatGPT-backed session is available
3. When the user clicks `Connect Codex`, `begin_agent_login` runs.
4. The auth manager updates state based on the real path being local `Codex CLI` session validation rather than callback-only auth.
5. When the user clicks `Open Codex Login`, the app launches `codex login --device-auth` in a new terminal session.
6. Successful validation sets the provider to `connected`, failure sets `error`, and `Claude` remains in a deferred/not-yet-daily-use state.

## Flow 4. Agent Request Envelope / Agent Request Envelope

### 한국어

현재 `request_agent_suggestions`의 입력 계약은 아래 필드를 기준으로 고정한다.

- `provider`
- `projectName`
- `projectPath`
- `activeTabId`
- `activeTabTitle`
- `activeFilePath`
- `activeFileLine`
- `activeFileSnippet`
- `lastNLogLines`
- `userTask`
- `executionMode`

실제 payload 조립은 [`src/features/agents/model/useAgentSuggestions.ts`](../src/features/agents/model/useAgentSuggestions.ts)에서 하고, [`src/app/App.tsx`](../src/app/App.tsx)가 필요한 project/file/terminal/auth 상태를 조합한다. typed contract는 [`src/lib/runtime.ts`](../src/lib/runtime.ts), runtime 수신 구조는 [`src-tauri/src/runtime/codex.rs`](../src-tauri/src/runtime/codex.rs)에 있다.

### English

The input contract for `request_agent_suggestions` is fixed around these fields:

- `provider`
- `projectName`
- `projectPath`
- `activeTabId`
- `activeTabTitle`
- `activeFilePath`
- `activeFileLine`
- `activeFileSnippet`
- `lastNLogLines`
- `userTask`
- `executionMode`

The payload is assembled in [`src/features/agents/model/useAgentSuggestions.ts`](../src/features/agents/model/useAgentSuggestions.ts), while [`src/app/App.tsx`](../src/app/App.tsx) composes the necessary project/file/terminal/auth state. It is typed in [`src/lib/runtime.ts`](../src/lib/runtime.ts) and received in [`src-tauri/src/runtime/codex.rs`](../src-tauri/src/runtime/codex.rs).

## Flow 5. Suggestion Request 와 승인 실행 / Suggestion Request And Approval Execution

### 한국어

1. 사용자가 request를 입력하고 provider가 연결된 상태여야 한다.
2. [`src/features/terminals/model/useTerminalWorkspace.ts`](../src/features/terminals/model/useTerminalWorkspace.ts)가 활성 terminal의 최근 50줄을 읽을 수 있게 유지한다.
3. [`src/features/projects/model/useProjectWorkspace.ts`](../src/features/projects/model/useProjectWorkspace.ts)와 [`src/shared/lib/file-context.ts`](../src/shared/lib/file-context.ts)가 anchored snippet을 준비한다.
4. 위 두 정보를 request envelope에 넣어 `request_agent_suggestions`를 호출한다.
5. `Codex` runtime은 connection 검증 뒤 `codex exec --sandbox read-only`로 suggestion을 요청한다.
6. 응답은 아래 구조로 정규화된다.
   - `summary`
   - `command`
   - `preferredTarget`
   - `confidence`
   - `error`
7. [`src/features/agents/model/useAgentSuggestions.ts`](../src/features/agents/model/useAgentSuggestions.ts)가 suggestion card용 UI state를 만들고, 사용자는 `현재 탭` 또는 `새 탭`으로 승인할 수 있다.
8. 승인 전에는 command가 실행되지 않는다.
9. 승인 후 실행은 [`src/features/terminals/model/useTerminalWorkspace.ts`](../src/features/terminals/model/useTerminalWorkspace.ts)의 command-target helper를 통해 현재 탭 또는 새 탭으로 주입된다.
10. task history에는 request 성공/실패, approval 성공/실패가 남는다.

### English

1. The user must enter a request while the provider is connected.
2. [`src/features/terminals/model/useTerminalWorkspace.ts`](../src/features/terminals/model/useTerminalWorkspace.ts) keeps the latest 50 lines from the active terminal available.
3. [`src/features/projects/model/useProjectWorkspace.ts`](../src/features/projects/model/useProjectWorkspace.ts) plus [`src/shared/lib/file-context.ts`](../src/shared/lib/file-context.ts) prepare the anchored file snippet.
4. Those inputs are packed into the request envelope and sent through `request_agent_suggestions`.
5. After validating the connection, the `Codex` runtime requests suggestions through `codex exec --sandbox read-only`.
6. The response is normalized into:
   - `summary`
   - `command`
   - `preferredTarget`
   - `confidence`
   - `error`
7. [`src/features/agents/model/useAgentSuggestions.ts`](../src/features/agents/model/useAgentSuggestions.ts) creates the suggestion-card UI state, and the user can approve it into the `current tab` or a `new tab`.
8. No command runs before approval.
9. After approval, execution is delegated through the command-target helper in [`src/features/terminals/model/useTerminalWorkspace.ts`](../src/features/terminals/model/useTerminalWorkspace.ts) for either the current-tab or new-tab path.
10. Task history records request success/failure and approval success/failure.

## Flow 6. Restore 와 반복 사용 / Restore And Repeated Use

### 한국어

1. 프론트엔드는 [`src/features/workspace/model/ui-state.ts`](../src/features/workspace/model/ui-state.ts)를 통해 마지막 프로젝트 경로, 선택 파일, line anchor, provider 선택, execution mode, task history를 `localStorage`에 저장한다.
2. 런타임은 provider auth, workspace meta, Telegram state를 app data JSON에 저장한다.
3. 앱 재시작 시 프론트엔드는 마지막 프로젝트를 다시 열고, 복원 가능한 파일과 line anchor를 우선 선택한다.
4. provider 연결 목록은 재로딩되지만, real provider는 stale connected 상태가 그대로 남지 않도록 다시 검증한다.
5. PTY 세션 객체 자체는 메모리 기반이므로 앱 프로세스 재시작 이후 완전 복원 대상이 아니다.

### English

1. The frontend stores the last project path, selected file, line anchor, provider choice, execution mode, and task history in `localStorage` through [`src/features/workspace/model/ui-state.ts`](../src/features/workspace/model/ui-state.ts).
2. The runtime stores provider auth, workspace metadata, and Telegram state in app-data JSON.
3. On app restart, the frontend reopens the last project and prefers the previously selected file and line anchor when still valid.
4. Provider connection lists reload, but real-provider state is revalidated so stale connected state does not survive unchecked.
5. PTY session objects themselves are memory-backed and are not fully restorable after a process restart.

## 현재 테스트 흐름과 연결 / Linked Test Flows

### 한국어

현재 E2E 기준 흐름은 아래 문서와 테스트 파일에서 같이 본다.

- 프로젝트와 파일: [`tests/e2e/project-workspace.spec.ts`](../tests/e2e/project-workspace.spec.ts)
- 터미널과 로그: [`tests/e2e/terminal-workspace.spec.ts`](../tests/e2e/terminal-workspace.spec.ts)
- provider 연결: [`tests/e2e/provider-auth.spec.ts`](../tests/e2e/provider-auth.spec.ts)
- request와 approval: [`tests/e2e/agent-request-flow.spec.ts`](../tests/e2e/agent-request-flow.spec.ts)
- aging/restore: [`tests/e2e/aging-core-flow.spec.ts`](../tests/e2e/aging-core-flow.spec.ts), [`tests/e2e/mvp-aging.spec.ts`](../tests/e2e/mvp-aging.spec.ts)

### English

The current E2E-aligned flows are covered through:

- project and file: [`tests/e2e/project-workspace.spec.ts`](../tests/e2e/project-workspace.spec.ts)
- terminal and logs: [`tests/e2e/terminal-workspace.spec.ts`](../tests/e2e/terminal-workspace.spec.ts)
- provider connect: [`tests/e2e/provider-auth.spec.ts`](../tests/e2e/provider-auth.spec.ts)
- request and approval: [`tests/e2e/agent-request-flow.spec.ts`](../tests/e2e/agent-request-flow.spec.ts)
- aging and restore: [`tests/e2e/aging-core-flow.spec.ts`](../tests/e2e/aging-core-flow.spec.ts), [`tests/e2e/mvp-aging.spec.ts`](../tests/e2e/mvp-aging.spec.ts)

## 문서 운영 원칙 / Documentation Rule

### 한국어

이 문서에 적혀 있어야 할 것은 `지속되는 흐름`이다.

- 다음 스프린트에서도 그대로 유지될 flow contract
- UI와 runtime이 만나는 payload shape
- restore, approval, execution처럼 다시 설명될 가능성이 높은 경계

반대로 일회성 진행 메모는 진행 중 `WORKLOG`에 둘 수 있지만, 스프린트 종료 후에는 여기나 다른 기준 문서에 흡수한 뒤 `WORKLOG`에서 제거한다.

### English

This document should capture only durable flow knowledge:

- flow contracts that survive beyond one sprint
- payload shapes where UI and runtime meet
- boundaries that will need to be re-explained, such as restore, approval, and execution

One-off progress notes may live in an active `WORKLOG`, but they should be absorbed into canonical docs before sprint close rather than retained as long-term history.
