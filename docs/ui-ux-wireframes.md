# gtum UI/UX 개선안과 와이어프레임 / UI/UX Improvements and Wireframes

## 문서 목적 / Document Purpose

### 한국어

이 문서는 `gtum`의 UI/UX를 기능 나열형 화면에서 작업 흐름 중심 워크스페이스로 재정렬하기 위한 기준 문서다.

이 문서의 목적은 다음과 같다.

- 현재 UI의 문제를 명확히 정리한다.
- 다음 스프린트에서 어떤 UX 개편이 필요한지 우선순위를 잡는다.
- 실제 구현 전에 공통 와이어프레임 기준을 만든다.
- 사람과 에이전트가 같은 화면 의도를 참조할 수 있게 한다.

### English

This document defines how to reshape the `gtum` UI from a feature-heavy screen into a workflow-oriented workspace.

Its purpose is to:

- make current UI problems explicit
- prioritize the next UX improvements
- create shared wireframe references before implementation
- give humans and agents a common reference for screen intent

## 장문 문서 라우팅 / Long-Doc Routing

### 한국어

이 문서는 200줄을 넘는 장문 와이어프레임 문서다. 기본값은 필요한 화면 흐름만 읽는 것이다.

- 현재 UI 문제와 설계 원칙만 확인할 때
  - 문서 앞부분만 읽는다.
- 핵심 사용자 흐름과 화면 배치만 볼 때
  - `Core User Flow`와 wireframe 부분만 읽는다.
- 구현 기준과 비교 검토가 필요할 때
  - `frontend-design-benchmarks.md`를 먼저 읽고 이 문서는 보조로 본다.

### English

This document exceeds 200 lines. Read only the route that matches your need.

- when you only need current UI problems and design principles
  - read the front portion only
- when you need core user flow and wireframe layout
  - jump to `Core User Flow` and the wireframe sections
- when you are validating implementation against design rules
  - read `frontend-design-benchmarks.md` first and use this doc as a companion

## 현재 UI 문제 / Current UI Problems

### 한국어

현재 UI는 기능을 많이 담고 있지만, 작업 흐름이 선명하게 보이지 않는다.

- 정보 계층이 약하다.
- 너무 많은 카드와 상태가 같은 중요도로 보인다.
- 사용자가 지금 무엇을 먼저 해야 하는지 바로 알기 어렵다.
- 프로젝트, 터미널, 에이전트, Telegram, debug 정보가 동시에 경쟁한다.
- `mock`, `prototype`, 내부 callback 같은 개발용 정보가 일반 사용자 영역에 너무 가깝다.
- 결과적으로 `VS Code` 같은 구조적 안정감, `conductor` 같은 작업 흐름 가시성, `cmux` 같은 터미널 중심성이 모두 약하다.

### English

The current UI contains many capabilities, but the workflow is not visually clear.

- the information hierarchy is weak
- too many cards and states compete at the same priority
- the first user action is not obvious
- project, terminal, agent, Telegram, and debug information compete at once
- development-facing details such as `mock`, `prototype`, and raw callbacks sit too close to normal user-facing areas
- the screen falls short of the structural clarity of `VS Code`, the workflow readability of `conductor`, and the terminal-first focus of `cmux`

## 설계 원칙 / Design Principles

### 한국어

- `VS Code`의 구조적 정보 계층, `conductor`의 에이전트 흐름, `cmux`의 터미널 중심성을 함께 참고한다.
- 터미널을 메인 작업 영역으로 둔다.
- 프로젝트 열기, 터미널 작업, 에이전트 요청 순서가 화면 구조에서 드러나야 한다.
- 사용자가 지금 해야 할 첫 액션을 항상 쉽게 찾을 수 있어야 한다.
- 보조 정보는 접거나 2선으로 내린다.
- `mock`, `prototype`, `real`은 상태 뱃지로 명확히 구분하되, mock 정보가 화면 전체를 점유하지 않게 한다.
- 디버그 정보와 내부 callback 값은 기본 화면이 아니라 보조 영역에 둔다.
- 카드 나열형 대시보드보다 패널 기반 워크스페이스를 우선한다.

### English

