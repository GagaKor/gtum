import { expect, test, type Page } from '@playwright/test'

type RuntimeCall = { command: string; args?: Record<string, unknown> }

const projectA = '/workspace/close-a'
const projectB = '/workspace/close-b'

const installProjectCloseHarness = async (page: Page) => {
  await page.addInitScript(({ projectA, projectB }) => {
    type TestWindow = Window & {
      __workspaceCloseCalls: RuntimeCall[]
      __agentAuthCloseCalls: RuntimeCall[]
      __agentCloseCalls: RuntimeCall[]
      __agentJobCloseCalls: RuntimeCall[]
      __terminalCloseCalls: RuntimeCall[]
      __delayNextProjectJobList(projectPath: string): void
      __resolveProjectJobList(): void
      __failNextProjectClose(message: string): void
      __delayNextProjectClose(): void
      __resolveProjectClose(): void
      __failNextProjectJobList(message: string): void
      __delayNextTerminalCreate(): void
      __setProjectJobStatus(status: string | null): void
      __setProjectTerminalStatus(status: string | null): void
      __GTUM_AGENT_FLEET_POLL_INTERVAL_MS__: number
      __GTUM_AGENT_JOB_POLL_INTERVAL_MS__: number
      __GTUM_WORKSPACE_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
      __GTUM_AGENT_AUTH_RUNTIME__: unknown
      __GTUM_AGENT_RUNTIME__: unknown
      __GTUM_AGENT_JOB_RUNTIME__: unknown
      __GTUM_TERMINAL_RUNTIME__: unknown
    }
    const bridgeWindow = window as TestWindow
    let openPaths = [projectA, projectB]
    let activePath = projectA
    let delayedProjectPath: string | null = null
    let resolveProjectJobList: (() => void) | null = null
    let closeFailure: string | null = null
    let delayProjectClose = false
    let resolveProjectClose: (() => void) | null = null
    let jobListFailure: string | null = null
    let delayTerminalCreate = false
    let projectJobStatus: string | null = null
    let projectTerminalStatus: string | null = null
    let updatedAt = 100
    const snapshot = () => ({
      recentProjects: [projectA, projectB],
      openProjectPaths: [...openPaths],
      activeProjectPath: activePath,
      lastOpenedProjectPath: activePath,
      updatedAt: updatedAt += 1,
      storageVersion: 2,
    })
    const jobSnapshot = (projectPath: string, status: string) => ({
      jobId: 91,
      sessionId: 'close-session',
      name: 'close guard job',
      command: 'npm test',
      cwd: projectPath,
      runner: 'npm',
      runnerArgs: ['test'],
      processId: status === 'running' ? 910 : null,
      status,
      createdAt: 1,
      updatedAt: updatedAt += 1,
      finishedAt: status === 'running' || status === 'cancelling' ? null : updatedAt,
      cancellationRequestedAt: status === 'cancelling' ? updatedAt : null,
      exitCode: status === 'completed' ? 0 : null,
      logsComplete: status !== 'running' && status !== 'cancelling',
      logCaptureError: null,
      processError: null,
      persistenceError: null,
      logLineCount: 0,
      maxLogEntries: 100,
      lastEvent: status,
    })
    const terminalSnapshot = (projectPath: string, status: string) => ({
      projectPath,
      sessionId: 71,
      name: 'close terminal',
      cwd: projectPath,
      shell: '/bin/zsh',
      shellArgs: [],
      processId: status === 'running' ? 710 : null,
      status,
      createdAt: 1,
      updatedAt: updatedAt += 1,
      exitCode: status === 'exited' ? 0 : null,
      logLineCount: 0,
      maxLogEntries: 100,
      lastEvent: status,
    })
    const codexLease = {
      provider: 'codex',
      accountId: 'codex-default',
      incarnation: '1',
      credentialRevision: '1',
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

    localStorage.setItem('gtum.agent-session-directory.v2', JSON.stringify({
      [projectA]: {
        workspaceTitle: 'close-a',
        activeSessionId: 'close-agent-a',
        sessions: [{
          id: 'close-agent-a',
          title: 'Close A Agent',
          providerId: 'codex',
          selectedAccountIds: { codex: 'codex-default' },
          selectedModels: {},
          selectedReasoningLevels: {},
          fastModes: {},
        }],
      },
      [projectB]: {
        workspaceTitle: 'close-b',
        activeSessionId: 'close-agent-b',
        sessions: [{
          id: 'close-agent-b',
          title: 'Close B Agent',
          providerId: 'codex',
          selectedAccountIds: { codex: 'codex-default' },
          selectedModels: {},
          selectedReasoningLevels: {},
          fastModes: {},
        }],
      },
    }))

    bridgeWindow.__workspaceCloseCalls = []
    bridgeWindow.__agentAuthCloseCalls = []
    bridgeWindow.__agentCloseCalls = []
    bridgeWindow.__agentJobCloseCalls = []
    bridgeWindow.__terminalCloseCalls = []
    bridgeWindow.__GTUM_AGENT_FLEET_POLL_INTERVAL_MS__ = 60_000
    bridgeWindow.__GTUM_AGENT_JOB_POLL_INTERVAL_MS__ = 60_000
    bridgeWindow.__delayNextProjectJobList = (projectPath) => {
      delayedProjectPath = projectPath
    }
    bridgeWindow.__resolveProjectJobList = () => {
      const resolve = resolveProjectJobList
      resolveProjectJobList = null
      delayedProjectPath = null
      resolve?.()
    }
    bridgeWindow.__failNextProjectClose = (message) => {
      closeFailure = message
    }
    bridgeWindow.__delayNextProjectClose = () => {
      delayProjectClose = true
    }
    bridgeWindow.__resolveProjectClose = () => {
      resolveProjectClose?.()
      resolveProjectClose = null
    }
    bridgeWindow.__failNextProjectJobList = (message) => {
      jobListFailure = message
    }
    bridgeWindow.__delayNextTerminalCreate = () => {
      delayTerminalCreate = true
    }
    bridgeWindow.__setProjectJobStatus = (status) => {
      projectJobStatus = status
    }
    bridgeWindow.__setProjectTerminalStatus = (status) => {
      projectTerminalStatus = status
    }
    bridgeWindow.__GTUM_WORKSPACE_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__workspaceCloseCalls.push({ command, args })
        if (command === 'read_workspace_runtime_snapshot') {
          return { snapshot: snapshot(), restoredAt: 110 }
        }
        const path = String((args?.request as { path?: string } | undefined)?.path)
        if (command === 'activate_workspace_project') {
          if (!openPaths.includes(path)) throw new Error(`Project is not open: ${path}`)
          activePath = path
          return snapshot()
        }
        if (command === 'close_workspace_project') {
          if (delayProjectClose) {
            delayProjectClose = false
            await new Promise<void>((resolve) => {
              resolveProjectClose = resolve
            })
          }
          if (closeFailure) {
            const message = closeFailure
            closeFailure = null
            throw new Error(message)
          }
          const index = openPaths.indexOf(path)
          openPaths = openPaths.filter((entry) => entry !== path)
          if (activePath === path) {
            activePath = openPaths[index] ?? openPaths[index - 1] ?? ''
          }
          return snapshot()
        }
        throw new Error(`Unexpected workspace command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        const path = String(args?.path ?? args?.projectPath)
        if (command === 'read_project_overview') {
          const suffix = path === projectA ? 'a' : 'b'
          return {
            metadata: { name: `close-${suffix}`, path },
            tree: {
              name: `close-${suffix}`,
              path,
              kind: 'directory',
              children: [{ name: `${suffix}.ts`, path: `src/${suffix}.ts`, kind: 'file' }],
            },
            git: { isRepository: true, branch: 'dev', changedFilesCount: 0 },
          }
        }
        if (command === 'read_project_file') {
          return {
            projectPath: path,
            filePath: String(args?.filePath),
            displayPath: String(args?.filePath),
            content: 'const close = true',
            contentHash: 'close-hash',
            isText: true,
            truncated: false,
          }
        }
        throw new Error(`Unexpected project command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_AGENT_AUTH_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__agentAuthCloseCalls.push({ command, args })
        if (command === 'read_agent_profile_snapshot') {
          return structuredClone(profileSnapshot)
        }
        if (command === 'list_agent_connections') {
          return [{
            provider: 'codex',
            displayName: 'Codex',
            availability: 'available',
            status: 'connected',
            connectionKind: 'real',
            accountLabel: 'Codex session',
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
          }]
        }
        throw new Error(`Unexpected Agent auth command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_AGENT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__agentCloseCalls.push({ command, args })
        if (command === 'read_agent_account_capabilities') {
          const request = args?.request as Record<string, unknown> | undefined
          if (
            request?.provider !== codexLease.provider
            || request.accountId !== codexLease.accountId
            || request.incarnation !== codexLease.incarnation
            || request.credentialRevision !== codexLease.credentialRevision
          ) {
            throw new Error(`Close capability lease mismatch: ${JSON.stringify(request)}`)
          }
          return {
            ...codexLease,
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
          const request = args?.request as Record<string, unknown> | undefined
          if (
            request?.provider !== codexLease.provider
            || request.accountId !== codexLease.accountId
            || request.incarnation !== codexLease.incarnation
            || request.credentialRevision !== codexLease.credentialRevision
          ) {
            throw new Error(`Close suggestion lease mismatch: ${JSON.stringify(request)}`)
          }
          return [{
            id: 'close-review',
            ...codexLease,
            summary: 'Run close review command',
            command: 'npm test',
            preferredTarget: 'new_tab',
            confidence: 'high',
            error: null,
          }]
        }
        throw new Error(`Unexpected agent command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_AGENT_JOB_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__agentJobCloseCalls.push({ command, args })
        if (command !== 'list_agent_jobs') {
          throw new Error(`Unexpected Agent job command: ${command}`)
        }
        const path = String(args?.projectPath)
        if (args?.sessionId == null && jobListFailure) {
          const message = jobListFailure
          jobListFailure = null
          throw new Error(message)
        }
        if (args?.sessionId == null && delayedProjectPath === path) {
          await new Promise<void>((resolve) => {
            resolveProjectJobList = resolve
          })
        }
        return projectJobStatus ? [jobSnapshot(path, projectJobStatus)] : []
      },
    }
    bridgeWindow.__GTUM_TERMINAL_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__terminalCloseCalls.push({ command, args })
        const path = String(args?.projectPath ?? (args?.request as { projectPath?: string })?.projectPath)
        if (command === 'list_terminal_sessions') {
          return projectTerminalStatus ? [terminalSnapshot(path, projectTerminalStatus)] : []
        }
        if (command === 'create_terminal_session') {
          if (delayTerminalCreate) {
            delayTerminalCreate = false
            return new Promise(() => undefined)
          }
          return terminalSnapshot(path, 'running')
        }
        if (command === 'read_raw_terminal_output') {
          return { projectPath: path, sessionId: 71, base: 0, cursor: 0, chunk: '', status: 'running' }
        }
        if (command === 'read_terminal_session_logs') {
          return {
            projectPath: path,
            sessionId: 71,
            status: 'running',
            limit: 400,
            logLineCount: 0,
            truncated: false,
            entries: [],
            updatedAt: updatedAt += 1,
          }
        }
        if (command === 'resize_terminal_session' || command === 'write_terminal_input') return undefined
        throw new Error(`Unexpected terminal command: ${command}`)
      },
    }
  }, { projectA, projectB })
}

