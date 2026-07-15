import { expect, test } from '@playwright/test'

import {
  createAgentJobRuntimeService,
  type AgentJobLogs,
  type AgentJobSnapshot,
  type AgentJobStatus,
} from '../../src/shared/api/runtimeAgentJobs'

const lifecycleStatuses = [
  'running',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
] satisfies AgentJobStatus[]

const runningJob: AgentJobSnapshot = {
  jobId: 7,
  sessionId: 'agent-session-1',
  name: 'agent-check',
  command: 'whoami',
  cwd: '/workspace/project',
  runner: 'whoami',
  runnerArgs: [],
  processId: 700,
  status: 'running',
  createdAt: 100,
  updatedAt: 120,
  finishedAt: null,
  cancellationRequestedAt: null,
  exitCode: null,
  logsComplete: false,
  logCaptureError: null,
  processError: null,
  persistenceError: null,
  logLineCount: 2,
  maxLogEntries: 400,
  lastEvent: 'agent job output received',
}

const completedJob: AgentJobSnapshot = {
  ...runningJob,
  jobId: 6,
  processId: null,
  status: 'completed',
  updatedAt: 140,
  finishedAt: 140,
  exitCode: 0,
  logsComplete: true,
  lastEvent: 'agent job completed',
}

const cancellingJob: AgentJobSnapshot = {
  ...runningJob,
  status: 'cancelling',
  updatedAt: 130,
  cancellationRequestedAt: 130,
  lastEvent: 'agent job cancellation requested',
}

const jobLogs: AgentJobLogs = {
  jobId: 7,
  status: 'running',
  limit: 100,
  logLineCount: 2,
  truncated: false,
  entries: [
    {
      sequence: 1,
      stream: 'command',
      text: '$ whoami',
      recordedAt: 100,
    },
    {
      sequence: 2,
      stream: 'stdout',
      text: 'kwon',
      recordedAt: 110,
    },
  ],
  updatedAt: 120,
  finishedAt: null,
  cancellationRequestedAt: null,
  exitCode: null,
  logsComplete: false,
  logCaptureError: null,
  processError: null,
  persistenceError: null,
  lastEvent: 'agent job output received',
}

test('exposes the complete durable agent-job lifecycle vocabulary', () => {
  expect(lifecycleStatuses).toEqual([
    'running',
    'cancelling',
    'completed',
    'failed',
    'cancelled',
    'interrupted',
  ])
})

test('creates, lists, reads, and cancels project jobs with project-scoped runtime payloads', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const service = createAgentJobRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })

      if (command === 'list_agent_jobs') return [runningJob, completedJob]
      if (command === 'read_agent_job_logs') return jobLogs
      if (command === 'cancel_agent_job') return cancellingJob
      return runningJob
    },
  })
  const project = { path: '/workspace/project', runtimeBacked: true }

  const created = await service.createProjectJob(
    project,
    'whoami',
    'agent-check',
    'agent-session-1',
  )
  const listed = await service.listProjectJobs(project, 25, 'agent-session-1')
  const logs = await service.readProjectJobLogs(project, 7)
  const cancelled = await service.cancelProjectJob(project, 7)

  expect(invoked).toEqual([
    {
      command: 'create_agent_job',
      args: {
        request: {
          projectPath: '/workspace/project',
          command: 'whoami',
          name: 'agent-check',
          sessionId: 'agent-session-1',
        },
      },
    },
    {
      command: 'list_agent_jobs',
      args: {
        projectPath: '/workspace/project',
        sessionId: 'agent-session-1',
        limit: 25,
      },
    },
    {
      command: 'read_agent_job_logs',
      args: { projectPath: '/workspace/project', jobId: 7, limit: 100 },
    },
    {
      command: 'cancel_agent_job',
      args: { projectPath: '/workspace/project', jobId: 7 },
    },
  ])
  expect(invoked.every(({ command }) => !command.includes('terminal'))).toBe(true)
  expect(created).toEqual(runningJob)
  expect(listed).toEqual([runningJob, completedJob])
  expect(logs).toEqual(jobLogs)
  expect(cancelled).toEqual(cancellingJob)
})

