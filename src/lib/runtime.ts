import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'

export type RuntimeInfo = {
  app_name: string
  platform: string
  mode: string
}

export type ProjectMetadata = {
  name: string
  path: string
  exists: boolean
  isDirectory: boolean
}

export type FileTreeNode = {
  name: string
  path: string
  kind: 'file' | 'directory'
  children: FileTreeNode[]
  truncated: boolean
}

export type GitOverview = {
  isRepository: boolean
  branch: string | null
  branchType: string | null
  isDirty: boolean
  changedFilesCount: number
}

export type ProjectOverview = {
  metadata: ProjectMetadata
  tree: FileTreeNode
  git: GitOverview
}

export type TerminalSessionStatus = 'running' | 'exited' | 'terminated' | 'failed'

export type CreateTerminalSessionRequest = {
  name?: string
  cwd?: string
  shell?: string
  rows?: number
  cols?: number
  maxLogEntries?: number
}

export type CreateTerminalSessionWithCommandRequest = {
  session: CreateTerminalSessionRequest
  command: string
}

export type TerminalSessionSnapshot = {
  sessionId: number
  name: string
  cwd: string | null
  shell: string
  shellArgs: string[]
  processId: number | null
  status: TerminalSessionStatus
  createdAt: number
  updatedAt: number
  exitCode: number | null
  logLineCount: number
  maxLogEntries: number
  lastEvent: string | null
}

export type TerminalSessionLogs = {
  sessionId: number
  status: TerminalSessionStatus
  limit: number
  logLineCount: number
  truncated: boolean
  entries: string[]
  updatedAt: number
}

export type AgentProviderId = 'codex' | 'claude'
export type AgentConnectionStatus = 'disconnected' | 'pending' | 'connected' | 'error'
export type AgentConnectionKind = 'mock' | 'prototype' | 'real'
export type ExecutionMode = 'fast' | 'balanced' | 'deep'
export type AgentExecutionTarget = 'current_tab' | 'new_tab'
export type AgentSuggestionConfidence = 'low' | 'medium' | 'high'
export type AgentProviderSetupState = 'ready' | 'needs_setup' | 'deferred'

export type AgentConnectionSnapshot = {
  provider: AgentProviderId
  displayName: string
  status: AgentConnectionStatus
  connectionKind: AgentConnectionKind
  accountLabel: string | null
  requiredScopes: string[]
  expiresAt: number | null
  callbackUrl: string | null
  authUrl: string | null
  connectedAt: number | null
  updatedAt: number
  lastError: string | null
}

export type AgentProviderRequirementStatus = {
  name: string
  required: boolean
  present: boolean
}

export type AgentProviderDiagnostics = {
  provider: AgentProviderId
  setupState: AgentProviderSetupState
  connectionPath: string
  summary: string
  guidance: string
  baseUrl: string | null
  model: string | null
  requirements: AgentProviderRequirementStatus[]
}

export type CompleteAgentLoginRequest = {
  provider: AgentProviderId
  authorizationCode?: string
  accountLabel?: string
  failReason?: string
}

export type AgentTaskRequest = {
  provider: AgentProviderId
  projectName: string
  projectPath: string
  activeTabId: string | null
  activeTabTitle: string | null
  lastNLogLines: string[]
  userTask: string
  executionMode: ExecutionMode
}

export type AgentSuggestion = {
  id: string
  provider: AgentProviderId
  summary: string
  command: string
  preferredTarget: AgentExecutionTarget
  confidence: AgentSuggestionConfidence
  error: string | null
}

export type TelegramLinkStatus = 'disconnected' | 'pending' | 'connected' | 'error'
export type TelegramReportStatus = 'queued' | 'sent' | 'failed'
export type TelegramRemoteCommandStatus = 'pending' | 'approved' | 'rejected' | 'executed'
export type TelegramRemoteCommandTarget = 'current_tab' | 'new_tab'

export type TelegramBridgeSnapshot = {
  status: TelegramLinkStatus
  chatLabel: string | null
  callbackUrl: string | null
  authUrl: string | null
  allowedCommands: string[]
  connectedAt: number | null
  updatedAt: number
  lastError: string | null
}

