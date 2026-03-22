# WORKLOG 2026-03-22 - Sprint 0 Testing

## 목적 / Purpose

### 한국어

이 문서는 `Sprint 0`의 검증과 문제 기록을 남기기 위한 작업 로그다.

현재 기준 문서:

- `AGENTS.md`
- `docs/README.md`
- `docs/sprint-0-checklist.md`
- `docs/sprint-plan.md`
- `docs/technical-design.md`

### English

This worklog records Sprint 0 verification work and issues discovered during testing.

Current reference documents:

- `AGENTS.md`
- `docs/README.md`
- `docs/sprint-0-checklist.md`
- `docs/sprint-plan.md`
- `docs/technical-design.md`

## 테스트 계획 / Test Plan

### 한국어

이번 Sprint 0에서 확인하려는 항목은 다음과 같다.

- Tauri + React + Vite 앱 셸이 초기화되었는가
- 좌측, 중앙, 우측 패널 구조가 보이는가
- Zustand 상태 관리 뼈대가 연결되었는가
- 프론트엔드와 Tauri 런타임 간 기본 command 통신이 되는가
- 문서와 실제 폴더 구조가 `docs/technical-design.md`와 크게 어긋나지 않는가

### English

The Sprint 0 checks are:

- has the Tauri + React + Vite app shell been initialized
- is the left/center/right panel structure visible
- is a Zustand state-management skeleton connected
- does basic command communication work between frontend and Tauri runtime
- does the actual folder structure stay aligned with `docs/technical-design.md`

## 기대 확인 절차 / Expected Checks

### 한국어

아래 절차는 실제 앱이 준비되었을 때 순서대로 확인한다.

1. `npm` 또는 프로젝트 기본 실행 명령으로 앱을 실행한다.
2. 브라우저 또는 데스크톱 창에서 기본 레이아웃이 뜨는지 확인한다.
3. 샘플 `invoke` 또는 command 호출이 정상 동작하는지 확인한다.
4. `docs/sprint-0-checklist.md`의 체크 항목을 하나씩 마무리한다.
5. 결과를 이 문서의 검증 결과 섹션에 기록한다.

### English

When the app is ready, verify in this order:

1. run the app with the project’s default `npm` or startup command
2. confirm the base layout appears in the browser or desktop window
3. verify that a sample `invoke` or command call works
4. complete items from `docs/sprint-0-checklist.md` one by one
5. record results in the verification section of this worklog

## 예상 블로커 / Likely Blockers

### 한국어

초기 기준에서 가장 가능성이 높았던 블로커는 다음과 같았다.

- `pkg-config` 미설치
- GTK 관련 시스템 패키지 미설치
- WebKit 관련 시스템 패키지 미설치
- Linux Tauri 빌드용 네이티브 의존성 부족
- Rust 설치 이후에도 `cargo check`가 시스템 라이브러리 단계에서 멈출 수 있음

### English

The most likely blockers are:

- missing `pkg-config`
- missing GTK-related system packages
- missing WebKit-related system packages
- missing native dependencies required for Linux Tauri builds
- `cargo check` may stop at the system-library layer even after Rust installation

## Fixable Issues for Other Workers

### 한국어

다른 워커가 바로 손댈 수 있는 항목은 다음과 같다.

- Linux GUI 창을 실제로 띄워 시각적으로 확인
- `AppImage` 번들 실패 재현 및 환경 차이 기록
- Linux 패키징 정책에서 `AppImage`를 기본 대상으로 유지할지 결정
- `docs/technical-design.md`와 실제 폴더 구조 차이 점검
- Sprint 1 프로젝트 열기 범위를 구현 순서로 분해

각 항목의 처리 방향:

- 시스템 패키지 설치와 기본 빌드 검증은 이미 끝났으므로 같은 이슈를 다시 열지 않는다.
- 남은 것은 GUI 시각 확인과 `AppImage` 번들 환경 차이 정리다.
- 실제 폴더 구조가 문서와 다르면 문서를 먼저 맞춘다.
- 해결된 이슈는 닫고, 남은 것은 다른 워커가 바로 이어받을 수 있게 유지한다.

### English

The following items are immediately actionable by other workers:

- visually confirm the Linux GUI window in a real desktop session
- reproduce and document the `AppImage` failure with environment details
- decide whether Linux packaging should keep `AppImage` as a default target
- compare the actual folder structure with `docs/technical-design.md`
- break Sprint 1 project-open work into implementation steps

