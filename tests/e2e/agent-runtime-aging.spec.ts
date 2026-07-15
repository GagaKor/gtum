import { expect, test } from '@playwright/test'

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
      invokeRuntime: async () => [
        {
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
        },
      ],
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
      invokeRuntime: async (command: string) => {
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
          const requestNumber = increment(requestCountKey)
          return [
            {
              id: `aging-${requestNumber}`,
              provider: 'codex',
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
          const request = args?.request as {
            projectPath: string
            command: string
            name?: string
            sessionId?: string
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