export type TelegramReportSnapshot = {
  reportId: string
  title: string
  body: string
  status: TelegramReportStatus
  createdAt: number
  deliveredAt: number | null
}

export type TelegramRemoteCommandSnapshot = {
  commandId: string
  sourceLabel: string
  summary: string
  command: string
  suggestedTarget: TelegramRemoteCommandTarget
  status: TelegramRemoteCommandStatus
  createdAt: number
  resolvedAt: number | null
  resolutionNote: string | null
}

export type TelegramRuntimeSnapshot = {
  storagePath: string | null
  bridge: TelegramBridgeSnapshot
  reports: TelegramReportSnapshot[]
  remoteCommands: TelegramRemoteCommandSnapshot[]
}

export type CompleteTelegramLinkRequest = {
  authorizationCode?: string
  chatLabel?: string
  failReason?: string
}

export type CreateTelegramReportRequest = {
  title: string
  body: string
}

export type QueueTelegramRemoteCommandRequest = {
  sourceLabel?: string
  summary: string
  command: string
  suggestedTarget?: TelegramRemoteCommandTarget
}

export type ResolveTelegramRemoteCommandRequest = {
  commandId: string
  status: Exclude<TelegramRemoteCommandStatus, 'pending'>
  resolutionNote?: string
}

const MOCK_AGENT_CONNECTIONS_KEY = 'gtum.mock-agent-connections'
const PREVIEW_AGENT_CONNECTIONS_KEY = 'gtum.preview-agent-connections'
const BROWSER_TELEGRAM_STATE_KEY = 'gtum.browser-telegram-state'
const mockProviderLabels: Record<AgentProviderId, string> = {
  codex: 'Codex',
  claude: 'Claude',
}

const defaultMockProjectPath = '/mock/demo-project'
const defaultPreviewProjectPath = 'C:/Users/demo/demo-project'

const hasTauriRuntime = () =>
  typeof window !== 'undefined' &&
  typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined'

const isMockRuntime = () => {
  if (typeof window === 'undefined') {
    return false
  }

  return new URLSearchParams(window.location.search).get('e2eMock') === '1'
}

const isPreviewContractRuntime = () => typeof window !== 'undefined' && !hasTauriRuntime() && !isMockRuntime()

const usesBrowserRuntime = () => isMockRuntime() || isPreviewContractRuntime()

const currentBrowserProjectPath = () => (isPreviewContractRuntime() ? defaultPreviewProjectPath : defaultMockProjectPath)

const currentBrowserBranch = () =>
  isPreviewContractRuntime() ? 'feature/windows-real-use' : 'feature/mock-project-open'

const buildBrowserTree = (rootPath: string): FileTreeNode => ({
  name: rootPath.split(/[\\/]/).filter(Boolean).at(-1) || 'demo-project',
  path: rootPath,
  kind: 'directory',
  truncated: false,
  children: [
    {
      name: 'src',
      path: `${rootPath}/src`,
      kind: 'directory',
      truncated: false,
      children: [
        {
          name: 'App.tsx',
          path: `${rootPath}/src/App.tsx`,
          kind: 'file',
          truncated: false,
          children: [],
        },
      ],
    },
    {
      name: 'package.json',
      path: `${rootPath}/package.json`,
      kind: 'file',
      truncated: false,
      children: [],
    },
  ],
})

const createDefaultBrowserTelegramState = (): TelegramRuntimeSnapshot => ({
  storagePath: null,
  bridge: {
    status: 'disconnected',
    chatLabel: null,
    callbackUrl: null,
    authUrl: null,
    allowedCommands: ['/status', '/rerun-tests', '/git-diff'],
    connectedAt: null,
    updatedAt: Date.now(),
    lastError: null,
  },
  reports: [],
  remoteCommands: [],
})

const requiredScopesForProvider = (provider: AgentProviderId) =>
  provider === 'codex'
    ? ['project:read', 'terminal:read']
    : ['provider:deferred']

