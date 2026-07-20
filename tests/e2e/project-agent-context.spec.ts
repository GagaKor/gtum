import { expect, test, type Page } from '@playwright/test'

import {
  beginAgentRequest,
  completeAgentRequest,
  createAgentContextCoordinator,
  createAgentRequestState,
  projectAgentContextKey,
  stopAgentRequest,
  type AgentContextOwner,
} from '../../src/features/agents/model/projectAgentContext'

const projectA = '/workspace/project-a'
const projectB = '/workspace/project-b'
const sharedSessionId = 'shared-agent-session'
const sameProjectSessionA = 'same-project-session-a'
const sameProjectSessionB = 'same-project-session-b'

const owner = (projectPath: string): AgentContextOwner => ({
  projectPath,
  sessionId: sharedSessionId,
})

test('request generations and stop tokens are isolated by full project and session owner', () => {
  const coordinator = createAgentContextCoordinator()
  const tokenA = coordinator.beginRequest(owner(projectA))
  const tokenB = coordinator.beginRequest(owner(projectB))

  expect(tokenA.contextKey).toBe(`${projectA}\u0000${sharedSessionId}`)
  expect(tokenB.contextKey).toBe(`${projectB}\u0000${sharedSessionId}`)
  expect(coordinator.isRequestCurrent(tokenA)).toBe(true)
  expect(coordinator.isRequestCurrent(tokenB)).toBe(true)
  expect(coordinator.hasRequestInFlight(owner(projectA))).toBe(true)
  expect(coordinator.hasRequestInFlight(owner(projectB))).toBe(true)

  coordinator.stopRequest(owner(projectB))

  expect(coordinator.isRequestCurrent(tokenB)).toBe(false)
  expect(coordinator.isRequestCurrent(tokenA)).toBe(true)
  expect(coordinator.hasRequestInFlight(owner(projectA))).toBe(true)
  expect(coordinator.hasRequestInFlight(owner(projectB))).toBe(false)
})

test('rejects same-context request re-entry until the running lease finishes or stops', () => {
  const coordinator = createAgentContextCoordinator()
  const contextA = owner(projectA)
  const first = coordinator.tryBeginRequest(contextA)

  expect(first).not.toBeNull()
  expect(coordinator.tryBeginRequest(contextA)).toBeNull()
  expect(coordinator.finishRequest(first!)).toBe(true)

  const second = coordinator.tryBeginRequest(contextA)
  expect(second?.generation).toBe(2)
  coordinator.stopRequest(contextA)
  expect(coordinator.tryBeginRequest(contextA)?.generation).toBe(4)
})

test('request state rejects stale completion after a scoped stop', () => {
  const running = beginAgentRequest(createAgentRequestState(), 1, 'turn-a', [
    'activityPreparing',
  ])
  const stopped = stopAgentRequest(running, 2)

  expect(stopped).toMatchObject({
    generation: 2,
    phase: 'stopped',
    turnId: 'turn-a',
    activity: [],
  })
  expect(completeAgentRequest(stopped, 1)).toBe(stopped)
  expect(completeAgentRequest(running, 1)).toMatchObject({
    generation: 1,
    phase: 'idle',
    turnId: null,
    activity: [],
  })
})

test('permission and job-create guards allow duplicate ids across owners but dedupe within one owner', () => {
  const coordinator = createAgentContextCoordinator()
  const contextA = owner(projectA)
  const contextB = owner(projectB)

  expect(projectAgentContextKey(contextA)).not.toBe(projectAgentContextKey(contextB))
  expect(coordinator.beginPermission(contextA, 'duplicate-suggestion')).toBe(true)
  expect(coordinator.beginPermission(contextA, 'duplicate-suggestion')).toBe(false)
  expect(coordinator.beginPermission(contextB, 'duplicate-suggestion')).toBe(true)
  expect(coordinator.hasPermissionInFlight(contextA)).toBe(true)
  expect(coordinator.hasPermissionInFlight(contextB)).toBe(true)

  expect(coordinator.jobCreateGeneration(contextA)).toBe(0)
  expect(coordinator.noteJobCreate(contextA)).toBe(1)
  expect(coordinator.jobCreateGeneration(contextA)).toBe(1)
  expect(coordinator.jobCreateGeneration(contextB)).toBe(0)

  coordinator.finishPermission(contextA, 'duplicate-suggestion')
  expect(coordinator.beginPermission(contextA, 'duplicate-suggestion')).toBe(true)
})

test('holds an exclusive project-close lease against new requests permissions and job creates', () => {
  const coordinator = createAgentContextCoordinator()
  const contextA = owner(projectA)
  const contextB = owner(projectB)

  const closeA = coordinator.tryBeginProjectClose(projectA)
  expect(closeA).not.toBeNull()
  expect(coordinator.isProjectClosing(projectA)).toBe(true)
  expect(coordinator.tryBeginProjectClose(projectA)).toBeNull()
  expect(coordinator.tryBeginRequest(contextA)).toBeNull()
  expect(coordinator.beginPermission(contextA, 'close-race')).toBe(false)
  expect(coordinator.noteJobCreate(contextA)).toBeNull()

  expect(coordinator.tryBeginRequest(contextB)).not.toBeNull()
  expect(coordinator.beginPermission(contextB, 'close-race')).toBe(true)
  expect(coordinator.noteJobCreate(contextB)).toBe(1)

  expect(coordinator.finishProjectClose(closeA!)).toBe(true)
  expect(coordinator.isProjectClosing(projectA)).toBe(false)
  expect(coordinator.tryBeginRequest(contextA)).not.toBeNull()
})

test('refuses a project-close lease while its request or permission work is in flight', () => {
  const coordinator = createAgentContextCoordinator()
  const contextA = owner(projectA)
  const request = coordinator.tryBeginRequest(contextA)

  expect(request).not.toBeNull()
  expect(coordinator.tryBeginProjectClose(projectA)).toBeNull()
  expect(coordinator.finishRequest(request!)).toBe(true)
  expect(coordinator.beginPermission(contextA, 'pending-create')).toBe(true)
  expect(coordinator.tryBeginProjectClose(projectA)).toBeNull()
  coordinator.finishPermission(contextA, 'pending-create')
  expect(coordinator.tryBeginProjectClose(projectA)).not.toBeNull()
})