- reference the structural hierarchy of `VS Code`, the agent workflow of `conductor`, and the terminal-first feel of `cmux`
- make the terminal the main working surface
- let the structure visually express the order of project open, terminal work, and agent request
- keep the first action easy to discover at all times
- collapse or demote supporting information
- distinguish `mock`, `prototype`, and `real` with explicit badges without letting mock states dominate the screen
- keep debug information and raw callback values out of the default primary UI
- prefer a panel-based workspace over a card-dashboard layout

## 핵심 사용자 흐름 / Core User Flow

### 한국어

기본 작업 흐름은 아래 순서를 따른다.

1. 프로젝트를 연다.
2. 필요한 터미널 탭을 만든다.
3. 코드와 로그를 본다.
4. 에이전트에게 요청한다.
5. 제안을 검토하고 승인 실행한다.

### English

The default workflow should follow this order:

1. open a project
2. create the needed terminal tabs
3. inspect code and logs
4. send a request to an agent
5. review and approve execution

## 화면 구조 제안 / Proposed Screen Structure

### 한국어

- 상단 바
  - 현재 프로젝트 이름과 경로 요약
  - 활성 터미널 탭
  - provider 상태
  - 실행 모드
- 좌측 패널
  - 프로젝트 열기 버튼
  - 최근 프로젝트
  - 파일 트리
- 중앙 메인
  - 터미널 탭 바
  - 활성 터미널
  - 빠른 액션
- 우측 패널
  - 에이전트 요청 입력
  - 연결된 provider 상태
  - 제안 카드와 승인 액션
- 하단 접이식 패널
  - 작업 이력
  - Telegram
  - runtime/debug
- 구현 구조는 가능하면 `widgets/project-sidebar`, `widgets/workspace-stage`, `widgets/agent-sidebar`처럼 화면 zone과 같은 단위로 나눈다.

### English

- top bar
  - current project name and compact path
  - active terminal tab
  - provider state
  - execution mode
- left panel
  - open-project action
  - recent projects
  - file tree
- center main
  - terminal tab bar
  - active terminal
  - quick actions
- right panel
  - agent request input
  - connected provider state
  - suggestion cards and approval actions
- bottom collapsible panel
  - task history
  - Telegram
  - runtime/debug
- when splitting implementation structure, prefer boundaries that match these screen zones such as `widgets/project-sidebar`, `widgets/workspace-stage`, and `widgets/agent-sidebar`

## 데스크톱 기본 와이어프레임 / Desktop Primary Wireframe

### 한국어

```text
+--------------------------------------------------------------------------------------------------+
| gtum | Project: my-app | Active Tab: tests | Provider: Codex (prototype) | Mode: Balanced      |
+------------------------------+------------------------------------------------+--------------------+
| Open Project                 | Tabs: app | tests | server | +                | Agent              |
| Recent Projects              +------------------------------------------------+--------------------+
| - my-app                     |                                                | Request            |
| - docs-site                  |                ACTIVE TERMINAL                 | [textarea]         |
|                              |                                                |                    |
| File Tree                    |                test output / logs              | Context            |
| src/                         |                                                | Project attached   |
| tests/                       |                                                | Tab: tests         |
| package.json                 |                                                | Active log: on     |
|                              |                                                |                    |
|                              |                                                | Suggestions        |
|                              |                                                | [review card]      |
+------------------------------+------------------------------------------------+--------------------+
| Task History | Telegram | Runtime / Debug (collapsed by default)                                 |
+--------------------------------------------------------------------------------------------------+
```

### English

```text
+--------------------------------------------------------------------------------------------------+
| gtum | Project: my-app | Active Tab: tests | Provider: Codex (prototype) | Mode: Balanced      |
+------------------------------+------------------------------------------------+--------------------+
| Open Project                 | Tabs: app | tests | server | +                | Agent              |
| Recent Projects              +------------------------------------------------+--------------------+
| - my-app                     |                                                | Request            |
| - docs-site                  |                ACTIVE TERMINAL                 | [textarea]         |
|                              |                                                |                    |
| File Tree                    |                test output / logs              | Context            |
| src/                         |                                                | Project attached   |
| tests/                       |                                                | Tab: tests         |
| package.json                 |                                                | Active log: on     |
|                              |                                                |                    |
|                              |                                                | Suggestions        |
|                              |                                                | [review card]      |
+------------------------------+------------------------------------------------+--------------------+
| Task History | Telegram | Runtime / Debug (collapsed by default)                                 |
+--------------------------------------------------------------------------------------------------+
```

