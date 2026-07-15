import { expect, test, type Page } from '@playwright/test'

const projectA = '/workspace/claude-a'
const projectB = '/workspace/codex-b'
const sessionA = 'claude-session-a'
const sessionB = 'codex-session-b'

const claudeModelCatalog = [
  {
    providerId: 'claude',
    modelId: 'default',
    label: 'Default (recommended) · Opus 4.8 with 1M context',
  },
  {
    providerId: 'claude',
    modelId: 'opus[1m]',
    label: 'Opus · Opus 4.8 with 1M context',
  },
  {
    providerId: 'claude',
    modelId: 'claude-fable-5[1m]',
    label: 'Fable · Fable 5',
  },
  {
    providerId: 'claude',
    modelId: 'sonnet',
    label: 'Sonnet · Sonnet 5',
  },
  {
    providerId: 'claude',
    modelId: 'haiku',
    label: 'Haiku · Haiku 4.5',
  },
] as const

const claudePriorPolicyCatalog = [
  {
    providerId: 'claude',
    modelId: 'opus[1m]',
    label: 'Opus · Prior account policy',
  },
] as const

const claudeUpdatedPolicyCatalog = [
  {
    providerId: 'claude',
    modelId: 'sonnet',
    label: 'Sonnet · Updated account policy',
  },
] as const

const claudeExecutionMetadataCatalog = [
  {
    providerId: 'claude',
    modelId: 'metadata-a',
    label: 'Metadata A',
    executionOptions: {
      reasoningLevels: [
        { level: 'high', label: 'High', description: 'Greater reasoning depth' },
        { level: 'low', label: 'Low', description: 'Fast, lighter reasoning' },
        { level: 'max', label: 'Max' },
      ],
      supportsFastMode: true,
    },
  },
  {
    providerId: 'claude',
    modelId: 'metadata-b',
    label: 'Metadata B',
    executionOptions: {
      reasoningLevels: [
        { level: 'medium', label: 'Medium' },
        { level: 'xhigh', label: 'XHigh' },
      ],
      supportsFastMode: false,
    },
  },
  {
    providerId: 'claude',
    modelId: 'metadata-c',
    label: 'Metadata C',
    executionOptions: {
      reasoningLevels: [],
      supportsFastMode: false,
    },
  },
] as const

const claudeMaxHumanLabel = `Maximum catalog label · ${'W'.repeat(132)}`

type ClaudeCapabilityFixture = {
  deferred?: boolean
  models: ReadonlyArray<{
    providerId: 'claude'
    modelId: string
    label: string
    executionOptions?: {
      reasoningLevels: ReadonlyArray<{
        level: string
        label: string
        description?: string | null
      }>
      supportsFastMode: boolean
    }
  }>
}

type ClaudeWorkspaceHarnessOptions = {
  sessionAProvider?: 'codex' | 'claude'
  sessionASelectedModels?: Record<string, unknown>
  sessionAPreferences?: Record<string, unknown>
  sessionBPreferences?: Record<string, unknown>
  claudeSupportsModelSelection?: boolean
  includeAdvancedControls?: boolean
  claudeInitialConnectionStatus?: 'connected' | 'disconnected'
  claudeCapabilityFixtures?: ClaudeCapabilityFixture[]
  deferInitialConnectionList?: boolean
}

