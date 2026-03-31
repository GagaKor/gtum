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
- 터미널은 하단 패널이 아니라 workbench 안의 탭 또는 pane으로 제공한다.
- 중앙 workbench는 상하좌우 분할이 가능해야 한다.
- 프로젝트 열기와 전환은 상단보다 좌측 rail에서 관리한다.
- 프로젝트 열기, 코드 읽기, 에이전트 운영, 필요 시 터미널 전환 순서가 화면 구조에서 드러나야 한다.
- 사용자가 지금 해야 할 첫 액션을 항상 쉽게 찾을 수 있어야 한다.
- 보조 정보는 접거나 2선으로 내린다.
- `mock`, `prototype`, `real`은 상태 뱃지로 명확히 구분하되, mock 정보가 화면 전체를 점유하지 않게 한다.
- 디버그 정보와 내부 callback 값은 기본 화면이 아니라 보조 영역에 둔다.
- 카드 나열형 대시보드보다 패널 기반 워크스페이스를 우선한다.

### English

- reference the structural hierarchy of `VS Code`, the agent workflow of `conductor`, and the tabbed-terminal strength of `cmux`
- make the editor and agent-management surfaces the main working area
- provide the terminal as a tab or pane inside the workbench rather than through a bottom panel or permanently dominant area
- make horizontal and vertical workbench splits a first-class capability
- move project opening and switching into the left rail instead of a top project-tab manager
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
  - 현재 작업 요약
  - provider 상태
  - 활성 에이전트
  - split 또는 layout 상태
- 좌측 패널
  - activity bar
  - 접기/펼치기 가능한 side panel
  - 프로젝트 열기와 전환
  - 파일 트리, 검색, Git, outline
- 중앙 메인
  - 비어 있는 상태에서 시작 가능한 workbench
  - 열린 editor tabs
  - `+`로 추가하는 code / terminal / diff / preview / test 탭
  - 상하좌우 pane 분할
- 우측 패널
  - 에이전트 작업창
  - 작업 요청과 답변
  - task status, approval queue, handoff
- 하단 패널
  - 기본 레이아웃에서는 제거
  - 필요한 결과는 중앙 탭 또는 우측 맥락 영역으로 보낸다
- 구현 구조는 가능하면 `widgets/project-sidebar`, `widgets/workspace-stage`, `widgets/agent-sidebar`처럼 화면 zone과 같은 단위로 나눈다.

### English

- top bar
  - current task summary
  - provider state
  - active agent
  - split or layout status
- left panel
  - activity bar
  - collapsible side panel
  - project opening and switching
  - file tree, search, Git, and outline
- center main
  - an empty-capable workbench
  - open editor tabs
  - code / terminal / diff / preview / test tabs added from `+`
  - horizontal and vertical pane splits
- right panel
  - agent work window
  - requests and replies
  - task status, approval queue, and handoff
- bottom panel
  - removed from the default layout
  - move needed results into center tabs or right-side contextual surfaces
- when splitting implementation structure, prefer boundaries that match these screen zones such as `widgets/project-sidebar`, `widgets/workspace-stage`, and `widgets/agent-sidebar`

## 데스크톱 기본 와이어프레임 / Desktop Primary Wireframe

### 한국어

```text
+--------------------------------------------------------------------------------------------------+
| gtum | 현재 작업: failing test 확인 | 연결: Codex | 승인 대기: 2 | 활성 에이전트: backend      |
+--------+---------------------+----------------------+-------------------+----------------------+
| 프로젝트| 프로젝트 목록        | auth.ts | login.test.ts | +               | 에이전트 작업창      |
| 탐색기  | 파일 트리 / 검색     +----------------------+-------------------+----------------------+
| 검색    | 변경점 / 구조        | ACTIVE CODE EDITOR   | TERMINAL PANE     | 작업 요청            |
| 소스관리|                     | code + breadcrumbs   | test output       | 답변 / 상태          |
| 구조    |                     |                      | shell prompt      | 승인 카드            |
+--------+---------------------+----------------------+-------------------+----------------------+
+--------------------------------------------------------------------------------------------------+
```

### English

