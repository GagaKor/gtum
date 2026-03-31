# gtum Sprint 15 디자인 시안 / Sprint 15 Design Concepts

## 목적

이 문서는 현재 `gtum` UI 방향을 다시 맞추기 위한 선택용 설계 초안이다.

이번 기준은 명확하다.

- 메인은 `VS Code` 같은 코드 에디터다.
- 메인은 `conductor` 같은 에이전트 관리다.
- 터미널은 메인 무대가 아니라 `탭 전환형 workbench mode`다.

즉, `cmux`의 가치는 “터미널을 항상 화면 중심에 두는 것”이 아니라, `필요할 때 가볍게 전환되고 세션이 끊기지 않는 강한 터미널 능력`으로 가져와야 한다.

사용자가 한 안을 고르면 해당 방향을 [frontend-design-benchmarks.md](/home/kwon/project/gtum/docs/frontend-design-benchmarks.md), [ui-ux-wireframes.md](/home/kwon/project/gtum/docs/ui-ux-wireframes.md), [sprint-plan.md](/home/kwon/project/gtum/docs/sprint-plan.md)에 흡수한다.

## 왜 이전 시안이 빗나갔는가

- 이전 시안은 `터미널 배치`를 메인 의사결정으로 잡았다.
- 하지만 사용자 요구는 `에디터 + 에이전트 관리`가 메인이고, 터미널은 선택 모드다.
- 이전 시안은 `conductor`를 흐름 가시성 정도로만 가져왔고, 실제로 중요한 `agent roster / task queue / approval board / trace`를 전면에 두지 못했다.
- 결과적으로 `cmux`의 성질을 과하게 크게 가져왔고, `conductor + VS Code`의 조합을 충분히 밀어주지 못했다.

## 시안 프리뷰 파일

- 시각 비교용 HTML
  - [design-concepts-sprint-15.html](/home/kwon/project/gtum/docs/design-concepts-sprint-15.html)

## 공통 전제

세 안 모두 아래를 공통으로 가진다.

- 좌측은 `Explorer / Search / Git` 같은 VS Code형 project rail
- 중앙은 `Code / Diff / Test / Terminal / Preview`를 전환하는 editor workbench
- 우측은 `Agents / Tasks / Approvals / Trace`를 다루는 conductor형 agent board
- 하단은 `Problems / Trace / Activity` 같은 secondary drawer
- 터미널은 workbench tab 또는 mode로 열리며, 항상 전면에 고정되지 않는다

## Concept A. Editor Board

- 한 줄 설명
  - 가장 VS Code에 가까운 기본형 위에 conductor형 agent board를 붙인 안
- 무엇을 우선하나
  - 익숙한 editor workflow와 안정적인 정보 계층
- 레이아웃

```text
+--------------------------------------------------------------------------------------------------+
| gtum | Project | Branch | Active File | Provider | Active Agent | Queue | Approval Count        |
+----------------------------+------------------------------------------+-------------------------+
| Explorer / Search / Git    | Code | Diff | Test | Terminal | Preview | Agents / Tasks         |
| File Tree                  +------------------------------------------+-------------------------+
|                            |              ACTIVE CODE EDITOR          | Active Agent            |
|                            |              tabs + breadcrumbs          | Current Plan            |
|                            |                                          | Approval Inbox          |
|                            |                                          | Trace / Retry Path      |
+----------------------------+------------------------------------------+-------------------------+
| Problems / Path Recap / Activity                                                             |
+--------------------------------------------------------------------------------------------------+
```

- 장점
  - 가장 익숙하고 설명이 쉽다.
  - 현재 code viewer를 실제 editor workbench로 키우기 좋다.
  - 터미널을 `Test`나 `Terminal` 탭으로 자연스럽게 넣을 수 있다.
- 약점
  - agent board가 충분히 강하지 않으면 다시 “에디터에 붙은 사이드 패널”처럼 보일 수 있다.

## Concept B. Mission Control

- 한 줄 설명
  - conductor형 agent management를 전면으로 올리고, 중앙 editor를 그 작업의 근거 surface로 묶는 안
- 무엇을 우선하나
  - agent orchestration, approval queue, task trace, multi-agent 가시성