const installClaudeWorkspaceHarness = async (
  page: Page,
  options: ClaudeWorkspaceHarnessOptions = {},
) => {
  await page.addInitScript(({
    projectA,
    projectB,
    sessionA,
    sessionB,
    options,
    claudeModelCatalog,
  }) => {
    type RuntimeCall = { command: string; args?: Record<string, unknown> }
    type SuggestionResolver = (value: unknown[]) => void
    type TestWindow = Window & {
      __providerCalls: RuntimeCall[]
      __authCalls: RuntimeCall[]
      __agentJobCalls: RuntimeCall[]
      __terminalCalls: RuntimeCall[]
      __claudeCapabilityReadCount: number
      __resolveClaudeCapabilityRead(readIndex: number, models: unknown[]): void
      __rejectClaudeCapabilityRead(readIndex: number, message: string): void
      __resolveInitialConnectionList(status: 'connected' | 'disconnected'): void
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
    const pendingClaudeCapabilities = new Map<number, {
      resolve(models: unknown[]): void
      reject(error: Error): void
    }>()
    let resolveInitialConnectionList: ((status: 'connected' | 'disconnected') => void) | null = null
    let claudeConnectionStatus = options.claudeInitialConnectionStatus || 'connected'
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

    if (!localStorage.getItem('gtum.agent-session-directory.v1')) {
      localStorage.setItem('gtum.agent-session-directory.v1', JSON.stringify({
        [projectA]: {
          workspaceTitle: 'claude-a',
          activeSessionId: sessionA,
          sessions: [{
            id: sessionA,
            title: 'Claude A',
            providerId: options.sessionAProvider || 'codex',
            selectedModels: options.sessionASelectedModels || {},
            ...(options.sessionAPreferences || {}),
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
            ...(options.sessionBPreferences || {}),
            createdAt: '10:00',
            updatedAt: '10:00',
          }],
        },
      }))
    }

    bridgeWindow.__providerCalls = []
    bridgeWindow.__authCalls = []
    bridgeWindow.__agentJobCalls = []
    bridgeWindow.__terminalCalls = []
    bridgeWindow.__claudeCapabilityReadCount = 0
    bridgeWindow.__resolveClaudeCapabilityRead = (readIndex, models) => {
      const pending = pendingClaudeCapabilities.get(readIndex)
      if (!pending) throw new Error(`No pending Claude capability read ${readIndex}`)
      pendingClaudeCapabilities.delete(readIndex)
      pending.resolve(models)
    }
    bridgeWindow.__rejectClaudeCapabilityRead = (readIndex, message) => {
      const pending = pendingClaudeCapabilities.get(readIndex)
      if (!pending) throw new Error(`No pending Claude capability read ${readIndex}`)
      pendingClaudeCapabilities.delete(readIndex)
      pending.reject(new Error(message))
    }
    bridgeWindow.__resolveInitialConnectionList = (status) => {
      if (!resolveInitialConnectionList) throw new Error('No pending initial connection list')
      const resolve = resolveInitialConnectionList
      resolveInitialConnectionList = null
      resolve(status)
    }
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
          if (options.deferInitialConnectionList) {
            return new Promise((resolve) => {
              resolveInitialConnectionList = (status) => {
                claudeConnectionStatus = status
                resolve([connection('claude', status), connection('codex')])
              }
            })
          }
          return [connection('claude', claudeConnectionStatus), connection('codex')]
        }
        if (command === 'begin_agent_login') {
          const provider = String(args?.provider) as 'codex' | 'claude'
          if (provider === 'claude') claudeConnectionStatus = 'connected'
          return connection(provider)
        }
        if (command === 'disconnect_agent_provider') {
          const provider = String(args?.provider) as 'codex' | 'claude'
          if (provider === 'claude') claudeConnectionStatus = 'disconnected'
          return connection(provider, 'disconnected')
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
          const capabilitySnapshot = (models: unknown[]) => ({
            provider,
            supportsModelSelection: models.length > 0,
            currentModel: models[0] || null,
            availableModels: models,
            reasoningLevels: options.includeAdvancedControls
              ? [
                  { level: 'low', label: 'Low', description: 'Fast, lighter reasoning' },
                  { level: 'medium', label: 'Medium', description: 'Balanced reasoning' },
                  { level: 'high', label: 'High', description: 'Greater reasoning depth' },
                  { level: 'xhigh', label: 'XHigh', description: 'Maximum reasoning depth' },
                ]
              : [],
            defaultReasoningLevel: options.includeAdvancedControls ? 'high' : null,
            supportsFastMode: options.includeAdvancedControls === true,
            attachments: [],
          })
          if (provider === 'claude' && options.claudeCapabilityFixtures?.length) {
            const readIndex = ++bridgeWindow.__claudeCapabilityReadCount
            const fixture = options.claudeCapabilityFixtures[readIndex - 1]
              || options.claudeCapabilityFixtures[options.claudeCapabilityFixtures.length - 1]
            if (fixture.deferred) {
              return new Promise((resolve, reject) => {
                pendingClaudeCapabilities.set(readIndex, {
                  resolve: (models) => resolve(capabilitySnapshot(models)),
                  reject,
                })
              })
            }
            return capabilitySnapshot([...fixture.models])
          }
          const availableModels = provider === 'claude'
            ? claudeModelCatalog
            : [
                { providerId: 'codex', modelId: 'gpt-default', label: 'GPT default' },
                { providerId: 'codex', modelId: 'gpt-5-codex', label: 'GPT-5 Codex' },
                { providerId: 'codex', modelId: 'gpt-mini', label: 'GPT Mini' },
              ]
          const supportsModelSelection = provider === 'claude'
            ? options.claudeSupportsModelSelection !== false
            : true
          return capabilitySnapshot(supportsModelSelection ? [...availableModels] : [])
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
  }, { projectA, projectB, sessionA, sessionB, options, claudeModelCatalog })
}

const projectRow = (page: Page, path: string) =>
  page.locator(`.project-switcher button[data-project-path="${path}"]`)

const sendRequest = async (page: Page, provider: string, text: string) => {
  await page.getByPlaceholder(`Ask ${provider}`).fill(text)
  await page.locator('.composer-input .send').click()
}

const modelTrigger = (page: Page, provider: 'Codex' | 'Claude') =>
  page.getByRole('button', { name: new RegExp(`^${provider} model:`) })

const switchProvider = async (page: Page, provider: 'Codex' | 'Claude') => {
  await page.locator('.composer-provider-chip').click()
  await page.getByRole('option', { name: new RegExp(`^${provider}`) }).click()
}

const resizeAgentPanel = async (page: Page, targetWidth: number) => {
  const agent = await page.locator('.agent').boundingBox()
  const resizeHandle = await page.locator('.resize-handle.handle-right').boundingBox()
  expect(agent).not.toBeNull()
  expect(resizeHandle).not.toBeNull()
  const dragDistance = agent!.width - targetWidth
  const handleX = resizeHandle!.x + resizeHandle!.width / 2
  const handleY = resizeHandle!.y + resizeHandle!.height / 2

  await page.mouse.move(handleX, handleY)
  await page.mouse.down()
  await page.mouse.move(handleX + dragDistance, handleY, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => Math.abs(
    ((await page.locator('.agent').boundingBox())?.width ?? 0) - targetWidth,
  )).toBeLessThanOrEqual(1)
}

const flushBrowserLayout = async (page: Page) => {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
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

test('refreshes after connected startup discovery and ignores the older catalog rejection', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'claude',
    claudeInitialConnectionStatus: 'connected',
    deferInitialConnectionList: true,
    claudeCapabilityFixtures: [
      { deferred: true, models: [] },
      { models: claudeUpdatedPolicyCatalog },
    ],
  })
  await page.goto('/')

  await expect.poll(() => page.evaluate(() => (
    window as Window & { __claudeCapabilityReadCount?: number }
  ).__claudeCapabilityReadCount ?? 0)).toBe(1)
  await expect(modelTrigger(page, 'Claude')).toHaveCount(0)

  await page.evaluate(() => (
    window as Window & {
      __resolveInitialConnectionList(status: 'connected' | 'disconnected'): void
    }
  ).__resolveInitialConnectionList('connected'))
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __claudeCapabilityReadCount?: number }
  ).__claudeCapabilityReadCount ?? 0)).toBe(2)
  await expect(modelTrigger(page, 'Claude')).toHaveAttribute(
    'aria-label',
    `Claude model: ${claudeUpdatedPolicyCatalog[0].label}`,
  )

  await page.evaluate(() => (
    window as Window & {
      __rejectClaudeCapabilityRead(readIndex: number, message: string): void
    }
  ).__rejectClaudeCapabilityRead(1, 'stale startup catalog failure'))
  await flushBrowserLayout(page)

  await expect(modelTrigger(page, 'Claude')).toHaveAttribute(
    'aria-label',
    `Claude model: ${claudeUpdatedPolicyCatalog[0].label}`,
  )
  await page.locator('.titlebar .pill.icon-only').click()
  const claudeSettings = page.locator('.settings-provider').filter({ hasText: 'Claude' })
  await expect(claudeSettings).toContainText('Connected')
  await expect(claudeSettings.getByRole('button', { name: 'Disconnect' })).toBeVisible()
})

test('clears startup capabilities after disconnected discovery and ignores the older success', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'claude',
    claudeInitialConnectionStatus: 'disconnected',
    deferInitialConnectionList: true,
    claudeCapabilityFixtures: [
      { deferred: true, models: claudePriorPolicyCatalog },
    ],
  })
  await page.goto('/')

  await expect.poll(() => page.evaluate(() => (
    window as Window & { __claudeCapabilityReadCount?: number }
  ).__claudeCapabilityReadCount ?? 0)).toBe(1)
  await page.evaluate(() => (
    window as Window & {
      __resolveInitialConnectionList(status: 'connected' | 'disconnected'): void
    }
  ).__resolveInitialConnectionList('disconnected'))
  await page.evaluate(({ models }) => (
    window as Window & {
      __resolveClaudeCapabilityRead(readIndex: number, values: unknown[]): void
    }
  ).__resolveClaudeCapabilityRead(1, models), { models: [...claudePriorPolicyCatalog] })
  await flushBrowserLayout(page)

  await expect(modelTrigger(page, 'Claude')).toHaveCount(0)
  await page.locator('.titlebar .pill.icon-only').click()
  const claudeSettings = page.locator('.settings-provider').filter({ hasText: 'Claude' })
  await expect(claudeSettings.getByRole('button', { name: 'Connect', exact: true })).toBeVisible()
})