const createDefaultBrowserConnections = (): AgentConnectionSnapshot[] =>
  (['codex', 'claude'] as AgentProviderId[]).map((provider) => ({
    provider,
    displayName: mockProviderLabels[provider],
    status: 'disconnected',
    connectionKind: isMockRuntime() ? 'mock' : provider === 'codex' ? 'real' : 'prototype',
    accountLabel: null,
    requiredScopes: requiredScopesForProvider(provider),
    expiresAt: null,
    callbackUrl: isMockRuntime() ? `gtum://auth/callback?provider=${provider}` : null,
    authUrl: isMockRuntime() ? `https://mock.gtum.local/auth/${provider}` : null,
    connectedAt: null,
    updatedAt: Date.now(),
    lastError: null,
  }))

const browserConnectionStorageKey = () =>
  isMockRuntime() ? MOCK_AGENT_CONNECTIONS_KEY : PREVIEW_AGENT_CONNECTIONS_KEY

const loadBrowserConnections = () => {
  if (typeof window === 'undefined') {
    return createDefaultBrowserConnections()
  }

  try {
    const saved = window.localStorage.getItem(browserConnectionStorageKey())
    if (!saved) {
      return createDefaultBrowserConnections()
    }

    const parsed = JSON.parse(saved) as AgentConnectionSnapshot[]
    return createDefaultBrowserConnections().map(
      (defaultEntry) =>
        parsed.find((entry) => entry.provider === defaultEntry.provider)
        ? {
            ...defaultEntry,
            ...parsed.find((entry) => entry.provider === defaultEntry.provider),
            requiredScopes:
              parsed.find((entry) => entry.provider === defaultEntry.provider)?.requiredScopes ??
              defaultEntry.requiredScopes,
          }
        : defaultEntry,
    )
  } catch {
    return createDefaultBrowserConnections()
  }
}

const persistBrowserConnections = (connections: AgentConnectionSnapshot[]) => {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(browserConnectionStorageKey(), JSON.stringify(connections))
}

const loadBrowserTelegramState = () => {
  if (typeof window === 'undefined') {
    return createDefaultBrowserTelegramState()
  }

  try {
    const saved = window.localStorage.getItem(BROWSER_TELEGRAM_STATE_KEY)
    if (!saved) {
      return createDefaultBrowserTelegramState()
    }

    const parsed = JSON.parse(saved) as TelegramRuntimeSnapshot
    return {
      ...createDefaultBrowserTelegramState(),
      ...parsed,
      bridge: {
        ...createDefaultBrowserTelegramState().bridge,
        ...parsed.bridge,
      },
      reports: parsed.reports ?? [],
      remoteCommands: parsed.remoteCommands ?? [],
    }
  } catch {
    return createDefaultBrowserTelegramState()
  }
}

const persistBrowserTelegramState = (snapshot: TelegramRuntimeSnapshot) => {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(BROWSER_TELEGRAM_STATE_KEY, JSON.stringify(snapshot))
}

const createInitialBrowserTerminalSessions = (): TerminalSessionSnapshot[] => {
  const cwd = currentBrowserProjectPath()
  return [
    {
      sessionId: 1,
      name: 'workspace',
      cwd,
      shell: isPreviewContractRuntime() ? 'pwsh' : 'bash',
      shellArgs: isPreviewContractRuntime() ? ['-NoLogo'] : ['-i'],
      processId: 1001,
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      exitCode: null,
      logLineCount: 4,
      maxLogEntries: 400,
      lastEvent: 'session created',
    },
  ]
}

const createInitialBrowserTerminalLogs = (): Record<number, string[]> => ({
  1: isPreviewContractRuntime()
    ? [
        'PS> pnpm test -- --watch=false',
        'FAIL src/app-shell.spec.ts',
        'The process exited with code 1.',
        'Open the active logs and ask Codex for the next command.',
      ]
    : [
        '$ sprint-2:start',
        '[gtum] terminal ready',
        '$ npm run test:watch',
        'PASS src/app-shell.spec.ts',
      ],
})

let nextBrowserTerminalId = 2
let browserTerminalSessions = createInitialBrowserTerminalSessions()
let browserTerminalLogs = createInitialBrowserTerminalLogs()
let browserAgentConnections = createDefaultBrowserConnections()
let browserTelegramState = createDefaultBrowserTelegramState()

if (typeof window !== 'undefined' && usesBrowserRuntime()) {
  browserAgentConnections = loadBrowserConnections()
  browserTelegramState = loadBrowserTelegramState()
}