const projectRow = (page: Page, path: string) =>
  page.locator(`.project-switcher button[data-project-path="${path}"]`)
const closeButton = (page: Page, path: string) =>
  page.locator(`.project-switcher button[data-project-close-path="${path}"]`)

test('keeps close checking isolated while selection continues and closes only after safe lists', async ({ page }) => {
  await installProjectCloseHarness(page)
  await page.goto('/')

  const rowA = projectRow(page, projectA)
  const rowB = projectRow(page, projectB)
  const closeA = closeButton(page, projectA)
  await expect(rowA).toHaveAttribute('data-project-state', 'ready')
  await expect(closeA).toBeVisible()
  expect(await closeA.evaluate((button) => button.parentElement?.querySelector(
    ':scope > button[data-project-path]',
  ) != null)).toBe(true)

  await page.evaluate((path) => (
    window as Window & { __delayNextProjectJobList(projectPath: string): void }
  ).__delayNextProjectJobList(path), projectA)
  await closeA.click()
  await expect(closeA).toHaveAttribute('data-close-state', 'checking')
  await expect.poll(() => page.evaluate((path) => (
    window as Window & { __agentJobCloseCalls?: RuntimeCall[] }
  ).__agentJobCloseCalls?.filter((call) =>
    call.command === 'list_agent_jobs' &&
    call.args?.projectPath === path &&
    call.args?.sessionId == null,
  ).length ?? 0, projectA)).toBeGreaterThanOrEqual(2)

  await page.getByPlaceholder('Ask Codex').fill('must not start while project closes')
  await page.locator('.composer-input .send').click()
  await page.locator('.empty-card .btn').click()
  await rowB.click()
  await expect(rowB).toHaveAttribute('aria-pressed', 'true')

  await page.evaluate(() => (
    window as Window & { __resolveProjectJobList(): void }
  ).__resolveProjectJobList())
  await expect(rowA).toHaveCount(0)
  await expect(rowB).toHaveAttribute('aria-pressed', 'true')

  const calls = await page.evaluate(() => ({
    workspace: (window as Window & { __workspaceCloseCalls?: RuntimeCall[] }).__workspaceCloseCalls ?? [],
    auth: (window as Window & { __agentAuthCloseCalls?: RuntimeCall[] }).__agentAuthCloseCalls ?? [],
    agent: (window as Window & { __agentCloseCalls?: RuntimeCall[] }).__agentCloseCalls ?? [],
    terminal: (window as Window & { __terminalCloseCalls?: RuntimeCall[] }).__terminalCloseCalls ?? [],
  }))
  expect(calls.workspace.map((call) => call.command)).toContain('activate_workspace_project')
  expect(calls.workspace.map((call) => call.command)).toContain('close_workspace_project')
  expect(calls.auth.filter((call) =>
    call.command === 'read_agent_profile_snapshot',
  )).toHaveLength(1)
  expect(calls.auth.filter((call) =>
    call.command === 'authorize_agent_profile_lease',
  )).toHaveLength(0)
  expect(calls.agent.filter((call) =>
    call.command === 'request_agent_account_suggestions',
  )).toHaveLength(0)
  expect(calls.agent.filter((call) =>
    call.command === 'read_agent_provider_capabilities'
    || call.command === 'request_agent_suggestions',
  )).toHaveLength(0)
  expect(calls.terminal.filter((call) =>
    call.command === 'create_terminal_session' || call.command === 'close_terminal_session',
  )).toHaveLength(0)
})

