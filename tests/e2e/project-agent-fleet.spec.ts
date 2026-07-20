import { expect, test, type Page } from '@playwright/test'

import type { AgentJobSnapshot } from '../../src/shared/api/runtimeAgentJobs'
import {
  createProjectAgentFleetPoller,
  createProjectAgentFleetState,
  mergeProjectAgentFleetJobs,
  normalizeProjectAgentFleetPollInterval,
  pruneProjectAgentFleet,
  summarizeProjectAgentActivity,
} from '../../src/features/agents/model/projectAgentFleet'

const projectA = '/workspace/fleet-a'
const projectB = '/workspace/fleet-b'

const job = (
  projectPath: string,
  status: AgentJobSnapshot['status'],
  updatedAt: number,
): AgentJobSnapshot => ({
  jobId: 7,
  sessionId: `${projectPath}-session`,
  name: `${projectPath} job`,
  command: 'npm test',
  cwd: projectPath,
  runner: 'sh',
  runnerArgs: ['-lc', 'npm test'],
  processId: status === 'running' ? 700 : null,
  status,
  createdAt: 1,
  updatedAt,
  finishedAt: status === 'running' ? null : updatedAt,
  cancellationRequestedAt: null,
  exitCode: status === 'completed' ? 0 : status === 'running' ? null : 1,
  logsComplete: status !== 'running',
  logCaptureError: null,
  processError: null,
  persistenceError: null,
  logLineCount: 1,
  maxLogEntries: 100,
  lastEvent: status,
})

test('keeps equal numeric job ids isolated by full project owner', () => {
  let state = createProjectAgentFleetState()
  state = mergeProjectAgentFleetJobs(state, projectA, [job(projectA, 'running', 2)])
  state = mergeProjectAgentFleetJobs(state, projectB, [job(projectB, 'failed', 3)])
  state = mergeProjectAgentFleetJobs(state, projectA, [job(projectA, 'completed', 4)])
  state = mergeProjectAgentFleetJobs(state, projectA, [job(projectA, 'running', 3)])

  expect(state.projectsByPath[projectA]?.jobs).toHaveLength(1)
  expect(state.projectsByPath[projectA]?.jobs[0]).toMatchObject({
    jobId: 7,
    status: 'completed',
    cwd: projectA,
  })
  expect(state.projectsByPath[projectB]?.jobs).toHaveLength(1)
  expect(state.projectsByPath[projectB]?.jobs[0]).toMatchObject({
    jobId: 7,
    status: 'failed',
    cwd: projectB,
  })
})

test('waits for a delayed fleet list before recursively scheduling the next poll', async () => {
  let calls = 0
  let concurrent = 0
  let maxConcurrent = 0
  const releases: Array<() => void> = []
  const poller = createProjectAgentFleetPoller({
    getProjects: () => [{ path: projectA, runtimeBacked: true }],
    listProjectJobs: async () => {
      calls += 1
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise<void>((resolve) => {
        releases.push(() => {
          concurrent -= 1
          resolve()
        })
      })
      return []
    },
    onSnapshot: () => undefined,
    pollIntervalMs: 1_000,
  })

  poller.start()
  await expect.poll(() => calls).toBe(1)
  poller.wake()
  poller.wake()
  poller.wake()
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(calls).toBe(1)

  releases[0]?.()
  await expect.poll(() => calls, { timeout: 200 }).toBe(2)
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(calls).toBe(2)
  expect(maxConcurrent).toBe(1)

  poller.stop()
  releases[1]?.()
})

test('keeps polling B without overlapping a hung A list call', async () => {
  const calls = new Map([[projectA, 0], [projectB, 0]])
  let releaseA: (() => void) | null = null
  const poller = createProjectAgentFleetPoller({
    getProjects: () => [
      { path: projectA, runtimeBacked: true },
      { path: projectB, runtimeBacked: true },
    ],
    listProjectJobs: async (project) => {
      calls.set(project.path, (calls.get(project.path) ?? 0) + 1)
      if (project.path === projectA) {
        await new Promise<void>((resolve) => {
          releaseA = resolve
        })
      }
      return []
    },
    onSnapshot: () => undefined,
    pollIntervalMs: 10,
  })

  poller.start()
  await expect.poll(() => calls.get(projectB) ?? 0, { timeout: 300 }).toBeGreaterThanOrEqual(2)
  expect(calls.get(projectA)).toBe(1)

  poller.stop()
  releaseA?.()
})