type SessionFixture = {
  id: string
  title: string
  selectedReasoningLevels?: Partial<Record<'codex' | 'claude', string>>
  fastModes?: Partial<Record<'codex' | 'claude', boolean>>
}
type ProjectAgentHarnessOptions = {
  includeClaude?: boolean
  progressStageDelayMs?: number
}

const installProjectAgentHarness = async (
  page: Page,
  projectASessions: SessionFixture[] = [{ id: sharedSessionId, title: 'A Agent' }],
  activeProjectASessionId = projectASessions[0]?.id ?? sharedSessionId,
  options: ProjectAgentHarnessOptions = {},
) => {
  await page.addInitScript(({
    projectA,
    projectB,
    sharedSessionId,
    projectASessions,
    activeProjectASessionId,
    options,
  }) => {
    type RuntimeCall = { command: string; args?: Record<string, unknown> }
    type SuggestionResolver = (value: unknown[]) => void
    type JobResolver = (value: unknown) => void
    type TestWindow = Window & {
      __agentCalls: RuntimeCall[]
      __agentJobCalls: RuntimeCall[]
      __terminalCalls: RuntimeCall[]
      __attachmentPickStarted: boolean
      __resolveAgentRequest(projectPath: string, sessionId: string, summary: string, command?: string): void
      __resolveAgentJob(projectPath: string, sessionId: string): void
      __resolveAgentAttachment(projectPath: string, sessionId: string, path: string): void
      __delaySessionCloseLists: boolean
      __resolveSessionClose(sessionId: string): void
      __resolveProviderConnect(): void
      __GTUM_AGENT_PROGRESS_STAGE_DELAY_MS__: number
      __GTUM_AGENT_JOB_POLL_INTERVAL_MS__: number
      __GTUM_WORKSPACE_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
      __GTUM_AGENT_AUTH_RUNTIME__: unknown
      __GTUM_AGENT_RUNTIME__: unknown
      __GTUM_AGENT_JOB_RUNTIME__: unknown
      __GTUM_TERMINAL_RUNTIME__: unknown
      __GTUM_AGENT_ATTACHMENT_PICKER__: unknown
    }
    const bridgeWindow = window as TestWindow
    const requestResolvers = new Map<string, SuggestionResolver>()
    const jobResolvers = new Map<string, JobResolver>()
    const attachmentResolvers = new Map<string, (value: string) => void>()
    const sessionCloseResolvers = new Map<string, (value: unknown[]) => void>()
    let providerConnectResolver: ((value: unknown) => void) | null = null
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
    const jobSnapshot = (projectPath: string) => ({
      jobId: projectPath === projectA ? 101 : 202,
      sessionId: sharedSessionId,
      name: projectPath === projectA ? 'A duplicate job' : 'B duplicate job',
      command: projectPath === projectA ? 'node project-a' : 'node project-b',
      cwd: projectPath,
      runner: 'node',
      runnerArgs: [projectPath === projectA ? 'project-a' : 'project-b'],
      processId: 900,
      status: 'running',
      createdAt: 100,
      updatedAt: 101,
      finishedAt: null,
      cancellationRequestedAt: null,
      exitCode: null,
      logsComplete: false,
      logCaptureError: null,
      processError: null,
      persistenceError: null,
      logLineCount: 1,
      maxLogEntries: 100,
      lastEvent: 'running',
    })

    if (!localStorage.getItem('gtum.agent-session-directory.v1')) {
      localStorage.setItem('gtum.agent-session-directory.v1', JSON.stringify({
        [projectA]: {
          workspaceTitle: 'project-a',
          activeSessionId: activeProjectASessionId,
          sessions: projectASessions.map((session) => ({
            ...session,
            createdAt: '10:00',
            updatedAt: '10:00',
          })),
        },
        [projectB]: {
          workspaceTitle: 'project-b',
          activeSessionId: sharedSessionId,
          sessions: [{
            id: sharedSessionId,
            title: 'B Agent',
            createdAt: '10:00',
            updatedAt: '10:00',
          }],
        },
      }))
    }
    bridgeWindow.__agentCalls = []
    bridgeWindow.__agentJobCalls = []
    bridgeWindow.__terminalCalls = []
    bridgeWindow.__attachmentPickStarted = false
    bridgeWindow.__delaySessionCloseLists = false
    bridgeWindow.__GTUM_AGENT_PROGRESS_STAGE_DELAY_MS__ = options.progressStageDelayMs ?? 1
    bridgeWindow.__GTUM_AGENT_JOB_POLL_INTERVAL_MS__ = 10_000
    bridgeWindow.__resolveAgentRequest = (projectPath, sessionId, summary, command = '') => {
      const key = contextKey(projectPath, sessionId)
      const resolve = requestResolvers.get(key)
      if (!resolve) throw new Error(`No pending request for ${key}`)
      requestResolvers.delete(key)
      resolve([{
        id: 'duplicate-suggestion',
        provider: 'codex',
        summary,
        command,
        preferredTarget: 'new_tab',
        confidence: 'high',
        error: null,
      }])
    }
    bridgeWindow.__resolveAgentJob = (projectPath, sessionId) => {
      const key = contextKey(projectPath, sessionId)
      const resolve = jobResolvers.get(key)
      if (!resolve) throw new Error(`No pending job for ${key}`)
      jobResolvers.delete(key)
      resolve(jobSnapshot(projectPath))
    }
    bridgeWindow.__resolveAgentAttachment = (projectPath, sessionId, path) => {
      const key = contextKey(projectPath, sessionId)
      const resolve = attachmentResolvers.get(key)
      if (!resolve) throw new Error(`No pending attachment picker for ${key}`)
      attachmentResolvers.delete(key)
      resolve(path)
    }
    bridgeWindow.__resolveSessionClose = (sessionId) => {
      const resolve = sessionCloseResolvers.get(sessionId)
      if (!resolve) throw new Error(`No pending close for ${sessionId}`)
      sessionCloseResolvers.delete(sessionId)
      resolve([])
    }
    bridgeWindow.__resolveProviderConnect = () => {
      if (!providerConnectResolver) throw new Error('No pending provider connect')
      const resolve = providerConnectResolver
      providerConnectResolver = null
      resolve(connection)
    }
    bridgeWindow.__GTUM_AGENT_ATTACHMENT_PICKER__ = {
      pick: async () => {
        bridgeWindow.__attachmentPickStarted = true
        const panel = document.querySelector<HTMLElement>('.agent')
        const key = contextKey(
          panel?.dataset.agentProjectPath || '',
          panel?.dataset.agentSessionId || '',
        )
        return new Promise<string>((resolve) => {
          attachmentResolvers.set(key, resolve)
        })
      },
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
          metadata: { name: path === projectA ? 'project-a' : 'project-b', path },
          tree: { name: 'root', path, kind: 'directory', children: [] },
          git: { isRepository: true, branch: 'dev', changedFilesCount: 0 },
        }
      },
    }
    bridgeWindow.__GTUM_AGENT_AUTH_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string) => {
        if (command === 'list_agent_connections') {
          return options.includeClaude
            ? [{
                ...connection,
                provider: 'claude',
                displayName: 'Claude',
                accountLabel: null,
                credentialSource: 'claude_cli_session',
                requiredScopes: ['provider:request', 'credential:cli_session'],
              }, connection]
            : [connection]
        }
        if (command === 'disconnect_agent_provider') {
          return {
            ...connection,
            status: 'disconnected',
            accountLabel: null,
            connectedAt: null,
          }
        }
        if (command === 'begin_agent_login') {
          return new Promise((resolve) => {
            providerConnectResolver = resolve
          })
        }
        return connection
      },
    }
    bridgeWindow.__GTUM_AGENT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__agentCalls.push({ command, args })
        if (command === 'read_agent_provider_capabilities') {
          const provider = String(args?.provider || 'codex')
          return {
            provider,
            supportsModelSelection: true,
            currentModel: provider === 'claude'
              ? { providerId: 'claude', modelId: 'claude-default', label: 'Claude Default' }
              : { providerId: 'codex', modelId: 'gpt-default', label: 'GPT Default' },
            availableModels: provider === 'claude'
              ? [{ providerId: 'claude', modelId: 'claude-default', label: 'Claude Default' }]
              : [
                  { providerId: 'codex', modelId: 'gpt-default', label: 'GPT Default' },
                  { providerId: 'codex', modelId: 'gpt-project-a', label: 'GPT Project A' },
                ],
            reasoningLevels: [
              { level: 'low', label: 'Low' },
              { level: 'high', label: 'High' },
            ],
            defaultReasoningLevel: 'high',
            supportsFastMode: true,
            attachments: [{ kind: 'image', label: 'Image', enabled: true, invocationFlag: '--image' }],
          }
        }
        if (command === 'request_agent_suggestions') {
          const request = args?.request as { projectPath?: string; agentSessionId?: string }
          const path = String(request?.projectPath)
          const sessionId = String(request?.agentSessionId || '')
          return new Promise<unknown[]>((resolve) =>
            requestResolvers.set(contextKey(path, sessionId), resolve))
        }
        throw new Error(`Unexpected Agent command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_AGENT_JOB_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__agentJobCalls.push({ command, args })
        if (command === 'list_agent_jobs') {
          if (bridgeWindow.__delaySessionCloseLists && Number(args?.limit) === 100) {
            const sessionId = String(args?.sessionId || '')
            return new Promise<unknown[]>((resolve) => {
              sessionCloseResolvers.set(sessionId, resolve)
            })
          }
          return []
        }
        if (command === 'create_agent_job') {
          const request = args?.request as { projectPath?: string; sessionId?: string }
          const path = String(request?.projectPath)
          const sessionId = String(request?.sessionId)
          return new Promise((resolve) =>
            jobResolvers.set(contextKey(path, sessionId), resolve))
        }
        if (command === 'read_agent_job_logs') {
          throw new Error('No job logs expected while create is pending')
        }
        throw new Error(`Unexpected Agent job command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_TERMINAL_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__terminalCalls.push({ command, args })
        throw new Error(`Center terminal must remain untouched: ${command}`)
      },
    }
  }, {
    projectA,
    projectB,
    sharedSessionId,
    projectASessions,
    activeProjectASessionId,
    options,
  })
}