test('does not accept a new dirty edit after the project close lease reaches runtime commit', async ({ page }) => {
  await installProjectCloseHarness(page)
  await page.goto('/')

  await expect(projectRow(page, projectA)).toHaveAttribute('data-project-state', 'ready')
  await page.locator('.tree-row.file').filter({ hasText: 'a.ts' }).click()
  const editor = page.locator('.editor-textarea')
  await expect(editor).toHaveValue('const close = true')
  await page.evaluate(() => (
    window as Window & { __delayNextProjectClose(): void }
  ).__delayNextProjectClose())
  await closeButton(page, projectA).click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __workspaceCloseCalls?: RuntimeCall[] }
  ).__workspaceCloseCalls?.filter((call) =>
    call.command === 'close_workspace_project',
  ).length ?? 0)).toBe(1)

  await editor.fill('const close = "dirty race"')
  await expect(editor).toHaveValue('const close = true')
  await page.evaluate(() => (
    window as Window & { __resolveProjectClose(): void }
  ).__resolveProjectClose())
  await expect(projectRow(page, projectA)).toHaveCount(0)
  expect(await page.evaluate(() => (
    window as Window & { __terminalCloseCalls?: RuntimeCall[] }
  ).__terminalCloseCalls?.filter((call) => call.command === 'close_terminal_session').length ?? 0)).toBe(0)
})