test('bounds each project snapshot and prunes projects outside the open set', () => {
  let state = createProjectAgentFleetState()
  state = mergeProjectAgentFleetJobs(
    state,
    projectA,
    Array.from({ length: 125 }, (_, jobId) => ({
      ...job(projectA, 'completed', jobId + 1),
      jobId,
    })),
  )
  state = mergeProjectAgentFleetJobs(state, projectB, [job(projectB, 'running', 1)])
  state = pruneProjectAgentFleet(state, new Set([projectA]))

  expect(state.projectsByPath[projectA]?.jobs).toHaveLength(100)
  expect(state.projectsByPath[projectB]).toBeUndefined()
})

test('keeps active jobs inside the bounded project snapshot', () => {
  const terminal = Array.from({ length: 100 }, (_, jobId) => ({
    ...job(projectA, 'completed', jobId + 10),
    jobId,
  }))
  const running = { ...job(projectA, 'running', 1), jobId: 500 }
  const state = mergeProjectAgentFleetJobs(
    createProjectAgentFleetState(),
    projectA,
    [...terminal, running],
  )

  expect(state.projectsByPath[projectA]?.jobs).toHaveLength(100)
  expect(state.projectsByPath[projectA]?.jobs).toContainEqual(running)
})

test('clamps zero fleet polling to a non-zero cadence', () => {
  expect(normalizeProjectAgentFleetPollInterval(0)).toBe(1)
  expect(normalizeProjectAgentFleetPollInterval(Number.NaN)).toBe(1_000)
})

test('summarizes local requests and project jobs with actionable precedence and counts', () => {
  const combined = summarizeProjectAgentActivity({
    jobs: [
      { ...job(projectA, 'running', 5), jobId: 1 },
      { ...job(projectA, 'completed', 4), jobId: 2 },
      { ...job(projectA, 'failed', 3), jobId: 3 },
    ],
    localSignals: [{
      runningRequest: true,
      jobCreateInFlight: true,
      pendingPermissionCount: 1,
      failedRequestCount: 1,
      completedRequestCount: 1,
    }],
    detailErrorCount: 1,
  })

  expect(combined).toMatchObject({
    state: 'review',
    label: 'Review',
    workingCount: 3,
    reviewCount: 1,
    attentionCount: 3,
    doneCount: 2,
    jobCount: 3,
  })
  expect(summarizeProjectAgentActivity({
    jobs: [],
    localSignals: [{ pendingPermissionCount: 1 }],
  }).state).toBe('review')
  expect(summarizeProjectAgentActivity({
    jobs: [
      { ...job(projectA, 'running', 2), jobId: 1 },
      { ...job(projectA, 'failed', 1), jobId: 2 },
    ],
    localSignals: [],
  }).state).toBe('attention')
  expect(summarizeProjectAgentActivity({
    jobs: [job(projectA, 'running', 1)],
    localSignals: [],
  }).state).toBe('working')
  expect(summarizeProjectAgentActivity({
    jobs: [job(projectA, 'failed', 1)],
    localSignals: [],
  }).state).toBe('attention')
  expect(summarizeProjectAgentActivity({
    jobs: [job(projectA, 'completed', 1)],
    localSignals: [],
  }).state).toBe('done')
  expect(summarizeProjectAgentActivity({
    jobs: [job(projectA, 'cancelled', 1)],
    localSignals: [],
  }).state).toBe('done')
  expect(summarizeProjectAgentActivity({
    jobs: [],
    localSignals: [],
  }).state).toBe('waiting')
})

const sharedFleetSessionId = 'shared-fleet-session'