test('preserves structured log entries and terminal metadata from the runtime', async () => {
  const terminalLogs: AgentJobLogs = {
    ...jobLogs,
    status: 'failed',
    updatedAt: 180,
    finishedAt: 180,
    exitCode: 2,
    logsComplete: true,
    logCaptureError: 'stderr reader stopped early',
    processError: 'process exited with code 2',
    persistenceError: 'last async flush failed',
    lastEvent: 'agent job failed',
    entries: [
      ...jobLogs.entries,
      {
        sequence: 3,
        stream: 'stderr',
        text: 'permission denied',
        recordedAt: 170,
      },
      {
        sequence: 4,
        stream: 'system',
        text: 'agent job failed',
        recordedAt: 180,
      },
    ],
    logLineCount: 4,
  }
  const service = createAgentJobRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => terminalLogs,
  })

  const logs = await service.readProjectJobLogs(
    { path: '/workspace/project', runtimeBacked: true },
    7,
    4,
  )

  expect(logs.entries.map(({ stream, text }) => [stream, text])).toEqual([
    ['command', '$ whoami'],
    ['stdout', 'kwon'],
    ['stderr', 'permission denied'],
    ['system', 'agent job failed'],
  ])
  expect(logs).toMatchObject({
    finishedAt: 180,
    cancellationRequestedAt: null,
    logsComplete: true,
    exitCode: 2,
    lastEvent: 'agent job failed',
    logCaptureError: 'stderr reader stopped early',
    processError: 'process exited with code 2',
    persistenceError: 'last async flush failed',
  })
})

test('keeps project operations unavailable without a runtime-backed project', async () => {
  let invokedRuntime = false
  const service = createAgentJobRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => {
      invokedRuntime = true
      throw new Error('runtime should not be invoked without a project')
    },
  })
  const project = { path: '', runtimeBacked: false }

  const created = await service.createProjectJob(project, 'whoami', 'agent-check')
  const listed = await service.listProjectJobs(project)
  const logs = await service.readProjectJobLogs(project, 7)
  const cancelled = await service.cancelProjectJob(project, 7)

  expect(invokedRuntime).toBe(false)
  expect(created).toMatchObject({
    status: 'failed',
    lastEvent: 'open a real project before running agent jobs',
  })
  expect(listed).toEqual([])
  expect(logs).toMatchObject({
    jobId: 7,
    status: 'failed',
    logsComplete: true,
    lastEvent: 'open a real project before reading agent job logs',
  })
  expect(cancelled).toMatchObject({
    jobId: 7,
    status: 'failed',
    lastEvent: 'open a real project before cancelling agent jobs',
  })
})

test('keeps project operations unavailable when the desktop runtime is disconnected', async () => {
  let invokedRuntime = false
  const service = createAgentJobRuntimeService({
    hasRuntime: () => false,
    invokeRuntime: async () => {
      invokedRuntime = true
      throw new Error('runtime should not be invoked while disconnected')
    },
  })
  const project = { path: '/workspace/project', runtimeBacked: true }

  const created = await service.createProjectJob(project, 'whoami', 'agent-check')
  const listed = await service.listProjectJobs(project, 3)
  const logs = await service.readProjectJobLogs(project, 7, 4)
  const cancelled = await service.cancelProjectJob(project, 7)

  expect(invokedRuntime).toBe(false)
  expect(created.lastEvent).toBe('desktop runtime is not connected')
  expect(listed).toEqual([])
  expect(logs).toMatchObject({
    jobId: 7,
    limit: 4,
    status: 'failed',
    logsComplete: true,
    lastEvent: 'desktop runtime is not connected',
  })
  expect(cancelled).toMatchObject({
    jobId: 7,
    status: 'failed',
    lastEvent: 'desktop runtime is not connected',
  })
})

test('rejects malformed runtime job and log payloads before they reach the UI', async () => {
  const project = { path: '/workspace/project', runtimeBacked: true }
  const malformed = createAgentJobRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command) => {
      if (command === 'list_agent_jobs') return { jobs: [runningJob] }
      if (command === 'read_agent_job_logs') {
        return {
          ...jobLogs,
          status: 'exited',
          entries: ['unstructured output'],
        }
      }
      return { ...runningJob, status: 'unknown' }
    },
  })

  await expect(
    malformed.createProjectJob(project, 'whoami', 'invalid', 'agent-session-1'),
  ).rejects.toThrow(/invalid agent job snapshot/i)
  await expect(
    malformed.listProjectJobs(project, 25, 'agent-session-1'),
  ).rejects.toThrow(/invalid agent job list/i)
  await expect(
    malformed.readProjectJobLogs(project, 7),
  ).rejects.toThrow(/invalid agent job logs/i)
})
