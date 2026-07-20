# gtum 왼쪽 메뉴 뷰 설계 / Left Menu View Plan

## 문서 목적 / Document Purpose

### 한국어

이 문서는 `gtum`의 왼쪽 rail과 side panel 안에서 열리는 다섯 개 view를 역할별로 고정하는 설계 문서다.

목적은 다음과 같다.

- `프로젝트`, `탐색기`, `소스제어`, `아웃라인`, `설정`이 서로 다른 기능으로 읽히게 한다.
- `프로젝트 허브`와 `문구 검색`, `Git 작업`, `파일 구조 읽기`, `설정`이 한 패널 안에서 섞이지 않게 한다.
- 구현 전에 정보 구조, interaction, 밀도 기준을 합의된 형태로 남긴다.

### English

This document fixes the role of the five left-side views in `gtum`.

Its goals are to:

- make `Project`, `Explorer`, `Source Control`, `Outline`, and `Settings` clearly distinct
- prevent project management, text search, Git workflow, file-structure reading, and settings from collapsing into one generic panel
- document information architecture, interaction, and density before implementation

## 언제 읽는 문서인가 / When To Read This Document

### 한국어

아래 상황이면 이 문서를 읽는다.

- 왼쪽 rail icon과 side panel mode를 설계하거나 구현할 때
- `프로젝트`, `탐색기`, `소스제어`, `아웃라인`, `설정` 중 어떤 정보를 보여줄지 정할 때
- 비슷한 패널이 같은 기능처럼 보이기 시작할 때

### English

Read this document when:

- designing or implementing left-rail icons and side-panel modes
- defining what each of `Project`, `Explorer`, `Source Control`, `Outline`, and `Settings` should show
- two side-panel views are starting to feel functionally identical

## 기본 구조 / Baseline Structure

### 한국어

- 왼쪽 기본 view는 아래 다섯 개다.
  - `프로젝트`
  - `탐색기`
  - `소스제어`
  - `아웃라인`
  - `설정`
- 한 번에 하나의 left-menu mode만 primary 상태가 된다.
- rail은 icon-only이고, hover 시 tooltip으로 명칭을 보여준다.
- side panel 폭은 `프로젝트`, `탐색기`, `소스제어`, `아웃라인`에서 크게 흔들리지 않게 유지한다.
- `설정`은 form control이 있으므로 약간 더 넓어질 수 있다.
- 시안 단계에서는 다섯 뷰를 `Light`와 `Dark` 양쪽 버전으로 각각 확인할 수 있어야 한다.

### English

- The primary left-side views are:
  - `Project`
  - `Explorer`
  - `Source Control`
  - `Outline`
  - `Settings`
- Only one left-menu mode should be primary at a time.
- The rail stays icon-only and reveals labels on hover.
- Keep the side-panel width stable across `Project`, `Explorer`, `Source Control`, and `Outline`.
- `Settings` may widen slightly because it contains controls instead of list navigation.
- Preview mocks should show all five views in both `Light` and `Dark`.

## 뷰별 기준 / Per-View Rules

### 1. 프로젝트 / Project

### 한국어

- 목적
  - 프로젝트 허브와 빠른 파일 진입
- 보여주는 것
  - 현재 프로젝트
  - 최근 프로젝트
  - 프로젝트 리스트
  - `+` 버튼 또는 `폴더 추가` 액션
  - 현재 프로젝트의 폴더 구조와 빠른 파일 이동 row
- 상호작용
  - `+`로 로컬 폴더를 프로젝트 목록에 추가한다
  - 프로젝트 row를 누르면 현재 프로젝트를 전환한다
  - 현재 프로젝트 tree에서 파일 row를 누르면 center editor로 빠르게 이동한다
- 밀도
  - `탐색기`보다 약간 더 많은 정보가 들어가지만, 여전히 compact해야 한다
  - 프로젝트 이름과 파일 경로는 줄바꿈 대신 ellipsis를 쓴다