const projectRow = (page: Page, path: string) =>
  page.locator(`[data-project-path="${path}"]`)

const sendRequest = async (page: Page, text: string) => {
  await page.getByPlaceholder('Ask Codex').fill(text)
  await page.locator('.composer-input .send').click()
}

const setFastMode = async (page: Page, enabled: boolean) => {
  const trigger = page.locator('.fast-toggle')
  const current = await trigger.getAttribute('aria-pressed')
  expect(
    ['true', 'false'],
    'Fast must expose its current boolean through aria-pressed',
  ).toContain(current)

  if ((current === 'true') !== enabled) await trigger.click()

  await expect(trigger).toHaveAttribute('aria-pressed', String(enabled))
  await expect(trigger).toHaveAttribute(
    'aria-label',
    `Fast mode: ${enabled ? 'Enabled' : 'Disabled'}`,
  )
  expect(await trigger.getAttribute('aria-haspopup')).toBeNull()
  expect(await trigger.getAttribute('aria-expanded')).toBeNull()
  await expect(page.getByRole('listbox', { name: 'Fast mode' })).toHaveCount(0)
}

const requestCalls = (page: Page) => page.evaluate(() => (
  window as Window & { __agentCalls?: Array<{ command: string; args?: Record<string, unknown> }> }
).__agentCalls?.filter((call) => call.command === 'request_agent_suggestions') ?? [])