test('refreshes an active Claude catalog immediately after connecting without a provider switch', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'claude',
    claudeInitialConnectionStatus: 'disconnected',
    claudeCapabilityFixtures: [
      { models: [] },
      { models: claudeModelCatalog },
    ],
  })
  await page.goto('/')

  await expect.poll(() => page.evaluate(() => (
    window as Window & { __claudeCapabilityReadCount?: number }
  ).__claudeCapabilityReadCount ?? 0)).toBe(1)
  await expect(modelTrigger(page, 'Claude')).toHaveCount(0)

  await page.locator('.titlebar .pill.icon-only').click()
  const claudeSettings = page.locator('.settings-provider').filter({ hasText: 'Claude' })
  await claudeSettings.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(page.locator('.settings-overlay')).toHaveCount(0)

  await expect.poll(() => page.evaluate(() => (
    window as Window & { __claudeCapabilityReadCount?: number }
  ).__claudeCapabilityReadCount ?? 0)).toBe(2)
  const trigger = modelTrigger(page, 'Claude')
  await expect(trigger).toHaveAttribute(
    'aria-label',
    `Claude model: ${claudeModelCatalog[0].label}`,
  )
  await trigger.click()
  await expect(page.getByRole('listbox', { name: 'Claude models' }).getByRole('option'))
    .toHaveCount(claudeModelCatalog.length)
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('clears Claude capabilities across disconnects and ignores stale policy reads after reconnect', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'claude',
    claudeInitialConnectionStatus: 'connected',
    claudeCapabilityFixtures: [
      { models: claudePriorPolicyCatalog },
      { deferred: true, models: claudePriorPolicyCatalog },
      { models: claudeUpdatedPolicyCatalog },
    ],
  })
  await page.goto('/')

  await expect.poll(() => page.evaluate(() => (
    window as Window & { __claudeCapabilityReadCount?: number }
  ).__claudeCapabilityReadCount ?? 0)).toBe(1)
  await expect(modelTrigger(page, 'Claude')).toHaveAttribute(
    'aria-label',
    `Claude model: ${claudePriorPolicyCatalog[0].label}`,
  )

  await page.locator('.titlebar .pill.icon-only').click()
  let claudeSettings = page.locator('.settings-provider').filter({ hasText: 'Claude' })
  await claudeSettings.getByRole('button', { name: 'Disconnect' }).click()
  await expect(claudeSettings.getByRole('button', { name: 'Connect', exact: true })).toBeVisible()
  await expect(modelTrigger(page, 'Claude')).toHaveCount(0)

  await claudeSettings.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(page.locator('.settings-overlay')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __claudeCapabilityReadCount?: number }
  ).__claudeCapabilityReadCount ?? 0)).toBe(2)
  await expect(modelTrigger(page, 'Claude')).toHaveCount(0)

  await page.locator('.titlebar .pill.icon-only').click()
  claudeSettings = page.locator('.settings-provider').filter({ hasText: 'Claude' })
  await claudeSettings.getByRole('button', { name: 'Disconnect' }).click()
  await expect(claudeSettings.getByRole('button', { name: 'Connect', exact: true })).toBeVisible()
  await expect(modelTrigger(page, 'Claude')).toHaveCount(0)

  await claudeSettings.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(page.locator('.settings-overlay')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __claudeCapabilityReadCount?: number }
  ).__claudeCapabilityReadCount ?? 0)).toBe(3)
  await expect(modelTrigger(page, 'Claude')).toHaveAttribute(
    'aria-label',
    `Claude model: ${claudeUpdatedPolicyCatalog[0].label}`,
  )

  await page.evaluate(({ models }) => (
    window as Window & {
      __resolveClaudeCapabilityRead(readIndex: number, values: unknown[]): void
    }
  ).__resolveClaudeCapabilityRead(2, models), { models: [...claudePriorPolicyCatalog] })
  await flushBrowserLayout(page)

  const updatedTrigger = modelTrigger(page, 'Claude')
  await expect(updatedTrigger).toHaveAttribute(
    'aria-label',
    `Claude model: ${claudeUpdatedPolicyCatalog[0].label}`,
  )
  await updatedTrigger.click()
  const menu = page.getByRole('listbox', { name: 'Claude models' })
  await expect(menu.getByRole('option', {
    name: claudeUpdatedPolicyCatalog[0].label,
    exact: true,
  })).toHaveCount(1)
  await expect(menu.getByRole('option', {
    name: claudePriorPolicyCatalog[0].label,
    exact: true,
  })).toHaveCount(0)
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('keeps the model popup within the Agent panel at 1280x720', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await installClaudeWorkspaceHarness(page, { sessionAProvider: 'claude' })
  await page.goto('/')

  const trigger = modelTrigger(page, 'Claude')
  await expect(trigger).toHaveAttribute('aria-label', `Claude model: ${claudeModelCatalog[0].label}`)
  await trigger.click()
  const menu = page.getByRole('listbox', { name: 'Claude models' })
  await expect(menu).toBeVisible()

  const [agentBox, menuBox] = await Promise.all([
    page.locator('.agent').boundingBox(),
    menu.boundingBox(),
  ])
  expect(agentBox).not.toBeNull()
  expect(menuBox).not.toBeNull()
  expect(menuBox!.x).toBeGreaterThanOrEqual(agentBox!.x)
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(agentBox!.x + agentBox!.width)
  expect(menuBox!.x).toBeGreaterThanOrEqual(0)
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(1280)
})

test('keeps the selected bottom Claude model visible after reopening', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await installClaudeWorkspaceHarness(page, { sessionAProvider: 'claude' })
  await page.goto('/')

  const trigger = modelTrigger(page, 'Claude')
  await trigger.click()
  let menu = page.getByRole('listbox', { name: 'Claude models' })
  await menu.getByRole('option').last().click()
  await expect(trigger).toHaveAttribute('aria-label', `Claude model: ${claudeModelCatalog[4].label}`)

  await trigger.click()
  menu = page.getByRole('listbox', { name: 'Claude models' })
  const selected = menu.locator('[role="option"][aria-selected="true"]')
  await expect(selected).toHaveCount(1)
  const geometry = await selected.evaluate((option) => {
    const listbox = option.closest('[role="listbox"]')
    if (!(listbox instanceof HTMLElement)) throw new Error('Selected option lost its listbox')
    const listboxRect = listbox.getBoundingClientRect()
    const optionRect = option.getBoundingClientRect()
    const visibleTop = listboxRect.top + listbox.clientTop
    return {
      optionTop: optionRect.top,
      optionBottom: optionRect.bottom,
      visibleTop,
      visibleBottom: visibleTop + listbox.clientHeight,
    }
  })
  expect(geometry.optionTop).toBeGreaterThanOrEqual(geometry.visibleTop - 0.5)
  expect(geometry.optionBottom).toBeLessThanOrEqual(geometry.visibleBottom + 0.5)
  await expect(selected).toHaveText(claudeModelCatalog[4].label)
})

test('renders the live Claude catalog as one-line readable labels without raw ids', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await installClaudeWorkspaceHarness(page, { sessionAProvider: 'claude' })
  await page.goto('/')

  await modelTrigger(page, 'Claude').click()
  const menu = page.getByRole('listbox', { name: 'Claude models' })
  await expect(menu.getByRole('option')).toHaveCount(claudeModelCatalog.length)
  await expect(menu.locator('[role="option"][aria-selected="true"]')).toHaveCount(1)

  for (const model of claudeModelCatalog) {
    const option = menu.getByRole('option', { name: model.label, exact: true })
    await expect(option).toHaveCount(1)
    await expect(option).toHaveText(model.label)
    await expect(option).toHaveAttribute('data-model-id', model.modelId)
    await expect(option).toHaveAttribute('title', model.modelId)
    await expect(option.locator('code')).toHaveCount(0)

    const labelGeometry = await option.locator('span').evaluate((label) => {
      const range = document.createRange()
      range.selectNodeContents(label)
      const lineTops = new Set(
        Array.from(range.getClientRects())
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .map((rect) => Math.round(rect.top * 10) / 10),
      )
      return {
        lineCount: lineTops.size,
        clientWidth: label.clientWidth,
        scrollWidth: label.scrollWidth,
        menuWidth: label.closest('[role="listbox"]')?.getBoundingClientRect().width ?? 0,
      }
    })
    expect(labelGeometry.lineCount, `${model.modelId}: ${JSON.stringify(labelGeometry)}`).toBe(1)
    expect(labelGeometry.scrollWidth).toBeLessThanOrEqual(labelGeometry.clientWidth + 1)
  }
})