const refreshBrowserSession = (sessionId: number) => {
  const lines = browserTerminalLogs[sessionId] || []
  browserTerminalSessions = browserTerminalSessions.map((session) =>
    session.sessionId === sessionId
      ? {
          ...session,
          logLineCount: lines.length,
          updatedAt: Date.now(),
        }
      : session,
  )
}

export const usesMockRuntime = isMockRuntime
export const usesPreviewContractRuntime = isPreviewContractRuntime

export const getRuntimeInfo = async () => {
  if (isMockRuntime()) {
    return {
      app_name: 'gtum',
      platform: 'mock-web',
      mode: 'e2e-mock',
    } satisfies RuntimeInfo
  }

  if (isPreviewContractRuntime()) {
    return {
      app_name: 'gtum',
      platform: 'windows-preview',
      mode: 'preview-contract',
    } satisfies RuntimeInfo
  }

  return invoke<RuntimeInfo>('get_runtime_info')
}

export const readProjectOverview = async (path: string) => {
  if (usesBrowserRuntime()) {
    const resolvedPath = path || currentBrowserProjectPath()
    return {
      metadata: {
        name: resolvedPath.split(/[\\/]/).filter(Boolean).at(-1) || 'demo-project',
        path: resolvedPath,
        exists: true,
        isDirectory: true,
      },
      tree: buildBrowserTree(resolvedPath),
      git: {
        isRepository: true,
        branch: currentBrowserBranch(),
        branchType: 'feature',
        isDirty: true,
        changedFilesCount: isPreviewContractRuntime() ? 2 : 3,
      },
    } satisfies ProjectOverview
  }

  return invoke<ProjectOverview>('read_project_overview', { path })
}

export const selectProjectFolder = async (defaultPath?: string) => {
  if (usesBrowserRuntime()) {
    return defaultPath?.trim() || currentBrowserProjectPath()
  }

  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Choose a project folder',
      defaultPath: defaultPath?.trim() || undefined,
    })

    return typeof selected === 'string' ? selected : null
  } catch {
    return null
  }
}

export const createTerminalSession = async (request: CreateTerminalSessionRequest) => {
  if (usesBrowserRuntime()) {
    const now = Date.now()
    const sessionId = nextBrowserTerminalId++
    const cwd = request.cwd || currentBrowserProjectPath()
    const session: TerminalSessionSnapshot = {
      sessionId,
      name: request.name || `tab-${sessionId}`,
      cwd,
      shell: isPreviewContractRuntime() ? 'pwsh' : 'bash',
      shellArgs: isPreviewContractRuntime() ? ['-NoLogo'] : ['-i'],
      processId: 1000 + sessionId,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      exitCode: null,
      logLineCount: 2,
      maxLogEntries: request.maxLogEntries || 400,
      lastEvent: 'session created',
    }

    browserTerminalSessions = [...browserTerminalSessions, session]
    browserTerminalLogs[sessionId] = [
      isPreviewContractRuntime() ? `PS> Set-Location "${cwd}"` : `$ cd ${cwd}`,
      '[gtum] terminal ready',
    ]
    return session
  }

  return invoke<TerminalSessionSnapshot>('create_terminal_session', { request })
}

export const createTerminalSessionWithCommand = async (request: CreateTerminalSessionWithCommandRequest) => {
  if (usesBrowserRuntime()) {
    const session = await createTerminalSession(request.session)
    const prompt = isPreviewContractRuntime() ? 'PS>' : '$'
    const extraLines = isPreviewContractRuntime()
      ? [
          `${prompt} ${request.command}`,
          '[preview] open the ChatGPT device login flow in your browser',
          '[preview] finish login, then return to gtum and connect Codex',
        ]
      : [`${prompt} ${request.command}`, '[mock] Codex login command queued']

    browserTerminalLogs[session.sessionId] = [...(browserTerminalLogs[session.sessionId] || []), ...extraLines]
    refreshBrowserSession(session.sessionId)
    return browserTerminalSessions.find((entry) => entry.sessionId === session.sessionId) ?? session
  }

  return invoke<TerminalSessionSnapshot>('create_terminal_session_with_command', { request })
}

