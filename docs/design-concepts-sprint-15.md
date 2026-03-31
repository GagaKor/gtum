# gtum Sprint 15 디자인 시안 / Sprint 15 Design Concepts

## 목적

이 문서는 현재 `gtum`의 기획과 UI가 왜 이해하기 어려운지 정리하고, 다음 UI 스프린트에서 선택할 수 있는 3개의 화면 시안을 제시한다.

이 문서는 source of truth가 아니라 `선택용 설계 초안`이다. 사용자가 한 안을 고르면 해당 선택안을 [ui-ux-wireframes.md](/home/kwon/project/gtum/docs/ui-ux-wireframes.md), [frontend-design-benchmarks.md](/home/kwon/project/gtum/docs/frontend-design-benchmarks.md), [sprint-plan.md](/home/kwon/project/gtum/docs/sprint-plan.md)에 흡수한다.

## 언제 읽는 문서인가

- 현재 UI가 왜 복잡하게 느껴지는지 빠르게 설명해야 할 때
- 다음 프론트 스프린트의 메인 화면 구조를 고를 때
- `VS Code`, `cmux`, `conductor` 레퍼런스를 어떤 비율로 섞을지 정할 때

## 왜 지금 이해가 어려운가

- `주인공`이 너무 많다.
  - 시작 카드, 상태 strip, flow 설명, request rail이 모두 메인 가이드처럼 보인다.
- 같은 흐름을 여러 번 반복한다.
  - `status pills`, `Workspace Flow`, `Step 1~4`, `Attached Context`가 비슷한 내용을 여러 방식으로 말한다.
- 사용자 언어보다 시스템 언어가 앞에 나온다.
  - `diagnostics`, `execution mode`, `callback`, `runtime`, `Telegram`이 기본 화면에서 아직 너무 잘 보인다.
- 시선 이동이 길다.
  - 코드, 로그, 요청, 승인 근거가 하나의 작업 묶음처럼 붙어 있지 않다.

## 시안 프리뷰 파일

- 시각 비교용 HTML:
  - [design-concepts-sprint-15.html](/home/kwon/project/gtum/docs/design-concepts-sprint-15.html)

## Concept A. Editor Spine

- 한 줄 설명
  - `코드 읽기 + 터미널 실행 + 승인 검토`를 가장 균형 있게 묶는 기본형
- 무엇을 우선하나
  - editor-like 가시성과 terminal-first 작업성을 동시에 지키는 것
- 레이아웃

```text
+--------------------------------------------------------------------------------------------------+
| Project / Path / Current Task                                      | Provider | Mode | Step 3/6 |
+---------------------------+------------------------------------------+-------------------------+
| Project Rail              | Code Surface            | Terminal       | Ask / Suggest / Approve |
| - Open Folder             |                         | Test / Logs     |                         |
| - Recent                  |                         |                 |                         |
| - File Tree               |                         |                 |                         |
+---------------------------+------------------------------------------+-------------------------+
| Trace / Problems / History / Retry Path                                                         |
+--------------------------------------------------------------------------------------------------+
```

- 장점
  - 현재 제품 방향과 가장 잘 맞는다.
  - `VS Code`에 익숙한 사용자가 가장 빨리 적응한다.
  - 다음 단계로 outline, symbol/range anchor, problems panel을 붙이기 쉽다.
- 약점
  - onboarding이 가장 친절한 구조는 아니다.
  - 처음 보는 사용자에게는 여전히 “패널이 많다”는 느낌이 남을 수 있다.

## Concept B. Operator Deck

- 한 줄 설명
  - 터미널과 실행 상태를 중심에 두고, 코드는 증거 pane으로 붙는 operator형 구조
- 무엇을 우선하나
  - log-driven workflow, 재실행, 빠른 command review
- 레이아웃

```text
+--------------------------------------------------------------------------------------------------+
| Run Status / Last Failure / Active Command                          | Queue | Provider | Hotkeys |
+-----------------------+---------------------------------------------+---------------------------+
| Project / Code Index  | Code Evidence           | Primary Terminal  | Approval Queue            |
| Tree / Outline        |                         |                   | Suggestions               |
|                       |                         |                   | Execution History         |
+-----------------------+---------------------------------------------+---------------------------+
| Secondary Tabs / Rerun / Diff / Log Pins                                                        |
+--------------------------------------------------------------------------------------------------+
```

- 장점
  - `cmux`에 가장 가깝다.
  - 테스트, 빌드, 디버깅 반복에는 가장 강하다.
  - 승인과 실행 상태를 빠르게 따라가기 쉽다.
- 약점
  - 코드 읽기 surface가 밀릴 위험이 있다.
  - 사용자가 이미 말한 “코드 보기 불편함”을 다시 만들 수 있다.

## Concept C. Guided Runbook

- 한 줄 설명
  - `Open -> Read -> Run -> Ask -> Approve -> Verify` 단계가 가장 선명하게 보이는 guided 구조
- 무엇을 우선하나
  - 처음 쓰는 사람도 바로 흐름을 이해하게 만드는 것
- 레이아웃

```text
+--------------------------------------------------------------------------------------------------+
| Step 1 Open -> Step 2 Read -> Step 3 Run -> Step 4 Ask -> Step 5 Approve -> Step 6 Verify      |
+---------------------------------------------------------------+----------------------------------+
| Current Mission / One Clear CTA                               | Approval Timeline / Trace        |
|                                                               |                                  |
| Code Surface                            | Terminal + Logs     |                                  |
|                                         |                     |                                  |
+---------------------------------------------------------------+----------------------------------+
```

- 장점
  - onboarding과 기획 전달력이 가장 좋다.
  - 사용자가 “지금 뭘 해야 하지?”를 가장 덜 느낀다.
  - `conductor`식 흐름 가시성을 가져오기 쉽다.
- 약점
  - power user에게는 화면 밀도가 낮게 느껴질 수 있다.
  - editor familiarity는 `A`보다 약하다.

## 추천

1. 첫 구현 타깃으로는 `Concept A. Editor Spine`을 추천한다.
2. 다만 상단에는 `Concept C. Guided Runbook`의 단계 bar를 얇게 얹는 혼합형이 가장 현실적이다.
3. 즉, 실제 추천안은 `A의 메인 구조 + C의 상단 흐름 가시성`이다.

## 선택 기준

- `A`를 고르면
  - 가장 균형형
  - 현재 구조에서 옮기기 쉬움
  - 다음 editor-like 확장이 가장 안전함
- `B`를 고르면
  - 가장 operator형
  - 테스트/실행/디버깅이 강함
  - 코드 읽기 우선순위는 따로 지켜야 함
- `C`를 고르면
  - 가장 이해하기 쉬움
  - 온보딩과 기획 전달력이 강함
  - power-user 밀도는 낮아질 수 있음

## 내가 보는 최종 권장안

- `1순위`
  - `A. Editor Spine`
- `현실적 혼합안`
  - `A. Editor Spine + C. Guided Runbook 상단 단계 바`
- `B`가 맞는 경우
  - 사용자의 핵심 가치가 코드 읽기보다 `멀티 터미널 + 로그 디버깅`에 더 강하게 있을 때