test('wraps a maximum-length account label at default width without clipping its exact name', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'claude',
    claudeInitialConnectionStatus: 'connected',
    claudeCapabilityFixtures: [{
      models: [{
        providerId: 'claude',
        modelId: 'maximum-label-model',
        label: claudeMaxHumanLabel,
      }],
    }],
  })
  await page.goto('/')

  const trigger = modelTrigger(page, 'Claude')
  await expect(trigger).toHaveAttribute('aria-label', `Claude model: ${claudeMaxHumanLabel}`)
  await trigger.click()
  const menu = page.getByRole('listbox', { name: 'Claude models' })
  const option = menu.getByRole('option', { name: claudeMaxHumanLabel, exact: true })
  await expect(option).toHaveText(claudeMaxHumanLabel)

  const geometry = await option.locator('span').evaluate((label) => {
    const option = label.closest('[role="option"]')
    const listbox = label.closest('[role="listbox"]')
    if (!(option instanceof HTMLElement) || !(listbox instanceof HTMLElement)) {
      throw new Error('Model label lost its option/listbox')
    }
    const optionRect = option.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(label)
    const lineRects = Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
    return {
      text: label.textContent,
      lineCount: new Set(lineRects.map((rect) => Math.round(rect.top * 10) / 10)).size,
      clientWidth: label.clientWidth,
      scrollWidth: label.scrollWidth,
      menuClientWidth: listbox.clientWidth,
      menuScrollWidth: listbox.scrollWidth,
      fullyInsideOption: lineRects.every((rect) => (
        rect.left >= optionRect.left - 0.5
        && rect.right <= optionRect.right + 0.5
        && rect.top >= optionRect.top - 0.5
        && rect.bottom <= optionRect.bottom + 0.5
      )),
    }
  })
  expect(geometry.text).toBe(claudeMaxHumanLabel)
  expect(geometry.lineCount).toBeGreaterThan(1)
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1)
  expect(geometry.menuScrollWidth).toBeLessThanOrEqual(geometry.menuClientWidth + 1)
  expect(geometry.fullyInsideOption).toBe(true)
})

test('Claude effort and Fast controls follow selected-model metadata without alias assumptions', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'claude',
    includeAdvancedControls: true,
    claudeCapabilityFixtures: [{ models: claudeExecutionMetadataCatalog }],
  })
  await page.goto('/')

  const reasoningTrigger = page.locator('.composer-reasoning-chip')
  const fastTrigger = page.locator('.fast-toggle')
  const chooseModel = async (model: typeof claudeExecutionMetadataCatalog[number]) => {
    await modelTrigger(page, 'Claude').click()
    await page.getByRole('listbox', { name: 'Claude models' })
      .getByRole('option', { name: model.label, exact: true })
      .click()
    await expect(modelTrigger(page, 'Claude'))
      .toHaveAttribute('aria-label', `Claude model: ${model.label}`)
  }
  const openReasoningMenu = async () => {
    await reasoningTrigger.click()
    const menu = page.getByRole('listbox', { name: 'Reasoning levels' })
    await expect(menu).toBeVisible()
    return menu
  }

  await expect(modelTrigger(page, 'Claude'))
    .toHaveAttribute('aria-label', 'Claude model: Metadata A')
  await expect(reasoningTrigger).toHaveAttribute('aria-label', 'Reasoning level: Default')
  await expect(fastTrigger).toHaveAttribute('aria-label', 'Fast mode: Disabled')

  let reasoningMenu = await openReasoningMenu()
  await expect(reasoningMenu.getByRole('option')).toHaveText(['Default', 'High', 'Low', 'Max'])
  await expect(reasoningMenu.locator('[role="option"][aria-selected="true"]')).toHaveCount(1)
  await expect(reasoningMenu.locator('[role="option"][aria-selected="true"]')).toHaveText('Default')
  await expect(page.locator('.reasoning-bars i.active')).toHaveCount(0)
  await reasoningMenu.getByRole('option', { name: 'High', exact: true }).click()
  const highActiveBarCount = await page.locator('.reasoning-bars i.active').count()
  reasoningMenu = await openReasoningMenu()
  await reasoningMenu.getByRole('option', { name: 'Low', exact: true }).click()
  const lowActiveBarCount = await page.locator('.reasoning-bars i.active').count()
  expect(highActiveBarCount).toBeGreaterThan(lowActiveBarCount)
  await expect(reasoningTrigger).toHaveAttribute('aria-label', 'Reasoning level: Low')

  await fastTrigger.click()
  await page.getByRole('listbox', { name: 'Fast mode' })
    .getByRole('option', { name: 'Enabled', exact: true })
    .click()
  await expect(fastTrigger).toHaveAttribute('aria-label', 'Fast mode: Enabled')

  await chooseModel(claudeExecutionMetadataCatalog[1])
  await expect(reasoningTrigger).toHaveAttribute('aria-label', 'Reasoning level: Default')
  await expect(fastTrigger).toHaveCount(0)
  reasoningMenu = await openReasoningMenu()
  await expect(reasoningMenu.getByRole('option')).toHaveText(['Default', 'Medium', 'XHigh'])
  await expect(reasoningMenu.locator('[role="option"][aria-selected="true"]')).toHaveText('Default')
  await page.keyboard.press('Escape')

  await chooseModel(claudeExecutionMetadataCatalog[0])
  await expect(reasoningTrigger).toHaveAttribute('aria-label', 'Reasoning level: Low')
  await expect(fastTrigger).toHaveAttribute('aria-label', 'Fast mode: Enabled')

  await chooseModel(claudeExecutionMetadataCatalog[1])
  reasoningMenu = await openReasoningMenu()
  await reasoningMenu.getByRole('option', { name: 'XHigh', exact: true }).click()
  await expect(reasoningTrigger).toHaveAttribute('aria-label', 'Reasoning level: XHigh')

  await chooseModel(claudeExecutionMetadataCatalog[2])
  await expect(reasoningTrigger).toHaveCount(0)
  await expect(fastTrigger).toHaveCount(0)

  await chooseModel(claudeExecutionMetadataCatalog[1])
  await expect(reasoningTrigger).toHaveAttribute('aria-label', 'Reasoning level: XHigh')
  reasoningMenu = await openReasoningMenu()
  await reasoningMenu.getByRole('option', { name: 'Default', exact: true }).click()
  await expect(reasoningTrigger).toHaveAttribute('aria-label', 'Reasoning level: Default')

  await chooseModel(claudeExecutionMetadataCatalog[2])
  await chooseModel(claudeExecutionMetadataCatalog[1])
  await expect(reasoningTrigger).toHaveAttribute('aria-label', 'Reasoning level: Default')

  await sendRequest(page, 'Claude', 'use runtime-default effort')
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __providerCalls?: Array<{ command: string }> }
  ).__providerCalls?.filter((call) => call.command === 'request_agent_suggestions').length ?? 0)).toBe(1)
  const request = await page.evaluate(() => (
    window as Window & {
      __providerCalls?: Array<{ command: string; args?: Record<string, unknown> }>
    }
  ).__providerCalls?.find((call) => call.command === 'request_agent_suggestions')?.args?.request)
  expect(request).toEqual(expect.objectContaining({
    provider: 'claude',
    model: 'metadata-b',
    reasoningLevel: null,
    fastMode: false,
  }))
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])

  await page.evaluate(({ projectA, sessionA }) => (
    window as Window & {
      __resolveProviderRequest(
        provider: string,
        projectPath: string,
        agentSessionId: string,
        summary: string,
      ): void
    }
  ).__resolveProviderRequest('claude', projectA, sessionA, 'Metadata controls completed'), {
    projectA,
    sessionA,
  })
  await expect(page.locator('.agent')).toContainText('Metadata controls completed')
})

