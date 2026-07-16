# gtum 프론트엔드 디자인 벤치마크 / Frontend Design Benchmarks

## 문서 목적 / Document Purpose

### 한국어

이 문서는 `gtum` 프론트엔드가 UI를 설계할 때 반드시 참고해야 할 제품 레퍼런스와 금지 패턴을 정의한다.

목적은 다음과 같다.

- 프론트엔드가 임의의 카드형 대시보드 UI로 흐르지 않게 한다.
- `VS Code`, `conductor`, `cmux`에서 배워야 할 지점을 명확히 고정한다.
- 디자인 완성도와 UX 기준을 구현 전에 합의된 문서로 남긴다.
- 코드 읽기와 흐름 추적이 AI 대화보다 뒤로 밀리지 않게 한다.
- 사용자가 이미 밟아온 작업 경로와 반복 문제를 UI에서 복기할 수 있게 한다.

### English

This document defines the required product references and anti-patterns for the `gtum` frontend UI.

Its goals are:

- prevent the frontend from drifting into an arbitrary card-dashboard UI
- make the useful lessons from `VS Code`, `conductor`, and `cmux` explicit
- keep design quality and UX expectations documented before implementation
- keep code reading and flow tracing from being demoted behind the AI conversation surface
- make prior work paths and repeated-problem signals easy to reread in the UI

## 언제 읽는 문서인가 / When To Read This Document

### 한국어

아래 상황이면 이 문서를 읽는다.

- UI 구조, 정보 계층, 인터랙션 패턴, 금지 패턴을 검토하거나 수정해야 할 때
- 프론트엔드 개편이 `VS Code`, `conductor`, `cmux` 기준과 맞는지 확인해야 할 때

### English

Read this document when:

- you need to review or change UI structure, information hierarchy, interaction patterns, or anti-patterns
- you need to check whether a frontend redesign still aligns with `VS Code`, `conductor`, and `cmux`

## 장문 문서 라우팅 / Long-Doc Routing

### 한국어

이 문서는 200줄을 넘는 장문 디자인 문서다. 기본값은 필요한 기준만 읽는 것이다.

- 레퍼런스와 금지 패턴만 확인할 때
  - 앞부분의 reference와 anti-pattern 부분만 읽는다.
- 현재 active UI slice 기준만 볼 때
  - `Current Delivery Slice` 이후만 읽는다.
- 세부 화면 설계가 필요할 때
  - `ui-ux-wireframes.md`를 같이 읽는다.

### English

This document exceeds 200 lines. Read only the matching route first.

- when you only need references and anti-patterns
  - read the front reference and anti-pattern portions only
- when you only need the current active UI-slice guidance
  - jump to `Current Delivery Slice` and continue from there
- when you need concrete screen structure
  - read `ui-ux-wireframes.md` alongside this doc

## 필수 레퍼런스 / Required References

### 한국어

프론트엔드 UI를 설계할 때 아래 세 제품을 반드시 참고한다.

- `VS Code`
  - 정보 계층, 사이드바 밀도, 탭 구조, 상태바, 패널 분리
- `conductor`
  - 에이전트 orchestration, 작업 단위 시각화, 승인 흐름, 컨텍스트 연결
- `cmux`
  - 탭 중심 터미널 워크플로우, 빠른 세션 전환, 강한 세션 연속성

레퍼런스의 목적은 복제가 아니라 기준 추출이다. `gtum`은 세 제품의 장점을 합쳐야 한다.

### English

Frontend UI work must explicitly reference these three products:

- `VS Code`
  - information hierarchy, sidebar density, tab structure, status bar, and panel separation
- `conductor`
  - agent orchestration, task visibility, approval flow, and context linkage
- `cmux`
  - tab-driven terminal workflow, fast session switching, and strong session continuity

The goal is not visual copying. The goal is to extract the right product qualities and combine them inside `gtum`.

## 최근 디자인 흐름 번역 / Current Trend Translation

### 한국어

최근 `Figma`와 `Canva`가 보여주는 생산성 도구 흐름은 아래처럼 번역한다.

- `AI`는 별도 모드나 장식이 아니라 실제 work surface 안에 자연스럽게 섞인다.
- 정보는 촘촘하게 담되, 화면을 동일한 카드로 잘게 쪼개지 않는다.
- 깊이감은 필요하지만 과장된 glassmorphism보다 얕은 그림자, 낮은 radius, 약한 질감 정도로 제한한다.
- 실제 파일명, 실제 상태, 실제 로그, 실제 approval 근거를 보여줘서 설명 박스보다 앱처럼 읽히게 한다.
- 시각적 포인트는 tab state, active line, split gutter, approval action처럼 작업성이 직접 걸린 곳에만 쓴다.