export const listTerminalSessions = async () => {
  if (usesBrowserRuntime()) {
    return browserTerminalSessions
  }

  return invoke<TerminalSessionSnapshot[]>('list_terminal_sessions')
}

export const renameTerminalSession = async (sessionId: number, name: string) => {
  if (usesBrowserRuntime()) {
    browserTerminalSessions = browserTerminalSessions.map((session) =>
      session.sessionId === sessionId
        ? {
            ...session,
            name,
            updatedAt: Date.now(),
            lastEvent: 'session renamed',
          }
        : session,
    )

    return browserTerminalSessions.find((session) => session.sessionId === sessionId)!
  }

  return invoke<TerminalSessionSnapshot>('rename_terminal_session', { sessionId, name })
}

export const closeTerminalSession = async (sessionId: number) => {
  if (usesBrowserRuntime()) {
    const session = browserTerminalSessions.find((entry) => entry.sessionId === sessionId) ?? null
    browserTerminalSessions = browserTerminalSessions.filter((entry) => entry.sessionId !== sessionId)
    delete browserTerminalLogs[sessionId]
    return session
  }

  return invoke<TerminalSessionSnapshot>('close_terminal_session', { sessionId })
}

export const readTerminalSessionLogs = async (sessionId: number, limit = 120) => {
  if (usesBrowserRuntime()) {
    const entries = (browserTerminalLogs[sessionId] || []).slice(-limit)
    return {
      sessionId,
      status:
        browserTerminalSessions.find((entry) => entry.sessionId === sessionId)?.status || 'terminated',
      limit,
      logLineCount: entries.length,
      truncated: false,
      entries,
      updatedAt: Date.now(),
    } satisfies TerminalSessionLogs
  }

  return invoke<TerminalSessionLogs>('read_terminal_session_logs', { sessionId, limit })
}

export const executeTerminalSessionCommand = async (sessionId: number, command: string) => {
  if (usesBrowserRuntime()) {
    const prompt = isPreviewContractRuntime() ? 'PS>' : '$'
    const completionLine = isPreviewContractRuntime() ? '[preview] command executed' : '[mock] command executed'
    browserTerminalLogs[sessionId] = [
      ...(browserTerminalLogs[sessionId] || []),
      `${prompt} ${command}`,
      completionLine,
    ]
    refreshBrowserSession(sessionId)
    return browserTerminalSessions.find((entry) => entry.sessionId === sessionId) ?? null
  }

  return invoke<TerminalSessionSnapshot>('execute_terminal_session_command', { sessionId, command })
}

export const appendMockTerminalLine = async (sessionId: number, input: string) => {
  if (!isMockRuntime()) {
    return
  }

  browserTerminalLogs[sessionId] = [...(browserTerminalLogs[sessionId] || []), input, '[mock] output received']
  refreshBrowserSession(sessionId)
}

export const listAgentConnections = async () => {
  if (usesBrowserRuntime()) {
    browserAgentConnections = loadBrowserConnections()
    return browserAgentConnections
  }

  return invoke<AgentConnectionSnapshot[]>('list_agent_connections')
}

