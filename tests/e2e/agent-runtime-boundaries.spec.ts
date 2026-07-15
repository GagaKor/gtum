import { expect, test, type Page } from '@playwright/test'

type HarnessMode =
  | 'delayed-create'
  | 'running-session'
  | 'stale-hydration'
  | 'active-retention'
  | 'close-during-create'
  | 'close-before-create'
  | 'late-cancel'
  | 'log-error'
  | 'no-auth'
  | 'expired-auth'

const installHarness = async (
  page: Page,
  mode: HarnessMode,
  authFailureMessage = 'Codex CLI session expired. Run codex login, then reconnect.',
) => {
  await page.addInitScript(({ selectedMode, authFailureMessage }: {
    selectedMode: HarnessMode
    authFailureMessage: string
  }) => {
    type JobStatus = 'running' | 'cancelling' | 'completed' | 'cancelled'
    const projectPath = '/workspace/agent-boundaries'
    let activeSessionId = ''
    let jobStatus: JobStatus = 'running'
    let authRejected = false
    let createResolver: ((value: unknown) => void) | null = null
    let hydrationResolver: ((value: unknown[]) => void) | null = null
    let cancelResolver: ((value: unknown) => void) | null = null
    let closeListResolver: ((value: unknown[]) => void) | null = null
    let delayNextList = false
    const createdSessionIds: string[] = []

    const bridgeWindow = window as Window & {
      __agentJobCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __agentSuggestionCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __terminalCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __resolveBoundaryCreate: () => void
      __resolveBoundaryHydration: () => void
      __resolveBoundaryCancel: () => void
      __delayNextBoundaryList: () => void
      __resolveBoundaryList: () => void
      __GTUM_AGENT_PROGRESS_STAGE_DELAY_MS__: number
      __GTUM_AGENT_JOB_POLL_INTERVAL_MS__: number
      __GTUM_AGENT_AUTH_RUNTIME__?: unknown
      __GTUM_AGENT_JOB_RUNTIME__: unknown
      __GTUM_AGENT_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
      __GTUM_TERMINAL_RUNTIME__: unknown
      __GTUM_WORKSPACE_RUNTIME__: unknown
    }

    const snapshot = (status: JobStatus, updatedAt = 100) => {
      const terminal = status === 'completed' || status === 'cancelled'
      return {
      jobId: 501,
      sessionId: createdSessionIds[0] || activeSessionId,
      name: 'agent-boundary-1',
      command: 'node boundary-job',
      cwd: projectPath,
      runner: 'node',
      runnerArgs: ['boundary-job'],
      processId: terminal ? null : 9_501,
      status,
      createdAt: 90,
      updatedAt,
      finishedAt: terminal ? updatedAt : null,
      cancellationRequestedAt:
        status === 'cancelling' || status === 'cancelled' ? updatedAt : null,
      exitCode: status === 'completed' ? 0 : null,
      logsComplete: terminal,
      logCaptureError: null,
      processError: null,
      persistenceError: null,
      logLineCount: terminal ? 2 : 1,
      maxLogEntries: 400,
      lastEvent:
        status === 'completed'
          ? 'agent job completed'
          : status === 'cancelled'
            ? 'agent job cancelled'
            : status === 'cancelling'
            ? 'agent job cancellation requested'
            : 'agent job created',
      }
    }

    const connectedCodex = {
      provider: 'codex',
      displayName: 'Codex',
      availability: 'available',
      status: 'connected',
      connectionKind: 'real',
      accountLabel: 'Codex CLI',
      accountEmail: null,
      requiredScopes: ['project:read', 'terminal:read'],
      expiresAt: null,
      callbackUrl: null,
      authUrl: null,
      activeLoginId: null,
      activeLoginState: null,
      connectedAt: 1,
      lastLoginAttemptAt: 1,
      updatedAt: 1,
      lastError: null,
    }

    bridgeWindow.__agentJobCalls = []
    bridgeWindow.__agentSuggestionCalls = []
    bridgeWindow.__terminalCalls = []
    bridgeWindow.__GTUM_AGENT_PROGRESS_STAGE_DELAY_MS__ = 0
    bridgeWindow.__GTUM_AGENT_JOB_POLL_INTERVAL_MS__ =
      selectedMode === 'stale-hydration' ? 10_000 : 25
    bridgeWindow.__resolveBoundaryCreate = () => {
      createResolver?.(snapshot('running'))
      createResolver = null
    }
    bridgeWindow.__resolveBoundaryHydration = () => {
      hydrationResolver?.([snapshot('running', 101)])
      hydrationResolver = null
    }
    bridgeWindow.__resolveBoundaryCancel = () => {
      cancelResolver?.(snapshot('cancelling', 101))
      cancelResolver = null
    }
    bridgeWindow.__delayNextBoundaryList = () => {
      delayNextList = true
    }
    bridgeWindow.__resolveBoundaryList = () => {
      closeListResolver?.([])
      closeListResolver = null
    }

    bridgeWindow.__GTUM_WORKSPACE_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string) => {
        if (command === 'read_workspace_runtime_snapshot') {
          return {
            storagePath: '/tmp/agent-boundaries.json',
            restoredAt: 1,
            snapshot: {
              recentProjects: [projectPath],
              lastOpenedProjectPath: projectPath,
              updatedAt: 1,
              storageVersion: 1,
            },
          }
        }
        return null
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async () => ({
        metadata: { name: 'agent-boundaries', path: projectPath },
        tree: {
          name: 'agent-boundaries',
          path: projectPath,
          kind: 'directory',
          children: [],
        },
        git: {
          isRepository: true,
          branch: 'dev',
          branchType: 'development',
          changedFilesCount: 0,
        },
      }),
    }

    if (selectedMode !== 'no-auth') {
      bridgeWindow.__GTUM_AGENT_AUTH_RUNTIME__ = {
        hasRuntime: () => true,
        invokeRuntime: async (command: string) => {
          if (command === 'list_agent_connections') {
            return authRejected
              ? [
                  {
                    ...connectedCodex,
                    status: 'error',
                    accountLabel: null,
                    connectedAt: null,
                    updatedAt: 2,
                    lastError: authFailureMessage,
                  },
                ]
              : [connectedCodex]
          }
          return connectedCodex
        },
      }
    }

    bridgeWindow.__GTUM_AGENT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__agentSuggestionCalls.push({ command, args })
        if (command === 'read_agent_provider_capabilities') {
          return {
            provider: 'codex',
            supportsModelSelection: false,
            currentModel: null,
            availableModels: [],
            reasoningLevels: [],
            defaultReasoningLevel: null,
            supportsFastMode: false,
            attachments: [],
          }
        }
        if (command === 'request_agent_suggestions') {
          if (selectedMode === 'expired-auth') {
            authRejected = true
            throw new Error(authFailureMessage)
          }
          return [
            {
              id: 'boundary',
              provider: 'codex',
              summary: 'Run the boundary command',
              command: 'node boundary-job',
              preferredTarget: 'current_tab',
              confidence: 'low',
              error: null,
            },
          ]
        }
        return []
      },
    }
    bridgeWindow.__GTUM_AGENT_JOB_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__agentJobCalls.push({ command, args })
        if (command === 'list_agent_jobs') {
          const requestedSessionId = String(args?.sessionId || '')
          if (!activeSessionId) activeSessionId = requestedSessionId
          if (selectedMode === 'close-before-create' && delayNextList) {
            delayNextList = false
            return new Promise<unknown[]>((resolve) => {
              closeListResolver = resolve
            })
          }
          if (selectedMode === 'active-retention') {
            const terminalHistory = Array.from({ length: 25 }, (_, index) => ({
              ...snapshot('completed', 200 + index),
              jobId: 600 + index,
              name: `terminal-history-${index}`,
              command: `node history-${index}`,
              runnerArgs: [`history-${index}`],
            }))
            return [...terminalHistory, snapshot('running', 100)]
              .sort((left, right) => right.updatedAt - left.updatedAt)
              .slice(0, Number(args?.limit || 25))
          }
          if (selectedMode === 'stale-hydration' && requestedSessionId === activeSessionId) {
            return new Promise<unknown[]>((resolve) => {
              hydrationResolver = resolve
            })
          }
          if (
            selectedMode === 'running-session' &&
            createdSessionIds.includes(requestedSessionId)
          ) {
            return [snapshot(jobStatus)]
          }
          return []
        }
        if (command === 'create_agent_job') {
          const request = args?.request as { sessionId?: string } | undefined
          createdSessionIds.push(String(request?.sessionId || activeSessionId))
          if (
            selectedMode === 'delayed-create' ||
            selectedMode === 'close-during-create' ||
            selectedMode === 'close-before-create'
          ) {
            return new Promise((resolve) => {
              createResolver = resolve
            })
          }
          return snapshot('running')
        }
        if (command === 'cancel_agent_job') {
          if (selectedMode === 'late-cancel') {
            jobStatus = 'cancelled'
            return new Promise((resolve) => {
              cancelResolver = resolve
            })
          }
          jobStatus = 'cancelling'
          return snapshot('cancelling', 101)
        }
        if (command === 'read_agent_job_logs') {
          if (selectedMode === 'log-error') {
            throw new Error('structured log read unavailable')
          }
          return {
            jobId: 501,
            status: jobStatus,
            limit: 100,
            logLineCount: 1,
            truncated: false,
            entries: [
              {
                sequence: 1,
                stream: 'command',
                text: 'node boundary-job',
                recordedAt: 90,
              },
            ],
            updatedAt: jobStatus === 'cancelled' ? 102 : jobStatus === 'cancelling' ? 101 : 100,
            finishedAt: jobStatus === 'cancelled' ? 102 : null,
            cancellationRequestedAt:
              jobStatus === 'cancelled' ? 101 : jobStatus === 'cancelling' ? 101 : null,
            exitCode: null,
            logsComplete: jobStatus === 'cancelled',
            logCaptureError: null,
            processError: null,
            persistenceError: null,
            lastEvent:
              jobStatus === 'cancelled'
                ? 'agent job cancelled'
                : jobStatus === 'cancelling'
                ? 'agent job cancellation requested'
                : 'agent job created',
          }
        }
        throw new Error(`unexpected agent job command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_TERMINAL_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__terminalCalls.push({ command, args })
        throw new Error('agent boundary tests must not use terminal commands')
      },
    }
  }, { selectedMode: mode, authFailureMessage })
}

const openHarness = async (page: Page) => {
  await page.goto('/')
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __GTUM_BACKEND_BRIDGE__?: { projectPath: string }
            }
          ).__GTUM_BACKEND_BRIDGE__?.projectPath ?? '',
      ),
    )
    .toBe('/workspace/agent-boundaries')
}

test('creates one isolated job when Allow once is clicked twice during IPC', async ({ page }) => {
  await installHarness(page, 'delayed-create')
  await openHarness(page)

  await page.getByPlaceholder('Ask Codex').fill('run once')
  await page.locator('.composer-input .send').click()
  const permission = page.locator('.composer-approval')
  await expect(permission).toContainText('isolated Agent job')
  await permission.getByRole('button', { name: 'Allow once' }).evaluate((button) => {
    ;(button as HTMLButtonElement).click()
    ;(button as HTMLButtonElement).click()
  })

  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & { __agentJobCalls: Array<{ command: string }> }
          ).__agentJobCalls.filter((call) => call.command === 'create_agent_job').length,
      ),
    )
    .toBe(1)
  await page.evaluate(() =>
    (
      window as Window & { __resolveBoundaryCreate: () => void }
    ).__resolveBoundaryCreate(),
  )
  await expect(page.locator('.composer-approval')).toHaveCount(0)
  expect(
    await page.evaluate(
      () =>
        (
          window as Window & { __terminalCalls: Array<{ command: string }> }
        ).__terminalCalls,
    ),
  ).toEqual([])
})

test('keeps a session while its approved job create call is in flight', async ({ page }) => {
  await installHarness(page, 'close-during-create')
  await openHarness(page)

  await page.getByPlaceholder('Ask Codex').fill('start a delayed job')
  await page.locator('.composer-input .send').click()
  await page.locator('.composer-approval').getByRole('button', { name: 'Allow once' }).click()

  const project = page.locator('.project-group').filter({ hasText: 'agent-boundaries' })
  await project.locator('.project-workspace-new').click()
  await expect(project.locator('.ws-item')).toHaveCount(2)
  await project.locator('.ws-remove').first().click()

  await expect(project.locator('.ws-item')).toHaveCount(2)
  await expect(project.locator('.ws-item').last()).toHaveClass(/active/)
  await project.locator('.ws-item').first().click()
  await expect(page.locator('.msg.assistant').last()).toContainText(/starting an Agent job/i)
  await page.evaluate(() =>
    (
      window as Window & { __resolveBoundaryCreate: () => void }
    ).__resolveBoundaryCreate(),
  )
})

test('keeps a session when job creation starts during its close check', async ({ page }) => {
  await installHarness(page, 'close-before-create')
  await openHarness(page)

  const project = page.locator('.project-group').filter({ hasText: 'agent-boundaries' })
  await project.locator('.project-workspace-new').click()
  await expect(project.locator('.ws-item')).toHaveCount(2)

  await page.getByPlaceholder('Ask Codex').fill('start while close is checking')
  await page.locator('.composer-input .send').click()
  const permission = page.locator('.composer-approval')
  await expect(permission).toContainText('isolated Agent job')

  await page.evaluate(() =>
    (
      window as Window & { __delayNextBoundaryList: () => void }
    ).__delayNextBoundaryList(),
  )
  await project.locator('.ws-remove').last().click()
  await permission.getByRole('button', { name: 'Allow once' }).click()
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & { __agentJobCalls: Array<{ command: string }> }
          ).__agentJobCalls.filter((call) => call.command === 'create_agent_job').length,
      ),
    )
    .toBe(1)

  await page.evaluate(() =>
    (
      window as Window & { __resolveBoundaryCreate: () => void }
    ).__resolveBoundaryCreate(),
  )
  await expect(permission).toHaveCount(0)
  await expect(page.locator('.agent-job-row[data-job-id="501"]')).toHaveAttribute(
    'data-status',
    'running',
  )

  await page.evaluate(() =>
    (
      window as Window & { __resolveBoundaryList: () => void }
    ).__resolveBoundaryList(),
  )
  await expect(project.locator('.ws-item')).toHaveCount(2)
  await expect(page.locator('.msg.assistant').last()).toContainText(/starting an Agent job/i)
})

test('keeps a session with a running job observable when close is requested', async ({ page }) => {
  await installHarness(page, 'running-session')
  await openHarness(page)

  await page.getByPlaceholder('Ask Codex').fill('keep this job observable')
  await page.locator('.composer-input .send').click()
  await page.locator('.composer-approval').getByRole('button', { name: 'Allow once' }).click()
  await expect(page.locator('.agent-job-row[data-job-id="501"]')).toHaveAttribute(
    'data-status',
    'running',
  )

  const project = page.locator('.project-group').filter({ hasText: 'agent-boundaries' })
  await project.locator('.project-workspace-new').click()
  await expect(project.locator('.ws-item')).toHaveCount(2)
  await project.locator('.ws-remove').first().click()

  await expect(project.locator('.ws-item')).toHaveCount(2)
  await expect(project.locator('.ws-item').last()).toHaveClass(/active/)
  await project.locator('.ws-item').first().click()
  await expect(page.locator('.msg.assistant').last()).toContainText(/running Agent job/i)
})

test('does not let equal-timestamp stale hydration regress cancellation', async ({ page }) => {
  await installHarness(page, 'stale-hydration')
  await openHarness(page)

  await page.getByPlaceholder('Ask Codex').fill('cancel this boundary job')
  await page.locator('.composer-input .send').click()
  await page.locator('.composer-approval').getByRole('button', { name: 'Allow once' }).click()
  const row = page.locator('.agent-job-row[data-job-id="501"]')
  await row.getByRole('button', { name: 'Cancel' }).click()
  await expect(row).toHaveAttribute('data-status', 'cancelling')

  await page.evaluate(() =>
    (
      window as Window & { __resolveBoundaryHydration: () => void }
    ).__resolveBoundaryHydration(),
  )
  await page.waitForTimeout(50)
  await expect(row).toHaveAttribute('data-status', 'cancelling')
})

test('keeps an older running job visible when terminal history reaches the limit', async ({ page }) => {
  await installHarness(page, 'active-retention')
  await openHarness(page)

  const running = page.locator('.agent-job-row[data-job-id="501"]')
  await expect(running).toHaveAttribute('data-status', 'running')
  await expect(running.getByRole('button', { name: 'Cancel' })).toBeVisible()
  await expect(page.locator('.agent-job-row')).toHaveCount(25)
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __agentJobCalls: Array<{
                command: string
                args?: Record<string, unknown>
              }>
            }
          ).__agentJobCalls.find((call) => call.command === 'list_agent_jobs')?.args?.limit,
      ),
    )
    .toBe(100)
})

test('does not let a late cancel response regress a terminal state', async ({ page }) => {
  await installHarness(page, 'late-cancel')
  await openHarness(page)

  await page.getByPlaceholder('Ask Codex').fill('cancel with a delayed response')
  await page.locator('.composer-input .send').click()
  await page.locator('.composer-approval').getByRole('button', { name: 'Allow once' }).click()
  const row = page.locator('.agent-job-row[data-job-id="501"]')
  await row.getByRole('button', { name: 'Cancel' }).click()
  await expect(row).toHaveAttribute('data-status', 'cancelled')

  await page.evaluate(() => {
    ;(window as Window & { __GTUM_AGENT_JOB_POLL_INTERVAL_MS__: number })
      .__GTUM_AGENT_JOB_POLL_INTERVAL_MS__ = 10_000
  })

  await page.evaluate(() =>
    (
      window as Window & { __resolveBoundaryCancel: () => void }
    ).__resolveBoundaryCancel(),
  )
  await page.waitForTimeout(50)
  await expect(row).toHaveAttribute('data-status', 'cancelled')
})

test('keeps log-read failures distinct from process state', async ({ page }) => {
  await installHarness(page, 'log-error')
  await openHarness(page)

  await page.getByPlaceholder('Ask Codex').fill('show a log read failure')
  await page.locator('.composer-input .send').click()
  await page.locator('.composer-approval').getByRole('button', { name: 'Allow once' }).click()
  const row = page.locator('.agent-job-row[data-job-id="501"]')

  await expect(row).toHaveAttribute('data-status', 'running')
  await expect(row.locator('[data-error-kind="log-read"]')).toContainText(
    'structured log read unavailable',
  )
  await expect(row.locator('[data-error-kind="process"]')).toHaveCount(0)
  await expect(row.getByRole('button', { name: 'Cancel' })).toBeVisible()
})

test('blocks Codex when suggestion runtime exists without an auth connection seam', async ({ page }) => {
  await installHarness(page, 'no-auth')
  await openHarness(page)

  await page.getByPlaceholder('Ask Codex').fill('do not bypass auth')
  await page.locator('.composer-input .send').click()

  await expect(page.locator('.msg.assistant').last()).toContainText(/connect|reconnect/i)
  expect(
    await page.evaluate(
      () =>
        (
          window as Window & { __agentSuggestionCalls: Array<{ command: string }> }
        ).__agentSuggestionCalls.filter(
          (call) => call.command === 'request_agent_suggestions',
        ),
    ),
  ).toEqual([])
})

const codexAuthFailures = [
  'Codex CLI is not installed. Install it and run `codex login` before connecting Codex.',
  'Codex CLI is logged in with an API key. Re-run `codex login` with ChatGPT session mode before connecting gtum.',
  'Codex CLI is installed, but no local session file was found. Run `codex login`, finish sign-in, then reconnect Codex.',
  'Codex CLI session is missing or expired. Run `codex login`, then reconnect Codex.',
]

for (const [index, authFailure] of codexAuthFailures.entries()) {
  test(`refreshes canonical Codex auth after request failure ${index + 1}`, async ({ page }) => {
    await installHarness(page, 'expired-auth', authFailure)
    await openHarness(page)

    await page.getByPlaceholder('Ask Codex').fill('first rejected request')
    await page.locator('.composer-input .send').click()
    await expect(page.locator('.msg.assistant').last()).toContainText(
      authFailure.replaceAll('`', ''),
    )

    await page.getByPlaceholder('Ask Codex').fill('second rejected request')
    await page.locator('.composer-input .send').click()
    await expect(page.locator('.msg.assistant').last()).toContainText(/connect|reconnect/i)

    expect(
      await page.evaluate(
        () =>
          (
            window as Window & { __agentSuggestionCalls: Array<{ command: string }> }
          ).__agentSuggestionCalls.filter(
            (call) => call.command === 'request_agent_suggestions',
          ).length,
      ),
    ).toBe(1)
  })
}