### English

Translate current `Figma` and `Canva` productivity patterns into `gtum` as follows:

- keep `AI` inside the real work surface rather than isolating it as a decorative mode
- keep density high without fragmenting the screen into many same-priority cards
- use depth sparingly through soft shadows, low radii, and subtle texture instead of exaggerated glass effects
- prefer real file names, live state, logs, and approval evidence over explanatory placeholder boxes
- spend visual emphasis on tab state, active lines, split gutters, and approval actions where usability depends on it

## 최근 트렌드 흡수 기준 / Trend Absorption Rules

### 한국어

최근 `Figma`와 `Canva` 쪽 흐름을 해석하면 아래 기준을 반드시 반영해야 한다.

- AI로 초안을 빠르게 만들수록 최종 UI는 더 높은 craft와 더 나은 handoff 감각을 보여야 한다.
- 지나치게 매끈한 SaaS 카드 대시보드보다 `thought trace`, `presence`, `human-in-the-loop`가 느껴지는 surface가 더 중요하다.
- 따라서 mock과 구현 모두 `설명 박스`보다 `실제 파일명`, `실제 로그`, `실제 대화`, `실제 승인 카드`, `실제 상태`를 보여주는 방향으로 간다.
- 질감은 필요하지만 과한 장식은 금지한다. `IDE readability`와 `task clarity`를 해치면 안 된다.
- 큰 radius와 균일한 카드 반복보다 `activity rail / side panel / editor / terminal / agent workspace`의 역할 차이가 시각적으로 분리돼야 한다.

### English

Recent `Figma` and `Canva` signals should be interpreted like this:

- as AI accelerates ideation, the final UI should show stronger craft and handoff quality
- instead of over-polished SaaS dashboards, surfaces should preserve thought trace, presence, and human-in-the-loop clarity
- both mocks and implementation should prefer real file names, logs, replies, approval cards, and states over empty explanation boxes
- texture is allowed, but not at the expense of IDE readability or task clarity
- instead of repeating identical rounded cards, the activity rail, side panel, editor, terminal, and agent workspace should feel like distinct roles

## 현재 구현 슬라이스 기준 / Current Delivery Slice

### 한국어

현재 시각 토큰과 컴포넌트 상태 표현의 source of truth는 [design-system.md](/Users/kwon/projects/gtum/docs/design-system.md)다. 이 문서는 UI 구조, 정보 계층, 레퍼런스, 금지 패턴을 담당한다.

현재 active 슬라이스에서 프론트가 지켜야 할 기준은 아래와 같다.

