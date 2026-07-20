import { expect, test, type Page } from '@playwright/test'

const projectA = '/workspace/claude-a'
const projectB = '/workspace/codex-b'
const sessionA = 'claude-session-a'
const sessionB = 'codex-session-b'
const codexDefaultAccountId = 'codex-default'
const claudeDefaultAccountId = 'claude-default'
const claudeSecondaryAccountId = 'claude-profile-1'

const claudeValidationFailureGuidance =
  'Claude authentication could not be validated. Check Claude credentials or run `claude auth login` in your own terminal, then reconnect Claude.'

type ClaudeConnectionStatus = 'connected' | 'disconnected' | 'error'

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
const maximumAccountAlias = `Claude ${'W'.repeat(57)}`
const accountPickerClaudeProfiles = Array.from({ length: 12 }, (_, index) => ({
  accountId: `claude-profile-${(index + 1).toString(36)}`,
  alias: index === 11 ? maximumAccountAlias : `Claude Account ${index + 1}`,
  status: 'connected' as ClaudeConnectionStatus,
}))

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
  sessionBProvider?: 'codex' | 'claude'
  sessionASelectedAccountIds?: Partial<Record<'codex' | 'claude', string>>
  sessionBSelectedAccountIds?: Partial<Record<'codex' | 'claude', string>>
  sessionASelectedModels?: Record<string, unknown>
  sessionAPreferences?: Record<string, unknown>
  sessionBPreferences?: Record<string, unknown>
  claudeSupportsModelSelection?: boolean
  includeAdvancedControls?: boolean
  claudeInitialConnectionStatus?: ClaudeConnectionStatus
  claudeCapabilityFixtures?: ClaudeCapabilityFixture[]
  deferInitialProfileSnapshot?: boolean
  failProfileSnapshot?: boolean
  profileSnapshotErrors?: Record<number, string>
  additionalClaudeProfiles?: Array<{
    accountId: string
    alias: string
    status?: ClaudeConnectionStatus
  }>
  profileTombstones?: Array<{
    provider: 'codex' | 'claude'
    accountId: string
    incarnation: string
    credentialRevision: string
    forgottenAt: number
  }>
  deferredProfileLifecycleInvocations?: number[]
  profileLifecycleErrors?: Record<number, string>
  profileSetupGuidance?: {
    supported: boolean
    program: string | null
    environment: Array<{ name: string; value: string }>
    arguments: string[]
    renderedCommand: string | null
    warning: string
    unsupportedReason: string | null
  }
  os?: 'mac' | 'windows'
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
    codexDefaultAccountId,
    claudeDefaultAccountId,
    claudeSecondaryAccountId,
    options,
    claudeModelCatalog,
    claudeValidationFailureGuidance,
  }) => {
    type RuntimeCall = { command: string; args?: Record<string, unknown> }
    type SuggestionResolver = {
      provider: 'codex' | 'claude'
      accountId: string
      incarnation: string
      credentialRevision: string
      resolve(value: unknown[]): void
      reject(error: Error): void
    }
    type ProfileLifecycleResolver = {
      command: string
      resolve(): void
      reject(error: Error): void
    }
    type TestWindow = Window & {
      __providerCalls: RuntimeCall[]
      __authCalls: RuntimeCall[]
      __agentJobCalls: RuntimeCall[]
      __terminalCalls: RuntimeCall[]
      __claudeCapabilityReadCount: number
      __resolveClaudeCapabilityRead(readIndex: number, models: unknown[]): void
      __rejectClaudeCapabilityRead(readIndex: number, message: string): void
      __resolveInitialProfileSnapshot(status: ClaudeConnectionStatus): void
      __resolveProviderRequest(
        provider: string,
        projectPath: string,
        agentSessionId: string,
        summary: string,
        command?: string,
      ): void
      __rejectProviderRequest(
        provider: string,
        projectPath: string,
        agentSessionId: string,
        message: string,
      ): void
      __removeAgentProfile(provider: string, accountId: string): void
      __profileLifecycleInvocationCount: number
      __resolveProfileLifecycleInvocation(invocation: number): void
      __rejectProfileLifecycleInvocation(invocation: number, message: string): void
      __GTUM_AGENT_PROGRESS_STAGE_DELAY_MS__: number
      __GTUM_AGENT_JOB_POLL_INTERVAL_MS__: number
      __GTUM_AGENT_FLEET_POLL_INTERVAL_MS__: number
      __GTUM_OS__?: 'mac' | 'windows'
      __GTUM_WORKSPACE_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
      __GTUM_AGENT_AUTH_RUNTIME__: unknown
      __GTUM_AGENT_RUNTIME__: unknown
      __GTUM_AGENT_JOB_RUNTIME__: unknown
      __GTUM_TERMINAL_RUNTIME__: unknown
    }

    const bridgeWindow = window as TestWindow
    const requestResolvers = new Map<string, SuggestionResolver>()
    const pendingProfileLifecycle = new Map<number, ProfileLifecycleResolver>()
    const pendingClaudeCapabilities = new Map<number, {
      resolve(models: unknown[]): void
      reject(error: Error): void
    }>()
    let resolveInitialProfileSnapshot: ((status: ClaudeConnectionStatus) => void) | null = null
    let resolveInitialConnectionList: ((status: ClaudeConnectionStatus) => void) | null = null
    let initialProfileResolutionStatus: ClaudeConnectionStatus | null = null
    let didReadInitialProfileSnapshot = false
    let didReadInitialConnectionList = false
    let claudeConnectionStatus = options.claudeInitialConnectionStatus || 'connected'
    let profileSnapshotReadCount = 0
    let profileLifecycleInvocationCount = 0
    const ownerKey = (provider: string, accountId: string) => `${provider}\u0000${accountId}`
    const additionalClaudeProfiles = [...(options.additionalClaudeProfiles || [{
      accountId: claudeSecondaryAccountId,
      alias: 'Claude Secondary',
      status: 'connected' as ClaudeConnectionStatus,
    }])]
    const profileStatuses = new Map<string, ClaudeConnectionStatus>([
      [ownerKey('codex', codexDefaultAccountId), 'connected'],
      [ownerKey('claude', claudeDefaultAccountId), claudeConnectionStatus],
      ...additionalClaudeProfiles.map((entry) => [
        ownerKey('claude', entry.accountId),
        entry.status || 'connected',
      ] as [string, ClaudeConnectionStatus]),
    ])
    const profileCredentialRevisions = new Map<string, number>([
      [ownerKey('codex', codexDefaultAccountId), 1],
      [ownerKey('claude', claudeDefaultAccountId), 1],
      ...additionalClaudeProfiles.map((entry) => [
        ownerKey('claude', entry.accountId),
        1,
      ] as [string, number]),
    ])
    const profileAliases = new Map<string, string>([
      [ownerKey('codex', codexDefaultAccountId), 'Codex CLI Session'],
      [ownerKey('claude', claudeDefaultAccountId), 'Claude CLI Session'],
      ...additionalClaudeProfiles.map((entry) => [
        ownerKey('claude', entry.accountId),
        entry.alias,
      ] as [string, string]),
    ])
    const profileDefaults = new Map<string, boolean>([
      [ownerKey('codex', codexDefaultAccountId), true],
      [ownerKey('claude', claudeDefaultAccountId), true],
      ...additionalClaudeProfiles.map((entry) => [
        ownerKey('claude', entry.accountId),
        false,
      ] as [string, boolean]),
    ])
    const profileMetadataRevisions = new Map<string, number>([
      [ownerKey('codex', codexDefaultAccountId), 1],
      [ownerKey('claude', claudeDefaultAccountId), 1],
      ...additionalClaudeProfiles.map((entry) => [
        ownerKey('claude', entry.accountId),
        1,
      ] as [string, number]),
    ])
    const profileIncarnations = new Map<string, number>([
      [ownerKey('codex', codexDefaultAccountId), 1],
      [ownerKey('claude', claudeDefaultAccountId), 2],
      ...additionalClaudeProfiles.map((entry, index) => [
        ownerKey('claude', entry.accountId),
        index + 3,
      ] as [string, number]),
    ])
    const mutableProfileTombstones = [...(options.profileTombstones || [])]
    let nextGeneratedProfileNumber = additionalClaudeProfiles.reduce((maximum, entry) => {
      const match = entry.accountId.match(/^claude-profile-([0-9a-z]+)$/)
      return match ? Math.max(maximum, Number.parseInt(match[1], 36)) : maximum
    }, 0) + 1
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
      status: ClaudeConnectionStatus = 'connected',
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
      lastError: provider === 'claude' && status === 'error'
        ? claudeValidationFailureGuidance
        : null,
    })

    const profile = (
      provider: 'codex' | 'claude',
      accountId: string,
      statusOverride?: ClaudeConnectionStatus,
    ) => {
      const key = ownerKey(provider, accountId)
      const additionalIndex = additionalClaudeProfiles.findIndex((entry) => (
        entry.accountId === accountId
      ))
      const status = statusOverride || profileStatuses.get(key) || 'connected'
      const alias = profileAliases.get(key)
        || (provider === 'codex' ? 'Codex CLI Session' : 'Claude CLI Session')
      const incarnation = String(profileIncarnations.get(key) || additionalIndex + 3)

      return ({
        provider,
        accountId,
        alias,
        profileKind: {
          kind: accountId.endsWith('-default')
            ? 'ambient'
            : provider === 'codex' ? 'codex_home' : 'claude_config_dir',
        },
        isDefault: profileDefaults.get(key) === true,
        incarnation,
        metadataRevision: String(profileMetadataRevisions.get(key) || 1),
        credentialRevision: String(profileCredentialRevisions.get(key) || 1),
        connection: {
          status,
          requiresValidation: false,
          credentialSource: status === 'connected' && provider === 'claude'
            ? 'claude_cli_session'
            : null,
          connectedAt: status === 'connected' ? 100 : null,
          updatedAt: 120 + (profileCredentialRevisions.get(key) || 1),
          lastError: provider === 'claude' && status === 'error'
            ? claudeValidationFailureGuidance
            : null,
        },
      })
    }
    const profileSnapshot = () => ({
      registryVersion: 2,
      profiles: [
        profile('codex', codexDefaultAccountId),
        profile('claude', claudeDefaultAccountId),
        ...additionalClaudeProfiles.map((entry) => profile('claude', entry.accountId)),
      ],
      tombstones: [...mutableProfileTombstones],
    })
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value != null && !Array.isArray(value)
    const nestedPreferences = (
      value: unknown,
      selectedAccountIds: Record<'codex' | 'claude', string>,
      accepts: (value: unknown) => boolean,
    ) => {
      if (!isRecord(value)) return {}
      return Object.fromEntries((['codex', 'claude'] as const).flatMap((provider) => {
        const providerValue = value[provider]
        if (isRecord(providerValue)) return [[provider, providerValue]]
        if (!accepts(providerValue)) return []
        return [[provider, { [selectedAccountIds[provider]]: providerValue }]]
      }))
    }
    const sessionASelectedAccountIds = {
      codex: codexDefaultAccountId,
      claude: claudeDefaultAccountId,
      ...(options.sessionASelectedAccountIds || {}),
    }
    const sessionBSelectedAccountIds = {
      codex: codexDefaultAccountId,
      claude: claudeDefaultAccountId,
      ...(options.sessionBSelectedAccountIds || {}),
    }
    const sessionAPreferences = options.sessionAPreferences || {}
    const sessionBPreferences = options.sessionBPreferences || {}

    if (!localStorage.getItem('gtum.agent-session-directory.v2')) {
      localStorage.setItem('gtum.agent-session-directory.v2', JSON.stringify({
        [projectA]: {
          workspaceTitle: 'claude-a',
          activeSessionId: sessionA,
          sessions: [{
            id: sessionA,
            title: 'Claude A',
            providerId: options.sessionAProvider || 'codex',
            selectedAccountIds: sessionASelectedAccountIds,
            selectedModels: nestedPreferences(
              options.sessionASelectedModels,
              sessionASelectedAccountIds,
              (value) => typeof value === 'string',
            ),
            selectedReasoningLevels: nestedPreferences(
              sessionAPreferences.selectedReasoningLevels,
              sessionASelectedAccountIds,
              (value) => typeof value === 'string',
            ),
            fastModes: nestedPreferences(
              sessionAPreferences.fastModes,
              sessionASelectedAccountIds,
              (value) => typeof value === 'boolean',
            ),
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
            providerId: options.sessionBProvider || 'codex',
            selectedAccountIds: sessionBSelectedAccountIds,
            selectedModels: nestedPreferences(
              sessionBPreferences.selectedModels,
              sessionBSelectedAccountIds,
              (value) => typeof value === 'string',
            ),
            selectedReasoningLevels: nestedPreferences(
              sessionBPreferences.selectedReasoningLevels,
              sessionBSelectedAccountIds,
              (value) => typeof value === 'string',
            ),
            fastModes: nestedPreferences(
              sessionBPreferences.fastModes,
              sessionBSelectedAccountIds,
              (value) => typeof value === 'boolean',
            ),
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
    bridgeWindow.__resolveInitialProfileSnapshot = (status) => {
      if (!resolveInitialProfileSnapshot && !resolveInitialConnectionList) {
        throw new Error('No pending initial profile snapshot or connection list')
      }
      const resolveProfile = resolveInitialProfileSnapshot
      resolveInitialProfileSnapshot = null
      const resolveConnections = resolveInitialConnectionList
      resolveInitialConnectionList = null
      initialProfileResolutionStatus = status
      claudeConnectionStatus = status
      resolveProfile?.(status)
      resolveConnections?.(status)
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
      const pending = requestResolvers.get(key)
      if (!pending) throw new Error(`No pending provider request for ${key}`)
      requestResolvers.delete(key)
      pending.resolve([{
        id: `${provider}-reply`,
        provider: pending.provider,
        accountId: pending.accountId,
        incarnation: pending.incarnation,
        credentialRevision: pending.credentialRevision,
        summary,
        command,
        preferredTarget: 'new_tab',
        confidence: 'high',
        error: null,
      }])
    }
    bridgeWindow.__rejectProviderRequest = (
      provider,
      projectPath,
      agentSessionId,
      message,
    ) => {
      const key = requestKey(provider, projectPath, agentSessionId)
      const pending = requestResolvers.get(key)
      if (!pending) throw new Error(`No pending provider request for ${key}`)
      requestResolvers.delete(key)
      pending.reject(new Error(message))
    }
    bridgeWindow.__removeAgentProfile = (provider, accountId) => {
      if (provider !== 'claude') throw new Error(`Cannot remove ${provider} profile in this harness`)
      const index = additionalClaudeProfiles.findIndex((entry) => entry.accountId === accountId)
      if (index < 0) throw new Error(`No additional Claude profile ${accountId}`)
      additionalClaudeProfiles.splice(index, 1)
      const key = ownerKey(provider, accountId)
      profileStatuses.delete(key)
      profileCredentialRevisions.delete(key)
      profileAliases.delete(key)
      profileDefaults.delete(key)
      profileMetadataRevisions.delete(key)
      profileIncarnations.delete(key)
    }
    bridgeWindow.__profileLifecycleInvocationCount = 0
    bridgeWindow.__resolveProfileLifecycleInvocation = (invocation) => {
      const pending = pendingProfileLifecycle.get(invocation)
      if (!pending) throw new Error(`No pending profile lifecycle invocation ${invocation}`)
      pendingProfileLifecycle.delete(invocation)
      pending.resolve()
    }
    bridgeWindow.__rejectProfileLifecycleInvocation = (invocation, message) => {
      const pending = pendingProfileLifecycle.get(invocation)
      if (!pending) throw new Error(`No pending profile lifecycle invocation ${invocation}`)
      pendingProfileLifecycle.delete(invocation)
      pending.reject(new Error(message))
    }
    if (options.os) bridgeWindow.__GTUM_OS__ = options.os

    const runProfileLifecycle = <T,>(command: string, complete: () => T): T | Promise<T> => {
      const invocation = ++profileLifecycleInvocationCount
      bridgeWindow.__profileLifecycleInvocationCount = invocation
      const configuredError = options.profileLifecycleErrors?.[invocation]
      if (configuredError) throw new Error(configuredError)
      if (!options.deferredProfileLifecycleInvocations?.includes(invocation)) {
        return complete()
      }
      return new Promise<T>((resolve, reject) => {
        pendingProfileLifecycle.set(invocation, {
          command,
          resolve: () => {
            try {
              resolve(complete())
            } catch (error) {
              reject(error instanceof Error ? error : new Error(String(error)))
            }
          },
          reject,
        })
      })
    }

    const targetProfile = (provider: 'codex' | 'claude', accountId: string) => {
      const exists = accountId === `${provider}-default`
        || (provider === 'claude'
          && additionalClaudeProfiles.some((entry) => entry.accountId === accountId))
      if (!exists) throw new Error(`No Agent profile ${provider}/${accountId}`)
      return profile(provider, accountId)
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
        if (command === 'read_agent_profile_snapshot') {
          profileSnapshotReadCount += 1
          const configuredSnapshotError = options.profileSnapshotErrors?.[profileSnapshotReadCount]
          if (configuredSnapshotError) throw new Error(configuredSnapshotError)
          if (options.failProfileSnapshot) {
            throw new Error('profile snapshot unavailable')
          }
          const isInitialRead = !didReadInitialProfileSnapshot
          didReadInitialProfileSnapshot = true
          if (options.deferInitialProfileSnapshot && isInitialRead) {
            if (initialProfileResolutionStatus) {
              claudeConnectionStatus = initialProfileResolutionStatus
              profileStatuses.set(
                ownerKey('claude', claudeDefaultAccountId),
                initialProfileResolutionStatus,
              )
              return profileSnapshot()
            }
            return new Promise((resolve) => {
              resolveInitialProfileSnapshot = (status) => {
                claudeConnectionStatus = status
                profileStatuses.set(ownerKey('claude', claudeDefaultAccountId), status)
                resolve(profileSnapshot())
              }
            })
          }
          return profileSnapshot()
        }
        if (command === 'list_agent_connections') {
          const isInitialRead = !didReadInitialConnectionList
          didReadInitialConnectionList = true
          if (options.deferInitialProfileSnapshot && isInitialRead) {
            if (initialProfileResolutionStatus) {
              return [
                connection('claude', initialProfileResolutionStatus),
                connection('codex'),
              ]
            }
            return new Promise((resolve) => {
              resolveInitialConnectionList = (status) => resolve([
                connection('claude', status),
                connection('codex'),
              ])
            })
          }
          return [connection('claude', claudeConnectionStatus), connection('codex')]
        }
        if (command === 'begin_agent_login') {
          const provider = String(args?.provider) as 'codex' | 'claude'
          if (provider === 'claude') {
            claudeConnectionStatus = 'connected'
            const key = ownerKey('claude', claudeDefaultAccountId)
            profileStatuses.set(key, 'connected')
            profileCredentialRevisions.set(
              key,
              (profileCredentialRevisions.get(key) || 1) + 1,
            )
          }
          return connection(provider)
        }
        if (command === 'create_agent_profile') {
          const request = args?.request as { provider?: string; alias?: string }
          const provider = String(request?.provider) as 'codex' | 'claude'
          const alias = String(request?.alias)
          return runProfileLifecycle(command, () => {
            if (provider !== 'claude') {
              throw new Error('This focused harness only creates additional Claude profiles')
            }
            let accountId = `claude-profile-${nextGeneratedProfileNumber.toString(36)}`
            while (additionalClaudeProfiles.some((entry) => entry.accountId === accountId)) {
              nextGeneratedProfileNumber += 1
              accountId = `claude-profile-${nextGeneratedProfileNumber.toString(36)}`
            }
            nextGeneratedProfileNumber += 1
            const key = ownerKey(provider, accountId)
            additionalClaudeProfiles.push({ accountId, alias, status: 'disconnected' })
            profileStatuses.set(key, 'disconnected')
            profileCredentialRevisions.set(key, 1)
            profileAliases.set(key, alias)
            profileDefaults.set(key, false)
            profileMetadataRevisions.set(key, 1)
            profileIncarnations.set(key, profileIncarnations.size + 1)
            return profile(provider, accountId)
          })
        }
        if (command === 'rename_agent_profile') {
          const request = args?.request as {
            provider?: string
            accountId?: string
            alias?: string
          }
          const provider = String(request?.provider) as 'codex' | 'claude'
          const accountId = String(request?.accountId)
          const alias = String(request?.alias)
          return runProfileLifecycle(command, () => {
            targetProfile(provider, accountId)
            const key = ownerKey(provider, accountId)
            profileAliases.set(key, alias)
            profileMetadataRevisions.set(
              key,
              (profileMetadataRevisions.get(key) || 1) + 1,
            )
            return profile(provider, accountId)
          })
        }
        if (command === 'set_default_agent_profile') {
          const request = args?.request as { provider?: string; accountId?: string }
          const provider = String(request?.provider) as 'codex' | 'claude'
          const accountId = String(request?.accountId)
          return runProfileLifecycle(command, () => {
            targetProfile(provider, accountId)
            for (const key of profileDefaults.keys()) {
              if (key.startsWith(`${provider}\u0000`)) profileDefaults.set(key, false)
            }
            const key = ownerKey(provider, accountId)
            profileDefaults.set(key, true)
            profileMetadataRevisions.set(
              key,
              (profileMetadataRevisions.get(key) || 1) + 1,
            )
            return profile(provider, accountId)
          })
        }
        if (command === 'check_agent_profile') {
          const request = args?.request as { provider?: string; accountId?: string }
          const provider = String(request?.provider) as 'codex' | 'claude'
          const accountId = String(request?.accountId)
          return runProfileLifecycle(command, () => {
            targetProfile(provider, accountId)
            const key = ownerKey(provider, accountId)
            profileStatuses.set(key, 'connected')
            profileCredentialRevisions.set(
              key,
              (profileCredentialRevisions.get(key) || 1) + 1,
            )
            if (provider === 'claude' && accountId === claudeDefaultAccountId) {
              claudeConnectionStatus = 'connected'
            }
            return profile(provider, accountId)
          })
        }
        if (command === 'disconnect_agent_profile') {
          const request = args?.request as { provider?: string; accountId?: string }
          const provider = String(request?.provider) as 'codex' | 'claude'
          const accountId = String(request?.accountId)
          return runProfileLifecycle(command, () => {
            targetProfile(provider, accountId)
            const key = ownerKey(provider, accountId)
            profileStatuses.set(key, 'disconnected')
            profileCredentialRevisions.set(
              key,
              (profileCredentialRevisions.get(key) || 1) + 1,
            )
            if (provider === 'claude' && accountId === claudeDefaultAccountId) {
              claudeConnectionStatus = 'disconnected'
            }
            return profile(provider, accountId)
          })
        }
        if (command === 'forget_agent_profile') {
          const request = args?.request as { provider?: string; accountId?: string }
          const provider = String(request?.provider) as 'codex' | 'claude'
          const accountId = String(request?.accountId)
          return runProfileLifecycle(command, () => {
            const current = targetProfile(provider, accountId)
            const tombstone = {
              provider,
              accountId,
              incarnation: current.incarnation,
              credentialRevision: String(Number(current.credentialRevision) + 1),
              forgottenAt: 900,
            }
            if (provider === 'claude') {
              const index = additionalClaudeProfiles.findIndex((entry) => (
                entry.accountId === accountId
              ))
              if (index >= 0) additionalClaudeProfiles.splice(index, 1)
            }
            const key = ownerKey(provider, accountId)
            profileStatuses.delete(key)
            profileCredentialRevisions.delete(key)
            profileAliases.delete(key)
            profileDefaults.delete(key)
            profileMetadataRevisions.delete(key)
            profileIncarnations.delete(key)
            const priorTombstone = mutableProfileTombstones.findIndex((entry) => (
              entry.provider === provider && entry.accountId === accountId
            ))
            if (priorTombstone >= 0) mutableProfileTombstones.splice(priorTombstone, 1)
            mutableProfileTombstones.push(tombstone)
            return tombstone
          })
        }
        if (command === 'read_agent_profile_setup_guidance') {
          const request = args?.request as { provider?: string; accountId?: string }
          const provider = String(request?.provider) as 'codex' | 'claude'
          const accountId = String(request?.accountId)
          return runProfileLifecycle(command, () => ({
            provider,
            accountId,
            supported: true,
            program: 'env',
            environment: [],
            arguments: [],
            renderedCommand: `GTUM_AGENT_PROFILE=${accountId} claude auth login`,
            warning: 'Run this command in your own terminal.',
            unsupportedReason: null,
            ...(options.profileSetupGuidance || {}),
          }))
        }
        if (command === 'authorize_agent_profile_lease') {
          const request = args?.request as Record<string, unknown>
          return { ...request, authorized: true }
        }
        throw new Error(`Unexpected auth command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_AGENT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__providerCalls.push({ command, args })
        if (command === 'read_agent_account_capabilities') {
          const request = args?.request as {
            provider?: string
            accountId?: string
            incarnation?: string
            credentialRevision?: string
          }
          const provider = String(request?.provider) as 'codex' | 'claude'
          const accountId = String(request?.accountId)
          const capabilitySnapshot = (models: unknown[]) => ({
            provider,
            accountId,
            incarnation: String(request?.incarnation),
            credentialRevision: String(request?.credentialRevision),
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
        if (command === 'request_agent_account_suggestions') {
          const request = args?.request as {
            provider?: string
            accountId?: string
            incarnation?: string
            credentialRevision?: string
            projectPath?: string
            agentSessionId?: string
          }
          const key = requestKey(
            String(request?.provider),
            String(request?.projectPath),
            String(request?.agentSessionId),
          )
          return new Promise<unknown[]>((resolve, reject) => requestResolvers.set(key, {
            provider: String(request?.provider) as 'codex' | 'claude',
            accountId: String(request?.accountId),
            incarnation: String(request?.incarnation),
            credentialRevision: String(request?.credentialRevision),
            resolve,
            reject,
          }))
        }
        throw new Error(`Unexpected Agent command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_AGENT_JOB_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__agentJobCalls.push({ command, args })
        if (command === 'list_agent_jobs') return []
        if (command === 'create_authorized_agent_job') {
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
  }, {
    projectA,
    projectB,
    sessionA,
    sessionB,
    codexDefaultAccountId,
    claudeDefaultAccountId,
    claudeSecondaryAccountId,
    options,
    claudeModelCatalog,
    claudeValidationFailureGuidance,
  })
}

const projectRow = (page: Page, path: string) =>
  page.locator(`.project-switcher button[data-project-path="${path}"]`)

const sendRequest = async (page: Page, provider: string, text: string) => {
  await page.getByPlaceholder(`Ask ${provider}`).fill(text)
  await page.locator('.composer-input .send').click()
}

const modelTrigger = (page: Page, provider: 'Codex' | 'Claude') =>
  page.getByRole('button', { name: new RegExp(`^${provider} model:`) })

const accountOption = (page: Page, accountId: string) =>
  page.locator(`[role="option"][data-account-id="${accountId}"]`)

const settingsAccountRow = (page: Page, provider: 'codex' | 'claude', accountId: string) =>
  page.locator(
    `.settings-account-row[data-provider-id="${provider}"][data-account-id="${accountId}"]`,
  )

const switchProvider = async (page: Page, provider: 'Codex' | 'Claude') => {
  await page.locator('.composer-provider-chip').click()
  await accountOption(
    page,
    provider === 'Codex' ? codexDefaultAccountId : claudeDefaultAccountId,
  ).click()
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
    const profileStatuses: Record<'claude' | 'codex', 'connected' | 'disconnected'> = {
      claude: 'disconnected',
      codex: 'disconnected',
    }
    const credentialRevisions: Record<'claude' | 'codex', number> = {
      claude: 1,
      codex: 1,
    }
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
    const profileSnapshot = () => ({
      registryVersion: 2,
      profiles: (['codex', 'claude'] as const).map((provider, index) => {
        const status = profileStatuses[provider]
        return {
          provider,
          accountId: `${provider}-default`,
          alias: provider === 'claude' ? 'Claude CLI Session' : 'Codex CLI Session',
          profileKind: { kind: 'ambient' },
          isDefault: true,
          incarnation: String(index + 1),
          metadataRevision: '1',
          credentialRevision: String(credentialRevisions[provider]),
          connection: {
            status,
            requiresValidation: false,
            credentialSource: status === 'connected' && provider === 'claude'
              ? 'claude_cli_session'
              : null,
            connectedAt: status === 'connected' ? 200 : null,
            updatedAt: status === 'connected' ? 200 : 100,
            lastError: null,
          },
        }
      }),
      tombstones: [],
    })
    localStorage.setItem('gtum.agent-session-directory.v2', JSON.stringify({
      'no-project': {
        workspaceTitle: 'Open a project',
        activeSessionId: 'connection-ordering-session',
        sessions: [{
          id: 'connection-ordering-session',
          title: 'Connection ordering',
          providerId: 'codex',
          selectedAccountIds: {
            codex: 'codex-default',
            claude: 'claude-default',
          },
          selectedModels: {},
          selectedReasoningLevels: {},
          fastModes: {},
          createdAt: '10:00',
          updatedAt: '10:00',
        }],
      },
    }))
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
      profileStatuses[provider] = 'connected'
      credentialRevisions[provider] += 1
      resolve(profileSnapshot().profiles.find((profile) => profile.provider === provider))
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
        if (command === 'read_agent_profile_snapshot') return profileSnapshot()
        if (command === 'list_agent_connections') {
          return new Promise<unknown[]>((resolve, reject) => {
            resolveList = resolve
            rejectList = reject
          })
        }
        if (command === 'check_agent_profile') {
          const request = args?.request as { provider?: string }
          connectingProvider = String(request?.provider) as 'claude' | 'codex'
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

test('account picker groups exact Codex and Claude aliases and selects one owner', async ({ page }) => {
  await installClaudeWorkspaceHarness(page)
  await page.goto('/')

  const trigger = page.locator('.composer-provider-chip')
  await expect(trigger).toHaveAttribute(
    'aria-label',
    'Agent account: Codex · Codex CLI Session · Connected',
  )
  await expect(trigger).toHaveAttribute(
    'title',
    'Agent account: Codex · Codex CLI Session · Connected',
  )
  await trigger.click()

  const menu = page.getByRole('listbox', { name: 'Agent accounts' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('group', { name: 'Codex accounts' })).toHaveCount(1)
  await expect(menu.getByRole('group', { name: 'Claude accounts' })).toHaveCount(1)
  await expect(accountOption(page, codexDefaultAccountId)).toContainText('Codex CLI Session')
  await expect(accountOption(page, claudeDefaultAccountId)).toContainText('Claude CLI Session')
  await expect(accountOption(page, claudeSecondaryAccountId)).toContainText('Claude Secondary')
  await expect(menu.locator('[role="option"][aria-selected="true"]')).toHaveCount(1)
  await expect(accountOption(page, codexDefaultAccountId)).toHaveAttribute('aria-selected', 'true')

  await accountOption(page, claudeSecondaryAccountId).click()
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-provider-id', 'claude')
  await expect(page.locator('.agent')).toHaveAttribute(
    'data-agent-account-id',
    claudeSecondaryAccountId,
  )
  await expect(trigger).toHaveAttribute(
    'aria-label',
    'Agent account: Claude · Claude Secondary · Connected',
  )
  await expect.poll(() => page.evaluate(({ projectA }) => {
    const directory = JSON.parse(localStorage.getItem('gtum.agent-session-directory.v2') || '{}')
    return directory[projectA]?.sessions?.[0]?.selectedAccountIds
  }, { projectA })).toEqual({
    codex: codexDefaultAccountId,
    claude: claudeSecondaryAccountId,
  })
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('agent header uses the exact selected profile instead of ambient provider state', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'claude',
    sessionASelectedAccountIds: { claude: claudeSecondaryAccountId },
    claudeInitialConnectionStatus: 'disconnected',
  })
  await page.goto('/')

  const header = page.locator('.agent-header')
  await expect(page.locator('.agent')).toHaveAttribute(
    'data-agent-account-id',
    claudeSecondaryAccountId,
  )
  await expect(header.locator('.agent-model-sub')).toContainText('Claude Secondary')
  await expect(header.locator('.agent-model-sub')).toContainText('Connected')
  await expect(header.locator('.agent-model-sub')).not.toContainText('Connect provider')
  await expect(header.locator('.agent-model-sub')).not.toContainText('Checking login')
})

test('account picker supports arrows Home End Escape and restores trigger focus', async ({ page }) => {
  await installClaudeWorkspaceHarness(page)
  await page.goto('/')

  const trigger = page.locator('.composer-provider-chip')
  const menu = page.getByRole('listbox', { name: 'Agent accounts' })
  await trigger.click()
  await expect(accountOption(page, codexDefaultAccountId)).toBeFocused()

  await page.keyboard.press('ArrowDown')
  await expect(accountOption(page, claudeDefaultAccountId)).toBeFocused()
  await page.keyboard.press('Space')
  await expect(menu).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-provider-id', 'claude')
  await expect(page.locator('.agent')).toHaveAttribute(
    'data-agent-account-id',
    claudeDefaultAccountId,
  )

  await trigger.click()
  await page.keyboard.press('End')
  await expect(accountOption(page, claudeSecondaryAccountId)).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(accountOption(page, claudeDefaultAccountId)).toBeFocused()
  await page.keyboard.press('Home')
  await expect(accountOption(page, codexDefaultAccountId)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await trigger.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(page.locator('.agent')).toHaveAttribute(
    'data-agent-account-id',
    claudeSecondaryAccountId,
  )
  await expect(trigger).toBeFocused()

  await trigger.click()
  await expect(accountOption(page, claudeSecondaryAccountId)).toBeFocused()
  await page.keyboard.press('Home')
  await expect(accountOption(page, codexDefaultAccountId)).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(menu).toHaveCount(0)
  await expect(trigger).not.toBeFocused()
  await trigger.click()
  await expect(accountOption(page, claudeSecondaryAccountId)).toBeFocused()
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('account picker restores focus when a focused non-selected row is removed live', async ({ page }) => {
  await installClaudeWorkspaceHarness(page)
  await page.goto('/')

  const textarea = page.getByPlaceholder('Ask Codex')
  await textarea.fill('refresh profiles after a provider failure')
  const trigger = page.locator('.composer-provider-chip')
  await trigger.click()
  const menu = page.getByRole('listbox', { name: 'Agent accounts' })
  const removed = accountOption(page, claudeSecondaryAccountId)
  await removed.focus()
  await expect(removed).toBeFocused()

  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('.composer-input .send')
    button?.click()
  })
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __providerCalls?: RuntimeCall[] }
  ).__providerCalls?.filter((call) => call.command === 'request_agent_account_suggestions').length ?? 0))
    .toBe(1)
  await page.evaluate(({ projectA, sessionA, accountId }) => {
    const testWindow = window as Window & {
      __removeAgentProfile(provider: string, accountId: string): void
      __rejectProviderRequest(
        provider: string,
        projectPath: string,
        agentSessionId: string,
        message: string,
      ): void
    }
    testWindow.__removeAgentProfile('claude', accountId)
    testWindow.__rejectProviderRequest(
      'codex',
      projectA,
      sessionA,
      'refresh profile rows',
    )
  }, { projectA, sessionA, accountId: claudeSecondaryAccountId })

  await expect(removed).toHaveCount(0)
  await expect(menu).toBeVisible()
  await expect(accountOption(page, codexDefaultAccountId)).toBeFocused()
  await expect(menu.locator('[role="option"][aria-selected="true"]')).toHaveCount(1)
})

test('account picker keeps missing and disconnected selections visible and blocks Send', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'claude',
    claudeInitialConnectionStatus: 'disconnected',
  })
  await page.goto('/')

  const trigger = page.locator('.composer-provider-chip')
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-profile-status', 'disconnected')
  await expect(trigger).toHaveAttribute(
    'aria-label',
    'Agent account: Claude · Claude CLI Session · Disconnected',
  )
  await expect(page.locator('.agent-header .agent-model-placeholder'))
    .toHaveText('Model unavailable')
  await expect(page.locator('.agent-header .agent-model-sub'))
    .toContainText('Claude CLI Session')
  await expect(page.locator('.agent-header .agent-model-sub')).toContainText('Disconnected')
  await trigger.click()
  let selected = accountOption(page, claudeDefaultAccountId)
  await expect(selected).toHaveAttribute('aria-selected', 'true')
  await expect(selected).toHaveAttribute('aria-disabled', 'true')
  await expect(selected).toContainText('Disconnected')
  await page.keyboard.press('Escape')

  const textarea = page.getByPlaceholder('Ask Claude')
  const send = page.locator('.composer-input .send')
  await textarea.fill('must remain blocked for a disconnected account')
  await expect(send).toBeDisabled()
  await textarea.press('Enter')
  await expect(textarea).toHaveValue('must remain blocked for a disconnected account')

  const missingAccountId = 'claude-profile-z'
  await page.evaluate(({ projectA, missingAccountId }) => {
    const key = 'gtum.agent-session-directory.v2'
    const directory = JSON.parse(localStorage.getItem(key) || '{}')
    directory[projectA].sessions[0].providerId = 'claude'
    directory[projectA].sessions[0].selectedAccountIds.claude = missingAccountId
    localStorage.setItem(key, JSON.stringify(directory))
  }, { projectA, missingAccountId })
  await page.reload()

  await expect(page.locator('.agent')).toHaveAttribute('data-agent-account-id', missingAccountId)
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-profile-status', 'missing')
  await expect(trigger).toHaveAttribute(
    'aria-label',
    `Agent account: Claude · Missing account (${missingAccountId}) · Missing`,
  )
  await trigger.click()
  selected = accountOption(page, missingAccountId)
  await expect(selected).toHaveAttribute('aria-selected', 'true')
  await expect(selected).toHaveAttribute('aria-disabled', 'true')
  await expect(selected).toContainText(`Missing account (${missingAccountId})`)
  await page.keyboard.press('Escape')
  await textarea.fill('must remain blocked for a missing account')
  await expect(send).toBeDisabled()
  await textarea.press('Enter')
  await expect(textarea).toHaveValue('must remain blocked for a missing account')
  expect(await page.evaluate(() => (
    window as Window & { __providerCalls?: RuntimeCall[] }
  ).__providerCalls?.filter((call) => call.command === 'request_agent_account_suggestions') ?? []))
    .toEqual([])
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('account picker keeps a forgotten selection disabled and ignores Enter and Space', async ({ page }) => {
  const forgottenAccountId = 'claude-profile-forgotten'
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'claude',
    sessionASelectedAccountIds: { claude: forgottenAccountId },
    profileTombstones: [{
      provider: 'claude',
      accountId: forgottenAccountId,
      incarnation: '99',
      credentialRevision: '4',
      forgottenAt: 500,
    }],
  })
  await page.goto('/')

  const trigger = page.locator('.composer-provider-chip')
  await expect(trigger).toHaveAttribute(
    'aria-label',
    `Agent account: Claude · Forgotten account (${forgottenAccountId}) · Forgotten`,
  )
  await trigger.click()
  const menu = page.getByRole('listbox', { name: 'Agent accounts' })
  const forgotten = accountOption(page, forgottenAccountId)
  await expect(forgotten).toHaveAttribute('aria-selected', 'true')
  await expect(forgotten).toHaveAttribute('aria-disabled', 'true')
  await forgotten.focus()
  await page.keyboard.press('Enter')
  await expect(menu).toBeVisible()
  await expect(forgotten).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Space')
  await expect(menu).toBeVisible()
  await expect(forgotten).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.agent')).toHaveAttribute(
    'data-agent-account-id',
    forgottenAccountId,
  )
  expect(await page.evaluate(() => (
    window as Window & { __providerCalls?: RuntimeCall[] }
  ).__providerCalls?.filter((call) => call.command === 'request_agent_account_suggestions') ?? []))
    .toEqual([])
})

test('account picker preserves live status and selected-row visibility after profile changes', async ({ page }) => {
  const selectedAccountId = accountPickerClaudeProfiles.at(-1)!.accountId
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'claude',
    sessionASelectedAccountIds: { claude: selectedAccountId },
    additionalClaudeProfiles: accountPickerClaudeProfiles,
  })
  await page.goto('/')

  const trigger = page.locator('.composer-provider-chip')
  await trigger.click()
  const menu = page.getByRole('listbox', { name: 'Agent accounts' })
  const selected = accountOption(page, selectedAccountId)
  await expect(selected).toHaveAttribute('aria-selected', 'true')
  await expect(selected).toContainText('Connected')
  const expectSelectedVisible = async () => {
    const geometry = await selected.evaluate((option) => {
      const listbox = option.closest('[role="listbox"]')
      if (!(listbox instanceof HTMLElement)) throw new Error('Account option lost its listbox')
      const optionRect = option.getBoundingClientRect()
      const menuRect = listbox.getBoundingClientRect()
      return {
        optionTop: optionRect.top,
        optionBottom: optionRect.bottom,
        menuTop: menuRect.top + listbox.clientTop,
        menuBottom: menuRect.top + listbox.clientTop + listbox.clientHeight,
      }
    })
    expect(geometry.optionTop).toBeGreaterThanOrEqual(geometry.menuTop - 0.5)
    expect(geometry.optionBottom).toBeLessThanOrEqual(geometry.menuBottom + 0.5)
  }
  await expectSelectedVisible()

  await page.locator('.agent-header .rail-toggle[title="Settings"]').click()
  const selectedSettingsRow = settingsAccountRow(page, 'claude', selectedAccountId)
  await selectedSettingsRow.getByRole('button', {
    name: `Disconnect Claude account ${maximumAccountAlias} (${selectedAccountId})`,
    exact: true,
  }).click()
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-profile-status', 'disconnected')
  await page.locator('.settings-close').click()

  await expect(menu).toBeVisible()
  await expect(selected).toHaveAttribute('aria-selected', 'true')
  await expect(selected).toHaveAttribute('aria-disabled', 'true')
  await expect(selected).toContainText('Disconnected')
  await expect(trigger).toHaveAttribute(
    'aria-label',
    `Agent account: Claude · ${maximumAccountAlias} · Disconnected`,
  )
  await expectSelectedVisible()
  await expect(menu.locator('[role="option"][aria-selected="true"]')).toHaveCount(1)
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('account picker stays one line and contained at 380 260 and 240 pixel Agent widths', async ({ page }) => {
  const selectedAccountId = accountPickerClaudeProfiles.at(-1)!.accountId
  await page.setViewportSize({ width: 1280, height: 720 })
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'claude',
    sessionASelectedAccountIds: { claude: selectedAccountId },
    additionalClaudeProfiles: accountPickerClaudeProfiles,
    includeAdvancedControls: true,
  })
  await page.goto('/')

  const trigger = page.locator('.composer-provider-chip')
  await expect(trigger).toHaveText('Cl')
  await expect(trigger).not.toContainText(maximumAccountAlias)
  await expect(page.locator('.fast-toggle')).toHaveAttribute('aria-pressed', 'false')

  for (const targetWidth of [380, 260, 240]) {
    await resizeAgentPanel(page, targetWidth)
    const toolbar = await page.locator('.composer-foot').evaluate((row) => {
      const visibleChildren = Array.from(row.children).filter((child) => {
        const style = getComputedStyle(child)
        return style.display !== 'none' && style.visibility !== 'hidden'
      })
      const centers = new Set(visibleChildren.map((child) => {
        const rect = child.getBoundingClientRect()
        return Math.round((rect.top + rect.height / 2) * 10) / 10
      }))
      return {
        flexWrap: getComputedStyle(row).flexWrap,
        lineCount: centers.size,
        clientWidth: row.clientWidth,
        scrollWidth: row.scrollWidth,
      }
    })
    expect(toolbar.flexWrap).toBe('nowrap')
    expect(toolbar.lineCount).toBe(1)
    expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth + 1)

    await trigger.click()
    const menu = page.getByRole('listbox', { name: 'Agent accounts' })
    await expect(menu).toBeVisible()
    const geometry = await menu.evaluate((listbox) => {
      const menuRect = listbox.getBoundingClientRect()
      const agent = listbox.closest('.agent')
      const composer = listbox.closest('.composer-input')
      if (!(agent instanceof HTMLElement) || !(composer instanceof HTMLElement)) {
        throw new Error('Account menu lost its Agent/composer owner')
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
        viewportWidth: innerWidth,
        clientWidth: listbox.clientWidth,
        scrollWidth: listbox.scrollWidth,
      }
    })
    expect(geometry.menuLeft).toBeGreaterThanOrEqual(geometry.agentLeft - 0.5)
    expect(geometry.menuRight).toBeLessThanOrEqual(geometry.agentRight + 0.5)
    expect(geometry.menuLeft).toBeGreaterThanOrEqual(geometry.composerLeft - 0.5)
    expect(geometry.menuRight).toBeLessThanOrEqual(geometry.composerRight + 0.5)
    expect(geometry.menuLeft).toBeGreaterThanOrEqual(0)
    expect(geometry.menuRight).toBeLessThanOrEqual(geometry.viewportWidth)
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1)

    const labelGeometry = await accountOption(page, selectedAccountId)
      .locator('.composer-account-alias')
      .evaluate((label) => {
        const option = label.closest('[role="option"]')
        if (!(option instanceof HTMLElement)) throw new Error('Account alias lost its option')
        const optionRect = option.getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(label)
        const lineRects = Array.from(range.getClientRects())
          .filter((rect) => rect.width > 0 && rect.height > 0)
        return {
          lineCount: new Set(lineRects.map((rect) => Math.round(rect.top * 10) / 10)).size,
          clientWidth: label.clientWidth,
          scrollWidth: label.scrollWidth,
          fullyInside: lineRects.every((rect) => (
            rect.left >= optionRect.left - 0.5 && rect.right <= optionRect.right + 0.5
          )),
        }
      })
    expect(labelGeometry.lineCount).toBeGreaterThan(1)
    expect(labelGeometry.scrollWidth).toBeLessThanOrEqual(labelGeometry.clientWidth + 1)
    expect(labelGeometry.fullyInside).toBe(true)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  }
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('account picker does not fabricate an account while profiles load or are unavailable', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, { deferInitialProfileSnapshot: true })
  await page.goto('/')

  const trigger = page.locator('.composer-provider-chip')
  await expect(trigger).toBeDisabled()
  await expect(trigger).toHaveAttribute('aria-label', 'Agent accounts: Loading')
  await expect(page.getByRole('listbox', { name: 'Agent accounts' })).toHaveCount(0)
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-provider-id', '')
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-account-id', '')
  await expect(page.locator('.agent-header > .provider-mark')).toHaveCount(0)
  await expect(trigger.locator('.provider-mark')).toHaveCount(0)
  await expect(page.locator('.agent-header .agent-model-name')).toHaveCount(0)
  await expect(page.locator('.agent-header')).not.toContainText('Codex default')
  await expect(page.locator('.agent-header')).not.toContainText('Agent 1')

  await page.evaluate(() => (
    window as Window & {
      __resolveInitialProfileSnapshot(status: 'connected' | 'disconnected'): void
    }
  ).__resolveInitialProfileSnapshot('connected'))
  await expect(trigger).toHaveAttribute(
    'aria-label',
    'Agent account: Codex · Codex CLI Session · Connected',
  )
})