test('keeps concurrent request, stop, draft, progress, and permission state with its project session', async ({ page }) => {
  await installProjectAgentHarness(page)
  await page.goto('/')

  const agentPanel = page.locator('.agent')
  await expect(agentPanel).toHaveAttribute('data-agent-project-path', projectA)
  await expect(agentPanel).toHaveAttribute('data-agent-session-id', sharedSessionId)
  await expect(page.locator('.agent-session-tab.active')).toHaveAttribute('aria-pressed', 'true')

  await page.getByPlaceholder('Ask Codex').fill('A draft survives')
  await projectRow(page, projectB).click()
  await expect(page.getByPlaceholder('Ask Codex')).toHaveValue('')
  await page.getByPlaceholder('Ask Codex').fill('B draft survives')
  await projectRow(page, projectA).click()
  await expect(page.getByPlaceholder('Ask Codex')).toHaveValue('A draft survives')

  await sendRequest(page, 'request A')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  await expect(agentPanel).toHaveAttribute('data-request-state', 'running')

  await projectRow(page, projectB).click()
  await expect(page.getByPlaceholder('Ask Codex')).toHaveValue('B draft survives')
  await sendRequest(page, 'request B')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(2)
  await page.locator('.composer-input .send').click()
  await expect(agentPanel).toHaveAttribute('data-request-state', 'stopped')
  await expect(page.locator('.agent-turn').last()).toContainText('Stopped by user')

  await page.evaluate(({ path, sessionId }) => (
    window as Window & { __resolveAgentRequest(path: string, sessionId: string, summary: string, command?: string): void }
  ).__resolveAgentRequest(path, sessionId, 'discarded B result', 'node project-b'), {
    path: projectB,
    sessionId: sharedSessionId,
  })
  await expect(page.locator('.agent')).not.toContainText('discarded B result')

  await projectRow(page, projectA).click()
  await expect(agentPanel).toHaveAttribute('data-request-state', 'running')
  await expect(page.locator('.composer-input .send')).toHaveClass(/stopping/)
  await page.evaluate(({ path, sessionId }) => (
    window as Window & { __resolveAgentRequest(path: string, sessionId: string, summary: string, command?: string): void }
  ).__resolveAgentRequest(path, sessionId, 'A completion only', 'node project-a'), {
    path: projectA,
    sessionId: sharedSessionId,
  })
  await expect(page.locator('.composer-approval')).toContainText('A completion only')
  await expect(page.locator('.composer-approval')).toHaveAttribute('data-owner-project-path', projectA)
  await expect(page.locator('.composer-approval')).toHaveAttribute('data-owner-session-id', sharedSessionId)
  await expect(agentPanel).toHaveAttribute('data-request-state', 'idle')

  await projectRow(page, projectB).click()
  await expect(agentPanel).toHaveAttribute('data-request-state', 'stopped')
  await expect(page.locator('.composer-approval')).toHaveCount(0)
  await expect(page.locator('.agent')).not.toContainText('A completion only')
})

test('returns a delayed attachment and request options only to their starting project session', async ({ page }) => {
  await installProjectAgentHarness(page)
  await page.goto('/')

  await page.getByPlaceholder('Ask Codex').fill('A private draft')
  await page.locator('.composer-model-chip').click()
  await page.locator('.composer-model-option').filter({ hasText: 'GPT Project A' }).click()
  await page.locator('.composer-reasoning-chip').click()
  const reasoningMenu = page.getByRole('listbox', { name: 'Reasoning levels' })
  await expect(reasoningMenu.locator('[role="option"][aria-selected="true"]')).toHaveText('High')
  await reasoningMenu.getByRole('option', { name: 'Low', exact: true }).click()
  await setFastMode(page, true)
  await page.locator('.composer-tool').click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __attachmentPickStarted?: boolean }
  ).__attachmentPickStarted ?? false)).toBe(true)

  await projectRow(page, projectB).click()
  await expect(page.getByPlaceholder('Ask Codex')).toHaveValue('')
  await expect(page.locator('.composer-attachment-chip')).toHaveCount(0)
  await expect(page.locator('.fast-toggle')).toHaveAttribute('aria-label', 'Fast mode: Disabled')
  await page.evaluate(({ projectPath, sessionId }) => (
    window as Window & { __resolveAgentAttachment(projectPath: string, sessionId: string, path: string): void }
  ).__resolveAgentAttachment(projectPath, sessionId, '/tmp/project-a.png'), {
    projectPath: projectA,
    sessionId: sharedSessionId,
  })
  await expect(page.locator('.composer-attachment-chip')).toHaveCount(0)

  await sendRequest(page, 'request B options')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  const bRequest = (await requestCalls(page))[0]?.args?.request as Record<string, unknown>
  expect(bRequest).toMatchObject({
    projectPath: projectB,
    model: null,
    fastMode: false,
    attachments: [],
  })
  await page.locator('.composer-input .send').click()

  await projectRow(page, projectA).click()
  await expect(page.getByPlaceholder('Ask Codex')).toHaveValue('A private draft')
  await expect(page.locator('.composer-attachment-chip')).toContainText('project-a.png')
  await expect(page.locator('.composer-model-chip'))
    .toHaveAttribute('aria-label', 'Codex model: GPT Project A')
  await expect(page.locator('.composer-reasoning-chip'))
    .toHaveAttribute('aria-label', 'Reasoning level: Low')
  await expect(page.locator('.fast-toggle')).toHaveAttribute('aria-label', 'Fast mode: Enabled')
})