- 중앙 workbench는 `Editor + Agent Management`의 co-primary surface여야 한다.
- code viewer는 사이드바가 아니라 메인 영역의 기본 surface여야 한다.
- agent board는 단순 채팅창이 아니라 roster, task status, plan, pending action을 함께 다루는 메인 surface여야 한다.
- 좌측은 `VS Code`처럼 activity bar와 side panel로 나뉘고, 접기/펼치기와 폭 조절이 가능해야 한다.
- 폭 조절은 panel 내부 edge의 4px dock handle로 처리하고, hover/drag 상태만 accent로 드러내야 한다.
- activity rail은 글자 약어보다 icon-only가 기본이고, hover 시 명칭 tooltip이 나오는 패턴이 맞다.
- activity rail은 오른쪽 agent workspace나 중앙 terminal과 중복되는 `에이전트`, `실행` 전용 icon을 두지 않고, 하단에는 `설정` icon을 두는 편이 맞다.
- side panel 내부의 `Explorer`, `Outline`, `Source Control`은 각각 독립적인 collapsible section이어야 한다.
- side panel tree는 큰 행 높이보다 compact typography와 짧은 row height를 우선해, 더 적은 세로 공간으로 읽히게 해야 한다.
- side panel의 project row와 tree row는 wrap이나 horizontal scroll보다 `single-line ellipsis`가 우선이다.
- `프로젝트`, `탐색기`, `소스제어`, `아웃라인`, `설정`의 view별 목적과 content model은 [left-menu-views.md](/home/kwon/project/gtum/docs/left-menu-views.md)를 기준으로 구분한다.
- design preview는 `프로젝트`, `탐색기`, `소스제어`, `아웃라인`, `설정`을 light/dark 둘 다에서 독립된 view처럼 보여줘야 하며, 하나의 generic side panel 예시로 뭉개면 안 된다.
- 프로젝트 열기와 전환 같은 project management는 상단이 아니라 좌측 rail에서 이뤄져야 한다.
- `프로젝트` icon은 현재 프로젝트, 최근 프로젝트, 프로젝트 리스트, `+ 폴더 추가`, 현재 프로젝트 tree를 함께 보여주는 project hub여야 한다.
- `탐색기` icon은 현재 프로젝트 안의 특정 문구를 찾는 text search view여야 한다.
- `아웃라인`은 현재 열려 있는 파일의 함수/컴포넌트/section 구조를 보여주고, 클릭 시 center editor line anchor로 이동시키는 보조 view여야 한다.
- 중앙 workbench는 처음에 비어 있어야 하며, `+` 버튼으로 `코드`, `터미널`, `비교`, `테스트`, `미리보기` 같은 탭을 연다고 이해돼야 한다.
- 중앙 workbench는 `VS Code`처럼 상하좌우 pane 분할을 지원해야 한다.
- workbench 탭은 큰 CTA 버튼이 아니라 `VS Code`처럼 낮고 가로로 긴 compact tab 형태여야 한다.
- split 상태에서는 전역 탭바 하나보다, 각 pane이 own tab strip과 own tab stack을 가지는 구조가 맞다.
- center의 pane tab strip과 pane header는 코드 본문보다 한 단계 작고 얇아야 하며, 정보보다 전환 조작으로 읽혀야 한다.
- `비교` 탭은 변경 코드 비교용이다.
- `테스트` 탭은 raw shell 대신 구조화된 테스트 결과와 실패 목록을 보여주는 탭이다.
- `미리보기` 탭은 Markdown, HTML, 렌더링 결과 같은 preview surface다.
- 중앙 시안은 단순 placeholder 박스가 아니라 실제 editor, terminal, diff, approval detail이 들어간 현실적인 밀도로 보여야 한다.
- editor는 breadcrumbs, line number, active line, syntax color, minimap 같은 최소한의 읽기 디테일을 가져야 한다.
- editor는 좁아질 때 코드 줄을 wrap하지 말고, pane 내부 horizontal scroll을 우선해야 한다.
- terminal은 prompt, command, success/error output, running indicator가 보여야 한다.
- agent board는 실제로 일을 주고 답변을 받고 제안을 보내는 `에이전트 작업창`처럼 읽혀야 한다.
- 오른쪽 agent workspace는 서로 분리된 카드 모음이 아니라 `mission header -> thread -> composer approval -> composer`가 이어지는 하나의 작업 surface처럼 보여야 한다.
- 오른쪽 agent workspace 상단에는 현재 provider와 session/readiness 상태를 compact row로 먼저 보여줘야 한다. 모델명과 실행 모드는 런타임 동기화가 없으면 고정 값으로 보여주지 않는다.
- thread와 composer가 항상 오른쪽 패널에서 가장 눈에 띄고 사용성이 좋은 영역이어야 한다.
- approval UI는 항상 큰 카드로 열려 있지 않고, 기본 제안은 activity row로 유지한 뒤 사용자가 열었을 때만 composer 바로 위 permission request로 펼쳐져야 한다.
- approval queue는 여러 후보를 compact row 또는 small pill 목록으로 보여주고, 사용자가 열었을 때만 상세 결정 패널이 composer 위에 나타나는 구조가 맞다.
- approval 영역은 `과거 승인 기록`이 아니라 `현재 pending action`만 보여주는 것이 맞다.
- 과거 승인이나 이미 끝난 결정은 approval UI가 아니라 task history / trace 같은 secondary zone으로 내려야 한다.
- agent workspace 내부 카드, queue row, command block, context chip은 기본적으로 가로 스크롤보다 줄바꿈을 우선해야 한다.
- 사용자가 일부 텍스트를 읽지 못한 채 잘리는 상태는 금지한다.
- agent workspace도 side panel처럼 compact typography와 짧은 row height를 우선해, 세로 공간을 과도하게 먹지 않게 해야 한다.
- terminal은 상단 고정 모드 버튼이 아니라 `+`로 여는 workbench tab 타입이어야 하며, 기본 화면을 점유하는 주인공은 아니어야 한다.
- 하단 패널은 기본 구조에서 제거하고, 필요 정보는 pane 또는 overlay로 푼다.
- composer approval은 editor와 agent board를 밀어내지 않으면서도, 어떤 파일, line anchor, 로그를 보고 제안이 나왔는지 보여줘야 한다.
- 첫 code-reading slice는 read-only viewer까지만 포함한다.
- line anchor와 restore 상태는 숨은 내부 상태가 아니라 사용자가 다시 읽을 수 있는 정보여야 한다.
- binary와 large-file fallback은 에러처럼 보이지 않고 bounded preview mode처럼 읽혀야 한다.
- task history, Telegram, runtime/debug는 2선 영역에 둔다.
- 구조를 `FSD`로 나누더라도 기준 단위는 `project rail / workspace stage / agent rail` 같은 workbench zone이어야 한다.
- 초기 mock이라도 빈 설명 박스보다 실제 파일명, 코드 줄, 테스트 출력, agent reply가 보이는 realistic surface를 우선한다.
- 전체 톤은 차갑고 generic한 SaaS 카드보다, 약간의 촉감과 layer가 있는 desktop productivity tool 쪽이 맞다.
- 좌측 rail, side panel, editor pane, terminal pane, agent panel은 모두 같은 박스 스타일을 재사용하지 않는다.
- 탭, pill, badge는 작고 조밀해야 하며, 큰 둥근 CTA 블록처럼 보이면 안 된다.
- 한 mock 안에서 light/dark surface를 섞지 않는다. `Light version`, `Dark version`은 각각 완결된 token 체계를 가져야 한다.
- `Light version`에서는 rail과 terminal도 light family 안에 있어야 하며, dark shell이 섞여 보이면 안 된다.
- scrollbar도 theme token을 따라야 하며, light/dark에서 같은 브라우저 기본 scrollbar가 그대로 보이면 안 된다.
- design preview와 구현 기본 레이아웃은 common laptop width에서 주요 영역이 잘리지 않아야 하며, 필요 시 responsive reflow나 panel drop을 우선한다.
- responsive에서는 IDE-like horizontal composition을 최대한 유지해야 하며, 화면이 좁아질 때 먼저 `side panel collapse`, 그다음 `agent panel narrow`를 적용하고 전체 세로 적층은 마지막 예외로 미뤄야 한다.
- 정상적인 desktop 폭에서 mission summary, user prompt, agent reply 같은 핵심 문구가 잘려 보이면 안 된다.