test('account picker unavailable state does not fabricate provider account or model UI', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, { failProfileSnapshot: true })
  await page.goto('/')

  const trigger = page.locator('.composer-provider-chip')
  await expect(trigger).toBeDisabled()
  await expect(trigger).toHaveAttribute('aria-label', 'Agent accounts: Unavailable')
  await expect(page.getByRole('listbox', { name: 'Agent accounts' })).toHaveCount(0)
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-account-id', '')
  await expect(page.locator('.agent-header > .provider-mark')).toHaveCount(0)
  await expect(trigger.locator('.provider-mark')).toHaveCount(0)
  await expect(page.locator('.agent-header .agent-model-name')).toHaveCount(0)
  await expect(page.locator('.agent-header')).not.toContainText('Codex default')
  await expect(page.locator('.agent-header')).not.toContainText('Agent 1')
  await expect(page.locator('.composer-model-chip')).toHaveCount(0)
  await expect(page.locator('[role="option"][data-account-id]')).toHaveCount(0)
})

test('selected provider marks stay explicitly current for Codex and Claude', async ({ page }) => {
  await installClaudeWorkspaceHarness(page)
  await page.goto('/')

  const expectCurrentProviderMarks = async (provider: 'codex' | 'claude') => {
    const marks = [
      page.locator('.agent-header > .provider-mark'),
      page.locator('.composer-provider-chip .provider-mark'),
    ]

    for (const mark of marks) {
      await expect(mark).toHaveClass(new RegExp(`\\b${provider}\\b`))
      await expect(mark).toHaveClass(/\bcurrent\b/)
      const style = await mark.evaluate((element) => {
        const probe = document.createElement('span')
        probe.style.color = 'var(--accent)'
        document.body.appendChild(probe)
        const accentColor = getComputedStyle(probe).color
        probe.remove()
        const computed = getComputedStyle(element)
        return {
          borderStyle: computed.borderStyle,
          color: computed.color,
          accentColor,
        }
      })
      expect(style.borderStyle).toBe('solid')
      expect(style.color).toBe(style.accentColor)
    }
  }
  const expectOnlySelectedProvider = async (provider: 'Codex' | 'Claude') => {
    const menu = page.getByRole('listbox', { name: 'Agent accounts' })
    const selected = menu.locator('[role="option"][aria-selected="true"]')
    await expect(selected).toHaveCount(1)
    await expect(selected).toContainText(provider)
    return menu
  }

  await expect(page.locator('.agent')).toHaveAttribute('data-agent-provider-id', 'codex')
  await expectCurrentProviderMarks('codex')
  await page.locator('.composer-provider-chip').click()
  let providerMenu = await expectOnlySelectedProvider('Codex')
  await accountOption(page, claudeDefaultAccountId).click()

  await expect(page.locator('.agent')).toHaveAttribute('data-agent-provider-id', 'claude')
  await expectCurrentProviderMarks('claude')
  await page.locator('.composer-provider-chip').click()
  providerMenu = await expectOnlySelectedProvider('Claude')
  await page.keyboard.press('Escape')
  await expect(providerMenu).toHaveCount(0)
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('toggles supported Fast mode directly with native activation and no terminal work', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'claude',
    includeAdvancedControls: true,
    claudeCapabilityFixtures: [{ models: claudeExecutionMetadataCatalog }],
  })
  await page.goto('/')

  const fastTrigger = page.locator('.fast-toggle')
  const fastMenu = page.getByRole('listbox', { name: 'Fast mode' })
  const expectFast = async (enabled: boolean) => {
    await expect(fastTrigger).toHaveAttribute('aria-pressed', String(enabled))
    await expect(fastTrigger).toHaveAttribute(
      'aria-label',
      `Fast mode: ${enabled ? 'Enabled' : 'Disabled'}`,
    )
    await expect(fastTrigger).toHaveAttribute(
      'title',
      `Fast mode: ${enabled ? 'Enabled' : 'Disabled'}`,
    )
    await expect(fastMenu).toHaveCount(0)
  }

  await expectFast(false)
  expect(await fastTrigger.getAttribute('aria-haspopup')).toBeNull()
  expect(await fastTrigger.getAttribute('aria-expanded')).toBeNull()

  await fastTrigger.click()
  await expectFast(true)
  await fastTrigger.click()
  await expectFast(false)

  const reasoningTrigger = page.locator('.composer-reasoning-chip')
  await reasoningTrigger.click()
  const reasoningMenu = page.getByRole('listbox', { name: 'Reasoning levels' })
  await expect(reasoningMenu).toBeVisible()
  await fastTrigger.click()
  await expect(reasoningMenu).toHaveCount(0)
  await expectFast(true)

  await fastTrigger.press('Enter')
  await expectFast(false)
  await fastTrigger.press('Space')
  await expectFast(true)

  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('waits for startup provider discovery before an exact Claude check and blocks repeat pending work', async ({ page }) => {
  await installClaudeConnectionOrderingHarness(page)
  await page.goto('/')
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => call.command === 'list_agent_connections').length ?? 0)).toBe(1)

  await page.locator('.titlebar .pill.icon-only').click()
  const claudeRow = settingsAccountRow(page, 'claude', claudeDefaultAccountId)
  await expect(claudeRow).toHaveCount(0)
  expect(await page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => call.command === 'read_agent_profile_snapshot').length ?? 0)).toBe(0)

  await page.evaluate(() => (
    window as Window & { __resolveStaleConnectionList(): void }
  ).__resolveStaleConnectionList())
  await expect(claudeRow).toHaveAttribute('data-profile-status', 'disconnected')
  const pending = claudeRow.getByRole('button', {
    name: `Check Claude account Claude CLI Session (${claudeDefaultAccountId})`,
    exact: true,
  })
  await pending.evaluate((button) => {
    button.click()
    button.click()
  })
  await expect(pending).not.toHaveAttribute('disabled')
  await expect(pending).toHaveAttribute('aria-disabled', 'true')
  await expect(pending).toHaveAttribute('aria-busy', 'true')
  expect(await page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => call.command === 'check_agent_profile').length ?? 0)).toBe(1)

  await page.evaluate(() => (
    window as Window & { __resolveProviderConnect(): void }
  ).__resolveProviderConnect())
  await expect(claudeRow).toHaveAttribute('data-profile-status', 'connected')

  await expect(claudeRow).toContainText('Connected')
  await expect(claudeRow).toContainText(claudeDefaultAccountId)
  await expect(claudeRow.getByRole('button', {
    name: `Disconnect Claude account Claude CLI Session (${claudeDefaultAccountId})`,
    exact: true,
  })).toBeVisible()
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('recovers an exact Codex check after startup provider discovery fails', async ({ page }) => {
  await installClaudeConnectionOrderingHarness(page)
  await page.goto('/')
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => call.command === 'list_agent_connections').length ?? 0)).toBe(1)

  await page.locator('.titlebar .pill.icon-only').click()
  const codexRow = settingsAccountRow(page, 'codex', codexDefaultAccountId)
  await expect(codexRow).toHaveCount(0)
  expect(await page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => call.command === 'read_agent_profile_snapshot').length ?? 0)).toBe(0)

  await page.evaluate(() => (
    window as Window & { __rejectStaleConnectionList(): void }
  ).__rejectStaleConnectionList())
  await expect(codexRow).toHaveAttribute('data-profile-status', 'disconnected')
  const check = codexRow.getByRole('button', {
    name: `Check Codex account Codex CLI Session (${codexDefaultAccountId})`,
    exact: true,
  })
  await check.click()
  await expect(check).toBeFocused()
  await expect(check).not.toHaveAttribute('disabled')
  await expect(check).toHaveAttribute('aria-disabled', 'true')
  await expect(check).toHaveAttribute('aria-busy', 'true')
  await page.evaluate(() => (
    window as Window & { __resolveProviderConnect(): void }
  ).__resolveProviderConnect())
  await expect(codexRow).toHaveAttribute('data-profile-status', 'connected')

  await expect(codexRow).toContainText('Connected')
  await expect(codexRow).toContainText(codexDefaultAccountId)
  await expect(codexRow.getByRole('button', {
    name: `Disconnect Codex account Codex CLI Session (${codexDefaultAccountId})`,
    exact: true,
  })).toBeVisible()
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('waits for recovered startup auth before loading Claude execution information', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'claude',
    claudeInitialConnectionStatus: 'connected',
    deferInitialProfileSnapshot: true,
    claudeCapabilityFixtures: [{ models: claudeExecutionMetadataCatalog }],
  })
  await page.goto('/')

  await expect.poll(() => page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => call.command === 'list_agent_connections').length ?? 0)).toBe(1)
  expect(await page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => call.command === 'read_agent_profile_snapshot').length ?? 0)).toBe(0)
  await flushBrowserLayout(page)

  await expect(page.locator('.composer-input .send')).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Attach', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => (
    window as Window & { __claudeCapabilityReadCount?: number }
  ).__claudeCapabilityReadCount ?? 0)).toBe(0)
  await expect(modelTrigger(page, 'Claude')).toHaveCount(0)
  await expect(page.locator('.composer-reasoning-chip')).toHaveCount(0)
  await expect(page.locator('.fast-toggle')).toHaveCount(0)
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])

  await page.evaluate(() => (
    window as Window & {
      __resolveInitialProfileSnapshot(status: 'connected' | 'disconnected'): void
    }
  ).__resolveInitialProfileSnapshot('connected'))
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => call.command === 'read_agent_profile_snapshot').length ?? 0)).toBe(1)
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __claudeCapabilityReadCount?: number }
  ).__claudeCapabilityReadCount ?? 0)).toBe(1)
  await expect(modelTrigger(page, 'Claude'))
    .toHaveAttribute('aria-label', 'Claude model: Metadata A')
  await expect(page.locator('.composer-reasoning-chip'))
    .toHaveAttribute('aria-label', 'Reasoning level: Default')
  await expect(page.locator('.fast-toggle'))
    .toHaveAttribute('aria-label', 'Fast mode: Disabled')
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('keeps Claude execution information unloaded after disconnected startup discovery', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'claude',
    claudeInitialConnectionStatus: 'disconnected',
    deferInitialProfileSnapshot: true,
    claudeCapabilityFixtures: [
      { models: claudePriorPolicyCatalog },
    ],
  })
  await page.goto('/')

  await expect.poll(() => page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => call.command === 'list_agent_connections').length ?? 0)).toBe(1)
  expect(await page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => call.command === 'read_agent_profile_snapshot').length ?? 0)).toBe(0)
  await flushBrowserLayout(page)
  expect(await page.evaluate(() => (
    window as Window & { __claudeCapabilityReadCount?: number }
  ).__claudeCapabilityReadCount ?? 0)).toBe(0)
  await expect(modelTrigger(page, 'Claude')).toHaveCount(0)

  await page.evaluate(() => (
    window as Window & {
      __resolveInitialProfileSnapshot(status: 'connected' | 'disconnected'): void
    }
  ).__resolveInitialProfileSnapshot('disconnected'))
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => call.command === 'read_agent_profile_snapshot').length ?? 0)).toBe(1)
  await flushBrowserLayout(page)

  expect(await page.evaluate(() => (
    window as Window & { __claudeCapabilityReadCount?: number }
  ).__claudeCapabilityReadCount ?? 0)).toBe(0)
  await expect(modelTrigger(page, 'Claude')).toHaveCount(0)
  await page.locator('.titlebar .pill.icon-only').click()
  const claudeRow = settingsAccountRow(page, 'claude', claudeDefaultAccountId)
  await expect(claudeRow).toContainText('Disconnected')
  await expect(claudeRow.getByRole('button', {
    name: `Check Claude account Claude CLI Session (${claudeDefaultAccountId})`,
    exact: true,
  })).toBeVisible()
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('keeps Claude execution information unloaded and shows canonical safe guidance after failed startup refresh', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'claude',
    deferInitialProfileSnapshot: true,
    claudeCapabilityFixtures: [
      { models: claudePriorPolicyCatalog },
    ],
  })
  await page.goto('/')

  await expect.poll(() => page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => call.command === 'list_agent_connections').length ?? 0)).toBe(1)
  expect(await page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => call.command === 'read_agent_profile_snapshot').length ?? 0)).toBe(0)
  await page.evaluate(() => (
    window as Window & {
      __resolveInitialProfileSnapshot(status: ClaudeConnectionStatus): void
    }
  ).__resolveInitialProfileSnapshot('error'))
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => call.command === 'read_agent_profile_snapshot').length ?? 0)).toBe(1)
  await flushBrowserLayout(page)

  expect(await page.evaluate(() => (
    window as Window & { __providerCalls?: RuntimeCall[] }
  ).__providerCalls?.filter((call) => (
    call.command === 'read_agent_account_capabilities'
  )) ?? [])).toEqual([])
  await expect(modelTrigger(page, 'Claude')).toHaveCount(0)
  await expect(page.locator('.composer-reasoning-chip')).toHaveCount(0)
  await expect(page.locator('.fast-toggle')).toHaveCount(0)

  await page.locator('.titlebar .pill.icon-only').click()
  const claudeRow = settingsAccountRow(page, 'claude', claudeDefaultAccountId)
  await expect(claudeRow).toContainText(claudeValidationFailureGuidance)
  await expect(claudeRow.getByRole('button', {
    name: `Check Claude account Claude CLI Session (${claudeDefaultAccountId})`,
    exact: true,
  })).toBeVisible()
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('refreshes an active Claude catalog immediately after connecting without a provider switch', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'claude',
    claudeInitialConnectionStatus: 'disconnected',
    claudeCapabilityFixtures: [{ models: claudeModelCatalog }],
  })
  await page.goto('/')

  await expect.poll(() => page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => call.command === 'read_agent_profile_snapshot').length ?? 0)).toBe(1)
  await flushBrowserLayout(page)
  expect(await page.evaluate(() => (
    window as Window & { __claudeCapabilityReadCount?: number }
  ).__claudeCapabilityReadCount ?? 0)).toBe(0)
  await expect(modelTrigger(page, 'Claude')).toHaveCount(0)

  await page.locator('.titlebar .pill.icon-only').click()
  const claudeRow = settingsAccountRow(page, 'claude', claudeDefaultAccountId)
  await claudeRow.getByRole('button', {
    name: `Check Claude account Claude CLI Session (${claudeDefaultAccountId})`,
    exact: true,
  }).click()
  await expect(page.locator('.settings-modal')).toBeVisible()

  await expect.poll(() => page.evaluate(() => (
    window as Window & { __claudeCapabilityReadCount?: number }
  ).__claudeCapabilityReadCount ?? 0)).toBe(1)
  await page.locator('.settings-close').click()
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
  const claudeRow = settingsAccountRow(page, 'claude', claudeDefaultAccountId)
  const disconnect = claudeRow.getByRole('button', {
    name: `Disconnect Claude account Claude CLI Session (${claudeDefaultAccountId})`,
    exact: true,
  })
  const check = claudeRow.getByRole('button', {
    name: `Check Claude account Claude CLI Session (${claudeDefaultAccountId})`,
    exact: true,
  })
  await disconnect.click()
  await expect(claudeRow).toHaveAttribute('data-profile-status', 'disconnected')
  await expect(modelTrigger(page, 'Claude')).toHaveCount(0)

  await check.click()
  await expect(page.locator('.settings-modal')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __claudeCapabilityReadCount?: number }
  ).__claudeCapabilityReadCount ?? 0)).toBe(2)
  await expect(modelTrigger(page, 'Claude')).toHaveCount(0)

  await disconnect.click()
  await expect(claudeRow).toHaveAttribute('data-profile-status', 'disconnected')
  await expect(modelTrigger(page, 'Claude')).toHaveCount(0)

  await check.click()
  await expect(page.locator('.settings-modal')).toBeVisible()
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
  await page.locator('.settings-close').click()

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