export const readAgentProviderDiagnostics = async (provider: AgentProviderId) => {
  if (isMockRuntime()) {
    return {
      provider,
      setupState: provider === 'codex' ? 'ready' : 'deferred',
      connectionPath: provider === 'codex' ? 'Mock Codex CLI session flow' : 'Deferred real-provider path',
      summary:
        provider === 'codex'
          ? 'Mock runtime simulates a Codex CLI session for provider UI testing.'
          : 'Claude remains deferred in the first daily-use release.',
      guidance:
        provider === 'codex'
          ? 'Use the mock session to exercise the provider UI without a live desktop Codex login.'
          : 'Keep Claude on the prototype path while Codex is the first real provider route.',
      baseUrl: null,
      model: provider === 'codex' ? 'Codex CLI default' : null,
      requirements:
        provider === 'codex'
          ? [
              { name: 'codex CLI', required: true, present: true },
              { name: '~/.codex/auth.json', required: true, present: true },
              { name: 'ChatGPT session', required: true, present: true },
            ]
          : [{ name: 'provider:deferred', required: false, present: false }],
    } satisfies AgentProviderDiagnostics
  }

  if (isPreviewContractRuntime()) {
    return {
      provider,
      setupState: provider === 'codex' ? 'ready' : 'deferred',
      connectionPath:
        provider === 'codex' ? 'Previewed Codex CLI ChatGPT session' : 'Deferred real-provider path',
      summary:
        provider === 'codex'
          ? 'Preview mode simulates a validated desktop Codex CLI session before the first request.'
          : 'Claude remains deferred in the first daily-use release.',
      guidance:
        provider === 'codex'
          ? 'Desktop mode expects Codex CLI to be logged in with ChatGPT before you connect.'
          : 'Keep Claude on the prototype path while Codex is the first real provider route.',
      baseUrl: null,
      model: provider === 'codex' ? 'Codex CLI default' : null,
      requirements:
        provider === 'codex'
          ? [
              { name: 'codex CLI', required: true, present: true },
              { name: '~/.codex/auth.json', required: true, present: true },
              { name: 'ChatGPT session', required: true, present: true },
            ]
          : [{ name: 'provider:deferred', required: false, present: false }],
    } satisfies AgentProviderDiagnostics
  }

  return invoke<AgentProviderDiagnostics>('read_agent_provider_diagnostics', { provider })
}

export const beginAgentLogin = async (provider: AgentProviderId, requestedScopes: string[] = []) => {
  if (isMockRuntime()) {
    const now = Date.now()
    browserAgentConnections = loadBrowserConnections().map((entry) =>
      entry.provider === provider
        ? {
            ...entry,
            status: 'pending',
            connectionKind: 'mock',
            requiredScopes: requestedScopes.length > 0 ? requestedScopes : entry.requiredScopes,
            callbackUrl: `gtum://auth/callback?provider=${provider}`,
            authUrl: `https://mock.gtum.local/auth/${provider}`,
            updatedAt: now,
            lastError: null,
          }
        : entry,
    )
    persistBrowserConnections(browserAgentConnections)
    return browserAgentConnections.find((entry) => entry.provider === provider)!
  }

  if (isPreviewContractRuntime()) {
    const now = Date.now()
    browserAgentConnections = loadBrowserConnections().map((entry) => {
      if (entry.provider !== provider) {
        return entry
      }

      if (provider === 'codex') {
        return {
          ...entry,
          status: 'connected',
          connectionKind: 'real',
          accountLabel: 'Codex ChatGPT Session',
          requiredScopes: requestedScopes.length > 0 ? requestedScopes : entry.requiredScopes,
          expiresAt: null,
          callbackUrl: null,
          authUrl: null,
          connectedAt: now,
          updatedAt: now,
          lastError: null,
        }
      }

      return {
        ...entry,
        status: 'error',
        connectionKind: 'prototype',
        accountLabel: null,
        callbackUrl: null,
        authUrl: null,
        updatedAt: now,
        lastError: 'Claude real-provider support is deferred for the first daily-use release.',
      }
    })
    persistBrowserConnections(browserAgentConnections)
    return browserAgentConnections.find((entry) => entry.provider === provider)!
  }

  return invoke<AgentConnectionSnapshot>('begin_agent_login', { provider, requestedScopes })
}

export const completeAgentLogin = async (request: CompleteAgentLoginRequest) => {
  if (isMockRuntime()) {
    const now = Date.now()
    browserAgentConnections = loadBrowserConnections().map((entry) =>
      entry.provider === request.provider
        ? {
            ...entry,
            status: request.failReason ? 'error' : 'connected',
            connectionKind: 'mock',
            accountLabel:
              request.failReason ? null : request.accountLabel || `${mockProviderLabels[request.provider]} User`,
            connectedAt: request.failReason ? null : now,
            updatedAt: now,
            lastError: request.failReason || null,
          }
        : entry,
    )
    persistBrowserConnections(browserAgentConnections)
    return browserAgentConnections.find((entry) => entry.provider === request.provider)!
  }

  return invoke<AgentConnectionSnapshot>('complete_agent_login', { request })
}