```text
+--------------------------------------------------------------------------------------------------+
| gtum | Current task: inspect failing test | Connection: Codex | Pending approvals: 2 | Active agent: backend |
+--------+---------------------+----------------------+-------------------+----------------------+
| Proj.  | Project List        | auth.ts | login.test.ts | +               | Agent Work Window    |
| Files  | Tree / Search       +----------------------+-------------------+----------------------+
| Search | Changes / Outline   | ACTIVE CODE EDITOR   | TERMINAL PANE     | Request Input        |
| Source |                     | code + breadcrumbs   | test output       | Replies / Status     |
| Outline|                     |                      | shell prompt      | Approval Cards       |
+--------+---------------------+----------------------+-------------------+----------------------+
+--------------------------------------------------------------------------------------------------+
```

## 프로젝트 미선택 상태 와이어프레임 / No-Project State Wireframe

### 한국어

```text
+--------------------------------------------------------------------------------------------------+
| gtum | 현재 작업: 없음 | 연결: 미연결 | 승인 대기: 0 | 활성 에이전트: 없음                    |
+--------+---------------------+------------------------------------------+----------------------+
| 프로젝트| 최근 프로젝트        |              빈 작업 공간                 | 에이전트 작업실      |
| 탐색기  | - my-app            |   프로젝트를 선택하고 + 버튼으로 탭 추가 | 연결 후 요청 가능    |
| 검색    | - docs-site         |   [ + 코드 탭 ] [ + 터미널 탭 ]          | 응답 없음            |
| 소스관리| 파일 트리 / 검색     |   [ 좌우 분할 ] [ 상하 분할 ]             | 승인 없음            |
| 구조    |                     |                                          |                      |
+--------+---------------------+------------------------------------------+----------------------+
+--------------------------------------------------------------------------------------------------+
```

### English

```text
+--------------------------------------------------------------------------------------------------+
| gtum | Current task: none | Connection: disconnected | Pending approvals: 0 | Active agent: none   |
+--------+---------------------+------------------------------------------+----------------------+
| Proj.  | Recent Projects     |              Empty Workbench              | Agent Workspace      |
| Files  | - my-app            |   Select a project and add tabs from +    | Requests after       |
| Search | - docs-site         |   [ + Code Tab ] [ + Terminal Tab ]       | connection           |
| Source | Tree / Search       |   [ Split Left/Right ] [ Split Up/Down ]  | No replies yet       |
| Outline|                     |                                          |                      |
+--------+---------------------+------------------------------------------+----------------------+
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
- 프로젝트 열기와 전환을 좌측 rail로 옮긴다.
- 중앙 workbench에 pane split을 넣는다.
- 터미널은 하단이 아니라 workbench pane 탭으로 연다.
- Telegram, runtime/debug는 기본 구조에서 빼거나 overlay 수준으로 내린다.
- provider 카드에 `mock`, `prototype`, `real` 상태를 분명하게 표시한다.
- callback URL과 내부 상태 문자열을 기본 화면에서 숨긴다.
- 어떤 pane과 어떤 탭의 로그가 에이전트 요청에 연결되는지 더 분명하게 보이게 한다.
- 큰 카드 묶음을 줄이고, `VS Code` 스타일의 패널 구조와 상태바 감각을 강화한다.
- 에이전트 요청과 승인 흐름은 `conductor`처럼 단계가 읽히게 만든다.
- 탭 전환, pane 분할, 터미널 집중도는 `cmux`처럼 가볍고 빠르게 유지한다.

### English

- replace `Open Project` with a native folder picker
- simplify the primary CTA on the initial screen to `Open Folder`
- move project opening and switching into the left rail
- add pane splits to the center workbench
- open terminal work as a workbench pane tab rather than through a bottom area
- remove Telegram and runtime/debug from the default structure or demote them to overlay-level surfaces
- mark provider cards clearly with `mock`, `prototype`, and `real`
- hide callback URLs and internal state strings from the default screen
- make it clearer which pane and tab log is attached to the agent request

## 구현 참고 / Implementation Notes

### 한국어

- 이 문서는 `docs/sprint-plan.md`의 `Sprint 7`과 함께 본다.
- 실제 화면 구현 전에 이 와이어프레임 기준으로 컴포넌트 우선순위를 재정렬한다.
- mock과 debug UI는 삭제보다 2선 배치가 우선이다.

### English

- read this document together with `Sprint 7` in `docs/sprint-plan.md`
- reorder component priorities against this wireframe before polishing visuals
- prefer demoting mock and debug UI into secondary areas rather than deleting them immediately