## 프로젝트 미선택 상태 와이어프레임 / No-Project State Wireframe

### 한국어

```text
+--------------------------------------------------------------------------------------------------+
| gtum | No project open | Provider: not connected | Mode: Balanced                                |
+------------------------------+------------------------------------------------+--------------------+
| Start                        |                                                | Agent              |
| [Open Folder]                |           Open a project to start             | Connect provider   |
|                              |   Use the folder picker instead of pasting    | after project open |
| Recent Projects              |   paths manually.                             |                    |
| - my-app                     |                                                |                    |
| - docs-site                  |                                                |                    |
|                              |                                                |                    |
| File Tree                    |                                                |                    |
| (empty)                      |                                                |                    |
+------------------------------+------------------------------------------------+--------------------+
| Task History (empty)                                                                       |
+--------------------------------------------------------------------------------------------------+
```

### English

```text
+--------------------------------------------------------------------------------------------------+
| gtum | No project open | Provider: not connected | Mode: Balanced                                |
+------------------------------+------------------------------------------------+--------------------+
| Start                        |                                                | Agent              |
| [Open Folder]                |           Open a project to start             | Connect provider   |
|                              |   Use the folder picker instead of pasting    | after project open |
| Recent Projects              |   paths manually.                             |                    |
| - my-app                     |                                                |                    |
| - docs-site                  |                                                |                    |
|                              |                                                |                    |
| File Tree                    |                                                |                    |
| (empty)                      |                                                |                    |
+------------------------------+------------------------------------------------+--------------------+
| Task History (empty)                                                                       |
+--------------------------------------------------------------------------------------------------+
```

## Provider 영역 정리 기준 / Provider Area Rules

### 한국어

- `Connected`, `Needs Login`, `Expired`, `Mock`, `Prototype`, `Real`을 뱃지와 짧은 설명으로 표시한다.
- 내부 callback URL은 기본 카드 본문에 노출하지 않는다.
- 미구현 provider는 `Coming Soon` 또는 `Prototype`으로 명확하게 표시한다.
- 실패 메시지는 기술 문자열보다 다음 액션 중심으로 쓴다.

### English

- show `Connected`, `Needs Login`, `Expired`, `Mock`, `Prototype`, and `Real` through badges plus short descriptions
- keep raw callback URLs out of the default card body
- mark unimplemented providers explicitly as `Coming Soon` or `Prototype`
- write failures around the next action instead of raw technical strings

## 우선 적용 UX 개편 항목 / Immediate UX Improvement List

### 한국어

- `Open Project`를 네이티브 폴더 선택기로 바꾼다.
- 첫 화면의 주 CTA를 `Open Folder` 하나로 단순화한다.
- 터미널을 가장 큰 영역으로 확실하게 올린다.
- Telegram, runtime/debug는 기본 접힘 상태로 둔다.
- provider 카드에 `mock`, `prototype`, `real` 상태를 분명하게 표시한다.
- callback URL과 내부 상태 문자열을 기본 화면에서 숨긴다.
- 어떤 탭의 로그가 에이전트 요청에 연결되는지 더 분명하게 보이게 한다.
- 큰 카드 묶음을 줄이고, `VS Code` 스타일의 패널 구조와 상태바 감각을 강화한다.
- 에이전트 요청과 승인 흐름은 `conductor`처럼 단계가 읽히게 만든다.
- 탭 전환과 터미널 집중도는 `cmux`처럼 가볍고 빠르게 유지한다.

### English

- replace `Open Project` with a native folder picker
- simplify the primary CTA on the initial screen to `Open Folder`
- make the terminal the clearly largest surface
- keep Telegram and runtime/debug collapsed by default
- mark provider cards clearly with `mock`, `prototype`, and `real`
- hide callback URLs and internal state strings from the default screen
- make it clearer which tab log is attached to the agent request

## 구현 참고 / Implementation Notes

### 한국어

- 이 문서는 `docs/sprint-plan.md`의 `Sprint 7`과 함께 본다.
- 실제 화면 구현 전에 이 와이어프레임 기준으로 컴포넌트 우선순위를 재정렬한다.
- mock과 debug UI는 삭제보다 2선 배치가 우선이다.

### English

- read this document together with `Sprint 7` in `docs/sprint-plan.md`
- reorder component priorities against this wireframe before polishing visuals
- prefer demoting mock and debug UI into secondary areas rather than deleting them immediately