export const disconnectAgentProvider = async (provider: AgentProviderId) => {
  if (usesBrowserRuntime()) {
    const nextConnection = {
      provider,
      displayName: mockProviderLabels[provider],
      status: 'disconnected',
      connectionKind: isMockRuntime() ? 'mock' : provider === 'codex' ? 'real' : 'prototype',
      accountLabel: null,
      requiredScopes: requiredScopesForProvider(provider),
      expiresAt: null,
      callbackUrl: isMockRuntime() ? `gtum://auth/callback?provider=${provider}` : null,
      authUrl: isMockRuntime() ? `https://mock.gtum.local/auth/${provider}` : null,
      connectedAt: null,
      updatedAt: Date.now(),
      lastError: null,
    } satisfies AgentConnectionSnapshot

    browserAgentConnections = loadBrowserConnections().map((entry) =>
      entry.provider === provider ? nextConnection : entry,
    )
    persistBrowserConnections(browserAgentConnections)
    return nextConnection
  }

  return invoke<AgentConnectionSnapshot>('disconnect_agent_provider', { provider })
}

const buildBrowserSuggestion = (request: AgentTaskRequest): AgentSuggestion => {
  const task = request.userTask.trim() || 'Investigate the current workspace state'
  const joinedLogs = request.lastNLogLines.join('\n').toLowerCase()
  const lowerTask = task.toLowerCase()

  if (request.provider !== 'codex') {
    return {
      id: `suggestion-${Date.now()}`,
      provider: request.provider,
      summary: 'This provider is not enabled in the first daily-use release.',
      command: '',
      preferredTarget: 'current_tab',
      confidence: 'low',
      error: 'Claude remains a prototype while Codex is the first real provider path.',
    }
  }

  if (lowerTask.includes('force error') || lowerTask.includes('permission')) {
    return {
      id: `suggestion-${Date.now()}`,
      provider: request.provider,
      summary: 'Codex could not produce a safe command from the current request.',
      command: '',
      preferredTarget: 'current_tab',
      confidence: 'low',
      error: 'Refine the task or attach a clearer failing log segment before asking again.',
    }
  }

  const command =
    lowerTask.includes('lint')
      ? 'npm run lint'
      : lowerTask.includes('build')
        ? 'npm run build'
        : lowerTask.includes('test') || joinedLogs.includes('fail')
          ? 'npm run test -- --runInBand'
          : 'git status --short'

  return {
    id: `suggestion-${Date.now()}`,
    provider: request.provider,
    summary: `Codex suggests running "${command}" next for "${task}".`,
    command,
    preferredTarget: command.includes('git status') || request.executionMode === 'deep' ? 'new_tab' : 'current_tab',
    confidence: request.executionMode === 'deep' ? 'high' : request.executionMode === 'fast' ? 'medium' : 'high',
    error: null,
  }
}

export const requestAgentSuggestions = async (
  request: AgentTaskRequest,
): Promise<AgentSuggestion[]> => {
  if (usesBrowserRuntime()) {
    return [buildBrowserSuggestion(request)]
  }

  return invoke<AgentSuggestion[]>('request_agent_suggestions', { request })
}

export const readTelegramRuntimeSnapshot = async () => {
  if (usesBrowserRuntime()) {
    browserTelegramState = loadBrowserTelegramState()
    return browserTelegramState
  }

  return invoke<TelegramRuntimeSnapshot>('read_telegram_runtime_snapshot')
}

export const beginTelegramLink = async () => {
  if (usesBrowserRuntime()) {
    if (isPreviewContractRuntime()) {
      const nextSnapshot: TelegramRuntimeSnapshot = {
        ...loadBrowserTelegramState(),
        bridge: {
          ...loadBrowserTelegramState().bridge,
          status: 'connected',
          chatLabel: '@gtum_preview',
          callbackUrl: null,
          authUrl: null,
          connectedAt: Date.now(),
          updatedAt: Date.now(),
          lastError: null,
        },
      }

      browserTelegramState = nextSnapshot
      persistBrowserTelegramState(nextSnapshot)
      return nextSnapshot.bridge
    }

    const nextSnapshot: TelegramRuntimeSnapshot = {
      ...loadBrowserTelegramState(),
      bridge: {
        ...loadBrowserTelegramState().bridge,
        status: 'pending',
        callbackUrl: 'gtum://telegram/callback',
        authUrl: 'https://mock.telegram.local/gtum/connect',
        updatedAt: Date.now(),
        lastError: null,
      },
    }

    browserTelegramState = nextSnapshot
    persistBrowserTelegramState(nextSnapshot)
    return nextSnapshot.bridge
  }

  return invoke<TelegramBridgeSnapshot>('begin_telegram_link')
}