Suggested handling:

- do not reopen resolved native dependency issues unless they regress
- treat GUI visual confirmation and `AppImage` packaging as the remaining environment-specific follow-up
- if the actual folder structure differs from docs, align the docs first

## 실패 및 이슈 기록 / Failures and Issues

### 한국어

이 섹션은 다른 워커가 수정할 수 있도록 문제를 남기는 용도다.

#### 이슈 1 - Linux Tauri native dependency missing

- 증상: `cargo check`가 `pkg-config`와 GTK/WebKit 계열 시스템 패키지 부족으로 실패한다.
- 재현 방법: Rust 설치 후 `cargo check` 실행
- 기대 결과: Linux 환경에서 Tauri 빌드가 시스템 라이브러리 단계까지 통과한다.
- 실제 결과: `pkg-config`와 GTK/WebKit 관련 패키지 부족으로 중단된다.
- 원인 추정: Linux 데스크톱용 Tauri 네이티브 의존성이 설치되지 않았다.
- 수정 필요 문서: `docs/technical-design.md`, `docs/sprint-0-checklist.md`, `docs/DOCS_READING_ORDER.md`
- 수정 필요 코드 영역: Tauri runtime setup, Linux build prerequisites, dependency bootstrap
- 상태: 해결됨. `sudo apt-get update` 후 네이티브 패키지를 설치하고 `cargo check`가 통과했다.

#### 이슈 2 - Validation gap after frontend success

- 증상: `npm install`, `npm run build`, `npm run lint`는 성공했지만 전체 Sprint 0 완료 검증은 아직 불완전하다.
- 재현 방법: 프론트엔드 명령 실행 후 Tauri 검증 단계 진입
- 기대 결과: 프론트엔드 성공 후 Rust/Tauri 검증도 이어서 통과한다.
- 실제 결과: 프론트엔드 검증은 통과했지만 네이티브 의존성 블로커로 이어서 진행되지 못했다.
- 실제 결과: 이후 네이티브 의존성 설치 뒤 `cargo check`, `npm run tauri:build`, `npm run tauri:dev` 시작 확인까지 통과했다.
- 원인 추정: 프론트엔드와 네이티브 환경 준비가 분리되어 있으며, Linux 시스템 패키지 단계가 남아 있다.
- 수정 필요 문서: `docs/sprint-0-checklist.md`, `docs/sprint-plan.md`, `docs/WORKLOG_TEMPLATE.md`
- 수정 필요 코드 영역: app shell bootstrap, Tauri integration, environment setup
- 상태: 대부분 해결됨. 프론트엔드 검증과 `cargo check`는 통과했고, 남은 것은 GUI 시각 확인과 `AppImage` 번들 환경 이슈다.

#### 이슈 3 - Linux AppImage bundling blocked by environment

- 증상: `npm run tauri:bundle` 실행 시 `AppImage` 번들 단계에서 read-only filesystem 오류가 발생한다.
- 재현 방법: `npm run tauri:bundle`
- 기대 결과: Linux 번들링이 모든 기본 대상에서 완료된다.
- 실제 결과: 바이너리와 `deb`/`rpm` 번들은 생성되지만 `AppImage`는 현재 환경에서 실패한다.
- 원인 추정: 현재 실행 환경의 파일 시스템 제약 때문에 `AppImage` 생성 단계가 쓰기 작업을 완료하지 못한다.
- 수정 필요 문서: `docs/sprint-0-checklist.md`, `docs/technical-design.md`
- 수정 필요 코드 영역: 없음. 빌드 스크립트/배포 정책 분리로 다루는 편이 적절하다.

#### 확인 후 기록할 문제 형식

- 증상:
- 재현 방법:
- 기대 결과:
- 실제 결과:
- 원인 추정:
- 수정 필요 문서:
- 수정 필요 코드 영역:

### English

This section is for recording issues so other workers can fix them.

#### Issue 1 - Missing Linux Tauri native dependencies

- symptom: `cargo check` fails because `pkg-config` and GTK/WebKit-related system packages are missing
- repro steps: install Rust, then run `cargo check`
- expected result: Linux Tauri build should get past the system-library stage
- actual result: it stops due to missing `pkg-config` and GTK/WebKit-related packages
- suspected cause: Linux desktop native dependencies for Tauri are not installed
- docs that need updates: `docs/technical-design.md`, `docs/sprint-0-checklist.md`, `docs/DOCS_READING_ORDER.md`
- code area that needs fixes: Tauri runtime setup, Linux build prerequisites, dependency bootstrap
- status: resolved. After `sudo apt-get update` and native package installation, `cargo check` passed.

