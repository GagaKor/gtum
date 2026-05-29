# gtum

`gtum`은 프로젝트 중심의 멀티 탭 터미널과 에이전트 워크플로우를 하나의 데스크톱 앱 안에서 다루기 위한 Tauri 기반 워크스페이스입니다.
`cmux`의 멀티 터미널 감각과 `conductor`의 에이전트 오케스트레이션 감각을 함께 가져오되, 특히 현재 테스트 중인 터미널 로그를 에이전트 맥락으로 바로 연결하는 흐름에 초점을 둡니다.
기본 개발 운영 모델은 `orchestrator`, `frontend`, `backend`, `tester`로 역할을 나눠 병렬 작업 후 통합하는 방식입니다.

`gtum` is a Tauri-based desktop workspace for managing project-centric multi-tab terminal workflows and agent workflows in one application.
It aims to combine the multi-terminal feel of `cmux` with the orchestration feel of `conductor`, with a strong focus on turning live terminal logs into immediate agent context.
The default development operating model splits work into `orchestrator`, `frontend`, `backend`, and `tester` roles for parallel delivery and controlled integration.

## 주요 기능 / Core Capabilities

- 로컬 프로젝트 열기
- 파일 트리와 Git 상태 확인
- 멀티 탭 터미널 세션 생성 및 로그 캡처
- `Codex` / `Claude` 로그인 기반 provider 흐름
- 승인 기반 agent suggestion 실행
- 작업 이력, 워크스페이스 복원, 실행 모드
- Post-MVP Telegram 브리지 프로토타입

- open local projects
- inspect the file tree and Git state
- create multi-tab terminal sessions and capture logs
- use login-based provider flows for `Codex` and `Claude`
- execute agent suggestions with explicit approval
- use task history, workspace restore, and execution modes
- explore the post-MVP Telegram bridge prototype

## 기술 스택 / Tech Stack

- `Tauri`
- `Rust`
- `React`
- `TypeScript`
- `Vite`
- `Zustand`
- `Playwright`

## 실행 방법 / Run Locally

### 1. 의존성 설치 / Install dependencies

```bash
npm ci
```

### 2. 프론트엔드 빌드 확인 / Verify frontend build

```bash
npm run build
```

### 3. 개발 모드로 실행 / Run in development mode

```bash
npm run tauri:dev
```

이 명령은 내부적으로 Vite 개발 서버와 Tauri 런타임을 함께 실행합니다.
This command starts both the Vite dev server and the Tauri runtime.

## 검증 명령 / Validation Commands

```bash
npm run lint
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run test:e2e
```

## Production Builds

```bash
npm run tauri:build
npm run tauri:bundle
```

- `npm run tauri:build`
  - validates the native Tauri build path without creating installers
- `npm run tauri:bundle`
  - creates platform-specific installable artifacts

macOS install support is currently explicit at the artifact level:

- CI runs a macOS `tauri build --no-bundle` smoke job.
- The Release workflow builds on `macos-latest` and fails if both `.app` and `.dmg` artifacts are not produced.
- macOS signing and notarization are not implemented yet, so generated macOS artifacts should be treated as unsigned builds.

Local Tauri builds require a Rust toolchain with `cargo` available on `PATH`; CI installs Rust before running native build steps.

The current release policy is to build and publish automatically to GitHub Releases when changes are merged into `master`.

## 문서 / Documentation

상세 기획, 기술 설계, 스프린트, 릴리즈 정책은 아래 문서를 기준으로 합니다.

- [문서 인덱스 / Docs Index](./docs/README.md)
- [프론트엔드 디자인 벤치마크 / Frontend Design Benchmarks](./docs/frontend-design-benchmarks.md)
- [에이전트 팀 토폴로지 / Agent Team Topology](./docs/agent-team-topology.md)
- [제품 기획서 / Product Plan](./docs/product-plan.md)
- [기술 설계서 / Technical Design](./docs/technical-design.md)
- [릴리스, 빌드, CI / Release, Build, and CI](./docs/release-build-ci.md)
- [에이전트 운영 가이드 / Agent Operating Guide](./AGENTS.md)