### English

The source of truth for current visual tokens and component state representation is [design-system.md](/Users/kwon/projects/gtum/docs/design-system.md). This document owns UI structure, information hierarchy, references, and anti-patterns.

For the current active slice, the frontend should follow these rules:

- the central workbench should act as a co-primary surface for `Editor + Agent Management`
- the code viewer should be the default main-workspace surface rather than a sidebar afterthought
- the agent board should be a first-class surface for roster, task state, plans, and approval queue instead of a simple chat rail
- the left side should follow a `VS Code`-style activity bar plus collapsible and resizable side panel
- width resizing should use a 4px dock handle on the panel edge, with accent only for hover/drag state
- project opening and switching should live in the left rail rather than in a top project-tab strip
- the center workbench should begin empty and make it obvious that `Code`, `Terminal`, `Diff`, `Test`, and `Preview` are tab types created from a `+` action
- the center workbench should support `VS Code`-style horizontal and vertical pane splits
- workbench tabs should read as compact horizontal tabs rather than large CTA buttons
- the `Diff` tab is for changed-code comparison
- the `Test` tab is for structured test results and failing-test focus views rather than raw shell output
- the `Preview` tab is for rendered surfaces such as Markdown, HTML, or generated output previews
- the agent board should read like an `agent work window` where users assign work, read replies, and approve actions
- runtime agent work should appear as a live conversational assistant turn: progress and final answer stay in the thread, while command-bearing results stay lightweight as execution-suggestion activity rows and open the detailed permission request directly above the composer
- composer controls should keep attachment and runtime-backed model selection inside the input toolbar, show project scope through the active workspace/session rather than a current-tab context chip, and render reasoning/fast controls only from provider capabilities
- Claude reasoning/Fast visibility must follow the effective selected model's `executionOptions`, including empty/false overrides; Codex may use the provider-level compatibility fields only when model options are absent
- the Claude reasoning menu may add one UI-only `Default` row that means `reasoningLevel: null`; do not invent a provider label or effort value for the CLI/model default
- closed provider, model, and reasoning menu controls in the composer should use compact icons or provider/model marks with no long visible names or wrapped text; exact full names and current state belong inside their opened lists, while exact accessible labels and expanded/selected semantics remain available to assistive technology
- the active provider mark in both the Agent header and closed composer control must use an explicit selected/current treatment for Codex and Claude alike; provider identity styling must remain neutral and must not imply that a provider is selected or ready
- Fast must be a capability-gated direct boolean button rather than a menu: one native pointer, Enter, or Space activation inverts it exactly once, closes another open composer popup, and exposes exact `Fast mode: Enabled` or `Fast mode: Disabled` through `aria-label`, `title`, and matching `aria-pressed`; unsupported models hide it without erasing the saved provider preference
- the top of the right agent workspace should expose the current provider and session/readiness state through a compact row; composer-level model picking and reasoning labels must come from `read_agent_provider_capabilities`, and execution modes must not appear as fixed values without runtime policy
- provider-backed model popups must remain inside the Agent panel and viewport at the default desktop size, use internal vertical scrolling, and scroll the selected row into view on reopen
- model options must show the complete provider-supplied human label: current account labels remain on one visual line at the default desktop width, while longer valid labels wrap inside the option without clipping or horizontal overflow; keep the exact provider value in accessible metadata and the request payload instead of rendering a raw-ID subtitle
- the terminal should be a workbench-tab type opened from `+` rather than a permanently fixed mode strip, without dominating the default screen
- remove the default bottom panel from the primary layout and solve needed details through panes or overlays
- the approval rail should show which file, line anchor, and logs produced a suggestion without pushing the editor and agent board away
- the app shell should fill the full desktop viewport after any native resize or maximize; fixed-aspect canvas letterboxing is not allowed
- the first code-reading slice should stop at a read-only viewer
- line-anchor state and restore state should stay legible to users rather than hidden as internal implementation
- binary and large-file fallback should read like bounded preview modes, not generic errors
- task history, Telegram, and runtime/debug belong in secondary zones

