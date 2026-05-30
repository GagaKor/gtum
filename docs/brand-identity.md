# gtum 브랜드 아이덴티티 / Brand Identity

## 문서 목적 / Document Purpose

### 한국어

이 문서는 `gtum`의 로고, 아이콘, 색상, 사용 원칙을 정리한 브랜드 기준 문서다.

목적은 다음과 같다.

- 제품이 템플릿 느낌에서 벗어나 고유한 정체성을 갖게 한다.
- 디자이너, 프론트엔드, QA가 같은 브랜드 자산을 기준으로 작업하게 한다.
- 로고와 아이콘이 제품 구조와 핵심 가치와 연결되도록 기준을 남긴다.

### English

This document defines the brand rules for `gtum`, including the logo, icon, colors, and usage principles.

Its goals are:

- move the product away from template-looking visuals into a recognizable identity
- keep designers, frontend, and QA aligned on the same assets
- ensure the logo and icon reflect the product structure and core value

## 언제 읽는 문서인가 / When To Read This Document

### 한국어

아래 상황이면 이 문서를 읽는다.

- 로고, 아이콘, favicon, 앱 런처 아이콘을 수정할 때
- 랜딩 화면, 사이드바 헤더, 제품 소개 화면에 브랜드 자산을 반영할 때
- 색상과 시각 언어가 `gtum`의 제품 방향과 맞는지 확인할 때

### English

Read this document when:

- updating the logo, icon, favicon, or app launcher icon
- applying brand assets to entry screens, sidebars, or product-intro surfaces
- checking whether the visual language still matches the product direction

## 현재 선택 / Current Selection

### 한국어

`Sprint 16` 기준으로 현재 브랜드 기준은 `Concept A`다.

- 선택 이유
  - 현재 제품 구조인 `left rail + split workbench + agent workspace`를 가장 직접적으로 읽힌다.
  - 기존 `gtum` 자산과의 연결을 유지하면서도 더 깔끔한 silhouette를 만든다.
- 현재 active web 자산
  - [gtum-mark.svg](/home/kwon/project/gtum/public/brand/gtum-mark.svg)
  - [gtum-logo.svg](/home/kwon/project/gtum/public/brand/gtum-logo.svg)
- 선택 기록
  - [logo-concepts-sprint-16.md](/home/kwon/project/gtum/docs/logo-concepts-sprint-16.md)

### English

As of `Sprint 16`, the current brand baseline is `Concept A`.

- Why it was selected
  - it communicates the current `left rail + split workbench + agent workspace` product structure most directly
  - it keeps continuity with the existing `gtum` assets while producing a cleaner silhouette
- current active web assets
  - [gtum-mark.svg](/home/kwon/project/gtum/public/brand/gtum-mark.svg)
  - [gtum-logo.svg](/home/kwon/project/gtum/public/brand/gtum-logo.svg)
- decision record
  - [logo-concepts-sprint-16.md](/home/kwon/project/gtum/docs/logo-concepts-sprint-16.md)

## 브랜드 방향 / Brand Direction

### 한국어

`gtum`의 브랜드는 다음 세 가지 감각을 함께 담아야 한다.

- 프로젝트 전환과 코드 구조가 읽히는 left rail
- 코드 읽기와 분할 실행이 함께 가능한 split workbench
- 에이전트가 신호를 보내고 대화와 pending action이 이어지는 mission workspace

시각 톤은 "차분한 editor shell + 구조가 보이는 workbench + 절제된 실행감"을 목표로 한다.

### English

The `gtum` brand should combine three product feelings:

- a left rail that makes project switching and code structure legible
- a split workbench where code reading and execution can coexist
- an agent mission workspace where signal, conversation, and pending action stay connected

The intended tone is "calm editor shell + structured workbench + restrained execution energy."

## 심볼 의미 / Symbol Meaning

### 한국어

현재 아이콘 심볼은 다섯 요소로 읽히도록 설계한다.

1. 바깥 라운드 프레임
   워크스페이스와 데스크톱 셸
2. 왼쪽 세로 레일
   프로젝트 탐색과 구조 인식
3. 위쪽 split block
   editor-like workbench와 분할 구조