- 레이아웃

```text
+--------------------------------------------------------------------------------------------------+
| gtum | Project | Branch | Active Task | Provider | Agents 3 | Pending 2 | Needs Review 1        |
+----------------------+---------------------------------------+-----------------------------------+
| Explorer / Git       | Code | Diff | Test | Terminal | Preview | Agent Mission Board             |
| File Tree            +---------------------------------------+-----------------------------------+
| Symbols / Outline    |             ACTIVE CODE EDITOR        | Agent Roster                      |
|                      |             breadcrumbs + minimap      | Current Mission                   |
|                      |                                        | Approval Queue                    |
|                      |                                        | Run Trace / Retry / Failure Path  |
+----------------------+---------------------------------------+-----------------------------------+
| Problems / Console / Activity / Draft Notes                                                     |
+--------------------------------------------------------------------------------------------------+
```

- 장점
  - 사용자 요구와 가장 가깝다.
  - `conductor`의 장점인 agent visibility와 approval readability를 제대로 살릴 수 있다.
  - 터미널을 editor tab으로 유지하면서도 실제 실행 근거를 잃지 않는다.
- 약점
  - agent board 설계가 약하면 금방 복잡해질 수 있다.
  - 초기 구현은 `A`보다 약간 무겁다.

## Concept C. Review Desk

- 한 줄 설명
  - 코드 편집과 승인 검토를 가장 강하게 붙인 review-heavy 구조
- 무엇을 우선하나
  - suggestion review, diff inspection, approval safety
- 레이아웃

```text
+--------------------------------------------------------------------------------------------------+
| gtum | Project | Active File | Diff Ready | Pending Approval | Last Run | Active Agent          |
+----------------------------+------------------------------------------+-------------------------+
| Explorer / Search / Git    | Code | Diff | Test | Terminal | Preview | Review / Approvals     |
| File Tree                  +------------------------------------------+-------------------------+
|                            |         CODE + DIFF WORKBENCH            | Suggestion Inbox        |
|                            |         selected file + context          | Approval Detail         |
|                            |                                          | Trace / Evidence        |
|                            |                                          | Agent Notes             |
+----------------------------+------------------------------------------+-------------------------+
| Problems / Path Recap / Run Results                                                            |
+--------------------------------------------------------------------------------------------------+
```

- 장점
  - 승인과 근거 검토가 가장 선명하다.
  - 코드, diff, approval evidence를 한 흐름으로 묶기 쉽다.
- 약점
  - 일상적인 “에이전트 운영”보다는 review-heavy 느낌이 강하다.
  - conductor형 운영감은 `B`보다 약하다.

## 추천

1. 현재 사용자 피드백 기준으로는 `Concept B. Mission Control`이 1순위다.
2. 이유는 사용자가 원하는 핵심이 `conductor에 더 가까운 구조`이고, 그 위에 `VS Code급 코드 에디터`와 `강화된 터미널 탭`을 얹는 것이기 때문이다.
3. 가장 현실적인 구현안은 `B`를 기본으로 하되, editor chrome은 `A`처럼 단순하게 가져가는 것이다.

## 선택 기준

- `A`를 고르면
  - 가장 익숙함
  - 구현 리스크가 가장 낮음
  - VS Code형 editor 경험이 가장 강함
- `B`를 고르면
  - conductor형 agent 관리가 가장 강함
  - 사용자가 원하는 방향과 가장 가까움
  - 다음 스프린트의 제품 정체성을 가장 잘 고정함
- `C`를 고르면
  - 승인/검토 UX가 가장 강함
  - 코드 근거와 diff 리뷰를 묶기 좋음
  - 운영보다는 review-heavy 제품으로 읽힐 수 있음

## 내가 보는 최종 권장안

- `1순위`
  - `B. Mission Control`
- `현실적 혼합안`
  - `B. Mission Control + A의 단순한 editor chrome`
- `A`가 맞는 경우
  - conductor형 보드보다 editor familiarity를 더 우선할 때
- `C`가 맞는 경우
  - approval, diff, evidence review를 제품의 제일 큰 가치로 둘 때