test('ignores a stale Claude catalog rejection after a newer reconnect succeeds', async ({ page }) => {
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
  const claudeRow = settingsAccountRow(page, 'claude', claudeDefaultAccountId)
  const disconnect = claudeRow.getByRole('button', {
    name: `Disconnect Claude account Claude CLI Session (${claudeDefaultAccountId})`,
    exact: true,
  })
  const check = claudeRow.getByRole('button', {
    name: `Check Claude account Claude CLI Session (${claudeDefaultAccountId})`,
    exact: true,
  })
  await disconnect.click()
  await expect(claudeRow).toHaveAttribute('data-profile-status', 'disconnected')
  await expect(modelTrigger(page, 'Claude')).toHaveCount(0)

  await check.click()
  await expect(page.locator('.settings-modal')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __claudeCapabilityReadCount?: number }
  ).__claudeCapabilityReadCount ?? 0)).toBe(2)
  await expect(modelTrigger(page, 'Claude')).toHaveCount(0)

  await disconnect.click()
  await expect(claudeRow).toHaveAttribute('data-profile-status', 'disconnected')
  await expect(modelTrigger(page, 'Claude')).toHaveCount(0)

  await check.click()
  await expect(page.locator('.settings-modal')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __claudeCapabilityReadCount?: number }
  ).__claudeCapabilityReadCount ?? 0)).toBe(3)
  await expect(modelTrigger(page, 'Claude')).toHaveAttribute(
    'aria-label',
    `Claude model: ${claudeUpdatedPolicyCatalog[0].label}`,
  )

  await page.evaluate(() => (
    window as Window & {
      __rejectClaudeCapabilityRead(readIndex: number, message: string): void
    }
  ).__rejectClaudeCapabilityRead(2, 'stale reconnect catalog failure'))
  await flushBrowserLayout(page)
  await page.locator('.settings-close').click()

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

  await page.locator('.titlebar .pill.icon-only').click()
  await expect(claudeRow).toContainText('Connected')
  await expect(disconnect).toBeVisible()
  await expect(claudeRow).not.toContainText('stale reconnect catalog failure')
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('account catalog keeps the newer same-account read when an older success resolves last', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'claude',
    claudeCapabilityFixtures: [
      { deferred: true, models: claudePriorPolicyCatalog },
      { deferred: true, models: claudeUpdatedPolicyCatalog },
    ],
  })
  await page.goto('/')

  await expect.poll(() => page.evaluate(() => (
    window as Window & { __claudeCapabilityReadCount?: number }
  ).__claudeCapabilityReadCount ?? 0)).toBe(1)
  await switchProvider(page, 'Codex')
  await switchProvider(page, 'Claude')
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __claudeCapabilityReadCount?: number }
  ).__claudeCapabilityReadCount ?? 0)).toBe(2)

  await page.evaluate(({ models }) => (
    window as Window & {
      __resolveClaudeCapabilityRead(readIndex: number, values: unknown[]): void
    }
  ).__resolveClaudeCapabilityRead(2, models), { models: [...claudeUpdatedPolicyCatalog] })
  await expect(modelTrigger(page, 'Claude')).toHaveAttribute(
    'aria-label',
    `Claude model: ${claudeUpdatedPolicyCatalog[0].label}`,
  )

  await page.evaluate(({ models }) => (
    window as Window & {
      __resolveClaudeCapabilityRead(readIndex: number, values: unknown[]): void
    }
  ).__resolveClaudeCapabilityRead(1, models), { models: [...claudePriorPolicyCatalog] })
  await flushBrowserLayout(page)

  await expect(modelTrigger(page, 'Claude')).toHaveAttribute(
    'aria-label',
    `Claude model: ${claudeUpdatedPolicyCatalog[0].label}`,
  )
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('account catalog ignores an older same-account rejection after a newer read succeeds', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'claude',
    claudeCapabilityFixtures: [
      { deferred: true, models: claudePriorPolicyCatalog },
      { deferred: true, models: claudeUpdatedPolicyCatalog },
    ],
  })
  await page.goto('/')

  await expect.poll(() => page.evaluate(() => (
    window as Window & { __claudeCapabilityReadCount?: number }
  ).__claudeCapabilityReadCount ?? 0)).toBe(1)
  await switchProvider(page, 'Codex')
  await switchProvider(page, 'Claude')
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __claudeCapabilityReadCount?: number }
  ).__claudeCapabilityReadCount ?? 0)).toBe(2)

  await page.evaluate(({ models }) => (
    window as Window & {
      __resolveClaudeCapabilityRead(readIndex: number, values: unknown[]): void
    }
  ).__resolveClaudeCapabilityRead(2, models), { models: [...claudeUpdatedPolicyCatalog] })
  await expect(modelTrigger(page, 'Claude')).toHaveAttribute(
    'aria-label',
    `Claude model: ${claudeUpdatedPolicyCatalog[0].label}`,
  )

  await page.evaluate(() => (
    window as Window & {
      __rejectClaudeCapabilityRead(readIndex: number, message: string): void
    }
  ).__rejectClaudeCapabilityRead(1, 'older same-account catalog failure'))
  await flushBrowserLayout(page)

  await expect(modelTrigger(page, 'Claude')).toHaveAttribute(
    'aria-label',
    `Claude model: ${claudeUpdatedPolicyCatalog[0].label}`,
  )
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('account catalog keeps different Claude accounts independent while reads overlap', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'claude',
    sessionBProvider: 'claude',
    sessionBSelectedAccountIds: { claude: claudeSecondaryAccountId },
    claudeCapabilityFixtures: [
      { deferred: true, models: claudePriorPolicyCatalog },
      { models: claudeUpdatedPolicyCatalog },
    ],
  })
  await page.goto('/')

  await expect.poll(() => page.evaluate(() => (
    window as Window & { __claudeCapabilityReadCount?: number }
  ).__claudeCapabilityReadCount ?? 0)).toBe(1)
  await projectRow(page, projectB).click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __claudeCapabilityReadCount?: number }
  ).__claudeCapabilityReadCount ?? 0)).toBe(2)
  await expect(modelTrigger(page, 'Claude')).toHaveAttribute(
    'aria-label',
    `Claude model: ${claudeUpdatedPolicyCatalog[0].label}`,
  )

  await page.evaluate(({ models }) => (
    window as Window & {
      __resolveClaudeCapabilityRead(readIndex: number, values: unknown[]): void
    }
  ).__resolveClaudeCapabilityRead(1, models), { models: [...claudePriorPolicyCatalog] })
  await flushBrowserLayout(page)
  await expect(modelTrigger(page, 'Claude')).toHaveAttribute(
    'aria-label',
    `Claude model: ${claudeUpdatedPolicyCatalog[0].label}`,
  )

  await projectRow(page, projectA).click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __claudeCapabilityReadCount?: number }
  ).__claudeCapabilityReadCount ?? 0)).toBe(2)
  await expect(modelTrigger(page, 'Claude')).toHaveAttribute(
    'aria-label',
    `Claude model: ${claudePriorPolicyCatalog[0].label}`,
  )
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

  await setFastMode(page, true)

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
  ).__providerCalls?.filter((call) => call.command === 'request_agent_account_suggestions').length ?? 0)).toBe(1)
  const request = await page.evaluate(() => (
    window as Window & {
      __providerCalls?: Array<{ command: string; args?: Record<string, unknown> }>
    }
  ).__providerCalls?.find((call) => call.command === 'request_agent_account_suggestions')?.args?.request)
  expect(request).toEqual(expect.objectContaining({
    provider: 'claude',
    accountId: claudeDefaultAccountId,
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

test('recovers a stale provider reasoning preference through the valid Codex default after reload', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'codex',
    includeAdvancedControls: true,
    sessionAPreferences: {
      selectedReasoningLevels: { codex: 'obsolete' },
      fastModes: { codex: false },
    },
  })
  await page.goto('/')

  const reasoningTrigger = page.locator('.composer-reasoning-chip')
  const assertDefaultRemainsSelectable = async () => {
    await expect(reasoningTrigger).toHaveAttribute('aria-label', 'Reasoning level: High')
    await reasoningTrigger.click()
    const menu = page.getByRole('listbox', { name: 'Reasoning levels' })
    const defaultOption = menu.getByRole('option', { name: 'High', exact: true })
    await expect(defaultOption).toBeEnabled()
    await expect(defaultOption).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Escape')
  }

  await assertDefaultRemainsSelectable()
  await page.reload()
  await assertDefaultRemainsSelectable()
  await expect.poll(() => page.evaluate(({ projectA }) => {
    const directory = JSON.parse(localStorage.getItem('gtum.agent-session-directory.v2') || '{}')
    return directory[projectA]?.sessions?.[0]?.selectedReasoningLevels
  }, { projectA })).toEqual({
    codex: { [codexDefaultAccountId]: 'obsolete' },
  })

  await sendRequest(page, 'Codex', 'use the valid provider reasoning default')
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __providerCalls?: RuntimeCall[] }
  ).__providerCalls?.filter((call) => call.command === 'request_agent_account_suggestions').length ?? 0)).toBe(1)
  const request = await page.evaluate(() => (
    window as Window & { __providerCalls?: RuntimeCall[] }
  ).__providerCalls?.find((call) => call.command === 'request_agent_account_suggestions')?.args?.request)
  expect(request).toEqual(expect.objectContaining({
    provider: 'codex',
    accountId: codexDefaultAccountId,
    reasoningLevel: 'high',
    fastMode: false,
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
  ).__resolveProviderRequest('codex', projectA, sessionA, 'Codex default completed'), {
    projectA,
    sessionA,
  })
  await expect(page.locator('.agent')).toContainText('Codex default completed')
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
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
    await setFastMode(page, label === 'Enabled')
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
    const directory = JSON.parse(localStorage.getItem('gtum.agent-session-directory.v2') || '{}')
    return directory[projectPath]?.sessions?.[0]
  }, path)

  await expect.poll(() => storedSession(projectA)).toEqual(expect.objectContaining({
    selectedReasoningLevels: { codex: { [codexDefaultAccountId]: 'medium' } },
    fastModes: { codex: { [codexDefaultAccountId]: false } },
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
    selectedReasoningLevels: { codex: { [codexDefaultAccountId]: 'xhigh' } },
    fastModes: {
      codex: { [codexDefaultAccountId]: false },
      claude: { [claudeDefaultAccountId]: true },
    },
  }))
  await chooseReasoning('Low')
  await chooseClaudeModel(claudeExecutionMetadataCatalog[2])
  await expect(reasoningTrigger()).toHaveCount(0)
  await expect(fastTrigger()).toHaveCount(0)

  await sendRequest(page, 'Claude', 'unsupported model uses safe execution defaults')
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __providerCalls?: RuntimeCall[] }
  ).__providerCalls?.filter((call) => call.command === 'request_agent_account_suggestions').length ?? 0)).toBe(1)
  const unsupportedRequest = await page.evaluate(() => (
    window as Window & { __providerCalls?: RuntimeCall[] }
  ).__providerCalls?.find((call) => call.command === 'request_agent_account_suggestions')?.args?.request)
  expect(unsupportedRequest).toEqual(expect.objectContaining({
    provider: 'claude',
    accountId: claudeDefaultAccountId,
    model: 'metadata-c',
    reasoningLevel: null,
    fastMode: false,
  }))
  await expect.poll(() => storedSession(projectA)).toEqual(expect.objectContaining({
    selectedReasoningLevels: {
      codex: { [codexDefaultAccountId]: 'xhigh' },
      claude: { [claudeDefaultAccountId]: 'low' },
    },
    fastModes: {
      codex: { [codexDefaultAccountId]: false },
      claude: { [claudeDefaultAccountId]: true },
    },
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
  await chooseFast('Enabled')
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
    const directory = JSON.parse(localStorage.getItem('gtum.agent-session-directory.v2') || '{}')
    return {
      a: directory[projectA]?.sessions?.[0],
      b: directory[projectB]?.sessions?.[0],
    }
  }, { projectA, projectB })
  expect(persisted.a).toEqual(expect.objectContaining({
    selectedReasoningLevels: {
      codex: { [codexDefaultAccountId]: 'xhigh' },
      claude: { [claudeDefaultAccountId]: 'low' },
    },
    fastModes: {
      codex: { [codexDefaultAccountId]: false },
      claude: { [claudeDefaultAccountId]: true },
    },
  }))
  expect(persisted.b).toEqual(expect.objectContaining({
    selectedReasoningLevels: {
      codex: { [codexDefaultAccountId]: 'low' },
      claude: { [claudeDefaultAccountId]: 'high' },
    },
    fastModes: {
      codex: { [codexDefaultAccountId]: true },
      claude: { [claudeDefaultAccountId]: false },
    },
  }))
  for (const session of [persisted.a, persisted.b]) {
    expect(Object.keys(session.selectedReasoningLevels).sort()).toEqual(['claude', 'codex'])
    expect(Object.keys(session.fastModes).sort()).toEqual(['claude', 'codex'])
    expect(Object.values(session.fastModes).every((providerValues) => (
      typeof providerValues === 'object'
      && providerValues != null
      && Object.values(providerValues).every((value) => typeof value === 'boolean')
    ))).toBe(true)
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
      menu: () => page.getByRole('listbox', { name: 'Agent accounts' }),
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
    'Agent account: Claude · Claude CLI Session · Connected',
  )
  await expect(providerTrigger).toHaveAttribute(
    'title',
    'Agent account: Claude · Claude CLI Session · Connected',
  )
  await providerTrigger.click()
  const providerMenu = page.getByRole('listbox', { name: 'Agent accounts' })
  await expect(accountOption(page, claudeDefaultAccountId)).toContainText('Claude CLI Session')
  await expect(accountOption(page, codexDefaultAccountId)).toContainText('Codex CLI Session')
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
  await setFastMode(page, true)
  await expect(fastTrigger).toHaveAttribute('title', 'Fast mode: Enabled')
  await expect(page.getByRole('listbox', { name: 'Fast mode' })).toHaveCount(0)

  await expect(providerTrigger).toHaveAttribute(
    'aria-label',
    'Agent account: Claude · Claude CLI Session · Connected',
  )

  await sendRequest(page, 'Claude', 'compact control request')
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __providerCalls?: RuntimeCall[] }
  ).__providerCalls?.filter((call) => call.command === 'request_agent_account_suggestions').length ?? 0)).toBe(1)
  const request = await page.evaluate(() => (
    window as Window & { __providerCalls?: RuntimeCall[] }
  ).__providerCalls?.find((call) => call.command === 'request_agent_account_suggestions')?.args?.request)
  expect(request).toEqual(expect.objectContaining({
    provider: 'claude',
    accountId: claudeDefaultAccountId,
    model: 'opus[1m]',
    reasoningLevel: 'medium',
    fastMode: true,
  }))
  await expect.poll(() => page.evaluate(({ projectA }) => {
    const directory = JSON.parse(localStorage.getItem('gtum.agent-session-directory.v2') || '{}')
    return directory[projectA]?.sessions?.[0]
  }, { projectA })).toEqual(expect.objectContaining({
    selectedModels: expect.objectContaining({
      claude: { [claudeDefaultAccountId]: 'opus[1m]' },
    }),
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
    claudeInitialConnectionStatus: 'connected',
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

  await modelTrigger(page, 'Codex').click()
  await switchProvider(page, 'Claude')
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-provider-id', 'claude')
  await expect(page.getByPlaceholder('Ask Claude')).toBeVisible()
  await expect(page.locator('.composer-provider-chip'))
    .toHaveAttribute(
      'aria-label',
      'Agent account: Claude · Claude CLI Session · Connected',
    )
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
  ).__providerCalls?.filter((call) => call.command === 'request_agent_account_suggestions').length ?? 0)).toBe(1)
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
  ).__providerCalls?.filter((call) => call.command === 'request_agent_account_suggestions').length ?? 0)).toBe(2)

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
  ).__providerCalls?.filter((call) => call.command === 'request_agent_account_suggestions') ?? [])
  expect(requests.map((call) => call.args?.request)).toEqual([
    expect.objectContaining({
      provider: 'claude',
      accountId: claudeDefaultAccountId,
      model: 'opus[1m]',
      projectPath: projectA,
      agentSessionId: sessionA,
    }),
    expect.objectContaining({
      provider: 'codex',
      accountId: codexDefaultAccountId,
      model: 'gpt-5-codex',
      projectPath: projectB,
      agentSessionId: sessionB,
    }),
  ])
  const authCalls = await page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => call.command === 'begin_agent_login') ?? [])
  expect(authCalls).toEqual([])
  const leaseAuthorizations = await page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => call.command === 'authorize_agent_profile_lease') ?? [])
  expect(leaseAuthorizations).toEqual([])
  const jobCreates = await page.evaluate(() => (
    window as Window & { __agentJobCalls?: RuntimeCall[] }
  ).__agentJobCalls?.filter((call) => call.command === 'create_authorized_agent_job') ?? [])
  expect(jobCreates).toHaveLength(1)
  expect(jobCreates[0]?.args?.request).toEqual(expect.objectContaining({
    provider: 'claude',
    accountId: claudeDefaultAccountId,
    incarnation: '2',
    credentialRevision: '1',
    projectPath: projectA,
    sessionId: sessionA,
    command: 'npm test -- --claude',
  }))
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
  await expect.poll(() => page.evaluate(({ projectA }) => {
    const directory = JSON.parse(localStorage.getItem('gtum.agent-session-directory.v2') || '{}')
    return directory[projectA]?.sessions?.[0]
  }, { projectA })).toEqual(expect.objectContaining({
    providerId: 'claude',
    selectedModels: {
      codex: { [codexDefaultAccountId]: 'gpt-5-codex' },
      claude: { [claudeDefaultAccountId]: 'opus[1m]' },
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
    const directory = JSON.parse(localStorage.getItem('gtum.agent-session-directory.v2') || '{}')
    return directory[projectA]?.sessions?.[0]?.selectedModels
  }, { projectA })).toEqual({
    codex: { [codexDefaultAccountId]: 'gpt-5-codex' },
  })

  await sendRequest(page, 'Claude', 'request after stale model')
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __providerCalls?: RuntimeCall[] }
  ).__providerCalls?.filter((call) => call.command === 'request_agent_account_suggestions').length ?? 0)).toBe(1)
  const request = await page.evaluate(() => (
    window as Window & { __providerCalls?: RuntimeCall[] }
  ).__providerCalls?.find((call) => call.command === 'request_agent_account_suggestions')?.args?.request)
  expect(request).toEqual(expect.objectContaining({
    provider: 'claude',
    accountId: claudeDefaultAccountId,
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
    const directory = JSON.parse(localStorage.getItem('gtum.agent-session-directory.v2') || '{}')
    return directory[projectA]?.sessions?.[0]?.selectedModels
  }, { projectA })).toEqual({
    codex: { [codexDefaultAccountId]: 'gpt-5-codex' },
    claude: { [claudeDefaultAccountId]: 'opus[1m]' },
  })
})