#### Issue 2 - Validation gap after frontend success

- symptom: `npm install`, `npm run build`, and `npm run lint` succeed, but Sprint 0 verification is still incomplete
- repro steps: run frontend commands and then move into the Tauri verification step
- expected result: frontend success should be followed by successful Rust/Tauri verification
- actual result: frontend verification passed, but the native dependency blocker prevented further progress
- actual result: after installing native dependencies, `cargo check`, `npm run tauri:build`, and startup verification for `npm run tauri:dev` all passed.
- suspected cause: frontend and native environment setup are split, and Linux system packages are still missing
- docs that need updates: `docs/sprint-0-checklist.md`, `docs/sprint-plan.md`, `docs/WORKLOG_TEMPLATE.md`
- code area that needs fixes: app shell bootstrap, Tauri integration, environment setup
- status: mostly resolved. Frontend checks and `cargo check` now pass; the remaining items are GUI visual verification and the `AppImage` environment issue.

#### Issue 3 - Linux AppImage bundling blocked by environment

- symptom: `npm run tauri:bundle` fails during the `AppImage` bundling step with a read-only filesystem error
- repro steps: run `npm run tauri:bundle`
- expected result: Linux bundling should complete for every default target
- actual result: the binary and `deb`/`rpm` bundles are created, but `AppImage` fails in the current environment
- suspected cause: filesystem restrictions in the current environment prevent the `AppImage` step from finishing its write operations
- docs that need updates: `docs/sprint-0-checklist.md`, `docs/technical-design.md`
- code area that needs fixes: none. This is better handled as a build-script or packaging-policy decision.

#### Issue format to fill in after verification

- symptom:
- repro steps:
- expected result:
- actual result:
- suspected cause:
- docs that need updates:
- code area that needs fixes:

## 검증 메모 / Verification Notes

### 한국어

#### 2026-03-22

- `npm install` 성공.
- `npm run build` 성공.
- `npm run lint` 성공.
- Rust 설치 이후 `cargo check`까지 진행했다.
- `sudo apt-get update`와 네이티브 패키지 설치 후 `cargo check`가 성공했다.
- `npm run tauri:build`를 번들 없는 검증용 명령으로 정리했고 성공했다.
- `npm run tauri:dev`는 Vite dev server 시작과 Rust 개발 빌드 진입까지 확인한 뒤 세션 제한으로 종료했다.
- `npm run tauri:bundle`는 바이너리와 `deb`/`rpm` 번들 생성까지 성공했다.
- `AppImage` 번들은 현재 환경의 read-only filesystem 제약으로 실패했다.
- Sprint 0의 프론트엔드 및 Rust/Tauri 기초 검증은 완료되었다.
- GUI 창 자체를 눈으로 본 시각 검증은 아직 이 세션에서 완료하지 못했다.

### English

#### 2026-03-22

- `npm install` succeeded.
- `npm run build` succeeded.
- `npm run lint` succeeded.
- `cargo check` was run after Rust installation.
- `cargo check` succeeded after `sudo apt-get update` and native package installation.
- `npm run tauri:build` was changed into a no-bundle verification command and succeeded.
- `npm run tauri:dev` reached Vite dev server startup and Rust dev-build startup before the session timeout ended it.
- `npm run tauri:bundle` succeeded through binary plus `deb`/`rpm` bundle generation.
- the `AppImage` bundle failed because of a read-only filesystem restriction in the current environment.
- the Sprint 0 frontend and Rust/Tauri baseline verification is complete.
- direct visual confirmation of the GUI window itself was not completed inside this session.

## 다음 작업 / Next Step

### 한국어

- 현재 환경에서 GUI 창을 직접 띄워 시각 검증이 가능한지 별도로 확인한다.
- Linux 패키징 정책에서 `AppImage`를 기본 대상에 둘지 추후 결정한다.
- Sprint 1에 맞춰 프로젝트 열기 기능 설계와 구현으로 넘어간다.

### English

- separately confirm whether the GUI window can be visually inspected in this environment
- decide later whether Linux packaging should keep `AppImage` as a default target
- move into Sprint 1 project-open design and implementation