const installProjectAgentFleetHarness = async (page: Page) => {
  await page.addInitScript(({ projectA, projectB, sharedFleetSessionId }) => {
    type RuntimeCall = { command: string; args?: Record<string, unknown> }
    type CreateResolver = (snapshot: unknown) => void
    type TestWindow = Window & {
      __fleetAuthCalls: RuntimeCall[]
      __fleetJobCalls: RuntimeCall[]
      __fleetTerminalCalls: RuntimeCall[]
      __resolveFleetCreate(projectPath: string, sessionId: string): void
      __advanceFleetJob(projectPath: string, status: string): void
      __GTUM_AGENT_PROGRESS_STAGE_DELAY_MS__: number
      __GTUM_AGENT_JOB_POLL_INTERVAL_MS__: number
      __GTUM_AGENT_FLEET_POLL_INTERVAL_MS__: number
      __GTUM_WORKSPACE_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
      __GTUM_AGENT_AUTH_RUNTIME__: unknown
      __GTUM_AGENT_RUNTIME__: unknown
      __GTUM_AGENT_JOB_RUNTIME__: unknown
      __GTUM_TERMINAL_RUNTIME__: unknown
    }
    const bridgeWindow = window as TestWindow
    const jobsByProject = new Map<string, Record<string, unknown>>()
    const createResolvers = new Map<string, CreateResolver>()
    let updatedAt = 100
    const contextKey = (projectPath: string, sessionId: string) =>
      `${projectPath}\u0000${sessionId}`
    const workspaceSnapshot = (activeProjectPath: string) => ({
      recentProjects: [projectA, projectB],
      openProjectPaths: [projectA, projectB],
      activeProjectPath,
      lastOpenedProjectPath: activeProjectPath,
      updatedAt: 500,
      storageVersion: 2,
    })
    const connection = {
      provider: 'codex',
      displayName: 'Codex',
      availability: 'available',
      status: 'connected',
      connectionKind: 'real',
      accountLabel: 'Codex ChatGPT Session',
      accountEmail: null,
      requiredScopes: ['project:read', 'terminal:read'],
      expiresAt: null,
      callbackUrl: null,
      authUrl: null,
      activeLoginId: null,
      activeLoginState: null,
      connectedAt: 100,
      lastLoginAttemptAt: 95,
      updatedAt: 120,
      lastError: null,
    }
    const profileSnapshot = {
      registryVersion: 2,
      profiles: [
        {
          provider: 'codex',
          accountId: 'codex-default',
          alias: 'Codex ambient',
          profileKind: { kind: 'ambient' },
          isDefault: true,
          incarnation: '1',
          metadataRevision: '1',
          credentialRevision: '1',
          connection: {
            status: 'connected',
            requiresValidation: false,
            credentialSource: null,
            connectedAt: 100,
            updatedAt: 120,
            lastError: null,
          },
        },
        {
          provider: 'claude',
          accountId: 'claude-default',
          alias: 'Claude ambient',
          profileKind: { kind: 'ambient' },
          isDefault: true,
          incarnation: '2',
          metadataRevision: '1',
          credentialRevision: '1',
          connection: {
            status: 'disconnected',
            requiresValidation: false,
            credentialSource: null,
            connectedAt: null,
            updatedAt: 120,
            lastError: null,
          },
        },
      ],
      tombstones: [],
    }
    const snapshot = (projectPath: string, status = 'running') => {
      updatedAt += 1
      const terminal = status !== 'running' && status !== 'cancelling'
      return {
        jobId: 7,
        sessionId: sharedFleetSessionId,
        name: `${projectPath === projectA ? 'A' : 'B'} fleet job`,
        command: projectPath === projectA ? 'node fleet-a' : 'node fleet-b',
        cwd: projectPath,
        runner: 'node',
        runnerArgs: [projectPath === projectA ? 'fleet-a' : 'fleet-b'],
        processId: terminal ? null : 707,
        status,
        createdAt: 100,
        updatedAt,
        finishedAt: terminal ? updatedAt : null,
        cancellationRequestedAt: status === 'cancelling' ? updatedAt : null,
        exitCode: status === 'completed' ? 0 : terminal ? 1 : null,
        logsComplete: false,
        logCaptureError: null,
        processError: null,
        persistenceError: null,
        logLineCount: 1,
        maxLogEntries: 100,
        lastEvent: status,
      }
    }

    localStorage.setItem('gtum.agent-session-directory.v1', JSON.stringify({
      [projectA]: {
        workspaceTitle: 'fleet-a',
        activeSessionId: sharedFleetSessionId,
        sessions: [{
          id: sharedFleetSessionId,
          title: 'A Agent',
          createdAt: '10:00',
          updatedAt: '10:00',
        }],
      },
      [projectB]: {
        workspaceTitle: 'fleet-b',
        activeSessionId: sharedFleetSessionId,
        sessions: [{
          id: sharedFleetSessionId,
          title: 'B Agent',
          createdAt: '10:00',
          updatedAt: '10:00',
        }],
      },
    }))
    bridgeWindow.__fleetAuthCalls = []
    bridgeWindow.__fleetJobCalls = []
    bridgeWindow.__fleetTerminalCalls = []
    bridgeWindow.__GTUM_AGENT_PROGRESS_STAGE_DELAY_MS__ = 1
    bridgeWindow.__GTUM_AGENT_JOB_POLL_INTERVAL_MS__ = 20
    bridgeWindow.__GTUM_AGENT_FLEET_POLL_INTERVAL_MS__ = 20
    bridgeWindow.__resolveFleetCreate = (projectPath, sessionId) => {
      const resolve = createResolvers.get(contextKey(projectPath, sessionId))
      if (!resolve) throw new Error(`No pending fleet create for ${projectPath}`)
      createResolvers.delete(contextKey(projectPath, sessionId))
      const job = snapshot(projectPath)
      jobsByProject.set(projectPath, job)
      resolve(job)
    }
    bridgeWindow.__advanceFleetJob = (projectPath, status) => {
      if (!jobsByProject.has(projectPath)) {
        throw new Error(`No fleet job for ${projectPath}`)
      }
      jobsByProject.set(projectPath, snapshot(projectPath, status))
    }
    bridgeWindow.__GTUM_WORKSPACE_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        if (command === 'read_workspace_runtime_snapshot') {
          return { snapshot: workspaceSnapshot(projectA), restoredAt: 510 }
        }
        if (command === 'activate_workspace_project') {
          const path = String((args?.request as { path?: string } | undefined)?.path)
          return workspaceSnapshot(path)
        }
        throw new Error(`Unexpected workspace command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (_command: string, args?: Record<string, unknown>) => {
        const path = String(args?.path)
        return {
          metadata: { name: path === projectA ? 'fleet-a' : 'fleet-b', path },
          tree: { name: 'root', path, kind: 'directory', children: [] },
          git: { isRepository: true, branch: 'dev', changedFilesCount: 0 },
        }
      },
    }
    bridgeWindow.__GTUM_AGENT_AUTH_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__fleetAuthCalls.push({ command, args })
        if (command === 'read_agent_profile_snapshot') return profileSnapshot
        if (command === 'list_agent_connections') return [connection]
        if (command === 'authorize_agent_profile_lease') {
          throw new Error('fleet approval must use atomic authorized job creation')
        }
        throw new Error(`Unexpected Agent auth command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_AGENT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        if (command === 'read_agent_account_capabilities') {
          const request = args?.request as {
            provider?: string
            accountId?: string
            incarnation?: string
            credentialRevision?: string
          } | undefined
          if (
            request?.provider !== 'codex'
            || request.accountId !== 'codex-default'
            || request.incarnation !== '1'
            || request.credentialRevision !== '1'
          ) {
            throw new Error(`Fleet capability lease mismatch: ${JSON.stringify(request)}`)
          }
          return {
            provider: 'codex',
            accountId: 'codex-default',
            incarnation: '1',
            credentialRevision: '1',
            supportsModelSelection: false,
            currentModel: { providerId: 'codex', modelId: 'gpt-default', label: 'GPT Default' },
            availableModels: [],
            reasoningLevels: [],
            defaultReasoningLevel: null,
            supportsFastMode: false,
            attachments: [],
          }
        }
        if (command === 'request_agent_account_suggestions') {
          const request = args?.request as {
            provider?: string
            accountId?: string
            incarnation?: string
            credentialRevision?: string
            projectPath?: string
          }
          if (
            request?.provider !== 'codex'
            || request.accountId !== 'codex-default'
            || request.incarnation !== '1'
            || request.credentialRevision !== '1'
          ) {
            throw new Error(`Fleet request lease mismatch: ${JSON.stringify(request)}`)
          }
          const path = String(request?.projectPath)
          return [{
            id: 'same-fleet-suggestion',
            provider: 'codex',
            accountId: 'codex-default',
            incarnation: '1',
            credentialRevision: '1',
            summary: `Run ${path === projectA ? 'A' : 'B'} fleet job`,
            command: path === projectA ? 'node fleet-a' : 'node fleet-b',
            preferredTarget: 'new_tab',
            confidence: 'high',
            error: null,
          }]
        }
        throw new Error(`Unexpected Agent command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_AGENT_JOB_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__fleetJobCalls.push({ command, args })
        if (command === 'create_agent_job') {
          throw new Error('fleet approval must not use legacy generic job creation')
        }
        if (command === 'create_authorized_agent_job') {
          const request = args?.request as {
            provider?: string
            accountId?: string
            incarnation?: string
            credentialRevision?: string
            projectPath?: string
            command?: string
            sessionId?: string
          }
          const path = String(request?.projectPath)
          const sessionId = String(request?.sessionId)
          const expectedCommand = path === projectA
            ? 'node fleet-a'
            : path === projectB
              ? 'node fleet-b'
              : null
          if (
            request?.provider !== 'codex'
            || request.accountId !== 'codex-default'
            || request.incarnation !== '1'
            || request.credentialRevision !== '1'
            || sessionId !== sharedFleetSessionId
            || request.command !== expectedCommand
          ) {
            throw new Error(`Fleet authorized job lease mismatch: ${JSON.stringify(request)}`)
          }
          return new Promise((resolve) => {
            createResolvers.set(contextKey(path, sessionId), resolve)
          })
        }
        if (command === 'list_agent_jobs') {
          const path = String(args?.projectPath)
          const job = jobsByProject.get(path)
          return job ? [{ ...job }] : []
        }
        if (command === 'read_agent_job_logs') {
          const path = String(args?.projectPath)
          const job = jobsByProject.get(path)
          if (!job) throw new Error(`No job logs for ${path}`)
          return {
            jobId: job.jobId,
            status: job.status,
            limit: Number(args?.limit || 100),
            logLineCount: 1,
            truncated: false,
            entries: [{
              sequence: 1,
              stream: 'stdout',
              text: `${path} detailed output`,
              recordedAt: Number(job.updatedAt),
            }],
            updatedAt: job.updatedAt,
            finishedAt: job.finishedAt,
            cancellationRequestedAt: job.cancellationRequestedAt,
            exitCode: job.exitCode,
            logsComplete: true,
            logCaptureError: null,
            processError: null,
            persistenceError: null,
            lastEvent: job.lastEvent,
          }
        }
        throw new Error(`Unexpected Agent job command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_TERMINAL_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__fleetTerminalCalls.push({ command, args })
        throw new Error(`Center terminal must remain untouched: ${command}`)
      },
    }
  }, { projectA, projectB, sharedFleetSessionId })
}

