# gtum 작업 로그 템플릿 / Worklog Template

## 문서 목적 / Document Purpose

### 한국어

이 문서는 진행 중 스프린트를 추적할 때 사용하는 임시 `WORKLOG` 템플릿이다.

기본 원칙은 다음과 같다.

- 스프린트 진행 중에는 이 템플릿으로 경로와 문제를 추적할 수 있다.
- 스프린트 종료 시 지속 정보는 source-of-truth 문서에 흡수한다.
- 흡수와 검증 반영이 끝나면 이 `WORKLOG` 파일은 삭제한다.

### English

This document is a temporary `WORKLOG` template for tracking an active sprint.

The default rules are:

- use it while the sprint is active to track path, issues, and interim decisions
- absorb durable knowledge into source-of-truth docs before closing the sprint
- delete the `WORKLOG` file once absorption and validation updates are complete

## 템플릿 / Template

```md
# WORKLOG YYYY-MM-DD - <title>

## 목적 / Purpose

### 한국어

- 이번 작업의 목표

### English

- goal of this work

## 작업 범위 / Scope

### 한국어

- 이번에 실제로 건드린 범위

### English

- what was actually touched in this work

## 수행 내용 / What Was Done

### 한국어

- 완료한 항목

### English

- completed items

## 작업 경로 요약 / Path Recap

### 한국어

- 어떤 순서로 시도했는지
- 승인, 실패, 우회, 재시도 경로

### English

- the order of attempts
- approvals, failures, detours, and retries

## 문제 발견 / Findings

### 한국어

- 반복 문제
- 가시성 부족
- UX 또는 워크플로우 마찰

### English

- recurring problems
- visibility gaps
- UX or workflow friction

## 확인 결과 / Verification

### 한국어

- 실행한 확인 절차
- 확인 결과

### English

- verification steps run
- verification results

## 리스크 / Risks

### 한국어

- 남아 있는 리스크

### English

- remaining risks

## 문서 동기화 / Documentation Sync

### 한국어

- 수정한 문서
- 아직 비동기 상태인 문서가 있으면 기록

### English

- updated documents
- list any documents that remain out of sync

## 다음 작업 / Next Step

### 한국어

- 다음에 바로 이어서 할 일
- 다음 스프린트에서 개선해야 할 항목

### English

- next immediate action
- items that should be improved in the next sprint
```