test('request option snapshot keeps the send-time provider model attachments reasoning and Fast owner', async ({ page }) => {
  await installProjectAgentHarness(page, [
    { id: sameProjectSessionA, title: 'Session A' },
    { id: sameProjectSessionB, title: 'Session B' },
  ], sameProjectSessionA, {
    includeClaude: true,
    progressStageDelayMs: 2_000,
  })
  await page.goto('/')

  await page.locator('.composer-model-chip').click()
  await page.locator('.composer-model-option').filter({ hasText: 'GPT Project A' }).click()
  await page.locator('.composer-reasoning-chip').click()
  await page.getByRole('listbox', { name: 'Reasoning levels' })
    .getByRole('option', { name: 'Low', exact: true })
    .click()
  await setFastMode(page, true)
  await page.locator('.composer-tool').click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __attachmentPickStarted?: boolean }
  ).__attachmentPickStarted ?? false)).toBe(true)
  await page.evaluate(({ projectPath, sessionId }) => (
    window as Window & {
      __resolveAgentAttachment(projectPath: string, sessionId: string, path: string): void
    }
  ).__resolveAgentAttachment(projectPath, sessionId, '/tmp/request-snapshot.png'), {
    projectPath: projectA,
    sessionId: sameProjectSessionA,
  })
  await expect(page.locator('.composer-attachment-chip')).toContainText('request-snapshot.png')

  await sendRequest(page, 'capture every send-time option')
  expect(await requestCalls(page)).toHaveLength(0)
  await page.locator('.composer-provider-chip').click()
  await page.getByRole('option', { name: /^Claude/ }).click()
  await page.locator(`.agent-session-tab[data-agent-session-id="${sameProjectSessionB}"]`).click()
  await projectRow(page, projectB).click()
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-project-path', projectB)
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-session-id', sharedSessionId)

  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  const request = (await requestCalls(page))[0]?.args?.request
  expect(request).toEqual(expect.objectContaining({
    provider: 'codex',
    projectPath: projectA,
    agentSessionId: sameProjectSessionA,
    model: 'gpt-project-a',
    attachments: [{
      kind: 'image',
      path: '/tmp/request-snapshot.png',
      label: 'request-snapshot.png',
    }],
    reasoningLevel: 'low',
    fastMode: true,
  }))

  await page.evaluate(({ projectPath, sessionId }) => (
    window as Window & {
      __resolveAgentRequest(projectPath: string, sessionId: string, summary: string): void
    }
  ).__resolveAgentRequest(projectPath, sessionId, 'snapshot request completed'), {
    projectPath: projectA,
    sessionId: sameProjectSessionA,
  })
  await projectRow(page, projectA).click()
  await page.locator(`.agent-session-tab[data-agent-session-id="${sameProjectSessionA}"]`).click()
  await expect(page.locator('.agent')).toContainText('snapshot request completed')
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('dedupes permission decisions per owner and writes delayed job creation only to its origin', async ({ page }) => {
  await installProjectAgentHarness(page)
  await page.goto('/')

  await sendRequest(page, 'approve duplicate A')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  await page.evaluate(({ path, sessionId }) => (
    window as Window & { __resolveAgentRequest(path: string, sessionId: string, summary: string, command?: string): void }
  ).__resolveAgentRequest(path, sessionId, 'duplicate permission A', 'node project-a'), {
    path: projectA,
    sessionId: sharedSessionId,
  })
  const permissionA = page.locator('.composer-approval')
  await expect(permissionA).toHaveAttribute('data-owner-project-path', projectA)
  const centerBeforeA = await page.locator('.workspace-root').innerHTML()
  await permissionA.getByRole('button', { name: 'Allow once' }).evaluate((button) => {
    button.click()
    button.click()
  })

  await projectRow(page, projectB).click()
  await sendRequest(page, 'approve duplicate B')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(2)
  await page.evaluate(({ path, sessionId }) => (
    window as Window & { __resolveAgentRequest(path: string, sessionId: string, summary: string, command?: string): void }
  ).__resolveAgentRequest(path, sessionId, 'duplicate permission B', 'node project-b'), {
    path: projectB,
    sessionId: sharedSessionId,
  })
  const permissionB = page.locator('.composer-approval')
  await expect(permissionB).toHaveAttribute('data-owner-project-path', projectB)
  await permissionB.getByRole('button', { name: 'Allow once' }).evaluate((button) => {
    button.click()
    button.click()
  })

  await expect.poll(() => page.evaluate(() => (
    window as Window & { __agentJobCalls?: Array<{ command: string; args?: Record<string, unknown> }> }
  ).__agentJobCalls?.filter((call) => call.command === 'create_agent_job') ?? [])).toHaveLength(2)

  const creates = await page.evaluate(() => (
    window as Window & { __agentJobCalls?: Array<{ command: string; args?: Record<string, unknown> }> }
  ).__agentJobCalls?.filter((call) => call.command === 'create_agent_job') ?? [])
  expect(creates.map((call) => call.args?.request)).toEqual([
    expect.objectContaining({ projectPath: projectA, sessionId: sharedSessionId }),
    expect.objectContaining({ projectPath: projectB, sessionId: sharedSessionId }),
  ])

  await page.evaluate(({ path, sessionId }) => (
    window as Window & { __resolveAgentJob(path: string, sessionId: string): void }
  ).__resolveAgentJob(path, sessionId), { path: projectB, sessionId: sharedSessionId })
  await expect(page.locator('.agent')).toContainText('agent job #202')
  await page.evaluate(({ path, sessionId }) => (
    window as Window & { __resolveAgentJob(path: string, sessionId: string): void }
  ).__resolveAgentJob(path, sessionId), { path: projectA, sessionId: sharedSessionId })
  await expect(page.locator('.agent')).not.toContainText('agent job #101')

  await projectRow(page, projectA).click()
  await expect(page.locator('.agent')).toContainText('agent job #101')
  expect(await page.locator('.workspace-root').innerHTML()).toBe(centerBeforeA)
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('keeps session selection and close actions as sibling buttons', async ({ page }) => {
  await installProjectAgentHarness(page)
  await page.goto('/')
  await page.locator('.agent-session-new').click()

  await expect(page.locator('.agent-session-tab')).toHaveCount(2)
  await expect(page.locator('.agent-session-tabs')).toHaveAttribute('role', 'group')
  await expect(page.locator('.agent-session-tab.active')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.agent-session-tab[aria-selected]')).toHaveCount(0)
  await expect(page.locator('.agent-session-tab').first()).toHaveAttribute('data-agent-project-path', projectA)
  await expect(page.locator('.ws-item').first()).toHaveAttribute('data-agent-project-path', projectA)
  await expect(page.locator('button [role="button"]')).toHaveCount(0)
  await expect(page.locator('.agent-session-tab .agent-session-close')).toHaveCount(0)
  await expect(page.locator('.ws-item .ws-remove')).toHaveCount(0)
  const close = page.locator('.agent-session-close').first()
  await expect(close).toHaveAttribute('aria-label', /Close .+ agent session/)
  const closeMetrics = await close.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return { width: rect.width, height: rect.height, cursor: style.cursor }
  })
  expect(closeMetrics.width).toBeGreaterThanOrEqual(24)
  expect(closeMetrics.height).toBeGreaterThanOrEqual(24)
  expect(closeMetrics.cursor).toBe('pointer')
})

test('same-project Agent session A/B execution preferences stay isolated across reload', async ({ page }) => {
  await installProjectAgentHarness(page, [
    {
      id: sameProjectSessionA,
      title: 'Session A',
      selectedReasoningLevels: { codex: 'low' },
      fastModes: { codex: false },
    },
    {
      id: sameProjectSessionB,
      title: 'Session B',
      selectedReasoningLevels: { codex: 'high' },
      fastModes: { codex: true },
    },
  ], sameProjectSessionA)
  await page.goto('/')

  const reasoningTrigger = page.locator('.composer-reasoning-chip')
  const fastTrigger = page.locator('.fast-toggle')
  const sessionTab = (sessionId: string) =>
    page.locator(`.agent-session-tab[data-agent-session-id="${sessionId}"]`)
  const expectExecution = async (reasoning: 'Low' | 'High', fast: 'Disabled' | 'Enabled') => {
    await expect(reasoningTrigger).toHaveAttribute('aria-label', `Reasoning level: ${reasoning}`)
    await expect(fastTrigger).toHaveAttribute('aria-label', `Fast mode: ${fast}`)
  }
  const chooseReasoning = async (reasoning: 'Low' | 'High') => {
    await reasoningTrigger.click()
    await page.getByRole('listbox', { name: 'Reasoning levels' })
      .getByRole('option', { name: reasoning, exact: true })
      .click()
  }
  const chooseFast = async (fast: 'Disabled' | 'Enabled') => {
    await setFastMode(page, fast === 'Enabled')
  }
  const storedPreferencesBySession = () => page.evaluate((projectPath) => {
    const directory = JSON.parse(localStorage.getItem('gtum.agent-session-directory.v1') || '{}')
    return Object.fromEntries((directory[projectPath]?.sessions || []).map((session: {
      id: string
      selectedReasoningLevels?: Record<string, unknown>
      fastModes?: Record<string, unknown>
      reasoningLevel?: unknown
      fastMode?: unknown
    }) => [session.id, session]))
  }, projectA)

  await expect(page.locator('.agent')).toHaveAttribute('data-agent-session-id', sameProjectSessionA)
  await expectExecution('Low', 'Disabled')
  await chooseReasoning('High')
  await chooseFast('Enabled')
  await expectExecution('High', 'Enabled')

  await sessionTab(sameProjectSessionB).click()
  await expectExecution('High', 'Enabled')
  await chooseReasoning('Low')
  await chooseFast('Disabled')
  await expectExecution('Low', 'Disabled')

  await sessionTab(sameProjectSessionA).click()
  await expectExecution('High', 'Enabled')
  await sessionTab(sameProjectSessionB).click()
  await expectExecution('Low', 'Disabled')

  await expect.poll(storedPreferencesBySession).toEqual(expect.objectContaining({
    [sameProjectSessionA]: expect.objectContaining({
      selectedReasoningLevels: { codex: 'high' },
      fastModes: { codex: true },
    }),
    [sameProjectSessionB]: expect.objectContaining({
      selectedReasoningLevels: { codex: 'low' },
      fastModes: { codex: false },
    }),
  }))

  await page.reload()
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-session-id', sameProjectSessionB)
  await expectExecution('Low', 'Disabled')
  await sessionTab(sameProjectSessionA).click()
  await expectExecution('High', 'Enabled')
  await sessionTab(sameProjectSessionB).click()
  await expectExecution('Low', 'Disabled')

  const persisted = await storedPreferencesBySession()
  for (const [sessionId, reasoningLevel, fastMode] of [
    [sameProjectSessionA, 'high', true],
    [sameProjectSessionB, 'low', false],
  ] as const) {
    expect(persisted[sessionId]).toEqual(expect.objectContaining({
      selectedReasoningLevels: { codex: reasoningLevel },
      fastModes: { codex: fastMode },
    }))
    expect(persisted[sessionId]).not.toHaveProperty('reasoningLevel')
    expect(persisted[sessionId]).not.toHaveProperty('fastMode')
  }
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('keeps same-project background request and attachment updates in session A while B stays selected', async ({ page }) => {
  await installProjectAgentHarness(page, [
    { id: sameProjectSessionA, title: 'Session A' },
    { id: sameProjectSessionB, title: 'Session B' },
  ], sameProjectSessionA)
  await page.goto('/')

  const composer = page.getByPlaceholder('Ask Codex')
  await composer.fill('first line\nsecond line\nthird line')
  const expandedHeight = await composer.evaluate((element) => element.style.height)
  expect(expandedHeight).toMatch(/px$/)
  await page.locator(`.agent-session-tab[data-agent-session-id="${sameProjectSessionB}"]`).click()
  await page.locator(`.agent-session-tab[data-agent-session-id="${sameProjectSessionA}"]`).click()
  await expect(composer).toHaveValue('first line\nsecond line\nthird line')
  await expect.poll(() => composer.evaluate((element) => element.style.height)).toBe(expandedHeight)

  await sendRequest(page, 'session A request')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  await page.locator('.composer-tool').click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __attachmentPickStarted?: boolean }
  ).__attachmentPickStarted ?? false)).toBe(true)

  const sessionB = page.locator(`.agent-session-tab[data-agent-session-id="${sameProjectSessionB}"]`)
  await sessionB.click()
  await expect(sessionB).toHaveAttribute('aria-pressed', 'true')
  await page.evaluate(({ projectA, sessionId }) => (
    window as Window & {
      __resolveAgentAttachment(projectPath: string, sessionId: string, path: string): void
      __resolveAgentRequest(projectPath: string, sessionId: string, summary: string): void
    }
  ).__resolveAgentAttachment(projectA, sessionId, '/tmp/session-a.png'), {
    projectA,
    sessionId: sameProjectSessionA,
  })
  await page.evaluate(({ projectA, sessionId }) => (
    window as Window & {
      __resolveAgentRequest(projectPath: string, sessionId: string, summary: string): void
    }
  ).__resolveAgentRequest(projectA, sessionId, 'session A background result'), {
    projectA,
    sessionId: sameProjectSessionA,
  })

  await expect(sessionB).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-session-id', sameProjectSessionB)
  await expect(page.locator('.agent')).not.toContainText('session A background result')
  await expect(page.locator('.composer-attachment-chip')).toHaveCount(0)

  await page.locator(`.agent-session-tab[data-agent-session-id="${sameProjectSessionA}"]`).click()
  await expect(page.locator('.agent')).toContainText('session A background result')
  await expect(page.locator('.composer-attachment-chip')).toContainText('session-a.png')
  await expect(page.locator('.agent')).toHaveAttribute('data-request-state', 'idle')
})

