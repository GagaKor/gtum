import { expect, test } from '@playwright/test'

import {
  createAgentJobRuntimeService,
  type AgentJobSnapshot,
} from '../../src/shared/api/runtimeAgentJobs'

const runningJob: AgentJobSnapshot = {
  jobId: 7,
  name: 'agent-check',
  command: 'whoami',
  cwd: '/workspace/project',
  runner: 'whoami',
  runnerArgs: [],
  processId: 700,
  status: 'running',
  createdAt: 100,
  updatedAt: 120,
  exitCode: null,
  logLineCount: 1,
  maxLogEntries: 400,
  lastEvent: 'agent job created',
}

test('creates agent-owned jobs without using terminal runtime commands', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const service = createAgentJobRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })

      return runningJob
    },
  })

  const job = await service.createProjectJob(
    { path: '/workspace/project', runtimeBacked: true },
    'whoami',
    'agent-check',
  )

  expect(invoked).toEqual([
    {
      command: 'create_agent_job',
      args: {
        request: {
          projectPath: '/workspace/project',
          command: 'whoami',
          name: 'agent-check',
        },
      },
    },
  ])
  expect(job).toMatchObject({
    jobId: 7,
    status: 'running',
    command: 'whoami',
  })
})

test('keeps agent jobs unavailable until a runtime-backed project is open', async () => {
  let invokedRuntime = false
  const service = createAgentJobRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => {
      invokedRuntime = true
      throw new Error('runtime should not be invoked without a project')
    },
  })

  const job = await service.createProjectJob(
    { path: '', runtimeBacked: false },
    'whoami',
    'agent-check',
  )

  expect(invokedRuntime).toBe(false)
  expect(job.status).toBe('failed')
  expect(job.lastEvent).toContain('open a real project')
})