const fleetProjectRow = (page: Page, projectPath: string) =>
  page.locator(`.project-switcher button[data-project-path="${projectPath}"]`)

const fleetJobCalls = (page: Page) => page.evaluate(() => (
  window as Window & {
    __fleetJobCalls?: Array<{ command: string; args?: Record<string, unknown> }>
  }
).__fleetJobCalls ?? [])

const fleetAuthCalls = (page: Page) => page.evaluate(() => (
  window as Window & {
    __fleetAuthCalls?: Array<{ command: string; args?: Record<string, unknown> }>
  }
).__fleetAuthCalls ?? [])

test('keeps an inactive A job observable through fleet lists without reading its logs', async ({ page }) => {
  await installProjectAgentFleetHarness(page)
  await page.goto('/')

  await page.getByPlaceholder('Ask Codex').fill('start A fleet job')
  await page.locator('.composer-input .send').click()
  await page.locator('.composer-approval').getByRole('button', { name: 'Allow once' }).click()
  await expect.poll(() => fleetJobCalls(page).then((calls) => calls.filter(
    (call) => call.command === 'create_authorized_agent_job',
  ).length)).toBe(1)
  const atomicCreate = (await fleetJobCalls(page)).find(
    (call) => call.command === 'create_authorized_agent_job',
  )
  expect(atomicCreate?.args).toEqual({
    request: {
      provider: 'codex',
      accountId: 'codex-default',
      incarnation: '1',
      credentialRevision: '1',
      projectPath: projectA,
      sessionId: sharedFleetSessionId,
      command: 'node fleet-a',
      name: 'agent-same-fleet-suggestion-1',
    },
  })
  expect((await fleetJobCalls(page)).filter(
    (call) => call.command === 'create_agent_job',
  )).toEqual([])
  expect((await fleetAuthCalls(page)).filter(
    (call) => call.command === 'authorize_agent_profile_lease',
  )).toEqual([])

  await fleetProjectRow(page, projectB).click()
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-project-path', projectB)
  await page.evaluate(({ projectPath, sessionId }) => (
    window as Window & {
      __resolveFleetCreate(projectPath: string, sessionId: string): void
    }
  ).__resolveFleetCreate(projectPath, sessionId), {
    projectPath: projectA,
    sessionId: sharedFleetSessionId,
  })

  const rowA = fleetProjectRow(page, projectA)
  const rowB = fleetProjectRow(page, projectB)
  await expect(rowA).toHaveAttribute('data-agent-state', 'working')
  await expect(rowA.locator('.project-agent-summary')).toHaveText('Working')
  await expect(rowA).toHaveAttribute('data-agent-working-count', '1')
  await expect(rowB).toHaveAttribute('data-agent-state', 'waiting')
  await expect(page.locator('.agent-job-row[data-job-id="7"]')).toHaveCount(0)
  expect((await fleetJobCalls(page)).filter((call) =>
    call.command === 'read_agent_job_logs' && call.args?.projectPath === projectA,
  )).toHaveLength(0)

  const fleetListsBefore = (await fleetJobCalls(page)).filter((call) =>
    call.command === 'list_agent_jobs' &&
    call.args?.projectPath === projectA &&
    call.args?.sessionId == null &&
    call.args?.limit === 100,
  ).length
  await page.evaluate((projectPath) => (
    window as Window & { __advanceFleetJob(projectPath: string, status: string): void }
  ).__advanceFleetJob(projectPath, 'completed'), projectA)
  await expect.poll(() => fleetJobCalls(page).then((calls) => calls.filter((call) =>
    call.command === 'list_agent_jobs' &&
    call.args?.projectPath === projectA &&
    call.args?.sessionId == null &&
    call.args?.limit === 100,
  ).length)).toBeGreaterThan(fleetListsBefore)
  await expect(rowA).toHaveAttribute('data-agent-state', 'done')
  await expect(rowA.locator('.project-agent-summary')).toHaveText('Done')
  expect((await fleetJobCalls(page)).filter((call) =>
    call.command === 'read_agent_job_logs' && call.args?.projectPath === projectA,
  )).toHaveLength(0)

  await rowA.click()
  const detailedAJob = page.locator(
    `.agent-job-row[data-job-id="7"][data-owner-project-path="${projectA}"]`,
  )
  await expect(detailedAJob).toHaveAttribute('data-owner-session-id', sharedFleetSessionId)
  await expect(detailedAJob).toHaveAttribute('data-status', 'completed')
  await expect(detailedAJob.locator('.agent-job-log')).toContainText('detailed output')
  await expect.poll(() => fleetJobCalls(page).then((calls) => calls.filter((call) =>
    call.command === 'read_agent_job_logs' && call.args?.projectPath === projectA,
  ).length)).toBeGreaterThan(0)
  expect(await page.evaluate(() => (
    window as Window & { __fleetTerminalCalls?: unknown[] }
  ).__fleetTerminalCalls?.length ?? 0)).toBe(0)
})
