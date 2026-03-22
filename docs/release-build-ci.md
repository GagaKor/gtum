# gtum 릴리스, 빌드, CI / Release, Build, and CI

## 문서 목적 / Document Purpose

### 한국어

이 문서는 `gtum`의 빌드, 번들, GitHub Release 배포, 그리고 CI/CD 운영 기준을 정리한다.

이 문서의 목적은 다음과 같다.

- 로컬 빌드와 배포용 빌드를 구분한다.
- Ubuntu, Windows, macOS별 산출물 형태를 정리한다.
- GitHub Release로 배포하는 흐름을 문서로 고정한다.
- 환경별 번들링 제약과 주의점을 기록한다.

### English

This document defines the build, bundling, GitHub Release, and CI/CD operating model for `gtum`.

Its purpose is to:

- distinguish local verification builds from distributable release builds
- document the expected artifacts for Ubuntu, Windows, and macOS
- fix the release flow to GitHub Releases in documentation
- record environment-specific bundling caveats and release concerns

## 빌드 단계 / Build Stages

### 한국어

현재 `package.json` 기준으로 빌드 관련 명령은 다음과 같다.

- `npm run build`
  - 프론트엔드 번들 생성
  - 릴리스 아티팩트 생성 전의 기본 검증 단계
- `npm run tauri:build`
  - `tauri build --no-bundle`
  - 네이티브 앱 번들 없이 Rust/Tauri 컴파일 경로를 검증한다
- `npm run tauri:bundle`
  - `tauri build`
  - 플랫폼별 설치/배포 산출물을 만든다

릴리스 관점에서는 보통 아래 순서로 간다.

1. `npm run lint`
2. `npm run build`
3. `cargo check --manifest-path src-tauri/Cargo.toml`
4. `npm run tauri:bundle`
5. GitHub Release 업로드

### English

The current build-related commands in `package.json` are:

- `npm run build`
  - produces the frontend bundle
  - serves as the baseline verification step before release artifacts
- `npm run tauri:build`
  - runs `tauri build --no-bundle`
  - validates the Rust/Tauri compilation path without packaging
- `npm run tauri:bundle`
  - runs `tauri build`
  - creates platform-specific installable/distributable artifacts

For release purposes, the usual order is:

1. `npm run lint`
2. `npm run build`
3. `cargo check --manifest-path src-tauri/Cargo.toml`
4. `npm run tauri:bundle`
5. upload to GitHub Releases

## 배포 산출물 / Release Artifacts

### 한국어

`src-tauri/tauri.conf.json`에서 `bundle.targets`는 `all`로 설정되어 있으므로, CI/CD에서는 가능한 한 플랫폼별 표준 산출물을 만든다고 가정한다.

- `Ubuntu`
  - `AppImage`
  - `deb`
  - `rpm`
- `Windows`
  - `exe` 또는 `msi`
- `macOS`
  - `.app`
  - `.dmg`

정확한 패키지 형식은 Tauri 버전과 러너 설정에 따라 달라질 수 있지만, 사용자 기준 배포는 위 형태로 생각하면 된다.

### English

`src-tauri/tauri.conf.json` sets `bundle.targets` to `all`, so CI/CD should aim to produce the standard artifacts for each platform.

- `Ubuntu`
  - `AppImage`
  - `deb`
  - `rpm`
- `Windows`
  - `exe` or `msi`
- `macOS`
  - `.app`
  - `.dmg`

The exact packaging format can vary by Tauri version and runner setup, but the distribution expectations should be treated as the list above.

## GitHub Release 흐름 / GitHub Release Flow

### 한국어

권장 릴리스 흐름은 다음과 같다.

1. `feature/*` 작업이 `dev`로 머지된다.
2. 릴리스 후보가 안정화되면 `dev`에서 릴리스 태그를 만든다.
3. CI/CD가 태그를 감지해 플랫폼별 빌드를 수행한다.
4. 생성된 아티팩트를 GitHub Release의 첨부 파일로 업로드한다.
5. 릴리스 노트에는 변경 요약, 검증 결과, 플랫폼별 주의점을 적는다.

릴리스 태그 예시는 `v0.1.0`, `v0.1.1`처럼 의미 있는 SemVer 형식을 권장한다.