test('account settings group authoritative profiles and expose disambiguated exact actions', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    claudeInitialConnectionStatus: 'disconnected',
    additionalClaudeProfiles: [
      { accountId: 'claude-profile-1', alias: 'Shared alias', status: 'connected' },
      { accountId: 'claude-profile-2', alias: 'Shared alias', status: 'disconnected' },
    ],
  })
  await page.goto('/')
  await page.locator('.titlebar .pill.icon-only').click()

  const claudeGroup = page.locator('.settings-account-group[data-provider-id="claude"]')
  await expect(claudeGroup).toBeVisible()
  await expect(claudeGroup.locator('.settings-account-row')).toHaveCount(3)
  await expect(claudeGroup.locator('[data-account-id="claude-default"]')).toContainText('Disconnected')
  await expect(claudeGroup.locator('[data-account-id="claude-profile-1"]')).toContainText('Connected')
  await expect(claudeGroup.locator('[data-account-id="claude-profile-2"]')).toContainText('Disconnected')

  await expect(claudeGroup.getByRole('button', {
    name: 'Rename Claude account Shared alias (claude-profile-1)',
    exact: true,
  })).toBeVisible()
  await expect(claudeGroup.getByRole('button', {
    name: 'Rename Claude account Shared alias (claude-profile-2)',
    exact: true,
  })).toBeVisible()
  await expect(claudeGroup.getByRole('button', {
    name: 'Forget Claude account Claude CLI Session (claude-default)',
    exact: true,
  })).toBeDisabled()
  await expect(claudeGroup.getByRole('button', {
    name: 'Forget Claude account Shared alias (claude-profile-1)',
    exact: true,
  })).toBeEnabled()
  await expect(claudeGroup).toContainText('Forget does not log out or delete credentials.')
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('account settings trap focus as a named dialog and restore the exact opener on Escape', async ({ page }) => {
  await installClaudeWorkspaceHarness(page)
  await page.goto('/')

  const opener = page.locator('.titlebar .pill.icon-only')
  await opener.focus()
  await opener.press('Enter')

  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  await expect(dialog).toBeFocused()

  const focusable = dialog.locator([
    'button:not([disabled])',
    'input:not([disabled])',
    '[href]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(','))
  const first = focusable.first()
  const last = focusable.last()

  await page.keyboard.press('Tab')
  await expect(first).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(last).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(first).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
})

test('account settings keep Add focus stable and announce failed and committed outcomes', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    additionalClaudeProfiles: [],
    deferredProfileLifecycleInvocations: [1, 2],
  })
  await page.goto('/')
  await page.locator('.titlebar .pill.icon-only').click()

  const aliasInput = page.getByRole('textbox', { name: 'Claude account alias' })
  const add = page.getByRole('button', { name: 'Add Claude account', exact: true })
  await aliasInput.fill('Focus-safe account')
  await add.focus()
  await add.evaluate((button) => {
    button.click()
    button.click()
  })

  await expect(add).toBeFocused()
  await expect(add).not.toHaveAttribute('disabled')
  await expect(add).toHaveAttribute('aria-disabled', 'true')
  await expect(add).toHaveAttribute('aria-busy', 'true')
  expect(await page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => call.command === 'create_agent_profile').length ?? 0)).toBe(1)

  await page.evaluate(() => (
    window as Window & {
      __rejectProfileLifecycleInvocation(invocation: number, message: string): void
    }
  ).__rejectProfileLifecycleInvocation(1, 'create profile temporarily unavailable'))
  await expect(add).toBeFocused()
  await expect(add).toHaveAttribute('aria-disabled', 'false')
  await expect(add).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator(
    '.settings-provider[data-provider-id="claude"] > .settings-account-error',
  )).toHaveText('create profile temporarily unavailable')

  await add.evaluate((button) => {
    button.click()
    button.click()
  })
  await expect(add).toBeFocused()
  await expect(add).toHaveAttribute('aria-disabled', 'true')
  expect(await page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => call.command === 'create_agent_profile').length ?? 0)).toBe(2)

  await page.evaluate(() => (
    window as Window & { __resolveProfileLifecycleInvocation(invocation: number): void }
  ).__resolveProfileLifecycleInvocation(2))

  const createdRow = settingsAccountRow(page, 'claude', 'claude-profile-1')
  const setup = createdRow.getByRole('button', {
    name: 'Show setup command for Claude account Focus-safe account (claude-profile-1)',
    exact: true,
  })
  await expect(setup).toBeFocused()
  await expect(page.getByRole('status')).toHaveText(
    'Claude account Focus-safe account was added. Setup guidance is ready.',
  )
})

