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
- the screen falls short of the structural clarity of `VS Code`, the workflow readability of `conductor`, and the tabbed-terminal strength of `cmux`

## 설계 원칙 / Design Principles

### 한국어

- `VS Code`의 구조적 정보 계층, `conductor`의 에이전트 흐름, `cmux`의 탭형 터미널 강점을 함께 참고한다.
- editor와 agent management를 메인 작업 영역으로 둔다.
- 터미널은 기본 메인 영역이 아니라 `Code / Diff / Trace / Tests / Terminal` 같은 mode tab으로 제공한다.
- 프로젝트 열기, 코드 읽기, 에이전트 운영, 필요 시 터미널 전환 순서가 화면 구조에서 드러나야 한다.
- 사용자가 지금 해야 할 첫 액션을 항상 쉽게 찾을 수 있어야 한다.
- 보조 정보는 접거나 2선으로 내린다.
- `mock`, `prototype`, `real`은 상태 뱃지로 명확히 구분하되, mock 정보가 화면 전체를 점유하지 않게 한다.
- 디버그 정보와 내부 callback 값은 기본 화면이 아니라 보조 영역에 둔다.
- 카드 나열형 대시보드보다 패널 기반 워크스페이스를 우선한다.

### English

- reference the structural hierarchy of `VS Code`, the agent workflow of `conductor`, and the tabbed-terminal strength of `cmux`
- make the editor and agent-management surfaces the main working area
- provide the terminal through a `Code / Diff / Trace / Tests / Terminal` style mode-tab rather than a permanently dominant pane
- let the structure visually express the order of project open, code reading, agent operation, and optional terminal switching
- keep the first action easy to discover at all times
- collapse or demote supporting information
- distinguish `mock`, `prototype`, and `real` with explicit badges without letting mock states dominate the screen
- keep debug information and raw callback values out of the default primary UI
- prefer a panel-based workspace over a card-dashboard layout

## 핵심 사용자 흐름 / Core User Flow

### 한국어

기본 작업 흐름은 아래 순서를 따른다.

1. 프로젝트를 연다.
2. 코드를 읽고 필요한 파일을 고른다.
3. 에이전트에게 작업을 요청하거나 task를 배정한다.
4. plan, status, approval queue를 검토한다.
5. 필요할 때 `Terminal` 탭으로 전환해 실행과 로그를 본다.
6. 결과를 검토하고 승인 실행하거나 다음 task로 넘긴다.

### English

The default workflow should follow this order:

1. open a project
2. read code and pick the needed file context
3. request work from an agent or assign a task
4. review the plan, status, and approval queue
5. switch into the `Terminal` tab when execution or logs are needed
6. review results and approve execution or hand off the next task

## 화면 구조 제안 / Proposed Screen Structure

### 한국어

- 상단 바
  - 현재 프로젝트 이름과 경로 요약
  - 현재 작업 요약
  - provider 상태
  - 활성 에이전트
- 좌측 패널
  - activity bar
  - 접기/펼치기 가능한 side panel
  - 파일 트리, 검색, Git, outline
- 중앙 메인
  - 비어 있는 상태에서 시작 가능한 workbench
  - 열린 editor tabs
  - `+`로 추가하는 code / terminal / diff / preview / test 탭
- 우측 패널
  - 에이전트 작업창
  - 작업 요청과 답변
  - task status, approval queue, handoff
- 하단 접이식 패널
  - 기본은 닫힘
  - 문제, 실행결과, 작업 기록
- 구현 구조는 가능하면 `widgets/project-sidebar`, `widgets/workspace-stage`, `widgets/agent-sidebar`처럼 화면 zone과 같은 단위로 나눈다.

### English

- top bar
  - current project name and compact path
  - current task summary
  - provider state
  - active agent
- left panel
  - activity bar
  - collapsible side panel
  - file tree, search, Git, and outline
- center main
  - an empty-capable workbench
  - open editor tabs
  - code / terminal / diff / preview / test tabs added from `+`