test('blocks authoritative running Agent jobs and terminal sessions without disabling selection', async ({ page }) => {
  await installProjectCloseHarness(page)
  await page.goto('/')
  const rowB = projectRow(page, projectB)
  const closeB = closeButton(page, projectB)
  await expect(projectRow(page, projectA)).toHaveAttribute('data-project-state', 'ready')

  await page.evaluate(() => (
    window as Window & { __setProjectJobStatus(status: string | null): void }
  ).__setProjectJobStatus('running'))
  await closeB.click()
  await expect(closeB).toHaveAttribute('data-close-state', 'blocked')
  await expect(page.locator('.project-close-reason')).toContainText('Agent job')
  await rowB.click()
  await expect(rowB).toHaveAttribute('aria-pressed', 'true')

  await page.evaluate(() => {
    const closeWindow = window as Window & {
      __setProjectJobStatus(status: string | null): void
      __setProjectTerminalStatus(status: string | null): void
    }
    closeWindow.__setProjectJobStatus(null)
    closeWindow.__setProjectTerminalStatus('running')
  })
  await closeB.click()
  await expect(closeB).toHaveAttribute('data-close-state', 'blocked')
  await expect(page.locator('.project-close-reason')).toContainText('running terminals')
  await expect(rowB).toHaveAttribute('aria-pressed', 'true')

  const calls = await page.evaluate(() => ({
    workspace: (window as Window & { __workspaceCloseCalls?: RuntimeCall[] }).__workspaceCloseCalls ?? [],
    terminal: (window as Window & { __terminalCloseCalls?: RuntimeCall[] }).__terminalCloseCalls ?? [],
  }))
  expect(calls.workspace.filter((call) => call.command === 'close_workspace_project')).toHaveLength(0)
  expect(calls.terminal.filter((call) => call.command === 'close_terminal_session')).toHaveLength(0)
})