test('account settings keep a failed Check focused and announce its exact error', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    deferredProfileLifecycleInvocations: [1],
  })
  await page.goto('/')
  await page.locator('.titlebar .pill.icon-only').click()

  const row = settingsAccountRow(page, 'claude', claudeDefaultAccountId)
  const check = row.getByRole('button', {
    name: `Check Claude account Claude CLI Session (${claudeDefaultAccountId})`,
    exact: true,
  })
  await check.focus()
  await check.evaluate((button) => {
    button.click()
    button.click()
  })

  await expect(check).toBeFocused()
  await expect(check).not.toHaveAttribute('disabled')
  await expect(check).toHaveAttribute('aria-disabled', 'true')
  await expect(check).toHaveAttribute('aria-busy', 'true')
  expect(await page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => call.command === 'check_agent_profile').length ?? 0)).toBe(1)

  await page.evaluate(() => (
    window as Window & {
      __rejectProfileLifecycleInvocation(invocation: number, message: string): void
    }
  ).__rejectProfileLifecycleInvocation(1, 'exact Claude check failed'))

  await expect(check).toBeFocused()
  await expect(check).toHaveAttribute('aria-disabled', 'false')
  await expect(check).toHaveAttribute('aria-busy', 'false')
  await expect(row.getByRole('alert')).toHaveText('exact Claude check failed')
})

