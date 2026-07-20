import { expect, test } from '@playwright/test'

import {
  auditProjectCloseSafety,
  projectCloseBlockReasons,
} from '../../src/features/projects/model/projectClosePreflight'
import type { AgentJobSnapshot } from '../../src/shared/api/runtimeAgentJobs'
import type { RuntimeTerminalSnapshot } from '../../src/shared/api/runtimeTerminals'

const projectPath = '/workspace/close-a'

const job = (status: AgentJobSnapshot['status']): AgentJobSnapshot => ({
  jobId: 1,
  sessionId: 'agent-a',
  name: 'close audit',
  command: 'npm test',
  cwd: projectPath,
  runner: 'npm',
  runnerArgs: ['test'],
  processId: status === 'running' ? 42 : null,
  status,
  createdAt: 1,
  updatedAt: 2,
  finishedAt: status === 'running' || status === 'cancelling' ? null : 2,
  cancellationRequestedAt: status === 'cancelling' ? 2 : null,
  exitCode: status === 'completed' ? 0 : null,
  logsComplete: status !== 'running' && status !== 'cancelling',
  logCaptureError: null,
  processError: null,
  persistenceError: null,
  logLineCount: 0,
  maxLogEntries: 100,
  lastEvent: status,
})

const terminal = (status: RuntimeTerminalSnapshot['status']): RuntimeTerminalSnapshot => ({
  projectPath,
  sessionId: 7,
  name: 'terminal',
  cwd: projectPath,
  shell: '/bin/zsh',
  shellArgs: [],
  processId: status === 'running' ? 77 : null,
  status,
  createdAt: 1,
  updatedAt: 2,
  exitCode: status === 'exited' ? 0 : null,
  logLineCount: 0,
  maxLogEntries: 100,
  lastEvent: status,
})

const safeInput = () => ({
  sessions: [],
  workbench: {
    workspace: {
      groups: {
        main: { tabs: [] },
      },
    },
  },
  provisionalTerminalTabIds: new Set<string>(),
  jobs: [] as AgentJobSnapshot[],
  terminals: [] as RuntimeTerminalSnapshot[],
})

test('blocks close for running requests and unresolved permission reviews in any session', () => {
  const requestAudit = auditProjectCloseSafety({
    ...safeInput(),
    sessions: [
      { request: { phase: 'idle' }, messages: [] },
      { request: { phase: 'running' }, messages: [] },
    ],
  })
  expect(requestAudit).toEqual({
    blocked: true,
    reason: projectCloseBlockReasons.agentRequest,
  })

  const permissionAudit = auditProjectCloseSafety({
    ...safeInput(),
    sessions: [{
      request: { phase: 'idle' },
      messages: [{ suggestion: { commands: [{ cmd: 'npm test' }] } }],
    }],
  })
  expect(permissionAudit).toEqual({
    blocked: true,
    reason: projectCloseBlockReasons.permissionReview,
  })
})

test('blocks dirty editors and provisional terminals without treating safe tabs as live', () => {
  const dirtyAudit = auditProjectCloseSafety({
    ...safeInput(),
    workbench: {
      workspace: {
        groups: {
          main: { tabs: [{ id: 'editor-a', type: 'editor', dirty: true }] },
        },
      },
    },
  })
  expect(dirtyAudit.reason).toBe(projectCloseBlockReasons.dirtyEditor)

  const provisionalAudit = auditProjectCloseSafety({
    ...safeInput(),
    workbench: {
      workspace: {
        groups: {
          main: {
            tabs: [{
              id: 'terminal-pending',
              type: 'terminal',
              runtimeBacked: false,
              terminalSessionId: null,
              status: 'running',
            }],
          },
        },
      },
    },
    provisionalTerminalTabIds: new Set(['terminal-pending']),
  })
  expect(provisionalAudit.reason).toBe(projectCloseBlockReasons.terminal)

  expect(auditProjectCloseSafety({
    ...safeInput(),
    workbench: {
      workspace: {
        groups: {
          main: {
            tabs: [{
              id: 'terminal-finished',
              type: 'terminal',
              runtimeBacked: true,
              terminalSessionId: 7,
              runtimeStatus: 'exited',
              status: 'idle',
            }],
          },
        },
      },
    },
  })).toEqual({ blocked: false, reason: null })
})

test('uses authoritative project-wide jobs and terminal sessions to block live work', () => {
  expect(auditProjectCloseSafety({
    ...safeInput(),
    jobs: [job('completed'), job('running')],
  }).reason).toBe(projectCloseBlockReasons.agentJob)

  expect(auditProjectCloseSafety({
    ...safeInput(),
    jobs: [job('cancelling')],
  }).reason).toBe(projectCloseBlockReasons.agentJob)

  expect(auditProjectCloseSafety({
    ...safeInput(),
    terminals: [terminal('running')],
  }).reason).toBe(projectCloseBlockReasons.terminal)

  expect(auditProjectCloseSafety({
    ...safeInput(),
    jobs: [job('completed')],
    terminals: [terminal('exited')],
  })).toEqual({ blocked: false, reason: null })
})