test('fails closed on activity-list or workspace-close errors and leaves the registry usable', async ({ page }) => {
  await installProjectCloseHarness(page)
  await page.goto('/')
  const rowB = projectRow(page, projectB)
  const closeB = closeButton(page, projectB)
  await expect(projectRow(page, projectA)).toHaveAttribute('data-project-state', 'ready')

  await page.evaluate(() => (
    window as Window & { __failNextProjectJobList(message: string): void }
  ).__failNextProjectJobList('job database unavailable'))
  await closeB.click()
  await expect(closeB).toHaveAttribute('data-close-state', 'blocked')
  await expect(page.locator('.project-close-reason')).toContainText('job database unavailable')
  await expect(rowB).toBeVisible()

  await page.evaluate(() => (
    window as Window & { __failNextProjectClose(message: string): void }
  ).__failNextProjectClose('workspace file is locked'))
  await closeB.click()
  await expect(closeB).toHaveAttribute('data-close-state', 'blocked')
  await expect(page.locator('.project-close-reason')).toContainText('workspace file is locked')
  await expect(rowB).toBeVisible()
  await rowB.click()
  await expect(rowB).toHaveAttribute('aria-pressed', 'true')
})

test('blocks dirty editors and unresolved permission reviews before closing', async ({ page }) => {
  await installProjectCloseHarness(page)
  await page.goto('/')
  const closeA = closeButton(page, projectA)
  await expect(projectRow(page, projectA)).toHaveAttribute('data-project-state', 'ready')

  await page.locator('.tree-row.file').filter({ hasText: 'a.ts' }).click()
  await page.locator('.editor-textarea').fill('const close = "keep me"')
  await closeA.click()
  await expect(closeA).toHaveAttribute('data-close-state', 'blocked')
  await expect(page.locator('.project-close-reason')).toContainText('unsaved editor changes')
  await expect(page.locator('.editor-textarea')).toHaveValue('const close = "keep me"')

  await page.reload()
  const reloadedCloseA = closeButton(page, projectA)
  await expect(projectRow(page, projectA)).toHaveAttribute('data-project-state', 'ready')
  await page.getByPlaceholder('Ask Codex').fill('create a permission review')
  await page.locator('.composer-input .send').click()
  await expect(page.locator('.composer-approval')).toBeVisible()
  const calls = await page.evaluate(() => ({
    auth: (window as Window & { __agentAuthCloseCalls?: RuntimeCall[] }).__agentAuthCloseCalls ?? [],
    agent: (window as Window & { __agentCloseCalls?: RuntimeCall[] }).__agentCloseCalls ?? [],
    terminal: (window as Window & { __terminalCloseCalls?: RuntimeCall[] }).__terminalCloseCalls ?? [],
  }))
  const request = calls.agent.find(
    (call) => call.command === 'request_agent_account_suggestions',
  )?.args?.request
  expect(request).toEqual(expect.objectContaining({
    provider: 'codex',
    accountId: 'codex-default',
    incarnation: '1',
    credentialRevision: '1',
    projectPath: projectA,
    agentSessionId: 'close-agent-a',
    userTask: 'create a permission review',
  }))
  expect(calls.auth.filter((call) =>
    call.command === 'read_agent_profile_snapshot',
  )).toHaveLength(1)
  expect(calls.auth.filter((call) =>
    call.command === 'authorize_agent_profile_lease',
  )).toHaveLength(0)
  expect(calls.agent.filter((call) =>
    call.command === 'read_agent_provider_capabilities'
    || call.command === 'request_agent_suggestions',
  )).toHaveLength(0)
  expect(calls.terminal.filter((call) =>
    call.command === 'create_terminal_session'
    || call.command === 'execute_terminal_session_command'
    || call.command === 'create_terminal_session_with_command'
    || call.command === 'write_terminal_input',
  )).toHaveLength(0)
  await reloadedCloseA.click()
  await expect(reloadedCloseA).toHaveAttribute('data-close-state', 'blocked')
  await expect(page.locator('.project-close-reason')).toContainText('pending Agent permissions')
  await expect(page.locator('.composer-approval')).toBeVisible()
})

