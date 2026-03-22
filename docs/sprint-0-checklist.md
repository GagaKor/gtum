# gtum Sprint 0 체크리스트 / Sprint 0 Checklist

## 문서 목적 / Document Purpose

### 한국어

이 문서는 `Sprint 0`를 실제 실행 가능한 체크리스트로 세분화한 문서다.

### English

This document breaks `Sprint 0` into an execution-ready checklist.

## Sprint 0 목표 / Sprint 0 Goal

### 한국어

- Tauri + React + Vite 기반 앱 셸을 초기화하고, 이후 스프린트를 올릴 수 있는 기본 구조를 만든다.

### English

- bootstrap the Tauri + React + Vite app shell and create the base structure required for later sprints

## 체크리스트 / Checklist

### 한국어

#### A. 저장소와 런타임 기반

- [ ] Tauri 프로젝트 초기화
- [ ] React + TypeScript + Vite 설정 연결
- [ ] 개발 실행 명령 확인
- [ ] 기본 빌드 명령 확인

#### B. 앱 레이아웃 기반

- [ ] 좌측 사이드바 뼈대 추가
- [ ] 중앙 워크스페이스 뼈대 추가
- [ ] 우측 에이전트 패널 뼈대 추가
- [ ] 공통 레이아웃 컴포넌트 구조 정리

#### C. 상태 관리 기반

- [ ] Zustand 스토어 폴더 생성
- [ ] 최소 AppState 또는 WorkspaceState 초안 추가
- [ ] 레이아웃 상태와 앱 상태 연결

#### D. Tauri 통신 기반

- [ ] 샘플 command 1개 정의
- [ ] 프론트엔드에서 invoke 호출 확인
- [ ] 응답 렌더링 확인

#### E. 문서 및 개발 기준

- [ ] 실제 생성된 폴더 구조가 `docs/technical-design.md`와 크게 어긋나는지 점검
- [ ] 어긋나면 문서를 같이 갱신
- [ ] `WORKLOG` 또는 체크 결과 기록

### English

#### A. Repository and Runtime Foundation

- [ ] initialize the Tauri project
- [ ] wire React + TypeScript + Vite
- [ ] verify development run command
- [ ] verify base build command

#### B. App Layout Foundation

- [ ] add left sidebar shell
- [ ] add center workspace shell
- [ ] add right agent panel shell
- [ ] organize shared layout component structure

#### C. State Management Foundation

- [ ] create Zustand store folder
- [ ] add first AppState or WorkspaceState draft
- [ ] connect layout state to app state

#### D. Tauri Communication Foundation

- [ ] define one sample command
- [ ] verify frontend invoke call
- [ ] verify response rendering

#### E. Documentation and Development Baseline

- [ ] compare generated folder structure with `docs/technical-design.md`
- [ ] update docs if reality diverges
- [ ] leave a `WORKLOG` or execution note

## Sprint 0 완료 확인 / Sprint 0 Done Check

### 한국어

아래 질문에 모두 `예`라고 답할 수 있어야 한다.

- 앱이 로컬에서 실행되는가
- 좌측, 중앙, 우측 레이아웃이 보이는가
- 프론트엔드와 Tauri 런타임 통신이 되는가
- 다음 스프린트에서 프로젝트 열기 기능을 바로 올릴 수 있는 구조인가

### English

All of the following should be answerable with `yes`:

- does the app run locally
- is the left/center/right layout visible
- does frontend-to-Tauri communication work
- is the structure ready for project-open work in the next sprint