test('provider-owned effort and Fast preferences stay isolated across providers, projects, sessions, and reload', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'claude',
    includeAdvancedControls: true,
    claudeCapabilityFixtures: [{ models: claudeExecutionMetadataCatalog }],
    sessionAPreferences: {
      selectedReasoningLevels: {
        codex: ' medium ',
        claude: '🚀🚀🚀🚀🚀',
        unknown: 'low',
      },
      fastModes: {
        codex: false,
        claude: 'true',
        unknown: true,
      },
    },
    sessionBPreferences: {
      reasoningLevel: 'low',
      fastMode: true,
    },
  })
  await page.goto('/')

  const reasoningTrigger = () => page.locator('.composer-reasoning-chip')
  const fastTrigger = () => page.locator('.fast-toggle')
  const chooseReasoning = async (label: string) => {
    await reasoningTrigger().click()
    await page.getByRole('listbox', { name: 'Reasoning levels' })
      .getByRole('option', { name: label, exact: true })
      .click()
  }
  const chooseFast = async (label: 'Disabled' | 'Enabled') => {
    await fastTrigger().click()
    await page.getByRole('listbox', { name: 'Fast mode' })
      .getByRole('option', { name: label, exact: true })
      .click()
  }
  const chooseClaudeModel = async (model: typeof claudeExecutionMetadataCatalog[number]) => {
    await modelTrigger(page, 'Claude').click()
    await page.getByRole('listbox', { name: 'Claude models' })
      .getByRole('option', { name: model.label, exact: true })
      .click()
  }
  const expectExecution = async (reasoning: string, fast: string) => {
    await expect(reasoningTrigger()).toHaveAttribute('aria-label', `Reasoning level: ${reasoning}`)
    await expect(fastTrigger()).toHaveAttribute('aria-label', `Fast mode: ${fast}`)
  }
  const storedSession = (path: string) => page.evaluate((projectPath) => {
    const directory = JSON.parse(localStorage.getItem('gtum.agent-session-directory.v1') || '{}')
    return directory[projectPath]?.sessions?.[0]
  }, path)

  await expect.poll(() => storedSession(projectA)).toEqual(expect.objectContaining({
    selectedReasoningLevels: { codex: 'medium' },
    fastModes: { codex: false },
  }))
  await expect(modelTrigger(page, 'Claude')).toHaveAttribute('aria-label', 'Claude model: Metadata A')
  await expectExecution('Default', 'Disabled')
  await switchProvider(page, 'Codex')
  await expectExecution('Medium', 'Disabled')
  await chooseReasoning('XHigh')
  await chooseFast('Disabled')

  await switchProvider(page, 'Claude')
  await chooseReasoning('Low')
  await chooseFast('Enabled')
  await expectExecution('Low', 'Enabled')
  await switchProvider(page, 'Codex')
  await expectExecution('XHigh', 'Disabled')
  await switchProvider(page, 'Claude')
  await expectExecution('Low', 'Enabled')

  await chooseReasoning('Default')
  await expect.poll(() => storedSession(projectA)).toEqual(expect.objectContaining({
    selectedReasoningLevels: { codex: 'xhigh' },
    fastModes: { codex: false, claude: true },
  }))
  await chooseReasoning('Low')
  await chooseClaudeModel(claudeExecutionMetadataCatalog[2])
  await expect(reasoningTrigger()).toHaveCount(0)
  await expect(fastTrigger()).toHaveCount(0)

  await sendRequest(page, 'Claude', 'unsupported model uses safe execution defaults')
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __providerCalls?: RuntimeCall[] }
  ).__providerCalls?.filter((call) => call.command === 'request_agent_suggestions').length ?? 0)).toBe(1)
  const unsupportedRequest = await page.evaluate(() => (
    window as Window & { __providerCalls?: RuntimeCall[] }
  ).__providerCalls?.find((call) => call.command === 'request_agent_suggestions')?.args?.request)
  expect(unsupportedRequest).toEqual(expect.objectContaining({
    provider: 'claude',
    model: 'metadata-c',
    reasoningLevel: null,
    fastMode: false,
  }))
  await expect.poll(() => storedSession(projectA)).toEqual(expect.objectContaining({
    selectedReasoningLevels: { codex: 'xhigh', claude: 'low' },
    fastModes: { codex: false, claude: true },
  }))
  await page.evaluate(({ projectA, sessionA }) => (
    window as Window & {
      __resolveProviderRequest(
        provider: string,
        projectPath: string,
        agentSessionId: string,
        summary: string,
      ): void
    }
  ).__resolveProviderRequest('claude', projectA, sessionA, 'Safe defaults completed'), {
    projectA,
    sessionA,
  })
  await expect(page.locator('.agent')).toContainText('Safe defaults completed')
  await chooseClaudeModel(claudeExecutionMetadataCatalog[0])
  await expectExecution('Low', 'Enabled')

  await projectRow(page, projectB).click()
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-session-id', sessionB)
  await expectExecution('High', 'Disabled')
  await expect.poll(() => storedSession(projectB)).toEqual(expect.objectContaining({
    selectedReasoningLevels: {},
    fastModes: {},
  }))
  await chooseReasoning('Low')
  await chooseFast('Enabled')
  await switchProvider(page, 'Claude')
  await expectExecution('Default', 'Disabled')
  await chooseReasoning('High')
  await chooseFast('Disabled')
  await switchProvider(page, 'Codex')
  await expectExecution('Low', 'Enabled')

  await projectRow(page, projectA).click()
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-session-id', sessionA)
  await expectExecution('Low', 'Enabled')
  await switchProvider(page, 'Codex')
  await expectExecution('XHigh', 'Disabled')

  await page.reload()
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-project-path', projectA)
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-session-id', sessionA)
  await expectExecution('XHigh', 'Disabled')
  await switchProvider(page, 'Claude')
  await expectExecution('Low', 'Enabled')
  await projectRow(page, projectB).click()
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-session-id', sessionB)
  await expectExecution('Low', 'Enabled')
  await switchProvider(page, 'Claude')
  await expectExecution('High', 'Disabled')

  const persisted = await page.evaluate(({ projectA, projectB }) => {
    const directory = JSON.parse(localStorage.getItem('gtum.agent-session-directory.v1') || '{}')
    return {
      a: directory[projectA]?.sessions?.[0],
      b: directory[projectB]?.sessions?.[0],
    }
  }, { projectA, projectB })
  expect(persisted.a).toEqual(expect.objectContaining({
    selectedReasoningLevels: { codex: 'xhigh', claude: 'low' },
    fastModes: { codex: false, claude: true },
  }))
  expect(persisted.b).toEqual(expect.objectContaining({
    selectedReasoningLevels: { codex: 'low', claude: 'high' },
    fastModes: { codex: true, claude: false },
  }))
  for (const session of [persisted.a, persisted.b]) {
    expect(Object.keys(session.selectedReasoningLevels).sort()).toEqual(['claude', 'codex'])
    expect(Object.keys(session.fastModes).sort()).toEqual(['claude', 'codex'])
    expect(Object.values(session.fastModes).every((value) => typeof value === 'boolean')).toBe(true)
    expect(session).not.toHaveProperty('reasoningLevel')
    expect(session).not.toHaveProperty('fastMode')
  }
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('keeps compact composer triggers on one line at default and narrow Agent widths', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'claude',
    includeAdvancedControls: true,
  })
  await page.goto('/')

  const composer = page.locator('.composer-foot')
  const providerTrigger = page.locator('.composer-provider-chip')
  const modelControl = page.locator('.composer-model-chip')
  const reasoningTrigger = page.locator('.composer-reasoning-chip')
  const fastTrigger = page.locator('.fast-toggle')
  await expect(reasoningTrigger).toHaveCount(1)
  await expect(fastTrigger).toHaveCount(1)

  const readLineMetrics = () => composer.evaluate((row) => {
    const visibleChildren = Array.from(row.children).filter((child) => {
      const style = window.getComputedStyle(child)
      return style.display !== 'none' && style.visibility !== 'hidden'
    })
    const lineCenters = new Set(visibleChildren.map((child) => {
      const rect = child.getBoundingClientRect()
      return Math.round((rect.top + rect.height / 2) * 10) / 10
    }))
    const rowRect = row.getBoundingClientRect()
    const childRects = visibleChildren.map((child) => child.getBoundingClientRect())
    const clientLeft = rowRect.left + row.clientLeft
    const clientRight = clientLeft + row.clientWidth
    const controls = Array.from(row.querySelectorAll(
      ':scope > button, :scope > div > button',
    )).filter((control) => {
      const style = window.getComputedStyle(control)
      return style.display !== 'none' && style.visibility !== 'hidden'
    }).map((control) => {
      const rect = control.getBoundingClientRect()
      return {
        className: control.className,
        left: rect.left,
        right: rect.right,
      }
    })
    return {
      flexWrap: window.getComputedStyle(row).flexWrap,
      lineCount: lineCenters.size,
      contentLeft: Math.min(...childRects.map((rect) => rect.left)),
      contentRight: Math.max(...childRects.map((rect) => rect.right)),
      rowLeft: rowRect.left,
      rowRight: rowRect.right,
      clientWidth: row.clientWidth,
      scrollWidth: row.scrollWidth,
      clientLeft,
      clientRight,
      controls,
    }
  })

  let metrics = await readLineMetrics()
  expect(metrics.flexWrap).toBe('nowrap')
  expect(metrics.lineCount).toBe(1)
  expect(metrics.contentLeft).toBeGreaterThanOrEqual(metrics.rowLeft - 0.5)
  expect(metrics.contentRight).toBeLessThanOrEqual(metrics.rowRight + 0.5)
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
  expect(metrics.controls).toHaveLength(6)
  for (const control of metrics.controls) {
    expect(control.left, `${control.className} left edge`).toBeGreaterThanOrEqual(
      metrics.clientLeft - 0.5,
    )
    expect(control.right, `${control.className} right edge`).toBeLessThanOrEqual(
      metrics.clientRight + 0.5,
    )
  }
  await expect(providerTrigger).toHaveText('Cl')
  await expect(modelControl).toHaveText('')
  await expect(reasoningTrigger).toHaveText('')
  await expect(fastTrigger).toHaveText('')

  const agentBefore = await page.locator('.agent').boundingBox()
  const resizeHandle = await page.locator('.resize-handle.handle-right').boundingBox()
  expect(agentBefore).not.toBeNull()
  expect(resizeHandle).not.toBeNull()
  const targetAgentWidth = 260
  const dragDistance = agentBefore!.width - targetAgentWidth
  await page.mouse.move(
    resizeHandle!.x + resizeHandle!.width / 2,
    resizeHandle!.y + resizeHandle!.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    resizeHandle!.x + resizeHandle!.width / 2 + dragDistance,
    resizeHandle!.y + resizeHandle!.height / 2,
    { steps: 5 },
  )
  await page.mouse.up()
  await expect.poll(async () => (await page.locator('.agent').boundingBox())?.width ?? 0)
    .toBeLessThanOrEqual(targetAgentWidth + 1)

  metrics = await readLineMetrics()
  expect(metrics.flexWrap).toBe('nowrap')
  expect(metrics.lineCount).toBe(1)
  expect(metrics.contentLeft).toBeGreaterThanOrEqual(metrics.rowLeft - 0.5)
  expect(metrics.contentRight).toBeLessThanOrEqual(metrics.rowRight + 0.5)
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
  expect(metrics.controls).toHaveLength(6)
  for (const control of metrics.controls) {
    expect(control.left, `${control.className} left edge at 260px`).toBeGreaterThanOrEqual(
      metrics.clientLeft - 0.5,
    )
    expect(control.right, `${control.className} right edge at 260px`).toBeLessThanOrEqual(
      metrics.clientRight + 0.5,
    )
  }
})

