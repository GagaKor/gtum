import { expect, test, type Page } from '@playwright/test'

test('keeps repeated agent jobs bounded, isolated, and restorable', async ({ page }) => {
  test.setTimeout(90_000)

  await page.addInitScript(() => {
    type JobStatus =
      | 'running'
      | 'cancelling'
      | 'completed'
      | 'failed'
      | 'cancelled'
      | 'interrupted'

    type StoredJob = {
      jobId: number
      sessionId: string
      name: string
      command: string
      cwd: string
      runner: string
      runnerArgs: string[]
      processId: number | null
      status: JobStatus
      createdAt: number
      updatedAt: number
      finishedAt: number | null
      cancellationRequestedAt: number | null
      exitCode: number | null
      logsComplete: boolean
      logCaptureError: string | null
      processError: string | null
      persistenceError: string | null
      logLineCount: number
      maxLogEntries: number
      lastEvent: string
    }

    const projectA = '/workspace/aging-a'
    const projectB = '/workspace/aging-b'
    const jobsKey = 'aging-agent-jobs'
    const readsKey = 'aging-agent-job-reads'
    const createCountKey = 'aging-agent-job-creates'
    const requestCountKey = 'aging-agent-requests'
    const terminalCountKey = 'aging-terminal-calls'
    let openProjectPaths = [projectA]
    let activeProjectPath = projectA

    const readNumber = (key: string): number =>
      Number(sessionStorage.getItem(key) || '0')
    const increment = (key: string): number => {
      const next = readNumber(key) + 1
      sessionStorage.setItem(key, String(next))
      return next
    }
    const readJobs = (): StoredJob[] =>
      JSON.parse(sessionStorage.getItem(jobsKey) || '[]') as StoredJob[]
    const writeJobs = (jobs: StoredJob[]) =>
      sessionStorage.setItem(jobsKey, JSON.stringify(jobs))
    const readCounts = (): Record<string, number> =>
      JSON.parse(sessionStorage.getItem(readsKey) || '{}') as Record<string, number>
    const incrementRead = (jobId: number) => {
      const counts = readCounts()
      counts[String(jobId)] = (counts[String(jobId)] || 0) + 1
      sessionStorage.setItem(readsKey, JSON.stringify(counts))
    }
    const updateJob = (jobId: number, updater: (job: StoredJob) => StoredJob) => {
      const jobs = readJobs().map((job) =>
        job.jobId === jobId ? updater(job) : job,
      )
      writeJobs(jobs)
      return jobs.find((job) => job.jobId === jobId)!
    }
    const projectOverview = (path: string) => ({
      metadata: {
        name: path === projectA ? 'aging-a' : 'aging-b',
        path,
      },
      tree: {
        name: path === projectA ? 'aging-a' : 'aging-b',
        path,
        kind: 'directory',
        children: [],
      },
      git: {
        isRepository: true,
        branch: 'dev',
        branchType: 'development',
        changedFilesCount: 0,
      },
    })
    const logResponse = (job: StoredJob) => ({
      jobId: job.jobId,
      status: job.status,
      limit: 100,
      logLineCount: job.logLineCount,
      truncated: false,
      entries: [
        {
          sequence: 1,
          stream: 'command',
          text: job.command,
          recordedAt: job.createdAt,
        },
        {
          sequence: 2,
          stream: job.status === 'failed' ? 'stderr' : 'stdout',
          text: job.status === 'failed' ? `failed ${job.jobId}` : `finished ${job.jobId}`,
          recordedAt: job.updatedAt,
        },
      ],
      updatedAt: job.updatedAt,
      finishedAt: job.finishedAt,
      cancellationRequestedAt: job.cancellationRequestedAt,
      exitCode: job.exitCode,
      logsComplete: job.logsComplete,
      logCaptureError: job.logCaptureError,
      processError: job.processError,
      persistenceError: job.persistenceError,
      lastEvent: job.lastEvent,
    })

    const bridgeWindow = window as Window & {
      __GTUM_AGENT_JOB_POLL_INTERVAL_MS__: number
      __GTUM_AGENT_AUTH_RUNTIME__: unknown
      __GTUM_AGENT_JOB_RUNTIME__: unknown
      __GTUM_AGENT_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
      __GTUM_PROJECT_FOLDER_PICKER__: unknown
      __GTUM_TERMINAL_RUNTIME__: unknown
      __GTUM_WORKSPACE_RUNTIME__: unknown
    }

    bridgeWindow.__GTUM_AGENT_JOB_POLL_INTERVAL_MS__ = 10
    bridgeWindow.__GTUM_PROJECT_FOLDER_PICKER__ = {
      pick: async () => projectB,
    }
    bridgeWindow.__GTUM_AGENT_AUTH_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string) => {
        const codexConnection = {
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
        if (command === 'read_agent_profile_snapshot') {
          return {
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
                  connectedAt: 1,
                  updatedAt: 1,
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
                  updatedAt: 1,
                  lastError: null,
                },
              },
            ],
            tombstones: [],
          }
        }
        if (command === 'authorize_agent_profile_lease') {
          throw new Error('aging approval must use the atomic authorized job command')
        }
        if (command === 'list_agent_connections') return [codexConnection]
        return codexConnection
      },
    }
    bridgeWindow.__GTUM_WORKSPACE_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        const snapshot = () => ({
          recentProjects: [...openProjectPaths].reverse(),
          openProjectPaths: [...openProjectPaths],
          activeProjectPath,
          lastOpenedProjectPath: activeProjectPath,
          updatedAt: 1,
          storageVersion: 2,
        })
        if (command === 'read_workspace_runtime_snapshot') {
          return {
            storagePath: '/tmp/aging-workspace.json',
            restoredAt: 1,
            snapshot: snapshot(),
          }
        }
        if (command === 'open_workspace_project') {
          const path = String((args?.request as { path?: string } | undefined)?.path || '')
          if (!openProjectPaths.includes(path)) openProjectPaths = [...openProjectPaths, path]
          activeProjectPath = path
          return snapshot()
        }
        if (command === 'activate_workspace_project') {
          const path = String((args?.request as { path?: string } | undefined)?.path || '')
          activeProjectPath = path
          return snapshot()
        }
        return null
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (_command: string, args?: Record<string, unknown>) =>
        projectOverview(String(args?.path || '')),
    }
    bridgeWindow.__GTUM_AGENT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        if (
          command === 'read_agent_account_capabilities'
          || command === 'read_agent_provider_capabilities'
        ) {
          const request = args?.request as {
            accountId?: string
            incarnation?: string
            credentialRevision?: string
          } | undefined
          if (
            command === 'read_agent_account_capabilities'
            && (
              request?.accountId !== 'codex-default'
              || request?.incarnation !== '1'
              || request?.credentialRevision !== '1'
            )
          ) {
            throw new Error(`Aging capability lease mismatch: ${JSON.stringify(request)}`)
          }
          return {
            provider: 'codex',
            accountId: request?.accountId ?? 'codex-default',
            incarnation: request?.incarnation ?? '1',
            credentialRevision: request?.credentialRevision ?? '1',
            supportsModelSelection: false,
            currentModel: null,
            availableModels: [],
            reasoningLevels: [],
            defaultReasoningLevel: null,
            supportsFastMode: false,
            attachments: [],
          }
        }
        if (
          command === 'request_agent_account_suggestions'
          || command === 'request_agent_suggestions'
        ) {
          const request = args?.request as {
            accountId?: string
            incarnation?: string
            credentialRevision?: string
          } | undefined
          if (
            command === 'request_agent_account_suggestions'
            && (
              request?.accountId !== 'codex-default'
              || request?.incarnation !== '1'
              || request?.credentialRevision !== '1'
            )
          ) {
            throw new Error(`Aging suggestion lease mismatch: ${JSON.stringify(request)}`)
          }
          const requestNumber = increment(requestCountKey)
          return [
            {
              id: `aging-${requestNumber}`,
              provider: 'codex',
              accountId: request?.accountId ?? 'codex-default',
              incarnation: request?.incarnation ?? '1',
              credentialRevision: request?.credentialRevision ?? '1',
              summary: `Run aging command ${requestNumber}`,
              command: `node aging-job-${requestNumber}`,
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
        const projectPath = String(args?.projectPath || '')
        if (command === 'list_agent_jobs') {
          const sessionId = String(args?.sessionId || '')
          const limit = Number(args?.limit || 25)
          return readJobs()
            .filter((job) => job.cwd === projectPath && job.sessionId === sessionId)
            .sort((left, right) => right.updatedAt - left.updatedAt)
            .slice(0, limit)
        }

        if (command === 'create_agent_job') {
          throw new Error('aging approval must not use legacy generic job creation')
        }
        if (command === 'create_authorized_agent_job') {
          const request = args?.request as {
            provider: string
            accountId: string
            incarnation: string
            credentialRevision: string
            projectPath: string
            command: string
            name?: string
            sessionId?: string
          }
          if (
            request.provider !== 'codex'
            || request.accountId !== 'codex-default'
            || request.incarnation !== '1'
            || request.credentialRevision !== '1'
            || !request.sessionId
          ) {
            throw new Error(`Aging authorized job lease mismatch: ${JSON.stringify(request)}`)
          }
          const jobId = increment(createCountKey)
          const createdAt = 1_000 + jobId * 10
          const job: StoredJob = {
            jobId,
            sessionId: String(request.sessionId || ''),
            name: request.name || `aging-${jobId}`,
            command: request.command,
            cwd: request.projectPath,
            runner: 'node',
            runnerArgs: [`aging-job-${jobId}`],
            processId: 5_000 + jobId,
            status: 'running',
            createdAt,
            updatedAt: createdAt,
            finishedAt: null,
            cancellationRequestedAt: null,
            exitCode: null,
            logsComplete: false,
            logCaptureError: null,
            processError: null,
            persistenceError: null,
            logLineCount: 1,
            maxLogEntries: 400,
            lastEvent: 'agent job created',
          }
          writeJobs([...readJobs(), job])
          return job
        }

        const jobId = Number(args?.jobId)
        const current = readJobs().find(
          (job) => job.jobId === jobId && job.cwd === projectPath,
        )
        if (!current) throw new Error(`missing aging job ${jobId}`)

        if (command === 'cancel_agent_job') {
          return updateJob(jobId, (job) => ({
            ...job,
            status: 'cancelling',
            updatedAt: job.updatedAt + 1,
            cancellationRequestedAt: job.updatedAt + 1,
            lastEvent: 'agent job cancellation requested',
          }))
        }

        if (command === 'read_agent_job_logs') {
          incrementRead(jobId)
          const outcome = jobId % 3
          const job = updateJob(jobId, (stored) => {
            if (outcome === 0 && stored.status !== 'cancelling') return stored
            if (stored.status === 'cancelling') {
              return {
                ...stored,
                processId: null,
                status: 'cancelled',
                updatedAt: stored.updatedAt + 2,
                finishedAt: stored.updatedAt + 2,
                logsComplete: true,
                logLineCount: 2,
                lastEvent: 'agent job cancelled',
              }
            }
            if (outcome === 1) {
              return {
                ...stored,
                processId: null,
                status: 'completed',
                updatedAt: stored.updatedAt + 2,
                finishedAt: stored.updatedAt + 2,
                exitCode: 0,
                logsComplete: true,
                logLineCount: 2,
                lastEvent: 'agent job completed',
              }
            }
            return {
              ...stored,
              processId: null,
              status: 'failed',
              updatedAt: stored.updatedAt + 2,
              finishedAt: stored.updatedAt + 2,
              exitCode: 2,
              logsComplete: true,
              logLineCount: 2,
              lastEvent: 'agent job failed',
            }
          })
          return logResponse(job)
        }

        throw new Error(`unexpected agent job command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_TERMINAL_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async () => {
        increment(terminalCountKey)
        throw new Error('agent aging must not invoke the terminal runtime')
      },
    }
  })

  await page.setViewportSize({ width: 1280, height: 720 })
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
    .toBe('/workspace/aging-a')

  const centerBefore = await page.locator('.center').evaluate((element) => element.innerHTML)

  for (let index = 1; index <= 30; index += 1) {
    await page.getByPlaceholder('Ask Codex').fill(`aging request ${index}`)
    await page.locator('.composer-input .send').click()
    const permission = page.locator('.composer-approval')
    await expect(permission).toContainText(`node aging-job-${index}`)
    await permission.getByRole('button', { name: 'Allow once' }).click()

    const row = page.locator(`.agent-job-row[data-job-id="${index}"]`)
    await expect(row).toBeVisible()
    if (index % 3 === 0) {
      await expect(row).toHaveAttribute('data-status', 'running')
      await row.getByRole('button', { name: 'Cancel' }).click()
      await expect(row).toHaveAttribute('data-status', 'cancelled')
    } else {
      await expect(row).toHaveAttribute(
        'data-status',
        index % 3 === 1 ? 'completed' : 'failed',
      )
    }
  }

  await expect(page.locator('.agent-job-row')).toHaveCount(25)
  expect(await page.locator('.center').evaluate((element) => element.innerHTML)).toBe(centerBefore)
  expect(await page.evaluate(() => Number(sessionStorage.getItem('aging-agent-job-creates')))).toBe(30)
  expect(await page.evaluate(() => Number(sessionStorage.getItem('aging-agent-requests')))).toBe(30)
  expect(await page.evaluate(() => Number(sessionStorage.getItem('aging-terminal-calls') || '0'))).toBe(0)

  const readsAfterCompletion = await page.evaluate(() =>
    sessionStorage.getItem('aging-agent-job-reads'),
  )
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => sessionStorage.getItem('aging-agent-job-reads'))).toBe(
    readsAfterCompletion,
  )

  await page.getByText('Open project folder').click()
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
    .toBe('/workspace/aging-b')
  await expect(page.locator('.agent-job-row')).toHaveCount(0)

  await page.locator('[data-project-path="/workspace/aging-a"]').click()
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
    .toBe('/workspace/aging-a')
  await expect(page.locator('.agent-job-row')).toHaveCount(25)

  await page.reload()
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
    .toBe('/workspace/aging-a')
  await expect(page.locator('.agent-job-row')).toHaveCount(25)
  await expect(page.locator('.agent-job-row').first()).toContainText('finished 30')
  expect(await page.locator('.center').evaluate((element) => element.innerHTML)).toBe(centerBefore)
  expect(await page.evaluate(() => Number(sessionStorage.getItem('aging-terminal-calls') || '0'))).toBe(0)

  await expect
    .poll(async () =>
      page.locator('.agent-job-row').evaluateAll((rows) =>
        rows.every((row) =>
          ['completed', 'failed', 'cancelled'].includes(
            row.getAttribute('data-status') || '',
          ),
        ),
      ),
    )
    .toBe(true)
  const readsAfterReload = await page.evaluate(() =>
    sessionStorage.getItem('aging-agent-job-reads'),
  )
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => sessionStorage.getItem('aging-agent-job-reads'))).toBe(
    readsAfterReload,
  )
})

type MultiAccountAgingCall = {
  surface: 'auth' | 'agent' | 'job' | 'terminal'
  command: string
  args?: Record<string, unknown>
}

const multiAccountAgingProject = '/workspace/multi-account-aging'
const multiAccountAgingSession = 'multi-account-aging-session'
const multiAccountA = 'codex-profile-a'
const multiAccountB = 'codex-profile-b'

const installMultiAccountAgingHarness = async (page: Page) => {
  await page.addInitScript(({
    projectPath,
    sessionId,
    accountA,
    accountB,
  }) => {
    type RuntimeCall = {
      surface: 'auth' | 'agent' | 'job' | 'terminal'
      command: string
      args?: Record<string, unknown>
    }
    type ProfileStatus = 'connected' | 'disconnected'
    type TestWindow = Window & {
      __multiAccountAgingCalls: RuntimeCall[]
      __GTUM_AGENT_PROGRESS_STAGE_DELAY_MS__: number
      __GTUM_AGENT_JOB_POLL_INTERVAL_MS__: number
      __GTUM_WORKSPACE_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
      __GTUM_AGENT_AUTH_RUNTIME__: unknown
      __GTUM_AGENT_RUNTIME__: unknown
      __GTUM_AGENT_JOB_RUNTIME__: unknown
      __GTUM_AGENT_ATTACHMENT_PICKER__: unknown
      __GTUM_TERMINAL_RUNTIME__: unknown
    }

    const bridgeWindow = window as TestWindow
    const callsStorageKey = 'gtum.test.multi-account-aging.calls'
    const terminalCountKey = 'gtum.test.multi-account-aging.terminal-count'
    const requestOrdinalKey = 'gtum.test.multi-account-aging.request-ordinal'
    const directoryKey = 'gtum.agent-session-directory.v2'
    const readCalls = (): RuntimeCall[] =>
      JSON.parse(sessionStorage.getItem(callsStorageKey) || '[]') as RuntimeCall[]
    const recordCall = (
      surface: RuntimeCall['surface'],
      command: string,
      args?: Record<string, unknown>,
    ) => {
      const call = { surface, command, args }
      bridgeWindow.__multiAccountAgingCalls.push(call)
      sessionStorage.setItem(callsStorageKey, JSON.stringify([...readCalls(), call]))
    }
    const nextRequestOrdinal = () => {
      const next = Number(sessionStorage.getItem(requestOrdinalKey) || '0') + 1
      sessionStorage.setItem(requestOrdinalKey, String(next))
      return next
    }
    const profileConnection = (
      provider: 'codex' | 'claude',
      status: ProfileStatus,
    ) => ({
      status,
      requiresValidation: false,
      credentialSource: provider === 'claude' && status === 'connected'
        ? 'claude_cli_session'
        : null,
      connectedAt: status === 'connected' ? 100 : null,
      updatedAt: 120,
      lastError: null,
    })
    const profile = (
      provider: 'codex' | 'claude',
      accountId: string,
      alias: string,
      isDefault: boolean,
      incarnation: string,
      status: ProfileStatus,
    ) => ({
      provider,
      accountId,
      alias,
      profileKind: {
        kind: accountId.endsWith('-default')
          ? 'ambient'
          : provider === 'codex' ? 'codex_home' : 'claude_config_dir',
      },
      isDefault,
      incarnation,
      metadataRevision: '1',
      credentialRevision: '1',
      connection: profileConnection(provider, status),
    })
    const profileSnapshot = {
      registryVersion: 2,
      profiles: [
        profile('codex', 'codex-default', 'Codex ambient', false, '1', 'connected'),
        profile('codex', accountA, 'Account A aging', true, '11', 'connected'),
        profile('codex', accountB, 'Account B aging', false, '12', 'connected'),
        profile('claude', 'claude-default', 'Claude ambient', true, '2', 'disconnected'),
      ],
      tombstones: [],
    }
    const providerConnection = {
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
      connectedAt: 100,
      lastLoginAttemptAt: 95,
      updatedAt: 120,
      lastError: null,
    }
    const capabilitySnapshot = (accountId: string) => {
      const isAccountA = accountId === accountA
      const modelId = isAccountA ? 'gpt-aging-a' : 'gpt-aging-b'
      const modelLabel = isAccountA ? 'Account A aging model' : 'Account B aging model'
      return {
        provider: 'codex',
        accountId,
        incarnation: isAccountA ? '11' : '12',
        credentialRevision: '1',
        supportsModelSelection: true,
        currentModel: { providerId: 'codex', modelId, label: modelLabel },
        availableModels: [{ providerId: 'codex', modelId, label: modelLabel }],
        reasoningLevels: [
          { level: 'low', label: 'Low' },
          { level: 'high', label: 'High' },
        ],
        defaultReasoningLevel: isAccountA ? 'low' : 'high',
        supportsFastMode: true,
        attachments: isAccountA
          ? [{ kind: 'image', label: 'Account A images', enabled: true, invocationFlag: '--image' }]
          : [{ kind: 'file', label: 'Account B files', enabled: true, invocationFlag: null }],
      }
    }

    if (!localStorage.getItem(directoryKey)) {
      localStorage.setItem(directoryKey, JSON.stringify({
        [projectPath]: {
          workspaceTitle: 'multi-account-aging',
          activeSessionId: sessionId,
          sessions: [{
            id: sessionId,
            title: 'Multi-account aging',
            providerId: 'codex',
            selectedAccountIds: { codex: accountA },
            selectedModels: {
              codex: {
                [accountA]: 'gpt-aging-a',
                [accountB]: 'gpt-aging-b',
              },
            },
            selectedReasoningLevels: {
              codex: {
                [accountA]: 'low',
                [accountB]: 'high',
              },
            },
            fastModes: {
              codex: {
                [accountA]: true,
                [accountB]: false,
              },
            },
          }],
        },
      }))
    }

    bridgeWindow.__multiAccountAgingCalls = []
    bridgeWindow.__GTUM_AGENT_PROGRESS_STAGE_DELAY_MS__ = 0
    bridgeWindow.__GTUM_AGENT_JOB_POLL_INTERVAL_MS__ = 10_000
    bridgeWindow.__GTUM_WORKSPACE_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string) => {
        if (command !== 'read_workspace_runtime_snapshot') {
          throw new Error(`Unexpected multi-account workspace command: ${command}`)
        }
        return {
          restoredAt: 1,
          snapshot: {
            recentProjects: [projectPath],
            openProjectPaths: [projectPath],
            activeProjectPath: projectPath,
            lastOpenedProjectPath: projectPath,
            updatedAt: 1,
            storageVersion: 2,
          },
        }
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string) => {
        if (command !== 'read_project_overview') {
          throw new Error(`Unexpected multi-account project command: ${command}`)
        }
        return {
          metadata: { name: 'multi-account-aging', path: projectPath },
          tree: {
            name: 'multi-account-aging',
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
        }
      },
    }
    bridgeWindow.__GTUM_AGENT_AUTH_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        recordCall('auth', command, args)
        if (command === 'read_agent_profile_snapshot') return structuredClone(profileSnapshot)
        if (command === 'list_agent_connections') return [providerConnection]
        throw new Error(`Unexpected multi-account auth command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_AGENT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        recordCall('agent', command, args)
        if (command === 'read_agent_account_capabilities') {
          const request = args?.request as {
            provider?: string
            accountId?: string
            incarnation?: string
            credentialRevision?: string
          } | undefined
          const exactIncarnation = request?.accountId === accountA ? '11' : '12'
          if (
            request?.provider !== 'codex'
            || ![accountA, accountB].includes(String(request.accountId))
            || request?.incarnation !== exactIncarnation
            || request?.credentialRevision !== '1'
          ) {
            throw new Error(`Capability request crossed account ownership: ${JSON.stringify(request)}`)
          }
          return capabilitySnapshot(String(request.accountId))
        }
        if (command === 'request_agent_account_suggestions') {
          const request = args?.request as {
            provider?: string
            accountId?: string
            incarnation?: string
            credentialRevision?: string
          } | undefined
          const exactIncarnation = request?.accountId === accountA ? '11' : '12'
          if (
            request?.provider !== 'codex'
            || ![accountA, accountB].includes(String(request.accountId))
            || request?.incarnation !== exactIncarnation
            || request?.credentialRevision !== '1'
          ) {
            throw new Error(`Suggestion request crossed account ownership: ${JSON.stringify(request)}`)
          }
          const ordinal = nextRequestOrdinal()
          return [{
            id: `multi-account-aging-${ordinal}`,
            provider: 'codex',
            accountId: String(request.accountId),
            incarnation: exactIncarnation,
            credentialRevision: '1',
            summary: `${String(request.accountId)} response ${ordinal}`,
            command: '',
            preferredTarget: 'current_tab',
            confidence: 'high',
            error: null,
          }]
        }
        throw new Error(`Unexpected multi-account Agent command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_AGENT_JOB_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        recordCall('job', command, args)
        if (command === 'list_agent_jobs') return []
        throw new Error(`Unexpected multi-account job command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_AGENT_ATTACHMENT_PICKER__ = {
      pick: async () => {
        const selectedAccountId = document.querySelector<HTMLElement>('.agent')
          ?.dataset.agentAccountId
        if (selectedAccountId === accountA) return '/tmp/multi-account-a.png'
        if (selectedAccountId === accountB) return '/tmp/multi-account-b.txt'
        throw new Error(`Attachment picker has no exact account owner: ${selectedAccountId}`)
      },
    }
    bridgeWindow.__GTUM_TERMINAL_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        recordCall('terminal', command, args)
        const count = Number(sessionStorage.getItem(terminalCountKey) || '0') + 1
        sessionStorage.setItem(terminalCountKey, String(count))
        throw new Error(`Multi-account aging must not use the center terminal: ${command}`)
      },
    }
  }, {
    projectPath: multiAccountAgingProject,
    sessionId: multiAccountAgingSession,
    accountA: multiAccountA,
    accountB: multiAccountB,
  })
}