export const completeTelegramLink = async (request: CompleteTelegramLinkRequest) => {
  if (usesBrowserRuntime()) {
    const now = Date.now()
    const state = loadBrowserTelegramState()
    const nextBridge: TelegramBridgeSnapshot = {
      ...state.bridge,
      status: request.failReason ? 'error' : 'connected',
      chatLabel: request.failReason ? null : request.chatLabel || '@gtum_ops',
      connectedAt: request.failReason ? null : now,
      updatedAt: now,
      lastError: request.failReason || null,
    }

    browserTelegramState = {
      ...state,
      bridge: nextBridge,
    }
    persistBrowserTelegramState(browserTelegramState)
    return nextBridge
  }

  return invoke<TelegramBridgeSnapshot>('complete_telegram_link', { request })
}

export const disconnectTelegramBridge = async () => {
  if (usesBrowserRuntime()) {
    const nextSnapshot = {
      ...loadBrowserTelegramState(),
      bridge: {
        ...createDefaultBrowserTelegramState().bridge,
        updatedAt: Date.now(),
      },
    }

    browserTelegramState = nextSnapshot
    persistBrowserTelegramState(nextSnapshot)
    return nextSnapshot.bridge
  }

  return invoke<TelegramBridgeSnapshot>('disconnect_telegram_bridge')
}

export const createTelegramReport = async (request: CreateTelegramReportRequest) => {
  if (usesBrowserRuntime()) {
    const now = Date.now()
    const report: TelegramReportSnapshot = {
      reportId: `telegram-report-${now}`,
      title: request.title.trim(),
      body: request.body.trim(),
      status: 'sent',
      createdAt: now,
      deliveredAt: now,
    }
    const state = loadBrowserTelegramState()
    browserTelegramState = {
      ...state,
      reports: [report, ...state.reports].slice(0, 8),
    }
    persistBrowserTelegramState(browserTelegramState)
    return report
  }

  return invoke<TelegramReportSnapshot>('create_telegram_report', { request })
}

export const queueTelegramRemoteCommand = async (request: QueueTelegramRemoteCommandRequest) => {
  if (usesBrowserRuntime()) {
    const now = Date.now()
    const remoteCommand: TelegramRemoteCommandSnapshot = {
      commandId: `telegram-command-${now}`,
      sourceLabel: request.sourceLabel?.trim() || '@gtum_ops',
      summary: request.summary.trim(),
      command: request.command.trim(),
      suggestedTarget: request.suggestedTarget ?? 'current_tab',
      status: 'pending',
      createdAt: now,
      resolvedAt: null,
      resolutionNote: null,
    }
    const state = loadBrowserTelegramState()
    browserTelegramState = {
      ...state,
      remoteCommands: [remoteCommand, ...state.remoteCommands].slice(0, 12),
    }
    persistBrowserTelegramState(browserTelegramState)
    return remoteCommand
  }

  return invoke<TelegramRemoteCommandSnapshot>('queue_telegram_remote_command', { request })
}

export const resolveTelegramRemoteCommand = async (request: ResolveTelegramRemoteCommandRequest) => {
  if (usesBrowserRuntime()) {
    const now = Date.now()
    const state = loadBrowserTelegramState()
    const remoteCommands = state.remoteCommands.map((entry) =>
      entry.commandId === request.commandId
        ? {
            ...entry,
            status: request.status,
            resolvedAt: now,
            resolutionNote: request.resolutionNote?.trim() || null,
          }
        : entry,
    )

    browserTelegramState = {
      ...state,
      remoteCommands,
    }
    persistBrowserTelegramState(browserTelegramState)
    return remoteCommands.find((entry) => entry.commandId === request.commandId)!
  }

  return invoke<TelegramRemoteCommandSnapshot>('resolve_telegram_remote_command', { request })
}