### English

- Purpose
  - the project hub plus fast file entry
- Show
  - current project
  - recent projects
  - the project list
  - a `+` or `Add Folder` action
  - the current project tree for fast file jumps
- Interaction
  - `+` adds a local folder to the project list
  - clicking a project row switches the active project
  - clicking a file in the current project tree jumps quickly into the center editor
- Density
  - it can hold slightly more information than `Explorer`, but should still stay compact
  - project names and file paths should use ellipsis, not wrapping

### 2. 탐색기 / Explorer

### 한국어

- 목적
  - 현재 프로젝트 안에서 특정 문구를 찾는 text-search view
- 보여주는 것
  - 상단 고정 search input
  - 최근 검색어
  - 파일별로 묶인 결과 목록
  - match highlight가 있는 line preview
  - 필요 시 case, regex, path 같은 compact filter row
- 상호작용
  - input은 항상 상단에 고정
  - 결과는 file group 단위로 접고 펼친다
  - result click은 파일을 열고 해당 line으로 이동한다
- 밀도
  - snippet 때문에 `프로젝트`보다 약간 큰 row를 허용한다
  - 결과는 file tree처럼 보이지 않고, result list처럼 읽혀야 한다

### English

- Purpose
  - a text-search view for finding specific phrases inside the current project
- Show
  - a fixed search input at the top
  - recent queries
  - grouped results by file
  - line previews with match highlighting
  - an optional compact filter row for case, regex, and path scope
- Interaction
  - keep the input fixed at the top
  - expand and collapse result groups by file
  - clicking a result opens the file and jumps to the matching line
- Density
  - allow slightly taller rows than `Project` because snippets need space
  - it should feel like a result list, not a file tree

### 3. 소스제어 / Source Control

### 한국어

- 목적
  - diff 검토와 Git 반영 작업
- 보여주는 것
  - 현재 branch
  - changed files
  - staged files
  - file별 `diff`, `stage`, `unstage` 상태
  - commit message 입력
  - commit / push action
- 상호작용
  - changed file click은 기본적으로 diff tab을 연다
  - staged / changed 그룹은 독립적으로 접고 펼친다
  - commit / push는 실제 지원 flow일 때만 활성화한다
- 밀도
  - `프로젝트`보다 약간 더 여유를 두되, Git 대시보드처럼 과하게 커지면 안 된다

### English

- Purpose
  - diff review plus Git submission workflow
- Show
  - current branch
  - changed files
  - staged files
  - per-file `diff`, `stage`, and `unstage` state
  - a commit message field
  - commit and push actions
- Interaction
  - clicking a changed file opens a diff tab by default
  - changed and staged groups collapse independently
  - commit and push are only active when the real flow is supported
- Density
  - slightly roomier than `Project`, but it should not expand into a full Git dashboard

### 4. 아웃라인 / Outline

### 한국어

- 목적
  - 현재 열려 있는 파일의 구조를 빠르게 읽고 점프하는 보조 view
- 보여주는 것
  - 현재 파일명
  - function, class, component, section 같은 symbol tree
  - 현재 cursor 또는 active symbol highlight
  - 필요 시 compact breadcrumb mirror
- 상호작용
  - symbol click은 center editor의 해당 line anchor로 점프한다
  - symbol group은 접고 펼칠 수 있다
  - active editor tab과만 동기화된다
- 밀도
  - 가장 compact한 보조 view 중 하나다
  - badge보다 indentation과 hierarchy가 더 중요하다

### English

- Purpose
  - a companion view for quickly reading and jumping through the structure of the currently open file
- Show
  - current file name
  - a symbol tree for functions, classes, components, and sections
  - current cursor or active symbol highlight
  - an optional compact breadcrumb mirror
- Interaction
  - clicking a symbol jumps to that line anchor in the center editor
  - symbol groups collapse independently
  - it syncs only with the active editor tab
