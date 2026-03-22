# WORKLOG 2026-03-22 - Post-MVP Telegram Prototype

## 목적 / Purpose

### 한국어

이 문서는 `gtum`의 Telegram 연동 초안에서 어떤 UI, runtime, 테스트, 문서 연결 지점을 추가했는지 기록한다. 이번 단계는 실제 외부 Telegram 네트워크 전송까지는 아니지만, 앱 내부에서 Telegram 브리지 상태, 보고서 초안/리포트, 제한된 원격 명령 승인 흐름을 검증하는 프로토타입이다.

### English

This document records the UI, runtime, test, and documentation touchpoints added for the Telegram integration draft in `gtum`. This step does not yet send real Telegram traffic, but it validates bridge state, report drafting/report creation, and restricted remote-command approval flows inside the app.

## 구현 범위 / Implemented Scope

### 한국어

- Telegram 보고서 초안 패널을 우측 인스펙터에 추가
- Telegram 브리지 상태 패널과 제한된 원격 명령 승인 패널을 추가
- 현재 프로젝트, 활성 터미널, 실행 모드, 최근 작업 이력을 바탕으로 보고서 초안과 상태 리포트 생성
- 보고서 초안은 localStorage에 유지하고, 브리지/리포트/원격 명령 상태는 runtime snapshot과 mock runtime 모두에서 확인 가능하게 연결
- Telegram용 제한 명령 정책 초안 표시
- Telegram 보고서 흐름과 Telegram 브리지 흐름을 검증하는 Playwright E2E 추가
- `docs/README.md`에 프로토타입 링크와 현재 결정을 반영

### English

- added a Telegram report-draft panel in the right inspector
- added a Telegram bridge-state panel and a restricted remote-command approval panel
- generated report drafts and workspace status reports from the current project, active terminal, execution mode, and recent task history
- kept the draft in local state/localStorage while exposing bridge/report/remote-command state through the runtime snapshot and mock runtime paths
- displayed a draft command-policy section for Telegram
- added Playwright E2E coverage for both Telegram report drafting and Telegram bridge flows
- updated `docs/README.md` with the prototype link and current decision

## 검증 결과 / Verification Results

### 한국어

- `npm run build`: 성공
- `npm run test:e2e`: 성공
- `cargo check --manifest-path src-tauri/Cargo.toml`: 성공
- `npm run tauri:dev`: 실행 시작 및 Rust 컴파일 진입 확인, 25초 타임박스 안에서 완전 기동 전 종료

### English

- `npm run build`: passed
- `npm run test:e2e`: passed
- `cargo check --manifest-path src-tauri/Cargo.toml`: passed
- `npm run tauri:dev`: launch started and entered Rust compilation; the 25-second timebox ended before full interactive startup

## 다음 단계 / Next Steps

### 한국어

- 실제 Telegram 전송/수신 브리지 설계
- 제한 명령 정책을 runtime contract에서 provider/channel policy 문서로 더 분리
- 보고서 초안과 앱 내 리포트를 실제 채널 adapter에 연결
- Telegram 원격 명령을 chat trust policy와 앱 승인 로그에 연결

### English

- design the actual Telegram send/receive bridge
- separate the restricted-command policy further into provider/channel policy docs and runtime contracts
- connect the report draft and in-app reports to a real channel adapter later
- connect Telegram remote commands to chat trust policy and app approval logs
