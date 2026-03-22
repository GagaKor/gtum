# WORKLOG 2026-03-22 - Release Workflow Fix

## 목적 / Purpose

### 한국어

이 문서는 첫 GitHub Release 실행에서 드러난 workflow 오류와 복구 내용을 기록한다.

### English

This document records the workflow error discovered during the first GitHub Release run and the fix applied afterward.

## 문제 원인 / Root Cause

### 한국어

`tauri-apps/tauri-action`은 내부적으로 `npm run tauri build`를 실행한다. 하지만 현재 `package.json`에는 `tauri` 스크립트가 없고 `tauri:dev`, `tauri:build`, `tauri:bundle`만 있었기 때문에 릴리즈 단계가 즉시 실패했다.

### English

`tauri-apps/tauri-action` internally executes `npm run tauri build`. The repository only exposed `tauri:dev`, `tauri:build`, and `tauri:bundle`, so the release step failed immediately because there was no base `tauri` script in `package.json`.

## 적용한 수정 / Applied Fix

### 한국어

- `package.json`에 `tauri: "tauri"` 스크립트를 추가했다.
- 이후 GitHub Release workflow는 같은 저장소 구조에서 `npm run tauri build`를 정상 호출할 수 있다.

### English

- added `tauri: "tauri"` to `package.json`
- the GitHub Release workflow can now call `npm run tauri build` successfully in the current repository layout

## 검증 / Verification

### 한국어

- 로컬에서 `npm run build` 확인
- 로컬에서 `python3`로 workflow YAML 파싱 확인
- 원인 로그는 GitHub Actions release run `23402911624`에서 확인

### English

- verified `npm run build` locally
- verified workflow YAML parsing locally with `python3`
- confirmed the root-cause log from GitHub Actions release run `23402911624`

## 다음 단계 / Next Steps

### 한국어

- fix 브랜치를 `dev`에 머지
- `Release` workflow를 `workflow_dispatch`로 다시 실행하거나 새 태그로 재시도

### English

- merge the fix branch into `dev`
- rerun the `Release` workflow through `workflow_dispatch` or retry with a fresh tag