## 최근 디자인 트렌드 흡수 기준 / Current Design Trend Guardrails

### 한국어

- `AI product`처럼 보여야 한다는 이유로 generic neon gradient나 과한 미래지향 장식을 붙이지 않는다.
- 추상 설명 카드보다 `실제 파일명`, `실제 명령`, `실제 응답`, `실제 승인 항목`을 보여주는 쪽을 우선한다.
- 큰 둥근 박스를 여러 개 나열하는 대신, 더 얇고 밀도 높은 desktop surface를 만든다.
- editor, terminal, agent panel은 같은 박스 재질을 공유하지 말고 역할에 따라 명도와 질감을 분리한다.
- 탭은 버튼처럼 보이면 안 되고, `VS Code`처럼 낮고 가로로 긴 compact tab이어야 한다.
- radius는 과하게 키우지 않고, workbench 계열은 대체로 `10-18px` 범위에서 통제한다.
- palette는 `따뜻한 중성 배경 + 제한된 accent + 명확한 상태색`을 기본으로 하고, purple-heavy SaaS 톤을 피한다.
- mock이나 preview 단계에서도 line number, breadcrumb, stdout/stderr, approval action처럼 실제 정보 밀도를 보여준다.
- 왼쪽 rail과 side panel은 `실제 tree row`와 `section header`를 보여줘야 하며, 설명용 빈 박스로 남으면 안 된다.
- 오른쪽 agent workspace는 단순 카드 스택이 아니라 `대화 thread + approval + composer`가 함께 보이는 구조여야 한다.

### English

- do not default to generic neon gradients or overly futuristic ornament just because the product uses AI
- prefer real file names, commands, replies, and approval items over abstract explanatory cards
- replace large rounded-box dashboards with denser desktop-like surfaces
- do not make editor, terminal, and agent panels feel like the same material; separate them through tone and texture
- tabs should read as low-profile horizontal tabs rather than CTA buttons
- keep radius values restrained, usually within a `10-18px` range for workbench surfaces
- use a `warm neutral base + restrained accent + clear status colors` palette instead of a purple-heavy SaaS look
- even in mock form, show realistic density such as line numbers, breadcrumbs, stdout/stderr, and approval actions
- the left rail and side panel should show real tree rows and section headers, not empty placeholder blocks
- the right agent workspace should combine a conversation thread, composer-level approvals, and a composer rather than becoming another passive card stack

## 제품별로 배워야 할 점 / What To Borrow From Each Product

