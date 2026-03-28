# MVP Validation Notes / MVP 검증 메모

## 목적 / Purpose

### 한국어

이 문서는 `gtum` MVP 완료 판단에 필요한 검증 메모를 모은다. 기능 검증, E2E 범위, aging test 초안, 그리고 플랫폼별 현재 상태를 함께 기록한다.

### English

This document captures the validation notes needed to judge `gtum` MVP completion. It records feature validation, E2E coverage, the first aging-test draft, and the current platform status.

## 자동화 검증 범위 / Automated Validation Coverage

### 한국어

- 프로젝트 열기, 파일 트리, Git 상태
- 멀티 탭 터미널과 활성 로그 캡처
- provider 연결 preview/deferred 상태와 diagnostics
- agent request -> suggestion -> approval 흐름
- 반복 실행과 reload를 포함한 초기 aging test

### English

- project open, file tree, and Git status
- multi-tab terminal and active-log capture
- preview/deferred provider connection states and diagnostics
- agent request -> suggestion -> approval flow
- initial aging test with repetition and reload

## Aging Test 초안 / Initial Aging Test

### 한국어

현재 aging test는 Playwright 기준으로 아래를 반복 확인한다.

- 프로젝트 열기
- provider 연결
- active log 캡처
- `Fast`, `Balanced`, `Deep` 모드 전환
- suggestion 요청과 승인 실행
- 페이지 reload 후 프로젝트와 task history 복원 확인

이 테스트는 장시간 실사용 전체를 대체하지는 않지만, MVP 기준의 상태 유지와 반복 사용 안정성의 첫 증거로 사용한다.

### English

The current aging test repeats the following in Playwright:

- open a project
- connect a provider
- capture active logs
- switch `Fast`, `Balanced`, and `Deep` modes
- request suggestions and approve execution
- reload the page and verify project/task-history restore

This does not replace long-duration manual aging validation, but it serves as the first evidence of state persistence and repeated-use stability for the MVP.

## 플랫폼 상태 / Platform Status

### 한국어

- `Ubuntu`
  - 현재 주요 개발 플랫폼
- `Windows`
  - 첫 실사용 기준 플랫폼
  - 셸 후보 추상화와 command submission line 분기까지 반영됨
  - real-device 검증은 아직 필요
- `macOS`
  - 비-Windows 셸 후보 추상화 범위에 포함됨
  - 실기 검증은 아직 필요

### English

- `Ubuntu`
  - current primary development platform
- `Windows`
  - first daily-use baseline platform
  - shell-candidate abstraction and command-submission newline handling are in place
  - real-device validation is still required
- `macOS`
  - covered by the non-Windows shell abstraction path
  - real-device validation is still required

## 현재 MVP 판단 / Current MVP Assessment

### 한국어

현재 기준으로 `gtum`은 문서에 정의한 MVP 핵심 흐름을 충족한다. 다만 아래는 `Post-MVP` 또는 후속 안정화 과제로 남는다.

- `Codex` real-device connect-time preflight 안정화
- 실제 Windows/macOS 실기 검증
- 장시간 수동 aging test 확대
- Telegram 외부 채널 연동

### English

At the current stage, `gtum` satisfies the core MVP flows defined in the planning documents. The following remain post-MVP or later stabilization work:

- real-device Codex connect-time preflight stabilization
- real-device Windows/macOS validation
- expanded long-running manual aging validation
- Telegram external-channel integration
