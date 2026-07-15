import { expect, test, type Page } from '@playwright/test'

const projectA = '/workspace/claude-a'
const projectB = '/workspace/codex-b'
const sessionA = 'claude-session-a'
const sessionB = 'codex-session-b'

const installClaudeWorkspaceHarness = async (page: Page) => {
  await page.addInitScript(({ projectA, projectB, sessionA, sessionB }) => {
    type RuntimeCall = { command: string; args?: Record<string, unknown> }
    type SuggestionResolver = (value: unknown[]) => void
    type TestWindow = Window & {
      __providerCalls: RuntimeCall[]
      __authCalls: RuntimeCall[]
      __agentJobCalls: RuntimeCall[]
      __terminalCalls: RuntimeCall[]
      __resolveProviderRequest(
        provider: string,
        projectPath: string,
        agentSessionId: string,
        summary: string,
        command?: string,
      ): void
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
    const requestResolvers = new Map<string, SuggestionResolver>()
    const requestKey = (provider: string, projectPath: string, agentSessionId: string) =>
      `${provider}\u0000${projectPath}\u0000${agentSessionId}`
    const workspaceSnapshot = (activeProjectPath: string) => ({
      recentProjects: [projectA, projectB],
      openProjectPaths: [projectA, projectB],
      activeProjectPath,
      lastOpenedProjectPath: activeProjectPath,
      updatedAt: 500,
      storageVersion: 2,
    })
    const connection = (
      provider: 'codex' | 'claude',
      status: 'connected' | 'disconnected' = 'connected',
    ) => ({
      provider,
      displayName: provider === 'codex' ? 'Codex' : 'Claude',
      availability: 'available',
      status,
      connectionKind: 'real',
      accountLabel: status === 'connected'
        ? provider === 'codex' ? 'Codex CLI Session' : null
        : null,
      accountEmail: null,
      credentialSource: status === 'connected' && provider === 'claude'
        ? 'claude_cli_session'
        : null,
      requiredScopes: provider === 'codex'
        ? ['project:read', 'terminal:read']
        : status === 'connected'
          ? ['provider:request', 'credential:cli_session']
          : ['provider:request'],
      expiresAt: null,
      callbackUrl: null,
      authUrl: null,
      activeLoginId: null,
      activeLoginState: null,
      connectedAt: status === 'connected' ? 100 : null,
      lastLoginAttemptAt: 95,
      updatedAt: 120,
      lastError: null,
    })

    localStorage.setItem('gtum.agent-session-directory.v1', JSON.stringify({
      [projectA]: {
        workspaceTitle: 'claude-a',
        activeSessionId: sessionA,
        sessions: [{
          id: sessionA,
          title: 'Claude A',
          createdAt: '10:00',
          updatedAt: '10:00',
        }],
      },
      [projectB]: {
        workspaceTitle: 'codex-b',
        activeSessionId: sessionB,
        sessions: [{
          id: sessionB,
          title: 'Codex B',
          providerId: 'codex',
          createdAt: '10:00',
          updatedAt: '10:00',
        }],
      },
    }))

    bridgeWindow.__providerCalls = []
    bridgeWindow.__authCalls = []
    bridgeWindow.__agentJobCalls = []
    bridgeWindow.__terminalCalls = []
    bridgeWindow.__GTUM_AGENT_PROGRESS_STAGE_DELAY_MS__ = 1
    bridgeWindow.__GTUM_AGENT_JOB_POLL_INTERVAL_MS__ = 10_000
    bridgeWindow.__GTUM_AGENT_FLEET_POLL_INTERVAL_MS__ = 10_000
    bridgeWindow.__resolveProviderRequest = (
      provider,
      projectPath,
      agentSessionId,
      summary,
      command = '',
    ) => {
      const key = requestKey(provider, projectPath, agentSessionId)
      const resolve = requestResolvers.get(key)
      if (!resolve) throw new Error(`No pending provider request for ${key}`)
      requestResolvers.delete(key)
      resolve([{
        id: `${provider}-reply`,
        provider,
        summary,
        command,
        preferredTarget: 'new_tab',
        confidence: 'high',
        error: null,
      }])
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
          metadata: { name: path === projectA ? 'claude-a' : 'codex-b', path },
          tree: { name: 'root', path, kind: 'directory', children: [] },
          git: { isRepository: true, branch: 'dev', changedFilesCount: 0 },
        }
      },
    }
    bridgeWindow.__GTUM_AGENT_AUTH_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__authCalls.push({ command, args })
        if (command === 'list_agent_connections') {
          return [connection('claude', 'disconnected'), connection('codex')]
        }
        if (command === 'begin_agent_login') {
          return connection('claude')
        }
        throw new Error(`Unexpected auth command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_AGENT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__providerCalls.push({ command, args })
        if (command === 'read_agent_provider_capabilities') {
          const provider = String(args?.provider) as 'codex' | 'claude'
          return {
            provider,
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
          const request = args?.request as {
            provider?: string
            projectPath?: string
            agentSessionId?: string
          }
          const key = requestKey(
            String(request?.provider),
            String(request?.projectPath),
            String(request?.agentSessionId),
          )
          return new Promise<unknown[]>((resolve) => requestResolvers.set(key, resolve))
        }
        throw new Error(`Unexpected Agent command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_AGENT_JOB_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__agentJobCalls.push({ command, args })
        if (command === 'list_agent_jobs') return []
        if (command === 'create_agent_job') {
          const request = args?.request as {
            projectPath?: string
            command?: string
            name?: string
            sessionId?: string
          }
          return {
            jobId: 701,
            sessionId: request.sessionId || null,
            name: request.name || 'Claude isolated job',
            command: request.command || '',
            cwd: request.projectPath || '',
            runner: 'npm',
            runnerArgs: ['test', '--', '--claude'],
            processId: 9001,
            status: 'running',
            createdAt: 700,
            updatedAt: 701,
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
          }
        }
        throw new Error(`Unexpected Agent job command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_TERMINAL_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__terminalCalls.push({ command, args })
        throw new Error(`Provider work must not touch the center terminal: ${command}`)
      },
    }
  }, { projectA, projectB, sessionA, sessionB })
}

const projectRow = (page: Page, path: string) =>
  page.locator(`.project-switcher button[data-project-path="${path}"]`)

const sendRequest = async (page: Page, provider: string, text: string) => {
  await page.getByPlaceholder(`Ask ${provider}`).fill(text)
  await page.locator('.composer-input .send').click()
}

const installClaudeConnectionOrderingHarness = async (page: Page) => {
  await page.addInitScript(() => {
    type RuntimeCall = { command: string; args?: Record<string, unknown> }
    type TestWindow = Window & {
      __authCalls: RuntimeCall[]
      __terminalCalls: RuntimeCall[]
      __resolveProviderConnect(): void
      __resolveStaleConnectionList(): void
      __rejectStaleConnectionList(): void
      __GTUM_AGENT_AUTH_RUNTIME__: unknown
      __GTUM_TERMINAL_RUNTIME__: unknown
    }
    const bridgeWindow = window as TestWindow
    const providerConnection = (
      provider: 'claude' | 'codex',
      status: 'connected' | 'disconnected',
    ) => ({
      provider,
      displayName: provider === 'claude' ? 'Claude' : 'Codex',
      availability: 'available',
      status,
      connectionKind: 'real',
      accountLabel: status === 'connected'
        ? provider === 'claude' ? null : 'Codex CLI Session'
        : null,
      accountEmail: null,
      credentialSource: status === 'connected' && provider === 'claude'
        ? 'claude_cli_session'
        : null,
      requiredScopes: provider === 'claude' && status === 'connected'
        ? ['provider:request', 'credential:cli_session']
        : provider === 'claude'
          ? ['provider:request']
        : ['project:read', 'terminal:read'],
      expiresAt: null,
      callbackUrl: null,
      authUrl: null,
      activeLoginId: null,
      activeLoginState: null,
      connectedAt: status === 'connected' ? 200 : null,
      lastLoginAttemptAt: 190,
      updatedAt: status === 'connected' ? 200 : 100,
      lastError: null,
    })
    let resolveList: ((connections: unknown[]) => void) | null = null
    let rejectList: ((error: Error) => void) | null = null
    let resolveConnect: ((connection: unknown) => void) | null = null
    let connectingProvider: 'claude' | 'codex' | null = null

    bridgeWindow.__authCalls = []
    bridgeWindow.__terminalCalls = []
    bridgeWindow.__resolveProviderConnect = () => {
      if (!resolveConnect || !connectingProvider) throw new Error('No pending provider connect')
      const resolve = resolveConnect
      const provider = connectingProvider
      resolveConnect = null
      connectingProvider = null
      resolve(providerConnection(provider, 'connected'))
    }
    bridgeWindow.__resolveStaleConnectionList = () => {
      if (!resolveList) throw new Error('No pending connection list')
      const resolve = resolveList
      resolveList = null
      rejectList = null
      resolve([
        providerConnection('claude', 'disconnected'),
        providerConnection('codex', 'disconnected'),
      ])
    }
    bridgeWindow.__rejectStaleConnectionList = () => {
      if (!rejectList) throw new Error('No pending connection list')
      const reject = rejectList
      resolveList = null
      rejectList = null
      reject(new Error('stale connection discovery failed'))
    }
    bridgeWindow.__GTUM_AGENT_AUTH_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__authCalls.push({ command, args })
        if (command === 'list_agent_connections') {
          return new Promise<unknown[]>((resolve, reject) => {
            resolveList = resolve
            rejectList = reject
          })
        }
        if (command === 'begin_agent_login') {
          connectingProvider = String(args?.provider) as 'claude' | 'codex'
          return new Promise<unknown>((resolve) => {
            resolveConnect = resolve
          })
        }
        throw new Error(`Unexpected auth command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_TERMINAL_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__terminalCalls.push({ command, args })
        throw new Error(`Claude connect must not touch the center terminal: ${command}`)
      },
    }
  })
}