### 한국어

#### `VS Code`에서 배울 점

- 화면을 큰 구조 단위로 나누는 명확한 레이아웃
- 많은 정보를 보여줘도 우선순위가 흐려지지 않는 정보 계층
- 사이드바, 메인, 패널, 상태바가 각자 역할이 분명한 구조
- 자주 쓰는 액션이 과도한 카드 없이 가까운 곳에 배치되는 방식
- 코드를 읽고 흐름을 따라가기 편한 editor 중심성

#### `conductor`에서 배울 점

- 에이전트 상태와 작업 상태를 UI에서 한눈에 읽게 하는 구성
- 계획, 실행, 승인, 결과가 이어지는 흐름형 UX
- 무엇이 자동이고 무엇이 승인 필요인지 분명하게 보이는 표현
- 에이전트 orchestration은 강하지만 코드 읽기 surface 불편함은 반복하지 않는 기준
- 현재 pending action과 별도 task history/trace를 분리해 문제 분석에 쓰게 하는 방식

#### `cmux`에서 배울 점

- 탭 단위 터미널 전환이 빠르고 가벼운 점
- 여러 세션을 오가도 실행 맥락이 끊기지 않는 점
- 로그와 실행 상태를 읽는 경험이 끊기지 않는 점
- 터미널을 선택했을 때는 강력하지만, 기본 화면을 terminal-first로 몰아가지 않는 기준
- 터미널 세션과 로그 경로를 끊지 않고 되짚어볼 수 있는 흐름

## 최근 디자인 트렌드 해석 / Current Trend Interpretation

### 한국어

- `Figma` 계열 흐름에서 배울 점은 `AI를 쓰더라도 결과물의 craft는 더 높아져야 한다`는 점이다.
- `Canva` 계열 흐름에서 배울 점은 `지나치게 완벽한 광택보다 인간적인 흔적과 촉감이 더 설득력 있다`는 점이다.
- 그래서 `gtum`은 유행성 gradient 쇼케이스가 아니라, 실제 업무 밀도가 느껴지는 workbench여야 한다.
- trend를 적용할 때도 아래 기준을 지킨다.
  - 실사용 탭 라벨을 쓴다.
  - 실제 코드와 출력 구조를 보여준다.
  - 영역마다 재질감과 밀도를 다르게 둔다.
  - 거대한 카드 대시보드로 회귀하지 않는다.

### English

- one useful signal from recent `Figma` directions is that AI-assisted workflows still raise the bar for craft
- one useful signal from recent `Canva` directions is that human texture and visible thought traces are more persuasive than sterile polish
- as a result, `gtum` should feel like a dense real workbench rather than a decorative trend showcase
- trend application still follows these rules
  - use realistic tab labels
  - show real code and output structures
  - differentiate each zone through density and material
  - do not regress into a large-card dashboard

### English

#### What to borrow from `VS Code`

- a clear macro layout with well-defined zones
- strong information hierarchy even when the screen is dense
- sidebars, main surface, panels, and status areas with distinct roles
- frequent actions placed close to use instead of hidden inside decorative cards
- editor-centered code reading and flow tracing

#### What to borrow from `conductor`

- a UI that makes agent and task state scannable at a glance
- flow-oriented UX across planning, execution, approval, and result
- explicit distinction between what is automatic and what requires approval
- a clear split between current pending actions and secondary task history or trace for finished decisions
- keep the orchestration strengths without inheriting uncomfortable code-reading surfaces

#### What to borrow from `cmux`

- lightweight tab-based terminal switching
- strong session continuity while moving across multiple executions
- uninterrupted reading of logs and execution state
- keep the terminal powerful when selected without forcing a terminal-first default layout
- preserve enough session continuity that users can retrace execution paths instead of guessing

## 반드시 지켜야 할 UI 원칙 / Non-Negotiable UI Rules

### 한국어

