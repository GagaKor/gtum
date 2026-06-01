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
- 현재 provider-auth 자동화는 최종 `OAuth/session login` 검증이 아니라 계약/프리뷰 범위 검증이다.
- agent request -> suggestion -> approval 흐름
- 반복 실행과 reload를 포함한 초기 aging test

### English

- project open, file tree, and Git status
- multi-tab terminal and active-log capture
- preview/deferred provider connection states and diagnostics
- current provider-auth automation is contract/preview coverage, not final `OAuth/session login` validation
- agent request -> suggestion -> approval flow
- new design shell render, scaled proportions, and titlebar/statusbar contracts through `tests/e2e/design-prototype.spec.ts`
- independent left `Projects` and `Files` accordion collapse behavior, settings-modal open, backend-bridge state, and file-open content (same spec)
- custom frameless titlebar coverage in the same spec: OS-specific window chrome, responsive collapse, injected native window-control routing, and titlebar drag-region behavior
- runtime project-service fallback behavior through `tests/e2e/runtime-project-service.spec.ts`
- terminal runtime service contract behavior through `tests/e2e/runtime-terminal-service.spec.ts`
- injected terminal runtime bridge coverage in `tests/e2e/design-prototype.spec.ts` for new-tab creation and close/terminate routing
- agent suggestion runtime service contract behavior through `tests/e2e/runtime-agent-suggestions-service.spec.ts`
- injected Codex suggestion runtime bridge coverage in `tests/e2e/design-prototype.spec.ts`
- agent auth runtime service contract behavior through `tests/e2e/runtime-agent-auth-service.spec.ts`
- injected Codex CLI login launcher coverage in `tests/e2e/design-prototype.spec.ts`

Note: the Sprint 17 frontend reset deleted the earlier suites (including `new-design-shell.spec.ts`, the project-workspace regression, the repetition/reload aging spec, and the agent-request-flow spec). The specs listed above are the active E2E coverage; the aging scenario must be re-gathered on the new shell.

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

The earlier MVP aging test was a Playwright scenario that repeated: open a project, connect a provider, capture active logs, switch `Fast`/`Balanced`/`Deep` modes, request suggestions and approve execution, then reload and verify project/task-history restore.

That spec was removed in the Sprint 17 frontend reset and has **not yet been re-created on the new shell**, so there is currently no automated aging evidence for the current UI. Re-establishing this scenario (and confirming reload-restore works against the per-store state files in `app_data_dir`) is required before claiming repeated-use stability. It still does not replace long-duration manual aging validation.

## Platform Status

- `Ubuntu`
  - current primary development platform
- `Windows`
  - first daily-use baseline platform
  - shell-candidate abstraction and command-submission newline handling are in place
  - native app compile path is covered by the `windows-install-smoke` CI job
  - Release workflow requires at least one `.exe` or `.msi` artifact from the Windows runner
  - real-device validation is still required
- `macOS`
  - covered by the non-Windows shell abstraction path
  - native app compile path is covered by the `macos-install-smoke` CI job
  - Release workflow requires both `.app` and `.dmg` artifacts from the macOS runner
  - signing and notarization are not implemented yet
  - real-device validation is still required

## Current MVP Assessment

At the current stage, `gtum` satisfies the core MVP flows defined in the planning documents. The following remain post-MVP or later stabilization work:

- broader `Codex` login UX validation for cancellation, reconnect-after-expiry, and missing-scope states
- real-device Windows/macOS validation
- signed and notarized macOS distribution
- expanded long-running manual aging validation
- Telegram external-channel integration

A code-verified state-persistence bug was found and fixed during the deployment-readiness review: the auth, workspace, and telegram stores previously resolved to the same `app_data_dir` directory path on installed builds and clobbered each other. They now persist to distinct files (`agent-auth.json`, `workspace-state.json`, `telegram-state.json`). On-device verification of reload-restore is still pending, and there are no Rust unit tests guarding this path.

For the consolidated deployment/operation readiness assessment, open blockers, and the ship/no-ship verdict, see `docs/release-build-ci.md` (`Current Release Status Snapshot` through `First-Release Go / No-Go Matrix`).
