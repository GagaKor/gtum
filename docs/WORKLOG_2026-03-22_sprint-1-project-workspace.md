# WORKLOG 2026-03-22 - Sprint 1 Project Workspace

## 목적 / Purpose

### 한국어

이 문서는 `Sprint 1`에서 구현한 프로젝트 열기, 파일 트리, Git 상태 표시 작업과 검증 결과를 기록한다.

### English

This document records the Sprint 1 implementation and verification for project open, file-tree visibility, and Git status display.

## 구현 범위 / Implemented Scope

### 한국어

- 프로젝트 경로 입력 기반 열기 흐름
- 최근 프로젝트 목록 저장과 재진입
- Tauri runtime의 프로젝트 메타데이터, 파일 트리, Git 상태 읽기
- 프론트엔드에서 프로젝트 메타데이터, 파일 트리, Git 요약 표시
- Playwright 기반 Sprint 1 UI E2E 시나리오 추가

### English

- path-input project open flow
- recent-project persistence and re-entry
- Tauri runtime support for project metadata, file tree, and Git status
- frontend rendering for project metadata, file tree, and Git summary
- Playwright-based Sprint 1 UI E2E scenario

## 검증 결과 / Verification Results

### 한국어

- `npm run lint`: 성공
- `npm run build`: 성공
- `cargo check --manifest-path src-tauri/Cargo.toml`: 성공
- `npm run test:e2e`: 성공

### English

- `npm run lint`: passed
- `npm run build`: passed
- `cargo check --manifest-path src-tauri/Cargo.toml`: passed
- `npm run test:e2e`: passed

## 남은 리스크 / Remaining Risks

### 한국어

- 현재 E2E는 브라우저 mock runtime 기준이므로, 실제 Tauri 데스크톱 경로 선택과 완전히 동일하지는 않다.
- 파일 트리는 깊이 제한이 있어 매우 큰 저장소의 전체 탐색을 모두 보여주지는 않는다.
- Git 상태는 읽기 전용 요약 수준이며, 세부 변경 목록은 아직 다루지 않는다.

### English

- the current E2E runs against a browser mock runtime, so it is not identical to full desktop Tauri behavior
- the file tree uses a depth limit and does not render the entire structure of very large repositories
- Git status is currently a read-only summary rather than a detailed change list

## 다음 스프린트에 추가할 작업 / Next Sprint Additions

### 한국어

Sprint 2로 넘겨야 할 후속 작업은 다음과 같다.

- PTY 기반 멀티 탭 터미널 런타임 도입
- 탭 생성, 이름 변경, 종료 상태 모델 추가
- 활성 탭 로그 버퍼 구조 추가
- 터미널 로그를 에이전트 컨텍스트로 넘기는 준비
- 터미널 핵심 흐름에 대한 UI E2E 시나리오 추가

### English

The following work should be added to Sprint 2:

- introduce the PTY-backed multi-tab terminal runtime
- add state for creating, renaming, and closing tabs
- add an active-tab log buffer model
- prepare terminal logs to become agent context
- add UI E2E coverage for the terminal core flow