- right panel
  - agent work window
  - requests and replies
  - task status, approval queue, and handoff
- bottom collapsible panel
  - closed by default
  - problems, run results, and work history
- when splitting implementation structure, prefer boundaries that match these screen zones such as `widgets/project-sidebar`, `widgets/workspace-stage`, and `widgets/agent-sidebar`

## 데스크톱 기본 와이어프레임 / Desktop Primary Wireframe

### 한국어

```text
+--------------------------------------------------------------------------------------------------+
| gtum | 프로젝트: my-app | 현재 작업: failing test 확인 | 연결: Codex | 활성 에이전트: backend  |
+--------+---------------------+------------------------------------------+----------------------+
| 파일   | 파일 트리            | [ 빈 워크벤치 ] [ + ]                     | 에이전트 작업창      |
| 검색   | 검색 / 변경점 / 구조 +------------------------------------------+----------------------+
| 변경점 |                     |     코드 탭 / 터미널 탭 / 비교 탭         | 작업 요청            |
| 구조   |                     |     테스트 탭 / 미리보기 탭               | 답변 / 상태          |
|        |                     |                                          | 승인 대기            |
+--------+---------------------+------------------------------------------+----------------------+
| 하단 drawer: 문제 | 실행 결과 | 작업 기록                                                     |
+--------------------------------------------------------------------------------------------------+
```

### English

```text
+--------------------------------------------------------------------------------------------------+
| gtum | Project: my-app | Current task: inspect failing test | Connection: Codex | Active agent: backend |
+--------+---------------------+------------------------------------------+----------------------+
| Files  | Tree                | [ Empty Workbench ] [ + ]                 | Agent Work Window    |
| Search | Search / Changes /  +------------------------------------------+----------------------+
| Changes| Outline             | Code / Terminal / Diff / Test / Preview  | Request Input        |
| Outline|                     | tab types created from `+`               | Replies / Status     |
|        |                     |                                          | Approval Queue       |
+--------+---------------------+------------------------------------------+----------------------+
| Bottom drawer: Problems | Run Results | History                                                 |
+--------------------------------------------------------------------------------------------------+
```

## 프로젝트 미선택 상태 와이어프레임 / No-Project State Wireframe

### 한국어

```text
+--------------------------------------------------------------------------------------------------+
| gtum | 프로젝트: 없음 | 현재 작업: 없음 | 연결: 미연결 | 활성 에이전트: 없음                        |
+--------+---------------------+------------------------------------------+----------------------+
| 탐색기 | 최근 프로젝트        |              빈 작업 공간                 | 에이전트 작업실      |
| 검색   | - my-app            |   프로젝트를 열고 + 버튼으로 탭을 추가   | 연결 후 요청 가능    |
| 소스관리| - docs-site        |   [ + 코드 탭 ] [ + 터미널 탭 ]          | 응답 없음            |
| 구조   |                     |                                          | 승인 없음            |
+--------+---------------------+------------------------------------------+----------------------+
| 결과 서랍: 실행결과 | 작업흐름 | 터미널 세션 | 테스트 | Telegram | Runtime / Debug          |
+--------------------------------------------------------------------------------------------------+
```

### English

```text
+--------------------------------------------------------------------------------------------------+
| gtum | Project: none | Current task: none | Connection: disconnected | Active agent: none      |
+--------+---------------------+------------------------------------------+----------------------+
| Explore| Recent Projects     |              Empty Workbench              | Agent Workspace      |
| Search | - my-app            |   Open a project and add tabs from +      | Requests after       |
| Source | - docs-site         |   [ + Code Tab ] [ + Terminal Tab ]       | connection           |
| Outline|                     |                                          | No replies yet       |
+--------+---------------------+------------------------------------------+----------------------+
| Results Drawer: Runs | Trace | Terminal Sessions | Tests | Telegram | Runtime / Debug        |
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
