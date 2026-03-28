# gtum historical note 템플릿 / Historical Note Template

## 문서 목적 / Document Purpose

### 한국어

이 문서는 기본 스프린트 기록용이 아니라, 예외적인 historical note가 필요할 때만 쓰는 템플릿이다.

기본 원칙은 다음과 같다.

- 일반 스프린트 진행 내용은 `git`과 source-of-truth 문서로 흡수한다.
- 이 템플릿은 실기 장비 검증, 릴리스 사고, 외부 레퍼런스 조사처럼 시간축 기록이 꼭 필요할 때만 사용한다.

### English

This document is not a default sprint log template. It should be used only when an exceptional historical note is needed.

The default rules are:

- ordinary sprint progress should be absorbed into `git` and source-of-truth docs
- use this template only when time-ordered evidence matters, such as real-device validation, release incidents, or external reference analysis

## 템플릿 / Template

```md
# HISTORICAL NOTE YYYY-MM-DD - <title>

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