test('account settings reject an unconfirmed same-alias rename when snapshot refresh fails', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    additionalClaudeProfiles: [
      { accountId: 'claude-profile-1', alias: 'Same alias', status: 'connected' },
    ],
    profileSnapshotErrors: { 2: 'authoritative profile refresh unavailable' },
  })
  await page.goto('/')
  await page.locator('.titlebar .pill.icon-only').click()

  const row = page.locator(
    '.settings-account-row[data-provider-id="claude"][data-account-id="claude-profile-1"]',
  )
  await row.getByRole('button', {
    name: 'Rename Claude account Same alias (claude-profile-1)',
    exact: true,
  }).click()
  const renameInput = row.getByRole('textbox', {
    name: 'New alias for Claude account Same alias (claude-profile-1)',
    exact: true,
  })
  await renameInput.fill('Same alias')
  await row.getByRole('button', {
    name: 'Save name for Claude account Same alias (claude-profile-1)',
    exact: true,
  }).click()

  await expect(row.locator('.settings-account-error')).toHaveText(
    'authoritative profile refresh unavailable',
  )
  await expect(renameInput).toBeVisible()
  await expect(page.locator('.settings-modal')).toBeVisible()
  const authCalls = await page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls ?? [])
  expect(authCalls.filter((call) => call.command === 'rename_agent_profile')).toHaveLength(1)
  expect(authCalls.filter((call) => call.command === 'read_agent_profile_snapshot')).toHaveLength(2)
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('account settings add refreshes then shows only transient backend setup guidance', async ({ page }) => {
  const renderedCommand = `CLAUDE_CONFIG_DIR='/Users/example/Claude Profile' claude auth login --profile "$USER"`
  const consoleMessages: string[] = []
  page.on('console', (message) => consoleMessages.push(message.text()))
  await page.addInitScript(() => {
    const copied: string[] = []
    ;(window as Window & { __copiedSetupCommands?: string[] }).__copiedSetupCommands = copied
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value: string) => { copied.push(value) } },
    })
  })
  await installClaudeWorkspaceHarness(page, {
    additionalClaudeProfiles: [],
    os: 'mac',
    profileSetupGuidance: {
      supported: true,
      program: 'env',
      environment: [{ name: 'CLAUDE_CONFIG_DIR', value: '/Users/example/Claude Profile' }],
      arguments: ['claude', 'auth', 'login', '--profile', '$USER'],
      renderedCommand,
      warning: 'Run this exact command in your own terminal.',
      unsupportedReason: null,
    },
  })
  await page.goto('/')
  await page.locator('.titlebar .pill.icon-only').click()

  await page.getByRole('textbox', { name: 'Claude account alias' }).fill('Heavy account')
  await page.getByRole('button', { name: 'Add Claude account', exact: true }).evaluate((button) => {
    button.click()
    button.click()
  })

  const createdRow = page.locator(
    '.settings-account-row[data-provider-id="claude"][data-account-id="claude-profile-1"]',
  )
  await expect(createdRow).toContainText('Heavy account')
  await expect(createdRow.locator('.settings-account-command')).toHaveText(renderedCommand)
  await expect(createdRow).toContainText('Run this exact command in your own terminal.')
  await expect(page.locator('.settings-modal')).toBeVisible()

  const lifecycleCalls = await page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => [
    'create_agent_profile',
    'read_agent_profile_snapshot',
    'read_agent_profile_setup_guidance',
  ].includes(call.command)) ?? [])
  const createIndex = lifecycleCalls.findIndex((call) => call.command === 'create_agent_profile')
  const refreshIndex = lifecycleCalls.findIndex((call, index) => (
    index > createIndex && call.command === 'read_agent_profile_snapshot'
  ))
  const guidanceIndex = lifecycleCalls.findIndex((call) => (
    call.command === 'read_agent_profile_setup_guidance'
  ))
  expect(createIndex).toBeGreaterThanOrEqual(0)
  expect(refreshIndex).toBeGreaterThan(createIndex)
  expect(guidanceIndex).toBeGreaterThan(refreshIndex)
  expect(lifecycleCalls[createIndex]?.args?.request).toEqual({
    provider: 'claude',
    alias: 'Heavy account',
  })
  expect(lifecycleCalls.filter((call) => call.command === 'create_agent_profile')).toHaveLength(1)
  expect(lifecycleCalls[guidanceIndex]?.args?.request).toEqual({
    provider: 'claude',
    accountId: 'claude-profile-1',
    shell: 'zsh',
  })

  await createdRow.getByRole('button', {
    name: 'Copy setup command for Claude account Heavy account (claude-profile-1)',
    exact: true,
  }).click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __copiedSetupCommands?: string[] }
  ).__copiedSetupCommands ?? [])).toEqual([renderedCommand])

  await page.locator('.settings-close').click()
  await expect(page.locator('body')).not.toContainText(renderedCommand)
  expect(await page.evaluate((command) => (
    Object.values(localStorage).every((value) => !String(value).includes(command))
  ), renderedCommand)).toBe(true)
  expect(consoleMessages.every((message) => !message.includes(renderedCommand))).toBe(true)
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])

  await page.locator('.titlebar .pill.icon-only').click()
  await expect(page.locator('.settings-modal')).toBeVisible()
  await expect(page.locator('.settings-modal')).not.toContainText(renderedCommand)
  const reopenedRow = page.locator(
    '.settings-account-row[data-provider-id="claude"][data-account-id="claude-profile-1"]',
  )
  await reopenedRow.getByRole('button', {
    name: 'Show setup command for Claude account Heavy account (claude-profile-1)',
    exact: true,
  }).click()
  await expect(reopenedRow.locator('.settings-account-command')).toHaveText(renderedCommand)
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => (
    call.command === 'read_agent_profile_setup_guidance'
  )).length ?? 0)).toBe(2)
})