test('contains every compact menu and fully reveals long model labels at 260px and 240px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'claude',
    includeAdvancedControls: true,
  })
  await page.goto('/')

  const menuDefinitions = [
    {
      label: 'provider',
      trigger: () => page.locator('.composer-provider-chip'),
      menu: () => page.getByRole('listbox', { name: 'Agent provider' }),
    },
    {
      label: 'model',
      trigger: () => modelTrigger(page, 'Claude'),
      menu: () => page.getByRole('listbox', { name: 'Claude models' }),
    },
    {
      label: 'reasoning',
      trigger: () => page.locator('.composer-reasoning-chip'),
      menu: () => page.getByRole('listbox', { name: 'Reasoning levels' }),
    },
    {
      label: 'fast',
      trigger: () => page.locator('.fast-toggle'),
      menu: () => page.getByRole('listbox', { name: 'Fast mode' }),
    },
  ]

  for (const targetWidth of [260, 240]) {
    await resizeAgentPanel(page, targetWidth)
    const toolbarGeometry = await page.locator('.composer-foot').evaluate((row) => {
      const centers = new Set(Array.from(row.children).map((child) => {
        const rect = child.getBoundingClientRect()
        return Math.round((rect.top + rect.height / 2) * 10) / 10
      }))
      return {
        flexWrap: window.getComputedStyle(row).flexWrap,
        lineCount: centers.size,
        clientWidth: row.clientWidth,
        scrollWidth: row.scrollWidth,
      }
    })
    expect(toolbarGeometry.flexWrap).toBe('nowrap')
    expect(toolbarGeometry.lineCount).toBe(1)
    expect(toolbarGeometry.scrollWidth).toBeLessThanOrEqual(toolbarGeometry.clientWidth + 1)

    for (const definition of menuDefinitions) {
      await definition.trigger().click()
      const menu = definition.menu()
      await expect(menu).toBeVisible()
      const geometry = await menu.evaluate((listbox) => {
        const menuRect = listbox.getBoundingClientRect()
        const agent = listbox.closest('.agent')
        const composer = listbox.closest('.composer-input')
        if (!(agent instanceof HTMLElement) || !(composer instanceof HTMLElement)) {
          throw new Error('Compact menu lost its Agent/composer owner')
        }
        const agentRect = agent.getBoundingClientRect()
        const composerRect = composer.getBoundingClientRect()
        return {
          menuLeft: menuRect.left,
          menuRight: menuRect.right,
          agentLeft: agentRect.left,
          agentRight: agentRect.right,
          composerLeft: composerRect.left,
          composerRight: composerRect.right,
          viewportWidth: window.innerWidth,
          clientWidth: listbox.clientWidth,
          scrollWidth: listbox.scrollWidth,
        }
      })
      expect.soft(
        geometry.menuLeft,
        `${definition.label} left edge at ${targetWidth}px`,
      ).toBeGreaterThanOrEqual(geometry.agentLeft - 0.5)
      expect.soft(
        geometry.menuRight,
        `${definition.label} right edge at ${targetWidth}px`,
      ).toBeLessThanOrEqual(geometry.agentRight + 0.5)
      expect.soft(
        geometry.menuLeft,
        `${definition.label} composer left edge at ${targetWidth}px`,
      ).toBeGreaterThanOrEqual(geometry.composerLeft - 0.5)
      expect.soft(
        geometry.menuRight,
        `${definition.label} composer right edge at ${targetWidth}px`,
      ).toBeLessThanOrEqual(geometry.composerRight + 0.5)
      expect.soft(geometry.menuLeft).toBeGreaterThanOrEqual(0)
      expect.soft(geometry.menuRight).toBeLessThanOrEqual(geometry.viewportWidth)
      expect.soft(
        geometry.scrollWidth,
        `${definition.label} horizontal content at ${targetWidth}px`,
      ).toBeLessThanOrEqual(geometry.clientWidth + 1)

      if (definition.label === 'model') {
        const option = menu.getByRole('option', {
          name: claudeModelCatalog[0].label,
          exact: true,
        })
        await expect(option).toHaveText(claudeModelCatalog[0].label)
        const labelGeometry = await option.locator('span').evaluate((label) => {
          const option = label.closest('[role="option"]')
          if (!(option instanceof HTMLElement)) throw new Error('Model label lost its option')
          const optionRect = option.getBoundingClientRect()
          const range = document.createRange()
          range.selectNodeContents(label)
          const lineRects = Array.from(range.getClientRects())
            .filter((rect) => rect.width > 0 && rect.height > 0)
          return {
            lineCount: new Set(lineRects.map((rect) => Math.round(rect.top * 10) / 10)).size,
            clientWidth: label.clientWidth,
            scrollWidth: label.scrollWidth,
            fullyInsideOption: lineRects.every((rect) => (
              rect.left >= optionRect.left - 0.5
              && rect.right <= optionRect.right + 0.5
              && rect.top >= optionRect.top - 0.5
              && rect.bottom <= optionRect.bottom + 0.5
            )),
          }
        })
        expect.soft(labelGeometry.scrollWidth).toBeLessThanOrEqual(labelGeometry.clientWidth + 1)
        expect.soft(labelGeometry.fullyInsideOption).toBe(true)
        if (targetWidth === 240) expect.soft(labelGeometry.lineCount).toBeGreaterThan(1)
      }

      await page.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)
    }
  }
})