4. 아래쪽 프롬프트와 커맨드 바
   terminal 실행과 제안 처리
5. 오른쪽 위 신호 점
   에이전트, 알림, attention state

### English

The current symbol is designed to read as five parts:

1. outer rounded frame
   the workspace shell
2. left vertical rail
   project navigation and structure
3. upper split block
   the editor-like workbench and split structure
4. lower prompt and command bar
   terminal execution and proposal handling
5. upper-right signal dot
   the agent, notification, and attention state

## 색상 / Color

### 한국어

브랜드 자산의 색상과 앱 내부 UI 토큰은 분리해서 관리한다. 로고와 아이콘은 아래 브랜드 팔레트를 따르지만, 실제 앱 작업 UI는 1차 디자인 시스템 기준의 `cool dark shell + green execution accent`를 사용한다. 앱 UI 토큰은 [design-system.md](/Users/kwon/projects/gtum/docs/design-system.md)를 따른다.

- `Ink`
  - `#17181C`
  - 로고 바탕, 강한 제목, 런처 아이콘 기본 질감
- `Shell`
  - `#23262D`
  - 보조 바탕, 깊이감
- `Paper`
  - `#F4E8D9`
  - 코드/패널 surface, 밝은 대비
- `Ember`
  - `#D76632`
  - 실행, 프롬프트, 강조, attention
- `Mist`
  - `#6A6F79`
  - 보조 텍스트와 설명

### English

Brand asset colors and in-app UI tokens are managed separately. Logo and icon assets follow the brand palette below, while the actual workspace UI uses the first design-system baseline: `cool dark shell + green execution accent`. In-app UI tokens follow [design-system.md](/Users/kwon/projects/gtum/docs/design-system.md).

- `Ink`
  - `#17181C`
  - main logo background, strong headings, launcher-icon base
- `Shell`
  - `#23262D`
  - secondary background and depth
- `Paper`
  - `#F4E8D9`
  - code/panel surface and bright contrast
- `Ember`
  - `#D76632`
  - execution, prompt, emphasis, and attention
- `Mist`
  - `#6A6F79`
  - supporting copy and muted description

## 자산 위치 / Asset Locations

### 한국어

- 앱 아이콘 원본
  - [gtum-mark.svg](/home/kwon/project/gtum/public/brand/gtum-mark.svg)
- 수평 로고
  - [gtum-logo.svg](/home/kwon/project/gtum/public/brand/gtum-logo.svg)
- 웹 favicon 연결 지점
  - [index.html](/home/kwon/project/gtum/index.html)
- 데스크톱 번들 아이콘 출력 디렉토리
  - [src-tauri/icons](/home/kwon/project/gtum/src-tauri/icons)
  - 현재 선택된 `Concept A`를 반영한 desktop bundle icon refresh는 후속 작업이다.

### English

- app icon source
  - [gtum-mark.svg](/home/kwon/project/gtum/public/brand/gtum-mark.svg)
- horizontal logo
  - [gtum-logo.svg](/home/kwon/project/gtum/public/brand/gtum-logo.svg)
- web favicon integration point
  - [index.html](/home/kwon/project/gtum/index.html)
- desktop bundle icon output directory
  - [src-tauri/icons](/home/kwon/project/gtum/src-tauri/icons)
  - refreshing desktop bundle icons from the selected `Concept A` mark is a follow-up task

## 사용 원칙 / Usage Rules

### 한국어

- 아이콘은 작은 크기에서도 읽혀야 하므로 내부 디테일을 더 늘리지 않는다.
- 워드마크는 가능하면 소문자 `gtum`을 유지한다.
- `Ember`는 포인트 컬러로 쓰고, 화면 전체를 오렌지로 덮지 않는다.
- 브랜드 자산은 카드 장식보다 "작업 환경"의 성격을 강화하는 데 써야 한다.

### English

- the icon should remain legible at small sizes, so avoid adding more internal detail
- keep the wordmark in lowercase `gtum` where possible
- use `Ember` as an accent, not as a full-screen wash
- brand assets should reinforce the idea of a working environment rather than decorative card chrome