test('ignores a delayed callback for a removed session without persisting a nonexistent selection', async ({ page }) => {
  await installProjectAgentHarness(page, [
    { id: sameProjectSessionA, title: 'Session A' },
    { id: sameProjectSessionB, title: 'Session B' },
  ], sameProjectSessionA)
  await page.goto('/')

  await page.locator('.composer-tool').click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __attachmentPickStarted?: boolean }
  ).__attachmentPickStarted ?? false)).toBe(true)
  await page.locator(`.agent-session-tab[data-agent-session-id="${sameProjectSessionB}"]`).click()
  await page.evaluate(() => {
    (window as Window & { __delaySessionCloseLists: boolean }).__delaySessionCloseLists = true
  })
  await page.locator('.agent-session-tab-wrap')
    .filter({ hasText: 'Session A' })
    .getByRole('button', { name: /Close Session A agent session/ })
    .click()
  await expect.poll(() => page.evaluate((sessionId) => (
    window as Window & { __agentJobCalls?: Array<{ command: string; args?: Record<string, unknown> }> }
  ).__agentJobCalls?.some((call) =>
    call.command === 'list_agent_jobs' && call.args?.sessionId === sessionId && call.args?.limit === 100,
  ) ?? false, sameProjectSessionA)).toBe(true)
  await page.evaluate((sessionId) => (
    window as Window & { __resolveSessionClose(sessionId: string): void }
  ).__resolveSessionClose(sessionId), sameProjectSessionA)
  await expect(page.locator('.agent-session-tab')).toHaveCount(1)

  await page.evaluate(({ projectA, sessionId }) => (
    window as Window & {
      __resolveAgentAttachment(projectPath: string, sessionId: string, path: string): void
    }
  ).__resolveAgentAttachment(projectA, sessionId, '/tmp/removed-session.png'), {
    projectA,
    sessionId: sameProjectSessionA,
  })
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-session-id', sameProjectSessionB)
  await expect(page.locator('.composer-attachment-chip')).toHaveCount(0)
  await expect.poll(() => page.evaluate(({ projectA }) => {
    const directory = JSON.parse(localStorage.getItem('gtum.agent-session-directory.v1') || '{}')
    return directory[projectA]?.activeSessionId
  }, { projectA })).toBe(sameProjectSessionB)
})

