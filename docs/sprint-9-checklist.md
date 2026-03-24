# gtum Sprint 9 체크리스트 / Sprint 9 Checklist

## 문서 목적 / Document Purpose

### 한국어

이 문서는 `Sprint 9`를 실제 실행 가능한 체크리스트로 세분화한 문서다.

### English

This document breaks `Sprint 9` into an execution-ready checklist.

## Sprint 9 목표 / Sprint 9 Goal

### 한국어

- 카드 중심 UI를 작업용 워크스페이스 구조로 재구성하고, backend 상태와 frontend UI 동작을 같은 계약으로 맞춘다.

### English

- replace the card-heavy UI with a working workspace structure and align backend state with frontend UI behavior under one contract.

## 체크리스트 / Checklist

### 한국어

#### A. 오케스트레이션과 문서 기준

- [x] `docs/frontend-design-benchmarks.md` 기준으로 구현 범위 고정
- [x] `docs/ui-ux-wireframes.md`와 실제 화면 차이 정리
- [x] `orchestrator / frontend / backend / tester` 역할별 작업 소유 범위 확인

#### B. 프론트엔드 워크스페이스 리디자인

- [x] 상단 바, 좌측 프로젝트 레일, 중앙 터미널 스테이지, 우측 에이전트 패널 구조 재구성
- [x] summary card 밀도 축소
- [x] Task History, Telegram, Runtime/Debug를 2선 영역으로 재배치
- [x] 에이전트 요청, 컨텍스트, 제안, 승인 흐름을 단계형으로 재구성
- [x] 활성 로그 연결 상태를 더 분명하게 표시

#### C. 백엔드-프론트 계약 정렬

- [x] backend snapshot/status field가 frontend 버튼 활성 조건과 같은 의미를 가지는지 점검
- [x] provider 상태, badge, diagnostics 노출 조건을 공통 display contract로 정리
- [x] action gating이 UI heuristic이 아니라 runtime contract를 기준으로 동작하도록 정리
- [x] 필요 시 문서에 contract 변경 사항 반영

#### D. 검증

- [x] 관련 `Playwright` 시나리오 갱신
- [x] 최소 `lint`와 `build` 검증
- [x] 가능하면 E2E까지 확인
- [x] 남은 UX 리스크와 후속 작업 기록

### English

#### A. Orchestration and Doc Baseline

- [ ] lock implementation scope against `docs/frontend-design-benchmarks.md`
- [ ] map the current gap between `docs/ui-ux-wireframes.md` and the real UI
- [ ] confirm ownership split across `orchestrator / frontend / backend / tester`

#### B. Frontend Workspace Redesign

- [ ] rebuild the top bar, left project rail, center terminal stage, and right agent panel
- [ ] reduce summary-card density
- [ ] move Task History, Telegram, and Runtime/Debug into secondary areas
- [ ] restructure request, context, suggestion, and approval into a staged flow
- [ ] make active-log attachment state much clearer

#### C. Backend-Frontend Contract Alignment

- [ ] verify that backend snapshot and status-field semantics match frontend button gating
- [ ] organize provider state, badges, and diagnostics visibility under a shared display contract
- [ ] make action gating depend on runtime contract rather than UI heuristics
- [ ] update docs if the contract meaning changes

#### D. Verification

- [ ] update relevant `Playwright` scenarios
- [ ] run at least `lint` and `build`
- [ ] run E2E if feasible
- [ ] record remaining UX risks and follow-up work

## Sprint 9 완료 확인 / Sprint 9 Done Check

### 한국어

아래 질문에 모두 `예`라고 답할 수 있어야 한다.

- 첫 화면이 이전보다 더 명확한 작업용 워크스페이스처럼 보이는가
- 터미널이 가장 강한 1차 작업 표면인가
- 에이전트 패널이 요청, 컨텍스트, 제안, 승인 흐름을 자연스럽게 보여주는가
- backend 상태와 frontend 버튼/뱃지/패널 동작이 같은 의미를 가지는가
- 관련 검증과 후속 리스크 기록이 남았는가

### English

All of the following should be answerable with `yes`:

- does the first screen now feel more like a working workspace than before
- is the terminal clearly the strongest primary work surface
- does the agent panel present request, context, suggestion, and approval in a natural order
- do backend state and frontend button, badge, and panel behavior mean the same thing
- were validation and follow-up risks recorded