### English

The recommended release flow is:

1. merge `feature/*` work into `dev`
2. once the release candidate is stable, create a release tag from `dev`
3. CI/CD detects the tag and runs platform builds
4. upload generated artifacts as GitHub Release assets
5. include a change summary, verification results, and platform notes in the release notes

Recommended tag examples follow a meaningful SemVer format such as `v0.1.0` or `v0.1.1`.

## CI/CD 설계 원칙 / CI/CD Design Principles

### 한국어

이 저장소의 CI/CD는 아래 원칙을 따른다.

- PR 검증과 릴리스 배포를 분리한다.
- PR에서는 lint, build, cargo check, Playwright E2E를 우선 검증한다.
- 릴리스 단계에서는 가능하면 각 플랫폼 빌드와 산출물 업로드를 수행한다.
- 릴리스 워크플로우는 tag push 또는 manual dispatch를 기준으로 시작한다.
- `GITHUB_TOKEN` 기반 업로드를 기본으로 생각하고, 별도 토큰이 필요할 때만 명시한다.

권장 워크플로우 분리 예시는 다음과 같다.

- `ci.yml`
  - lint, build, cargo check, E2E
- `release.yml`
  - tag push 기반 cross-platform build
  - GitHub Release asset upload

현재 저장소에는 아래 워크플로우가 추가되어 있다.

- [`.github/workflows/ci.yml`](/home/kwon/project/gtum/.github/workflows/ci.yml)
  - PR 및 `dev`/`master` 푸시에서 lint, build, cargo check, Playwright E2E 실행
- [`.github/workflows/release.yml`](/home/kwon/project/gtum/.github/workflows/release.yml)
  - `v*` 태그 push 및 manual dispatch에서 cross-platform Tauri bundle 생성과 GitHub Release 업로드

### English

The repository should follow these CI/CD principles:

- separate PR verification from release publishing
- use lint, build, cargo check, and Playwright E2E for PR validation
- perform per-platform builds and artifact upload during the release stage when possible
- trigger release workflows from tag pushes or manual dispatch
- treat `GITHUB_TOKEN` as the default upload credential and document any additional secret only if it is required

Suggested workflow split:

- `ci.yml`
  - lint, build, cargo check, E2E
- `release.yml`
  - cross-platform builds on tag push
  - GitHub Release asset upload

## 플랫폼 주의점 / Platform Caveats

### 한국어

- `Ubuntu`
  - 현재 로컬 검증의 기준 플랫폼이다.
  - 현재 환경에서는 `AppImage` 번들이 파일시스템 제약으로 실패한 적이 있어, CI에서도 분리해서 확인해야 한다.
- `Windows`
  - `cmd.exe`와 `powershell.exe` 경로 차이를 반영한 셸 처리와 설치형 패키지 산출물을 확인해야 한다.
- `macOS`
  - `.dmg`와 `.app` 산출물, 코드 서명과 notarization 여부를 추후 릴리스 정책으로 분리할 필요가 있다.

### English

- `Ubuntu`
  - current baseline validation platform
  - `AppImage` bundling has previously failed in this environment due to filesystem restrictions, so CI should treat it as a separately verified artifact
- `Windows`
  - shell handling should account for `cmd.exe` and `powershell.exe` differences, and the installable package output should be checked
- `macOS`
  - `.dmg` and `.app` outputs, code signing, and notarization should be handled as separate release policy decisions later

## 운영 메모 / Operational Notes

### 한국어

- 이 문서는 워크플로우 파일 자체를 대체하지 않는다.
- 실제 `.github/workflows`는 이 문서의 정책과 같은 의미를 유지해야 한다.
- 릴리스 관련 판단이 흐려지면 `docs/DOCS_READING_ORDER.md`와 이 문서를 다시 읽는다.

### English

- This document does not replace the actual workflow files.
- The real `.github/workflows` are now present and must match the policy defined here.
- If release decisions feel unclear, reread `docs/DOCS_READING_ORDER.md` and this document.
- The baseline credential required for release automation is `GITHUB_TOKEN`. Consider `TAURI_PRIVATE_KEY` and `TAURI_KEY_PASSWORD` only if code signing or macOS notarization is introduced later.
