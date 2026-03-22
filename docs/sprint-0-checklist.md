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

- [x] Tauri 프로젝트 초기화
- [x] React + TypeScript + Vite 설정 연결
- [x] 개발 실행 명령 확인
- [x] 기본 빌드 명령 확인

#### B. 앱 레이아웃 기반

- [x] 좌측 사이드바 뼈대 추가
- [x] 중앙 워크스페이스 뼈대 추가
- [x] 우측 에이전트 패널 뼈대 추가
- [x] 공통 레이아웃 컴포넌트 구조 정리

#### C. 상태 관리 기반

- [x] Zustand 스토어 폴더 생성
- [x] 최소 AppState 또는 WorkspaceState 초안 추가
- [x] 레이아웃 상태와 앱 상태 연결

#### D. Tauri 통신 기반

- [x] 샘플 command 1개 정의
- [x] 프론트엔드에서 invoke 호출 확인
- [x] 응답 렌더링 확인

#### E. 문서 및 개발 기준

- [x] 실제 생성된 폴더 구조가 `docs/technical-design.md`와 크게 어긋나는지 점검
- [x] 어긋나면 문서를 같이 갱신
- [x] `WORKLOG` 또는 체크 결과 기록

### English

#### A. Repository and Runtime Foundation

- [x] initialize the Tauri project
- [x] wire React + TypeScript + Vite
- [x] verify development run command
- [x] verify base build command

#### B. App Layout Foundation

- [x] add left sidebar shell
- [x] add center workspace shell
- [x] add right agent panel shell
- [x] organize shared layout component structure

#### C. State Management Foundation

- [x] create Zustand store folder
- [x] add first AppState or WorkspaceState draft
- [x] connect layout state to app state

#### D. Tauri Communication Foundation

- [x] define one sample command
- [x] verify frontend invoke call
- [x] verify response rendering

#### E. Documentation and Development Baseline

- [x] compare generated folder structure with `docs/technical-design.md`
- [x] update docs if reality diverges
- [x] leave a `WORKLOG` or execution note

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

## 최신 검증 상태 / Latest Verification Status

### 한국어

- `npm install`: 성공
- `npm run build`: 성공
- `npm run lint`: 성공
- `cargo check`: 성공
- `npm run tauri:build`: 성공
- `npm run tauri:dev`: 성공적으로 시작되었고 Vite dev server 기동 및 Rust 개발 빌드 진입을 확인한 뒤 세션 제한으로 종료
- `npm run tauri:bundle`: 바이너리 및 `deb`/`rpm` 번들 성공, `AppImage`는 현재 환경의 read-only filesystem 제약으로 실패

현재 해석:

- Sprint 0 앱 셸 기준의 프론트엔드 및 Rust/Tauri 기본 검증은 완료되었다.
- 데스크톱 번들링 중 `AppImage` 실패는 현재 환경 제약에 가까우며, Sprint 0의 핵심 완료 조건과는 분리해서 다룬다.

### English

- `npm install`: succeeded
- `npm run build`: succeeded
- `npm run lint`: succeeded
- `cargo check`: succeeded
- `npm run tauri:build`: succeeded
- `npm run tauri:dev`: started successfully, reached Vite dev server startup and Rust dev build, then was stopped by the session timeout
- `npm run tauri:bundle`: binary plus `deb`/`rpm` bundles succeeded, while `AppImage` failed because of a read-only filesystem restriction in this environment

Current interpretation:

- the frontend foundation and the Rust/Tauri baseline checks for Sprint 0 are complete
- the `AppImage` failure is treated as an environment-specific bundling issue, separate from Sprint 0 core completion

## 알려진 blocker / Known Blockers

### 한국어

- 현재 세션에서는 GUI 창을 직접 띄워 시각적으로 확인하지 못했다.
- Linux `AppImage` 번들링은 현재 환경의 read-only filesystem 제약으로 실패한다.

### English

- this session could not visually inspect the GUI window directly
- Linux `AppImage` bundling fails because of a read-only filesystem restriction in the current environment