test('opens exact full-name compact composer menus and preserves selected request state', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'claude',
    includeAdvancedControls: true,
  })
  await page.goto('/')

  const providerTrigger = page.locator('.composer-provider-chip')
  await expect(providerTrigger).toHaveAttribute(
    'aria-label',
    'Provider: Claude · CLI session',
  )
  await expect(providerTrigger).toHaveAttribute(
    'title',
    'Provider: Claude · CLI session',
  )
  await providerTrigger.click()
  const providerMenu = page.getByRole('listbox', { name: 'Agent provider' })
  await expect(providerMenu.getByRole('option', { name: 'Claude CLI session', exact: true }))
    .toHaveCount(1)
  await expect(providerMenu.getByRole('option', { name: 'Codex CLI session', exact: true }))
    .toHaveCount(1)
  await expect(providerMenu.locator('[role="option"][aria-selected="true"]')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(providerMenu).toHaveCount(0)
  await expect(providerTrigger).toBeFocused()

  const modelControl = modelTrigger(page, 'Claude')
  const defaultModelLabel = claudeModelCatalog[0].label
  await expect(modelControl).toHaveAttribute('title', `Claude model: ${defaultModelLabel}`)
  await modelControl.click()
  const modelMenu = page.getByRole('listbox', { name: 'Claude models' })
  await expect(modelMenu.getByRole('option', {
    name: claudeModelCatalog[1].label,
    exact: true,
  })).toHaveCount(1)

  const reasoningTrigger = page.locator('.composer-reasoning-chip')
  await expect(reasoningTrigger).toHaveAttribute('aria-label', 'Reasoning level: High')
  await reasoningTrigger.click()
  await expect(modelMenu).toHaveCount(0)
  const reasoningMenu = page.getByRole('listbox', { name: 'Reasoning levels' })
  for (const label of ['Low', 'Medium', 'High', 'XHigh']) {
    await expect(reasoningMenu.getByRole('option', { name: label, exact: true })).toHaveCount(1)
  }
  await expect(reasoningMenu.locator('[role="option"][aria-selected="true"]')).toHaveText('High')
  await reasoningMenu.getByRole('option', { name: 'Medium', exact: true }).click()
  await expect(reasoningTrigger).toHaveAttribute('title', 'Reasoning level: Medium')

  await modelControl.click()
  await modelMenu.getByRole('option', {
    name: claudeModelCatalog[1].label,
    exact: true,
  }).click()
  await expect(modelControl).toHaveAttribute(
    'aria-label',
    `Claude model: ${claudeModelCatalog[1].label}`,
  )

  const fastTrigger = page.locator('.fast-toggle')
  await expect(fastTrigger).toHaveAttribute('aria-label', 'Fast mode: Disabled')
  await fastTrigger.click()
  const fastMenu = page.getByRole('listbox', { name: 'Fast mode' })
  await expect(fastMenu.getByRole('option', { name: 'Disabled', exact: true })).toHaveCount(1)
  await expect(fastMenu.getByRole('option', { name: 'Enabled', exact: true })).toHaveCount(1)
  await expect(fastMenu.locator('[role="option"][aria-selected="true"]')).toHaveText('Disabled')
  await fastMenu.getByRole('option', { name: 'Enabled', exact: true }).click()
  await expect(fastTrigger).toHaveAttribute('title', 'Fast mode: Enabled')

  await fastTrigger.click()
  await expect(fastMenu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(fastMenu).toHaveCount(0)
  await expect(fastTrigger).toBeFocused()

  await fastTrigger.click()
  await reasoningTrigger.click()
  await expect(fastMenu).toHaveCount(0)
  await expect(reasoningMenu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(reasoningMenu).toHaveCount(0)
  await expect(reasoningTrigger).toBeFocused()

  await expect(providerTrigger).toHaveAttribute('aria-label', 'Provider: Claude · CLI session')

  await sendRequest(page, 'Claude', 'compact control request')
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __providerCalls?: RuntimeCall[] }
  ).__providerCalls?.filter((call) => call.command === 'request_agent_suggestions').length ?? 0)).toBe(1)
  const request = await page.evaluate(() => (
    window as Window & { __providerCalls?: RuntimeCall[] }
  ).__providerCalls?.find((call) => call.command === 'request_agent_suggestions')?.args?.request)
  expect(request).toEqual(expect.objectContaining({
    provider: 'claude',
    model: 'opus[1m]',
    reasoningLevel: 'medium',
    fastMode: true,
  }))
  await expect.poll(() => page.evaluate(({ projectA }) => {
    const directory = JSON.parse(localStorage.getItem('gtum.agent-session-directory.v1') || '{}')
    return directory[projectA]?.sessions?.[0]
  }, { projectA })).toEqual(expect.objectContaining({
    selectedModels: expect.objectContaining({ claude: 'opus[1m]' }),
  }))

  await page.evaluate(({ projectA, sessionA }) => (
    window as Window & {
      __resolveProviderRequest(
        provider: string,
        projectPath: string,
        agentSessionId: string,
        summary: string,
      ): void
    }
  ).__resolveProviderRequest('claude', projectA, sessionA, 'Compact controls completed'), {
    projectA,
    sessionA,
  })
  await expect(page.locator('.agent')).toContainText('Compact controls completed')
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('keeps provider-specific models accessible, persisted, and owned by their project sessions', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    claudeInitialConnectionStatus: 'disconnected',
  })
  await page.goto('/')

  await expect(page.locator('.agent')).toHaveAttribute('data-agent-project-path', projectA)
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-provider-id', 'codex')
  const initialCodexTrigger = modelTrigger(page, 'Codex')
  await expect(initialCodexTrigger).toHaveAttribute('aria-haspopup', 'listbox')
  await expect(initialCodexTrigger).toHaveAttribute('aria-label', 'Codex model: GPT default')
  await initialCodexTrigger.click()
  const initialCodexModels = page.getByRole('listbox', { name: 'Codex models' })
  await expect(initialCodexModels.getByRole('option')).toHaveCount(3)
  await expect(initialCodexModels.locator('[role="option"][aria-selected="true"]')).toHaveCount(1)
  await expect(initialCodexModels.locator('[role="option"][aria-selected="true"]')).toContainText('GPT default')
  await page.keyboard.press('Escape')
  await expect(initialCodexModels).toHaveCount(0)
  await expect(initialCodexTrigger).toBeFocused()
  await initialCodexTrigger.click()
  await initialCodexModels.getByRole('option', { name: /GPT-5 Codex/ }).click()
  await expect(modelTrigger(page, 'Codex')).toHaveAttribute('aria-label', 'Codex model: GPT-5 Codex')

  await page.locator('.titlebar .pill.icon-only').click()
  const claudeSettings = page.locator('.settings-provider').filter({ hasText: 'Claude' })
  await expect(claudeSettings.getByRole('button', { name: 'Connect' })).toBeVisible()
  await claudeSettings.getByRole('button', { name: 'Connect' }).click()
  await expect(page.locator('.settings-overlay')).toHaveCount(0)
  await expect(page.locator('.msg.assistant').last()).toContainText(
    'Claude connected through the local Claude CLI session.',
  )
  await modelTrigger(page, 'Codex').click()
  await switchProvider(page, 'Claude')
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-provider-id', 'claude')
  await expect(page.getByPlaceholder('Ask Claude')).toBeVisible()
  await expect(page.locator('.composer-provider-chip'))
    .toHaveAttribute('aria-label', 'Provider: Claude · CLI session')
  const claudeTrigger = modelTrigger(page, 'Claude')
  await expect(claudeTrigger).toHaveAttribute('aria-haspopup', 'listbox')
  await expect(claudeTrigger)
    .toHaveAttribute('aria-label', `Claude model: ${claudeModelCatalog[0].label}`)
  await expect(page.getByRole('listbox', { name: 'Claude models' })).toHaveCount(0)
  await claudeTrigger.click()
  const claudeModels = page.getByRole('listbox', { name: 'Claude models' })
  await expect(claudeModels.getByRole('option')).toHaveCount(5)
  await expect(claudeModels.getByRole('option', { name: /gpt/i })).toHaveCount(0)
  await expect(claudeModels.locator('[role="option"][aria-selected="true"]')).toHaveCount(1)
  await expect(claudeModels.locator('[role="option"][aria-selected="true"]'))
    .toContainText(claudeModelCatalog[0].label)
  await claudeModels.getByRole('option', {
    name: claudeModelCatalog[1].label,
    exact: true,
  }).click()
  await expect(modelTrigger(page, 'Claude'))
    .toHaveAttribute('aria-label', `Claude model: ${claudeModelCatalog[1].label}`)

  await sendRequest(page, 'Claude', 'request from A')
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __providerCalls?: RuntimeCall[] }
  ).__providerCalls?.filter((call) => call.command === 'request_agent_suggestions').length ?? 0)).toBe(1)
  await projectRow(page, projectB).click()
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-provider-id', 'codex')
  await expect(page.getByPlaceholder('Ask Codex')).toBeVisible()
  await modelTrigger(page, 'Codex').click()
  await page.getByRole('listbox', { name: 'Codex models' })
    .getByRole('option', { name: /GPT-5 Codex/ })
    .click()
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
      model: 'opus[1m]',
      projectPath: projectA,
      agentSessionId: sessionA,
    }),
    expect.objectContaining({
      provider: 'codex',
      model: 'gpt-5-codex',
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
    return directory[projectA]?.sessions?.[0]
  }, { projectA })).toEqual(expect.objectContaining({
    providerId: 'claude',
    selectedModels: {
      codex: 'gpt-5-codex',
      claude: 'opus[1m]',
    },
  }))

  await expect(modelTrigger(page, 'Claude'))
    .toHaveAttribute('aria-label', `Claude model: ${claudeModelCatalog[1].label}`)
  await switchProvider(page, 'Codex')
  await expect(modelTrigger(page, 'Codex')).toHaveAttribute('aria-label', 'Codex model: GPT-5 Codex')
  await switchProvider(page, 'Claude')
  await expect(modelTrigger(page, 'Claude'))
    .toHaveAttribute('aria-label', `Claude model: ${claudeModelCatalog[1].label}`)

  await page.reload()
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-provider-id', 'claude')
  await expect(modelTrigger(page, 'Claude'))
    .toHaveAttribute('aria-label', `Claude model: ${claudeModelCatalog[1].label}`)
  await switchProvider(page, 'Codex')
  await expect(modelTrigger(page, 'Codex')).toHaveAttribute('aria-label', 'Codex model: GPT-5 Codex')
  await switchProvider(page, 'Claude')
  await expect(modelTrigger(page, 'Claude'))
    .toHaveAttribute('aria-label', `Claude model: ${claudeModelCatalog[1].label}`)
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('drops only a stale Claude model after its selectable catalog loads', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'claude',
    sessionASelectedModels: {
      codex: ' gpt-5-codex ',
      claude: 'retired-claude-model',
      unknown: 'must-not-persist',
    },
  })
  await page.goto('/')

  await expect(page.locator('.agent')).toHaveAttribute('data-agent-provider-id', 'claude')
  await expect(modelTrigger(page, 'Claude'))
    .toHaveAttribute('aria-label', `Claude model: ${claudeModelCatalog[0].label}`)
  await expect.poll(() => page.evaluate(({ projectA }) => {
    const directory = JSON.parse(localStorage.getItem('gtum.agent-session-directory.v1') || '{}')
    return directory[projectA]?.sessions?.[0]?.selectedModels
  }, { projectA })).toEqual({ codex: 'gpt-5-codex' })

  await sendRequest(page, 'Claude', 'request after stale model')
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __providerCalls?: RuntimeCall[] }
  ).__providerCalls?.filter((call) => call.command === 'request_agent_suggestions').length ?? 0)).toBe(1)
  const request = await page.evaluate(() => (
    window as Window & { __providerCalls?: RuntimeCall[] }
  ).__providerCalls?.find((call) => call.command === 'request_agent_suggestions')?.args?.request)
  expect(request).toEqual(expect.objectContaining({
    provider: 'claude',
    model: null,
  }))
  await page.evaluate(({ projectA, sessionA }) => (
    window as Window & {
      __resolveProviderRequest(
        provider: string,
        projectPath: string,
        agentSessionId: string,
        summary: string,
      ): void
    }
  ).__resolveProviderRequest('claude', projectA, sessionA, 'Claude default completed'), {
    projectA,
    sessionA,
  })
  await expect(page.locator('.agent')).toContainText('Claude default completed')
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('keeps a saved Claude model while selection support is temporarily unavailable', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'claude',
    sessionASelectedModels: {
      codex: 'gpt-5-codex',
      claude: 'opus[1m]',
    },
    claudeSupportsModelSelection: false,
  })
  await page.goto('/')

  await expect(page.locator('.agent')).toHaveAttribute('data-agent-provider-id', 'claude')
  await expect(modelTrigger(page, 'Claude')).toHaveCount(0)
  await expect.poll(() => page.evaluate(({ projectA }) => {
    const directory = JSON.parse(localStorage.getItem('gtum.agent-session-directory.v1') || '{}')
    return directory[projectA]?.sessions?.[0]?.selectedModels
  }, { projectA })).toEqual({
    codex: 'gpt-5-codex',
    claude: 'opus[1m]',
  })
})

type RuntimeCall = { command: string; args?: Record<string, unknown> }