test('account settings commits Add before a retryable setup guidance failure', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    additionalClaudeProfiles: [],
    profileLifecycleErrors: { 2: 'setup guidance temporarily unavailable' },
  })
  await page.goto('/')
  await page.locator('.titlebar .pill.icon-only').click()

  const aliasInput = page.getByRole('textbox', { name: 'Claude account alias' })
  await aliasInput.fill('Committed account')
  await page.getByRole('button', { name: 'Add Claude account', exact: true }).click()

  const createdRow = page.locator(
    '.settings-account-row[data-provider-id="claude"][data-account-id="claude-profile-1"]',
  )
  await expect(createdRow).toContainText('Committed account')
  await expect(aliasInput).toHaveValue('')
  await expect(createdRow.getByRole('alert')).toHaveText(
    'setup guidance temporarily unavailable',
  )
  await expect(page.locator(
    '.settings-provider[data-provider-id="claude"] > .settings-account-error',
  )).toHaveCount(0)

  await createdRow.getByRole('button', {
    name: 'Show setup command for Claude account Committed account (claude-profile-1)',
    exact: true,
  }).click()
  await expect(createdRow.locator('.settings-account-command')).toContainText(
    'claude auth login',
  )

  const authCalls = await page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls ?? [])
  expect(authCalls.filter((call) => call.command === 'create_agent_profile')).toHaveLength(1)
  expect(authCalls.filter((call) => (
    call.command === 'read_agent_profile_setup_guidance'
  ))).toHaveLength(2)
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('account settings keeps a committed Add when authoritative refresh fails', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    additionalClaudeProfiles: [],
    profileSnapshotErrors: { 2: 'authoritative created-profile refresh unavailable' },
  })
  await page.goto('/')
  await page.locator('.titlebar .pill.icon-only').click()

  const aliasInput = page.getByRole('textbox', { name: 'Claude account alias' })
  await aliasInput.fill('Refresh-safe account')
  await page.getByRole('button', { name: 'Add Claude account', exact: true }).click()

  const createdRow = page.locator(
    '.settings-account-row[data-provider-id="claude"][data-account-id="claude-profile-1"]',
  )
  await expect(createdRow).toContainText('Refresh-safe account')
  await expect(aliasInput).toHaveValue('')
  await expect(createdRow.getByRole('alert')).toContainText(
    'authoritative created-profile refresh unavailable',
  )
  await expect(page.locator(
    '.settings-provider[data-provider-id="claude"] > .settings-account-error',
  )).toHaveCount(0)

  await createdRow.getByRole('button', {
    name: 'Show setup command for Claude account Refresh-safe account (claude-profile-1)',
    exact: true,
  }).click()
  await expect(createdRow.locator('.settings-account-command')).toContainText(
    'claude auth login',
  )

  const authCalls = await page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls ?? [])
  expect(authCalls.filter((call) => call.command === 'create_agent_profile')).toHaveLength(1)
  expect(authCalls.filter((call) => call.command === 'read_agent_profile_snapshot')).toHaveLength(2)
  expect(authCalls.filter((call) => (
    call.command === 'read_agent_profile_setup_guidance'
  ))).toHaveLength(1)
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('account settings target exact owners and isolate pending lifecycle actions', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    additionalClaudeProfiles: [
      { accountId: 'claude-profile-1', alias: 'Alpha', status: 'connected' },
      { accountId: 'claude-profile-2', alias: 'Beta', status: 'connected' },
    ],
    deferredProfileLifecycleInvocations: [3, 4],
  })
  await page.goto('/')
  await page.locator('.titlebar .pill.icon-only').click()

  const alphaRow = page.locator('[data-provider-id="claude"][data-account-id="claude-profile-1"]')
  const betaRow = page.locator('[data-provider-id="claude"][data-account-id="claude-profile-2"]')
  await alphaRow.getByRole('button', {
    name: 'Rename Claude account Alpha (claude-profile-1)',
    exact: true,
  }).click()
  await alphaRow.getByRole('textbox', {
    name: 'New alias for Claude account Alpha (claude-profile-1)',
    exact: true,
  }).fill('Renamed Alpha')
  await alphaRow.getByRole('button', {
    name: 'Save name for Claude account Alpha (claude-profile-1)',
    exact: true,
  }).evaluate((button) => {
    button.click()
    button.click()
  })
  await expect(alphaRow).toContainText('Renamed Alpha')

  await betaRow.getByRole('button', {
    name: 'Set default Claude account Beta (claude-profile-2)',
    exact: true,
  }).evaluate((button) => {
    button.click()
    button.click()
  })
  await expect(betaRow).toContainText('Default')
  await expect(betaRow.getByRole('button', {
    name: 'Forget Claude account Beta (claude-profile-2)',
    exact: true,
  })).toBeDisabled()

  const alphaCheck = alphaRow.getByRole('button', {
    name: 'Check Claude account Renamed Alpha (claude-profile-1)',
    exact: true,
  })
  const betaCheck = betaRow.getByRole('button', {
    name: 'Check Claude account Beta (claude-profile-2)',
    exact: true,
  })
  await alphaCheck.focus()
  await alphaCheck.evaluate((button) => {
    button.click()
    button.click()
  })
  await expect(alphaCheck).toBeFocused()
  await expect(alphaCheck).not.toHaveAttribute('disabled')
  await expect(alphaCheck).toHaveAttribute('aria-disabled', 'true')
  await expect(alphaCheck).toHaveAttribute('aria-busy', 'true')
  await expect(betaCheck).toBeEnabled()
  await betaCheck.click()
  await expect(betaCheck).toBeFocused()
  await expect(betaCheck).not.toHaveAttribute('disabled')
  await expect(betaCheck).toHaveAttribute('aria-disabled', 'true')
  await expect(betaCheck).toHaveAttribute('aria-busy', 'true')
  await expect(page.locator('.settings-modal')).toBeVisible()

  const ownerCalls = await page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.filter((call) => [
    'rename_agent_profile',
    'set_default_agent_profile',
    'check_agent_profile',
  ].includes(call.command)) ?? [])
  expect(ownerCalls.map((call) => [call.command, call.args?.request])).toEqual([
    ['rename_agent_profile', {
      provider: 'claude', accountId: 'claude-profile-1', alias: 'Renamed Alpha',
    }],
    ['set_default_agent_profile', {
      provider: 'claude', accountId: 'claude-profile-2',
    }],
    ['check_agent_profile', {
      provider: 'claude', accountId: 'claude-profile-1',
    }],
    ['check_agent_profile', {
      provider: 'claude', accountId: 'claude-profile-2',
    }],
  ])

  await page.evaluate(() => (
    window as Window & { __resolveProfileLifecycleInvocation(invocation: number): void }
  ).__resolveProfileLifecycleInvocation(4))
  await expect(betaCheck).toBeEnabled()
  await expect(betaCheck).toHaveAttribute('aria-disabled', 'false')
  await expect(betaCheck).toHaveAttribute('aria-busy', 'false')
  await expect(alphaCheck).toHaveAttribute('aria-disabled', 'true')
  await page.evaluate(() => (
    window as Window & { __resolveProfileLifecycleInvocation(invocation: number): void }
  ).__resolveProfileLifecycleInvocation(3))
  await expect(alphaCheck).toBeEnabled()
  await expect(alphaCheck).toHaveAttribute('aria-disabled', 'false')
  await expect(alphaCheck).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByRole('status')).toHaveText(
    'Claude account Renamed Alpha check completed.',
  )

  await alphaRow.getByRole('button', {
    name: 'Disconnect Claude account Renamed Alpha (claude-profile-1)',
    exact: true,
  }).click()
  await expect(alphaRow).toContainText('Disconnected')
  await expect(betaRow).toContainText('Connected')
  const disconnectCall = await page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.findLast((call) => call.command === 'disconnect_agent_profile'))
  expect(disconnectCall?.args?.request).toEqual({
    provider: 'claude',
    accountId: 'claude-profile-1',
  })
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('account settings show authoritative macOS additional-Claude guidance failures', async ({ page }) => {
  const backendMessage =
    'Additional Claude profiles are unavailable on macOS because Claude credentials are stored in Keychain. Use the ambient Claude profile.'
  await installClaudeWorkspaceHarness(page, {
    additionalClaudeProfiles: [],
    os: 'mac',
    profileLifecycleErrors: { 1: backendMessage },
  })
  await page.goto('/')
  await page.locator('.titlebar .pill.icon-only').click()

  const claudeGroup = page.locator('.settings-account-group[data-provider-id="claude"]')
  await claudeGroup.getByRole('textbox', { name: 'Claude account alias' }).fill('Second Mac')
  await claudeGroup.getByRole('button', { name: 'Add Claude account', exact: true }).click()
  await expect(claudeGroup.locator('.settings-account-error')).toHaveText(backendMessage)
  await expect(claudeGroup).not.toContainText('CLAUDE_CONFIG_DIR')
  await expect(claudeGroup).not.toContainText('/tmp/')
  await expect(page.locator('.settings-modal')).toBeVisible()
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('account settings forget only after inline confirmation and keep selected sessions missing', async ({ page }) => {
  await installClaudeWorkspaceHarness(page, {
    sessionAProvider: 'claude',
    sessionASelectedAccountIds: { claude: 'claude-profile-1' },
    additionalClaudeProfiles: [
      { accountId: 'claude-profile-1', alias: 'Disposable', status: 'connected' },
    ],
    deferredProfileLifecycleInvocations: [1],
  })
  await page.goto('/')
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-account-id', 'claude-profile-1')
  await page.locator('.titlebar .pill.icon-only').click()

  const row = page.locator(
    '.settings-account-row[data-provider-id="claude"][data-account-id="claude-profile-1"]',
  )
  await row.getByRole('button', {
    name: 'Forget Claude account Disposable (claude-profile-1)',
    exact: true,
  }).click()
  await expect(row).toContainText('Forget does not log out or delete credentials.')
  await expect(row.getByRole('button', {
    name: 'Confirm forget Claude account Disposable (claude-profile-1)',
    exact: true,
  })).toBeVisible()
  await expect(row).toBeVisible()
  const confirm = row.getByRole('button', {
    name: 'Confirm forget Claude account Disposable (claude-profile-1)',
    exact: true,
  })
  await confirm.click()
  await expect(confirm).toBeFocused()
  await expect(confirm).not.toHaveAttribute('disabled')
  await expect(confirm).toHaveAttribute('aria-disabled', 'true')
  await expect(confirm).toHaveAttribute('aria-busy', 'true')

  await page.evaluate(() => (
    window as Window & { __resolveProfileLifecycleInvocation(invocation: number): void }
  ).__resolveProfileLifecycleInvocation(1))
  await expect(row).toHaveCount(0)
  await expect(settingsAccountRow(page, 'claude', claudeDefaultAccountId).getByRole('button', {
    name: `Rename Claude account Claude CLI Session (${claudeDefaultAccountId})`,
    exact: true,
  })).toBeFocused()
  await expect(page.getByRole('status')).toHaveText('Claude account Disposable was forgotten.')

  const forgetCall = await page.evaluate(() => (
    window as Window & { __authCalls?: RuntimeCall[] }
  ).__authCalls?.find((call) => call.command === 'forget_agent_profile'))
  expect(forgetCall?.args?.request).toEqual({
    provider: 'claude',
    accountId: 'claude-profile-1',
  })
  await page.locator('.settings-close').click()
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-provider-id', 'claude')
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-account-id', 'claude-profile-1')
  await expect(page.locator('.composer-provider-chip')).toHaveAttribute(
    'aria-label',
    'Agent account: Claude · Forgotten account (claude-profile-1) · Forgotten',
  )
  await page.locator('.composer-provider-chip').click()
  await expect(accountOption(page, 'claude-profile-1')).toHaveAttribute('aria-disabled', 'true')
  await expect(accountOption(page, 'claude-profile-1')).toHaveAttribute('data-profile-status', 'forgotten')
  await expect(page.locator('.composer-input .send')).toBeDisabled()
  await expect.poll(() => page.evaluate(({ projectA }) => {
    const directory = JSON.parse(localStorage.getItem('gtum.agent-session-directory.v2') || '{}')
    return directory[projectA]?.sessions?.[0]?.selectedAccountIds?.claude
  }, { projectA })).toBe('claude-profile-1')
  expect(await page.evaluate(() => (
    window as Window & { __providerCalls?: RuntimeCall[] }
  ).__providerCalls?.filter((call) => call.command === 'request_agent_account_suggestions') ?? [])).toEqual([])
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('account settings stay contained and wrap setup commands at narrow desktop sizes', async ({ page }) => {
  const renderedCommand = `CLAUDE_CONFIG_DIR=/Users/heavy/${'account-segment-'.repeat(18)} claude auth login`
  await page.setViewportSize({ width: 720, height: 640 })
  await installClaudeWorkspaceHarness(page, {
    additionalClaudeProfiles: accountPickerClaudeProfiles,
    profileSetupGuidance: {
      supported: true,
      program: 'env',
      environment: [],
      arguments: [],
      renderedCommand,
      warning: 'Run this command in your own terminal.',
      unsupportedReason: null,
    },
  })
  await page.goto('/')
  await page.locator('.titlebar .pill.icon-only').click()
  await page.getByRole('textbox', { name: 'Claude account alias' }).fill(maximumAccountAlias)
  await page.getByRole('button', { name: 'Add Claude account', exact: true }).click()
  await expect(page.locator('.settings-account-command')).toHaveText(renderedCommand)

  const assertContained = async () => {
    const geometry = await page.evaluate(() => {
      const modal = document.querySelector<HTMLElement>('.settings-modal')!
      const body = document.querySelector<HTMLElement>('.settings-body')!
      const command = document.querySelector<HTMLElement>('.settings-account-command')!
      const modalRect = modal.getBoundingClientRect()
      const bodyRect = body.getBoundingClientRect()
      const actionRects = [...document.querySelectorAll<HTMLElement>('.settings-account-actions button')]
        .map((button) => button.getBoundingClientRect())
      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        modal: {
          left: modalRect.left,
          top: modalRect.top,
          right: modalRect.right,
          bottom: modalRect.bottom,
        },
        body: {
          left: bodyRect.left,
          right: bodyRect.right,
          scrollWidth: body.scrollWidth,
          clientWidth: body.clientWidth,
        },
        commandScrollWidth: command.scrollWidth,
        commandClientWidth: command.clientWidth,
        actionRects: actionRects.map((rect) => ({
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        })),
        documentScrollWidth: document.documentElement.scrollWidth,
      }
    })
    expect(geometry.modal.left).toBeGreaterThanOrEqual(0)
    expect(geometry.modal.top).toBeGreaterThanOrEqual(0)
    expect(geometry.modal.right).toBeLessThanOrEqual(geometry.viewportWidth + 1)
    expect(geometry.modal.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1)
    expect(geometry.body.scrollWidth).toBeLessThanOrEqual(geometry.body.clientWidth + 1)
    expect(geometry.commandScrollWidth).toBeLessThanOrEqual(geometry.commandClientWidth + 1)
    expect(geometry.documentScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1)
    for (const rect of geometry.actionRects) {
      expect(rect.left).toBeGreaterThanOrEqual(geometry.body.left - 1)
      expect(rect.right).toBeLessThanOrEqual(geometry.body.right + 1)
    }
    for (let index = 0; index < geometry.actionRects.length; index += 1) {
      for (let candidateIndex = index + 1;
        candidateIndex < geometry.actionRects.length;
        candidateIndex += 1) {
        const first = geometry.actionRects[index]
        const second = geometry.actionRects[candidateIndex]
        const overlaps = first.left < second.right
          && first.right > second.left
          && first.top < second.bottom
          && first.bottom > second.top
        expect(overlaps).toBe(false)
      }
    }
  }

  await assertContained()
  await page.setViewportSize({ width: 640, height: 600 })
  await flushBrowserLayout(page)
  await assertContained()
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: RuntimeCall[] }
  ).__terminalCalls ?? [])).toEqual([])
})

type RuntimeCall = { command: string; args?: Record<string, unknown> }