- editor와 agent management는 항상 메인 화면의 중심이어야 한다.
- 프로젝트, editor, agent flow는 순서가 보이도록 배치해야 한다.
- 터미널은 한 번의 전환으로 바로 들어갈 수 있어야 하며, 선택 시 충분히 강력해야 한다.
- 전역 상단 바는 project-tab manager가 아니라 `현재 작업`, `연결 상태`, `승인 대기`, `활성 에이전트` 같은 쉬운 현재 상태 언어를 우선한다.
- desktop 기본 비율에서 top header는 한 줄을 유지해야 하며, 브랜드 텍스트가 여러 줄로 쪼개지면 안 된다.
- 좌측 rail은 `activity bar + side panel` 구조로 접고 펼칠 수 있어야 한다.
- 프로젝트 관리와 전환은 왼쪽 rail로 보낸다.
- 중앙 workbench는 비어 있는 상태에서 시작할 수 있고, `+`로 코드 탭과 터미널 탭을 추가할 수 있어야 한다.
- 중앙 workbench는 상하좌우 pane 분할이 1급 기능이어야 한다.
- 오른쪽 panel은 단순 상태판이 아니라 실제 작업 요청과 답변이 오가는 `에이전트 작업실`이어야 한다.
- 하단 panel은 기본 레이아웃에서 제거하는 것을 우선한다.
- 정보 계층은 `primary`, `secondary`, `debug` 세 단계 이상으로 나뉘어야 한다.
- 첫 진입 시 사용자가 해야 할 첫 액션이 한눈에 보여야 한다.
- 승인 필요 액션과 읽기 전용 상태는 시각적으로 분리되어야 한다.
- 디버그 정보, mock 세부정보, callback 값은 기본 화면의 주인공이 되면 안 된다.
- 코드 읽기, 흐름 추적, 테스트 확인은 AI 대화창보다 먼저 보이거나 최소한 같은 급의 작업 surface를 가져야 한다.
- 에이전트 대화는 보조 surface일 수 있지만, 코드 보기가 사이드바나 하단 패널에 종속되면 안 된다.
- 사용자는 현재 pending action은 메인 UI에서 빠르게 보고, 이미 끝난 승인, 실패, 재시도 경로는 task history나 trace에서 복기할 수 있어야 한다.
- task history와 실행 이력은 단순 로그가 아니라 문제 분석이 가능한 timeline 또는 trace 형태로 읽혀야 한다.
- 에이전트가 안정적으로 수정하기 어렵다면 React 추상화보다 더 단순한 `TypeScript` 중심 구조를 우선할 수 있다.
- 큰 네모 placeholder가 화면을 설명하는 수준에서 멈추면 안 되고, 실제 작업 surface처럼 보여야 한다.

### English

- the editor and agent-management surface must remain the center of the product
- project, editor, and agent flow should be visually ordered
- the terminal should be reachable within one switch and feel powerful when selected
- the global top bar should stay thin and avoid becoming a project-tab manager
- the left rail should use a collapsible `activity bar + side panel` structure
- project management should move into the left rail
- the center workbench should support an empty state and allow users to add code tabs and terminal tabs from `+`
- the center workbench should support horizontal and vertical pane splits as a first-class feature
- the right panel should be an actual agent workspace for requests and replies rather than a passive status board
- avoid a default bottom panel in the primary layout
- information hierarchy should clearly separate `primary`, `secondary`, and `debug` levels
- the first useful action must be obvious on first entry
- approval-required actions must be visually distinct from read-only status
- debug data, mock details, and raw callback values must not dominate the default UI
- code reading, flow tracing, and test inspection should be at least as first-class as the AI conversation surface
- AI chat may be secondary, but code viewing must not be trapped inside a sidebar-only or bottom-panel-only interaction model
- users should see current pending actions in the main surface and revisit completed approvals, failures, retries, and detours in task history or trace
- task history should be readable as a scannable timeline or trace, not just as raw transcript fragments
- if React abstractions make agent-driven maintenance harder, prefer a simpler `TypeScript`-first structure over framework purity
- if the frontend adopts an FSD-style split, keep the boundaries aligned with workbench zones rather than decorative card fragments

## 에이전트 친화적 구현 원칙 / Agent-Friendly Implementation Rules

### 한국어

- 이 프로젝트는 사람이 아니라 에이전트가 주 개발 주체라는 전제를 둔다.
- 프론트엔드 구현은 프레임워크 유행보다 에이전트가 읽고 수정하기 쉬운 구조를 우선한다.
- `React`는 현재 구현 기반이지만, source of truth는 "에이전트가 빠르게 안전하게 수정 가능한가"다.
- hook, derived state, UI heuristic이 복잡해질수록 순수 `TypeScript` 함수나 더 얇은 구조로 내리는 쪽을 우선 검토한다.
- 이후 필요하면 `React` 내부에서도 프레임워크 의존을 줄이고 `TypeScript` 중심 렌더링 구조로 더 단순화할 수 있다.

### English