test('keeps a completed Claude connect ahead of stale discovery and blocks repeat pending login', async ({ page }) => {
  await installClaudeConnectionOrderingHarness(page)
  await page.goto('/')
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => call.command === 'list_agent_connections').length ?? 0)).toBe(1)

  await page.locator('.titlebar .pill.icon-only').click()
  const claudeSettings = page.locator('.settings-provider').filter({ hasText: 'Claude' })
  await claudeSettings.getByRole('button', { name: 'Connect' }).click()
  const pending = claudeSettings.getByRole('button', { name: 'Checking…' })
  await expect(pending).toBeDisabled()
  await pending.evaluate((button) => button.click())
  expect(await page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => call.command === 'begin_agent_login').length ?? 0)).toBe(1)

  await page.evaluate(() => (
    window as Window & { __resolveProviderConnect(): void }
  ).__resolveProviderConnect())
  await expect(page.locator('.settings-overlay')).toHaveCount(0)
  await page.evaluate(() => (
    window as Window & { __resolveStaleConnectionList(): void }
  ).__resolveStaleConnectionList())

  await page.locator('.titlebar .pill.icon-only').click()
  const connectedClaude = page.locator('.settings-provider').filter({ hasText: 'Claude' })
  await expect(connectedClaude).toContainText('Connected')
  await expect(connectedClaude).toContainText('CLI session')
  await expect(connectedClaude).toContainText('credential:cli_session')
  await expect(connectedClaude).not.toContainText('credential:api_key')
  await expect(connectedClaude).not.toContainText('API credential')
  await expect(connectedClaude.getByRole('button', { name: 'Disconnect' })).toBeVisible()
  await expect(connectedClaude.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('does not let stale discovery failure overwrite a completed Codex connect', async ({ page }) => {
  await installClaudeConnectionOrderingHarness(page)
  await page.goto('/')
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => call.command === 'list_agent_connections').length ?? 0)).toBe(1)

  await page.locator('.titlebar .pill.icon-only').click()
  const codexSettings = page.locator('.settings-provider').filter({ hasText: 'Codex' })
  await codexSettings.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(codexSettings.getByRole('button', { name: 'Checking…' })).toBeDisabled()
  await page.evaluate(() => (
    window as Window & { __resolveProviderConnect(): void }
  ).__resolveProviderConnect())
  await expect(page.locator('.settings-overlay')).toHaveCount(0)
  await page.evaluate(() => (
    window as Window & { __rejectStaleConnectionList(): void }
  ).__rejectStaleConnectionList())

  await page.locator('.titlebar .pill.icon-only').click()
  const connectedCodex = page.locator('.settings-provider').filter({ hasText: 'Codex' })
  await expect(connectedCodex).toContainText('Connected')
  await expect(connectedCodex).toContainText('CLI session')
  await expect(connectedCodex.getByRole('button', { name: 'Disconnect' })).toBeVisible()
  await expect(connectedCodex.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('keeps Claude and Codex selections and delayed results in their project sessions', async ({ page }) => {
  await installClaudeWorkspaceHarness(page)
  await page.goto('/')

  await expect(page.locator('.agent')).toHaveAttribute('data-agent-project-path', projectA)
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-provider-id', 'codex')
  await page.locator('.titlebar .pill.icon-only').click()
  const claudeSettings = page.locator('.settings-provider').filter({ hasText: 'Claude' })
  await expect(claudeSettings.getByRole('button', { name: 'Connect' })).toBeVisible()
  await claudeSettings.getByRole('button', { name: 'Connect' }).click()
  await expect(page.locator('.settings-overlay')).toHaveCount(0)
  await expect(page.locator('.msg.assistant').last()).toContainText(
    'Claude connected through the local Claude CLI session.',
  )
  await page.locator('.composer-provider-chip').click()
  await page.getByRole('option', { name: /Claude/ }).click()
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-provider-id', 'claude')
  await expect(page.getByPlaceholder('Ask Claude')).toBeVisible()
  await expect(page.locator('.composer-provider-chip')).toContainText('Claude CLI session')

  await sendRequest(page, 'Claude', 'request from A')
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __providerCalls?: RuntimeCall[] }
  ).__providerCalls?.filter((call) => call.command === 'request_agent_suggestions').length ?? 0)).toBe(1)
  await projectRow(page, projectB).click()
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-provider-id', 'codex')
  await expect(page.getByPlaceholder('Ask Codex')).toBeVisible()
  await sendRequest(page, 'Codex', 'request from B')
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __providerCalls?: RuntimeCall[] }
  ).__providerCalls?.filter((call) => call.command === 'request_agent_suggestions').length ?? 0)).toBe(2)

  await page.evaluate(({ projectB, sessionB }) => (
    window as Window & {
      __resolveProviderRequest(
        provider: string,
        projectPath: string,
        agentSessionId: string,
        summary: string,
        command?: string,
      ): void
    }
  ).__resolveProviderRequest('codex', projectB, sessionB, 'Codex B completed'), {
    projectB,
    sessionB,
  })
  await expect(page.locator('.agent')).toContainText('Codex B completed')
  await expect(page.locator('.agent')).not.toContainText('Claude A completed')

  await page.evaluate(({ projectA, sessionA }) => (
    window as Window & {
      __resolveProviderRequest(
        provider: string,
        projectPath: string,
        agentSessionId: string,
        summary: string,
        command?: string,
      ): void
    }
  ).__resolveProviderRequest(
    'claude',
    projectA,
    sessionA,
    'Claude A completed',
    'npm test -- --claude',
  ), {
    projectA,
    sessionA,
  })
  await expect(page.locator('.agent')).not.toContainText('Claude A completed')

  await projectRow(page, projectA).click()
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-provider-id', 'claude')
  await expect(page.locator('.agent')).toContainText('Claude A completed')
  await expect(page.locator('.agent .role-tag.assistant').filter({ hasText: 'Claude' })).toBeVisible()
  await expect(page.locator('.agent')).not.toContainText('Codex B completed')
  const permission = page.locator('.composer-approval')
  await expect(permission).toContainText('npm test -- --claude')
  await permission.getByRole('button', { name: 'Allow once' }).click()
  await expect(page.locator('.agent')).toContainText('agent job #701')

  const requests = await page.evaluate(() => (
    window as Window & { __providerCalls?: Array<{ command: string; args?: Record<string, unknown> }> }
  ).__providerCalls?.filter((call) => call.command === 'request_agent_suggestions') ?? [])
  expect(requests.map((call) => call.args?.request)).toEqual([
    expect.objectContaining({
      provider: 'claude',
      projectPath: projectA,
      agentSessionId: sessionA,
    }),
    expect.objectContaining({
      provider: 'codex',
      projectPath: projectB,
      agentSessionId: sessionB,
    }),
  ])
  const authCalls = await page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => call.command === 'begin_agent_login') ?? [])
  expect(authCalls).toHaveLength(1)
  expect(authCalls[0]?.args).toEqual(expect.objectContaining({ provider: 'claude' }))
  const jobCreates = await page.evaluate(() => (
    window as Window & { __agentJobCalls?: RuntimeCall[] }
  ).__agentJobCalls?.filter((call) => call.command === 'create_agent_job') ?? [])
  expect(jobCreates).toHaveLength(1)
  expect(jobCreates[0]?.args?.request).toEqual(expect.objectContaining({
    projectPath: projectA,
    sessionId: sessionA,
    command: 'npm test -- --claude',
  }))
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
  await expect.poll(() => page.evaluate(({ projectA }) => {
    const directory = JSON.parse(localStorage.getItem('gtum.agent-session-directory.v1') || '{}')
    return directory[projectA]?.sessions?.[0]?.providerId
  }, { projectA })).toBe('claude')
})

type RuntimeCall = { command: string; args?: Record<string, unknown> }