- Density
  - one of the most compact companion views
  - hierarchy and indentation matter more than badges

### 5. 설정 / Settings

### 한국어

- 목적
  - 프로그램 동작과 환경을 조정하는 설정 view
- 보여주는 것
  - `언어 설정`
  - `확장 / integration`
  - `프로그램 정보 / about`
  - 필요 시 diagnostics
- 상호작용
  - left panel 안의 dedicated settings view 또는 별도 settings surface
  - 필요 시 compact subnav로 category를 전환
  - 민감한 action은 분리된 block에 둔다
- 밀도
  - form control이 있으므로 다른 뷰보다 약간 숨을 준다
  - 그래도 oversized card layout은 피한다

### English

- Purpose
  - the configuration view for program behavior and environment setup
- Show
  - `language settings`
  - `extensions / integrations`
  - `program info / about`
  - diagnostics if needed
- Interaction
  - open as a dedicated settings view in the left panel or a separate settings surface
  - use a compact subnav for categories if needed
  - keep sensitive actions isolated in clearly separated blocks
- Density
  - slightly roomier than navigation views because controls need breathing room
  - still avoid oversized card-dashboard styling

### Multi-Account Settings Contract

- Group account profiles under `Codex` and `Claude`; do not mix them into one flat connection list or duplicate the active-session picker inside every row.
- Each row shows the user alias, default state, connection status, and supported/unsupported platform state. Provider marks do not substitute for explicit status.
- Row actions are exact and disambiguated: Add, Rename, Set Default, Check Again, Disconnect, and Forget. The ambient row disables Forget, and another row cannot inherit a pending/error state.
- Add accepts a user-authored alias, then may reveal transient copyable CLI setup guidance beneath that exact row. The command is never persisted, logged, executed, or sent to the center terminal, and the surface stays open while the user completes login externally.
- Forget requires copy that it does not log out or delete credentials. The row disappears into retained tombstone state, while any Agent session that selected it keeps a visible missing-account state rather than switching accounts.
- On macOS, additional Claude rows show the Keychain isolation limitation and ambient-only guidance. Linux/Windows expose the supported isolated `CLAUDE_CONFIG_DIR` setup path.
- At 720x640 and 640x600, actions may stack under the row metadata, but controls must not overlap or introduce horizontal scrolling. Use bounded internal scrolling for a long account list.
- Provider/account lifecycle controls must never create, focus, type into, or otherwise mutate the user-visible center terminal.

## 공통 규칙 / Shared Rules

### 한국어

- label은 줄바꿈보다 `single-line ellipsis`를 우선한다.
- 왼쪽 메뉴는 가로 스크롤을 만들지 않는다.
- `프로젝트`는 프로젝트 관리와 빠른 파일 진입 view고, `탐색기`는 text search view다. 두 뷰가 같은 content model로 보이면 안 된다.
- `탐색기`는 결과 중심 view여야 하며, project tree처럼 보이면 안 된다.
- `아웃라인`은 프로젝트 전체가 아니라 `현재 파일 구조`만 다루는 보조 view여야 한다.
- preview HTML에서는 다섯 뷰가 generic placeholder가 아니라 realistic row와 control을 가진 독립 화면처럼 보여야 한다.
- responsive에서는 전체 vertical stacking보다 `side panel collapse -> agent panel narrow` 순서를 우선한다.

### English

- prefer `single-line ellipsis` over wrapping
- do not introduce horizontal scrolling in the left menu
- `Project` is the project-management and quick-file-entry view, while `Explorer` is the text-search view. They must not share the same content model.
- `Explorer` should feel result-driven, not like a file tree
- `Outline` should stay a companion view for the current file, not a project-wide structure browser
- preview HTML should show all five views as realistic independent surfaces rather than generic placeholders
- in responsive states, prefer `side panel collapse -> agent panel narrow` before full vertical stacking