- assume that agents, not humans, are the primary developers of this project
- prefer frontend structures that agents can read and edit quickly over framework fashion
- `React` is the current implementation base, but the real source of truth is whether agents can modify it safely and quickly
- when hooks, derived state, or UI heuristics grow too complex, prefer moving logic into plain `TypeScript` functions or thinner structures
- if needed later, the frontend may be simplified further toward a more `TypeScript`-first rendering structure even while staying inside the current stack

## 금지 패턴 / Anti-Patterns

### 한국어

- 의미 없이 큰 카드들을 여러 개 나열하는 대시보드형 화면
- 같은 중요도의 박스를 화면 전체에 퍼뜨리는 구성
- 터미널보다 보조 카드가 더 시선을 끄는 배치
- provider 상태, Telegram, debug, runtime 정보가 동시에 1차 영역을 차지하는 구조
- 현재 무엇을 해야 하는지보다 현재 가능한 기능 목록이 먼저 보이는 구조
- AI 대화가 메인인데 코드 보기와 테스트 확인이 사이드바나 하단 패널에 눌리는 구조
- 코드 흐름을 따라가야 하는 순간에도 editor-like surface가 부족한 구조
- 이미 밟아온 작업 경로와 실패 기록이 흩어져 있어 사용자가 무엇이 있었는지 재구성해야 하는 구조

### English

- dashboard-like grids of oversized cards without clear hierarchy
- layouts where every box competes at the same visual priority
- supporting cards drawing more attention than the terminal surface
- provider state, Telegram, debug, and runtime details all competing in the primary zone
- layouts that emphasize feature inventory before the next user action
- AI conversation dominating while code viewing and test inspection are squeezed into a sidebar or bottom panel
- layouts that lack an editor-like surface when users need to trace code flow
- layouts where prior work paths and failure evidence are scattered badly enough that users must reconstruct them manually
- provider/model popups that are clipped by the Agent shell, hide the selected final row, or add a raw model-ID line that reduces label readability
- composer provider/model/reasoning menu triggers that repeat long current names, wrap onto another line, or hide their exact accessible names behind icon-only rendering
- Fast controls that open a popup or listbox, require an intermediate option choice, omit exact `Fast mode: Enabled` / `Fast mode: Disabled` accessible state, or override native one-activation button behavior
- reasoning/Fast controls that remain visible after switching to a model that does not return support, or that erase a saved provider preference merely because the current model cannot use it

## 프론트엔드 작업 체크리스트 / Frontend Review Checklist

### 한국어

프론트 작업 전에 아래를 확인한다.

1. 이 화면이 `VS Code`처럼 구조가 명확한가
2. 이 흐름이 `conductor`처럼 에이전트 상태와 승인 단계를 읽기 쉬운가
3. 터미널이 `cmux`처럼 빠르고 강한 mode로 동작하면서도 editor와 agent board를 밀어내지 않는가
4. 카드 수를 줄이고 패널 구조로 바꿀 수 없는가
5. debug/mock 정보를 한 단계 더 뒤로 보낼 수 없는가
6. 에이전트 대화와 별개로 사용자가 코드를 읽고 흐름을 따라가기 편한 editor-like surface가 있는가
7. 사용자가 현재 pending action과 종료된 결정 이력을 헷갈리지 않고, task history나 trace에서 문제를 파악할 수 있는가

### English

Before shipping frontend work, check:

1. is the structure as clear as a `VS Code`-style workspace
2. is the agent and approval flow as legible as a `conductor`-style workflow
3. does the terminal feel as strong and fast as `cmux` without displacing the editor and agent board
4. can this be expressed with fewer cards and stronger panel layout
5. can debug or mock details be pushed one level further back
6. does the user still have an editor-like surface for reading code and tracing flow apart from the agent conversation
7. can the user distinguish current pending actions from finished decisions and diagnose recurring problems through task history or trace
8. do provider-backed model labels, popup bounds, and the selected row remain fully readable at the default desktop viewport
9. do the active Agent-header and closed-composer provider marks show an explicit current treatment for either real provider without confusing identity or readiness, while provider/model/reasoning menus retain exact full names and state in their opened lists
10. does the supported Fast control toggle directly once for pointer, Enter, and Space with exact `Fast mode: Enabled` / `Fast mode: Disabled` accessible state and matching pressed state, no popup/listbox, and closure of another open composer popup
11. does switching project, Agent session, provider, or model restore the correct provider-owned preference and send only the currently supported effective value