test('keeps a session open while its provider request is running', async ({ page }) => {
  await installProjectAgentHarness(page, [
    { id: sameProjectSessionA, title: 'Session A' },
    { id: sameProjectSessionB, title: 'Session B' },
  ], sameProjectSessionA)
  await page.goto('/')

  await sendRequest(page, 'keep the running owner')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  await page.locator('.agent-session-tab-wrap')
    .filter({ hasText: 'Session A' })
    .getByRole('button', { name: /Close Session A agent session/ })
    .click()

  await expect(page.locator('.agent-session-tab')).toHaveCount(2)
  await expect(page.locator('.agent')).toContainText(
    'This session has a running provider request. Stop it or wait for it to finish before closing the session.',
  )

  await page.evaluate(({ projectA, sessionId }) => (
    window as Window & {
      __resolveAgentRequest(projectPath: string, sessionId: string, summary: string): void
    }
  ).__resolveAgentRequest(projectA, sessionId, 'running owner completed'), {
    projectA,
    sessionId: sameProjectSessionA,
  })
  await expect(page.locator('.agent')).toContainText('running owner completed')
})

test('returns a delayed provider connection message to its origin project and session', async ({ page }) => {
  await installProjectAgentHarness(page)
  await page.goto('/')

  await projectRow(page, projectB).click()
  await page.locator('.titlebar .pill.icon-only').click()
  const codexRow = page.locator('.settings-provider').filter({ hasText: 'Codex' })
  await codexRow.getByRole('button', { name: 'Disconnect' }).click()
  await codexRow.getByRole('button', { name: 'Connect' }).click()
  await page.locator('.settings-close').click()
  await projectRow(page, projectA).click()

  await page.evaluate(() => (
    window as Window & { __resolveProviderConnect(): void }
  ).__resolveProviderConnect())
  await expect(page.locator('.agent')).not.toContainText('Codex connected through the local CLI session.')

  await projectRow(page, projectB).click()
  await expect(page.locator('.agent')).toContainText('Codex connected through the local CLI session.')
})