const selectMultiAccountAgingProfile = async (page: Page, accountId: string) => {
  await page.locator('.composer-provider-chip').click()
  await page.locator(`[role="option"][data-account-id="${accountId}"]`).click()
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-account-id', accountId)
}

const readMultiAccountAgingCalls = (page: Page) => page.evaluate(() => (
  window as Window & { __multiAccountAgingCalls?: MultiAccountAgingCall[] }
).__multiAccountAgingCalls ?? [])

test('multi-account account aging keeps 31 explicit switches exact, bounded, and terminal isolated', async ({ page }) => {
  test.setTimeout(120_000)
  await installMultiAccountAgingHarness(page)
  await page.goto('/')

  const agent = page.locator('.agent')
  const draft = page.getByPlaceholder('Ask Codex')
  const accountAState = {
    accountId: multiAccountA,
    modelLabel: 'Account A aging model',
    reasoning: 'Low',
    fast: true,
    attachment: 'multi-account-a.png',
    attachmentKind: 'image',
    incarnation: '11',
  }
  const accountBState = {
    accountId: multiAccountB,
    modelLabel: 'Account B aging model',
    reasoning: 'High',
    fast: false,
    attachment: 'multi-account-b.txt',
    attachmentKind: 'file',
    incarnation: '12',
  }
  const sessionDraft = 'the Agent-session draft survives account switches'

  await expect(agent).toHaveAttribute('data-agent-account-id', multiAccountA)
  await expect(agent).toHaveAttribute('data-capability-cache-size', '1')
  const centerBefore = await page.locator('.center').evaluate((element) => ({
    html: element.innerHTML,
    rect: element.getBoundingClientRect().toJSON(),
  }))

  await draft.fill(sessionDraft)
  await page.locator('.composer-tool').click()
  await expect(page.locator('.composer-attachment-chip')).toContainText(accountAState.attachment)

  await selectMultiAccountAgingProfile(page, multiAccountB)
  await expect(draft).toHaveValue(sessionDraft)
  await expect(page.locator('.composer-attachment-chip')).toHaveCount(0)
  await page.locator('.composer-tool').click()
  await expect(page.locator('.composer-attachment-chip')).toContainText(accountBState.attachment)

  await selectMultiAccountAgingProfile(page, multiAccountA)
  await expect(draft).toHaveValue(sessionDraft)
  await expect(page.locator('.composer-attachment-chip')).toContainText(accountAState.attachment)
  const initialCapabilityLeases = (await readMultiAccountAgingCalls(page))
    .filter((call) => call.command === 'read_agent_account_capabilities')
    .map((call) => call.args?.request)
  expect(initialCapabilityLeases).toEqual([
    {
      provider: 'codex',
      accountId: multiAccountA,
      incarnation: '11',
      credentialRevision: '1',
    },
    {
      provider: 'codex',
      accountId: multiAccountB,
      incarnation: '12',
      credentialRevision: '1',
    },
  ])

  for (let index = 0; index < 31; index += 1) {
    const expected = index % 2 === 0 ? accountBState : accountAState
    await selectMultiAccountAgingProfile(page, expected.accountId)
    await expect(draft).toHaveValue(sessionDraft)
    await expect(page.locator('.composer-model-chip')).toHaveAttribute(
      'aria-label',
      `Codex model: ${expected.modelLabel}`,
    )
    await expect(page.locator('.composer-reasoning-chip')).toHaveAttribute(
      'aria-label',
      `Reasoning level: ${expected.reasoning}`,
    )
    await expect(page.locator('.fast-toggle')).toHaveAttribute(
      'aria-pressed',
      String(expected.fast),
    )
    const attachmentChip = page.locator('.composer-attachment-chip')
    if (index < 2) {
      await expect(
        attachmentChip,
        `${expected.accountId} must retain its exact in-memory attachment across account switches`,
      ).toContainText(expected.attachment)
    } else {
      await expect(attachmentChip).toHaveCount(0)
      await page.locator('.composer-tool').click()
    }
    await expect(attachmentChip).toContainText(expected.attachment)

    const requestText = `exact account aging request ${index + 1}`
    await draft.fill(requestText)
    await page.locator('.composer-input .send').click()
    await expect.poll(async () => (
      await readMultiAccountAgingCalls(page)
    ).filter((call) => call.command === 'request_agent_account_suggestions').length)
      .toBe(index + 1)

    const requests = (await readMultiAccountAgingCalls(page)).filter(
      (call) => call.command === 'request_agent_account_suggestions',
    )
    expect(requests.at(-1)?.args?.request).toEqual(expect.objectContaining({
      provider: 'codex',
      accountId: expected.accountId,
      incarnation: expected.incarnation,
      credentialRevision: '1',
      projectPath: multiAccountAgingProject,
      agentSessionId: multiAccountAgingSession,
      model: expected.accountId === multiAccountA ? 'gpt-aging-a' : 'gpt-aging-b',
      reasoningLevel: expected.reasoning.toLowerCase(),
      fastMode: expected.fast,
      attachments: [{
        kind: expected.attachmentKind,
        path: `/tmp/${expected.attachment}`,
        label: expected.attachment,
      }],
    }))

    const exactTurn = page.locator(
      `.agent-turn[data-owner-account-id="${expected.accountId}"]`,
    ).last()
    await expect(exactTurn).toContainText(`${expected.accountId} response ${index + 1}`)
    await expect(exactTurn).toHaveAttribute('data-owner-provider-id', 'codex')
    await expect(exactTurn).toHaveAttribute('data-owner-incarnation', expected.incarnation)
    await expect(exactTurn).toHaveAttribute('data-owner-credential-revision', '1')

    await draft.fill(sessionDraft)
    await expect(agent).toHaveAttribute('data-capability-cache-size', '2')
    await expect(agent).toHaveAttribute('data-capability-generation-slots', '2')
  }

  await expect(agent).toHaveAttribute('data-agent-account-id', multiAccountB)
  await expect(agent).toHaveAttribute('data-capability-cache-size', '2')
  await expect(agent).toHaveAttribute('data-capability-generation-slots', '2')
  await expect(
    agent,
    'account action generation slots must remain observable and bounded',
  ).toHaveAttribute('data-action-generation-slots', '0')
  expect(await page.locator('.center').evaluate((element) => ({
    html: element.innerHTML,
    rect: element.getBoundingClientRect().toJSON(),
  }))).toEqual(centerBefore)
  expect(await page.evaluate(() => Number(
    sessionStorage.getItem('gtum.test.multi-account-aging.terminal-count') || '0',
  ))).toBe(0)

  await expect.poll(() => page.evaluate(({ projectPath, sessionId }) => {
    const directory = JSON.parse(localStorage.getItem('gtum.agent-session-directory.v2') || '{}')
    const session = directory[projectPath]?.sessions?.find(
      (candidate: { id?: string }) => candidate.id === sessionId,
    )
    return session && {
      selectedAccountId: session.selectedAccountIds?.codex,
      selectedModels: session.selectedModels?.codex,
      selectedReasoningLevels: session.selectedReasoningLevels?.codex,
      fastModes: session.fastModes?.codex,
      hasDraft: Object.prototype.hasOwnProperty.call(session, 'draft'),
      hasAttachments: Object.prototype.hasOwnProperty.call(session, 'attachments'),
    }
  }, { projectPath: multiAccountAgingProject, sessionId: multiAccountAgingSession }))
    .toEqual({
      selectedAccountId: multiAccountB,
      selectedModels: {
        [multiAccountA]: 'gpt-aging-a',
        [multiAccountB]: 'gpt-aging-b',
      },
      selectedReasoningLevels: {
        [multiAccountA]: 'low',
        [multiAccountB]: 'high',
      },
      fastModes: {
        [multiAccountA]: true,
        [multiAccountB]: false,
      },
      hasDraft: false,
      hasAttachments: false,
    })

  await page.reload()
  await expect(agent).toHaveAttribute('data-agent-account-id', multiAccountB)
  await expect(page.locator('.composer-model-chip')).toHaveAttribute(
    'aria-label',
    'Codex model: Account B aging model',
  )
  await expect(page.locator('.composer-reasoning-chip')).toHaveAttribute(
    'aria-label',
    'Reasoning level: High',
  )
  await expect(page.locator('.fast-toggle')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.composer-attachment-chip')).toHaveCount(0)
  await expect(draft).toHaveValue('')
  await expect(agent).toHaveAttribute('data-capability-cache-size', '1')
  await expect(agent).toHaveAttribute('data-capability-generation-slots', '1')
  await expect(
    agent,
    'account action generation slots must remain bounded after reload',
  ).toHaveAttribute('data-action-generation-slots', '0')
  expect(await page.evaluate(() => Number(
    sessionStorage.getItem('gtum.test.multi-account-aging.terminal-count') || '0',
  ))).toBe(0)

  const persistedCalls = await page.evaluate(() => JSON.parse(
    sessionStorage.getItem('gtum.test.multi-account-aging.calls') || '[]',
  ) as MultiAccountAgingCall[])
  const exactRequests = persistedCalls.filter(
    (call) => call.command === 'request_agent_account_suggestions',
  )
  expect(exactRequests).toHaveLength(31)
  expect(exactRequests.every((call, index) => (
    (call.args?.request as { provider?: string; accountId?: string } | undefined)?.provider
      === 'codex'
    && (call.args?.request as { accountId?: string } | undefined)?.accountId
      === (index % 2 === 0 ? multiAccountB : multiAccountA)
  ))).toBe(true)
})