test('blocks a provisional PTY without closing or mutating its center terminal', async ({ page }) => {
  await installProjectCloseHarness(page)
  await page.goto('/')
  const closeA = closeButton(page, projectA)
  await expect(projectRow(page, projectA)).toHaveAttribute('data-project-state', 'ready')

  await page.evaluate(() => (
    window as Window & { __delayNextTerminalCreate(): void }
  ).__delayNextTerminalCreate())
  await page.locator('.empty-card .btn').click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __terminalCloseCalls?: RuntimeCall[] }
  ).__terminalCloseCalls?.filter((call) => call.command === 'create_terminal_session').length ?? 0)).toBe(1)
  await closeA.click()
  await expect(closeA).toHaveAttribute('data-close-state', 'blocked')
  await expect(page.locator('.project-close-reason')).toContainText('running terminals')

  const calls = await page.evaluate(() => ({
    workspace: (window as Window & { __workspaceCloseCalls?: RuntimeCall[] }).__workspaceCloseCalls ?? [],
    terminal: (window as Window & { __terminalCloseCalls?: RuntimeCall[] }).__terminalCloseCalls ?? [],
  }))
  expect(calls.workspace.filter((call) => call.command === 'close_workspace_project')).toHaveLength(0)
  expect(calls.terminal.filter((call) => call.command === 'close_terminal_session')).toHaveLength(0)
})

test('hydrates the deterministic next neighbor after safely closing the active project', async ({ page }) => {
  await installProjectCloseHarness(page)
  await page.goto('/')
  const rowB = projectRow(page, projectB)
  await expect(projectRow(page, projectA)).toHaveAttribute('data-project-state', 'ready')

  await closeButton(page, projectA).click()
  await expect(projectRow(page, projectA)).toHaveCount(0)
  await expect(rowB).toHaveAttribute('aria-pressed', 'true')
  await expect(rowB).toHaveAttribute('data-project-state', 'ready')
  await expect(page.locator('.titlebar')).toContainText('close-b')
  await expect(page.locator('.tree-row.file')).toContainText('b.ts')

  const calls = await page.evaluate(() => ({
    workspace: (window as Window & { __workspaceCloseCalls?: RuntimeCall[] }).__workspaceCloseCalls ?? [],
    terminal: (window as Window & { __terminalCloseCalls?: RuntimeCall[] }).__terminalCloseCalls ?? [],
  }))
  expect(calls.workspace).toContainEqual({
    command: 'close_workspace_project',
    args: { request: { path: projectA } },
  })
  expect(calls.terminal.filter((call) => call.command === 'close_terminal_session')).toHaveLength(0)
})