test('retains the last session request lease across deterministic concurrent closes', async ({ page }) => {
  await installProjectAgentHarness(page, [
    { id: sameProjectSessionA, title: 'Session A' },
    { id: sameProjectSessionB, title: 'Session B' },
  ], sameProjectSessionB)
  await page.goto('/')

  await sendRequest(page, 'session B survives close race')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  await page.evaluate(() => {
    (window as Window & { __delaySessionCloseLists: boolean }).__delaySessionCloseLists = true
  })
  const closeListsBefore = await page.evaluate(({ sessionA, sessionB }) => {
    const calls = (
      window as Window & { __agentJobCalls?: Array<{ command: string; args?: Record<string, unknown> }> }
    ).__agentJobCalls ?? []
    const countFor = (sessionId: string) => calls.filter((call) =>
      call.command === 'list_agent_jobs' &&
      call.args?.limit === 100 &&
      call.args?.sessionId === sessionId,
    ).length
    return { sessionA: countFor(sessionA), sessionB: countFor(sessionB) }
  }, { sessionA: sameProjectSessionA, sessionB: sameProjectSessionB })
  const closeButtons = page.locator('.agent-session-close')
  await closeButtons.nth(0).click()
  await closeButtons.nth(1).click()
  await expect.poll(() => page.evaluate((sessionId) => (
    window as Window & { __agentJobCalls?: Array<{ command: string; args?: Record<string, unknown> }> }
  ).__agentJobCalls?.filter((call) =>
    call.command === 'list_agent_jobs' &&
    call.args?.limit === 100 &&
    call.args?.sessionId === sessionId,
  ).length ?? 0, sameProjectSessionA)).toBe(closeListsBefore.sessionA + 1)
  expect(await page.evaluate((sessionId) => (
    window as Window & { __agentJobCalls?: Array<{ command: string; args?: Record<string, unknown> }> }
  ).__agentJobCalls?.filter((call) =>
    call.command === 'list_agent_jobs' &&
    call.args?.limit === 100 &&
    call.args?.sessionId === sessionId,
  ).length ?? 0, sameProjectSessionB)).toBe(closeListsBefore.sessionB)

  await page.evaluate((sessionId) => (
    window as Window & { __resolveSessionClose(sessionId: string): void }
  ).__resolveSessionClose(sessionId), sameProjectSessionA)
  await expect(page.locator('.agent-session-tab')).toHaveCount(1)
  await expect(page.locator('.agent-session-tab')).toHaveAttribute('data-agent-session-id', sameProjectSessionB)

  await page.evaluate(({ projectA, sessionId }) => (
    window as Window & {
      __resolveAgentRequest(projectPath: string, sessionId: string, summary: string): void
    }
  ).__resolveAgentRequest(projectA, sessionId, 'retained request completed'), {
    projectA,
    sessionId: sameProjectSessionB,
  })
  await expect(page.locator('.agent')).toContainText('retained request completed')
  await expect(page.locator('.agent')).toHaveAttribute('data-request-state', 'idle')
})

test('rejects rapid same-context double send before React can render the busy state', async ({ page }) => {
  await installProjectAgentHarness(page)
  await page.goto('/')

  await page.getByPlaceholder('Ask Codex').fill('rapid request')
  await page.locator('.composer-input .send').evaluate((button) => {
    button.click()
    button.click()
  })
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  await expect(page.locator('.msg.user').filter({ hasText: 'rapid request' })).toHaveCount(1)
  await expect(page.locator('.agent-turn[data-request-turn-id]')).toHaveCount(1)

  await page.evaluate(({ projectA, sessionId }) => (
    window as Window & {
      __resolveAgentRequest(projectPath: string, sessionId: string, summary: string): void
    }
  ).__resolveAgentRequest(projectA, sessionId, 'single rapid result'), {
    projectA,
    sessionId: sharedSessionId,
  })
  await expect(page.locator('.agent')).toContainText('single rapid result')
  await expect(page.locator('.agent')).toHaveAttribute('data-request-state', 'idle')
})

test('keeps fast B and late successful A results in their project owners without stopping either', async ({ page }) => {
  await installProjectAgentHarness(page)
  await page.goto('/')

  await sendRequest(page, 'successful request A')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  await projectRow(page, projectB).click()
  await sendRequest(page, 'successful request B')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(2)
  await page.evaluate(({ projectB, sessionId }) => (
    window as Window & {
      __resolveAgentRequest(projectPath: string, sessionId: string, summary: string): void
    }
  ).__resolveAgentRequest(projectB, sessionId, 'fast B result'), {
    projectB,
    sessionId: sharedSessionId,
  })
  await expect(page.locator('.agent')).toContainText('fast B result')

  await page.evaluate(({ projectA, sessionId }) => (
    window as Window & {
      __resolveAgentRequest(projectPath: string, sessionId: string, summary: string): void
    }
  ).__resolveAgentRequest(projectA, sessionId, 'late A result'), {
    projectA,
    sessionId: sharedSessionId,
  })
  await expect(projectRow(page, projectB)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.agent')).not.toContainText('late A result')
  await projectRow(page, projectA).click()
  await expect(page.locator('.agent')).toContainText('late A result')
})

test('keeps an old numbered choice retryable when a running request lease rejects it', async ({ page }) => {
  await installProjectAgentHarness(page)
  await page.goto('/')

  await sendRequest(page, 'create a numbered choice')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  await page.evaluate(({ projectPath, sessionId }) => (
    window as Window & {
      __resolveAgentRequest(projectPath: string, sessionId: string, summary: string): void
    }
  ).__resolveAgentRequest(
    projectPath,
    sessionId,
    'Choose how to continue. 1. Keep waiting 2. Retry after the current request',
  ), { projectPath: projectA, sessionId: sharedSessionId })

  const choiceCard = page.locator('.agent-event-card.choice')
  const retryChoice = choiceCard.getByRole('button', {
    name: /2 Retry after the current request/,
  })
  await expect(retryChoice).toBeEnabled()

  await sendRequest(page, 'hold the request lease')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(2)
  await retryChoice.click()

  await expect(choiceCard).not.toContainText('Selected')
  await expect(retryChoice).toBeEnabled()
  await expect(page.locator('.msg.user').filter({
    hasText: '2. Retry after the current request',
  })).toHaveCount(0)
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(2)

  await page.locator('.composer-input .send').click()
  await expect(page.locator('.agent')).toHaveAttribute('data-request-state', 'stopped')
  await retryChoice.click()

  await expect(choiceCard).toContainText('Selected')
  await expect(page.locator('.msg.user').filter({
    hasText: '2. Retry after the current request',
  })).toHaveCount(1)
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(3)

  await page.evaluate(({ projectPath, sessionId }) => (
    window as Window & {
      __resolveAgentRequest(projectPath: string, sessionId: string, summary: string): void
    }
  ).__resolveAgentRequest(projectPath, sessionId, 'choice retry accepted'), {
    projectPath: projectA,
    sessionId: sharedSessionId,
  })
  await expect(page.locator('.agent')).toContainText('choice retry accepted')
  await expect(page.locator('.agent')).toHaveAttribute('data-request-state', 'idle')
})
