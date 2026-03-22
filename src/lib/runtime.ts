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

export type AgentConnectionSnapshot = {
  provider: AgentProviderId
  displayName: string
  status: AgentConnectionStatus
  accountLabel: string | null
  scopes: string[]
  callbackUrl: string | null
  authUrl: string | null
  connectedAt: number | null
  updatedAt: number
  lastError: string | null
}

export type CompleteAgentLoginRequest = {
  provider: AgentProviderId
  authorizationCode?: string
  accountLabel?: string
  failReason?: string
}

export type AgentExecutionTarget = 'current_tab' | 'new_tab'

export type AgentTaskRequest = {
  provider: AgentProviderId
  task: string
  projectName: string
  projectPath: string
  activeTabTitle: string | null
  activeTabId: string | null
  activeLogLines: string[]
}

export type AgentSuggestion = {
  id: string
  provider: AgentProviderId
  title: string
  rationale: string
  command: string
  preferredTarget: AgentExecutionTarget
}

export type TelegramLinkStatus = 'disconnected' | 'pending' | 'connected' | 'error'
export type TelegramReportStatus = 'queued' | 'sent' | 'failed'
export type TelegramRemoteCommandStatus = 'pending' | 'approved' | 'rejected' | 'executed'

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

export type TelegramRemoteCommandTarget = 'current_tab' | 'new_tab'

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

const mockTree: FileTreeNode = {
  name: 'demo-project',
  path: '/mock/demo-project',
  kind: 'directory',
  truncated: false,
  children: [
    {
      name: 'src',
      path: '/mock/demo-project/src',
      kind: 'directory',
      truncated: false,
      children: [
        {
          name: 'App.tsx',
          path: '/mock/demo-project/src/App.tsx',
          kind: 'file',
          truncated: false,
          children: [],
        },
      ],
    },
    {
      name: 'package.json',
      path: '/mock/demo-project/package.json',
      kind: 'file',
      truncated: false,
      children: [],
    },
  ],
}

const MOCK_AGENT_CONNECTIONS_KEY = 'gtum.mock-agent-connections'
const MOCK_TELEGRAM_STATE_KEY = 'gtum.mock-telegram-state'
const mockProviderLabels: Record<AgentProviderId, string> = {
  codex: 'Codex',
  claude: 'Claude',
}

const createDefaultMockTelegramState = (): TelegramRuntimeSnapshot => ({
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

const isMockRuntime = () => {
  if (typeof window === 'undefined') {
    return false
  }

  return new URLSearchParams(window.location.search).get('e2eMock') === '1'
}

const createDefaultMockConnections = (): AgentConnectionSnapshot[] =>
  (['codex', 'claude'] as AgentProviderId[]).map((provider) => ({
    provider,
    displayName: mockProviderLabels[provider],
    status: 'disconnected',
    accountLabel: null,
    scopes: [],
    callbackUrl: null,
    authUrl: null,
    connectedAt: null,
    updatedAt: Date.now(),
    lastError: null,
  }))

const loadMockConnections = () => {
  if (typeof window === 'undefined') {
    return createDefaultMockConnections()
  }

  try {
    const saved = window.localStorage.getItem(MOCK_AGENT_CONNECTIONS_KEY)
    if (!saved) {
      return createDefaultMockConnections()
    }

    const parsed = JSON.parse(saved) as AgentConnectionSnapshot[]
    return createDefaultMockConnections().map(
      (defaultEntry) =>
        parsed.find((entry) => entry.provider === defaultEntry.provider) ?? defaultEntry,
    )
  } catch {
    return createDefaultMockConnections()
  }
}

const persistMockConnections = (connections: AgentConnectionSnapshot[]) => {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(MOCK_AGENT_CONNECTIONS_KEY, JSON.stringify(connections))
}

const loadMockTelegramState = () => {
  if (typeof window === 'undefined') {
    return createDefaultMockTelegramState()
  }

  try {
    const saved = window.localStorage.getItem(MOCK_TELEGRAM_STATE_KEY)
    if (!saved) {
      return createDefaultMockTelegramState()
    }

    const parsed = JSON.parse(saved) as TelegramRuntimeSnapshot
    return {
      ...createDefaultMockTelegramState(),
      ...parsed,
      bridge: {
        ...createDefaultMockTelegramState().bridge,
        ...parsed.bridge,
      },
      reports: parsed.reports ?? [],
      remoteCommands: parsed.remoteCommands ?? [],
    }
  } catch {
    return createDefaultMockTelegramState()
  }
}

const persistMockTelegramState = (snapshot: TelegramRuntimeSnapshot) => {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(MOCK_TELEGRAM_STATE_KEY, JSON.stringify(snapshot))
}

let nextMockTerminalId = 2
let mockTerminalSessions: TerminalSessionSnapshot[] = [
  {
    sessionId: 1,
    name: 'workspace',
    cwd: '/mock/demo-project',
    shell: 'bash',
    shellArgs: ['-i'],
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

const mockTerminalLogs: Record<number, string[]> = {
  1: [
    '$ sprint-2:start',
    '[gtum] terminal ready',
    '$ npm run test:watch',
    'PASS src/app-shell.spec.ts',
  ],
}

const refreshMockSession = (sessionId: number) => {
  const lines = mockTerminalLogs[sessionId] || []
  mockTerminalSessions = mockTerminalSessions.map((session) =>
    session.sessionId === sessionId
      ? {
          ...session,
          logLineCount: lines.length,
          updatedAt: Date.now(),
        }
      : session,
  )
}

let mockAgentConnections = createDefaultMockConnections()
let mockTelegramState = createDefaultMockTelegramState()

if (typeof window !== 'undefined' && isMockRuntime()) {
  mockAgentConnections = loadMockConnections()
  mockTelegramState = loadMockTelegramState()
}

export const usesMockRuntime = isMockRuntime

export const getRuntimeInfo = async () => {
  if (isMockRuntime()) {
    return {
      app_name: 'gtum',
      platform: 'mock-web',
      mode: 'e2e',
    } satisfies RuntimeInfo
  }

  return invoke<RuntimeInfo>('get_runtime_info')
}

export const readProjectOverview = async (path: string) => {
  if (isMockRuntime()) {
    return {
      metadata: {
        name: path.split('/').filter(Boolean).at(-1) || 'demo-project',
        path: path || '/mock/demo-project',
        exists: true,
        isDirectory: true,
      },
      tree: {
        ...mockTree,
        name: path.split('/').filter(Boolean).at(-1) || mockTree.name,
        path: path || mockTree.path,
      },
      git: {
        isRepository: true,
        branch: 'feature/mock-project-open',
        branchType: 'feature',
        isDirty: true,
        changedFilesCount: 3,
      },
    } satisfies ProjectOverview
  }

  return invoke<ProjectOverview>('read_project_overview', { path })
}

export const createTerminalSession = async (request: CreateTerminalSessionRequest) => {
  if (isMockRuntime()) {
    const now = Date.now()
    const sessionId = nextMockTerminalId++
    const session: TerminalSessionSnapshot = {
      sessionId,
      name: request.name || `tab-${sessionId}`,
      cwd: request.cwd || '/mock/demo-project',
      shell: 'bash',
      shellArgs: ['-i'],
      processId: 1000 + sessionId,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      exitCode: null,
      logLineCount: 2,
      maxLogEntries: request.maxLogEntries || 400,
      lastEvent: 'session created',
    }

    mockTerminalSessions = [...mockTerminalSessions, session]
    mockTerminalLogs[sessionId] = [`$ cd ${session.cwd}`, '[gtum] terminal ready']
    return session
  }

  return invoke<TerminalSessionSnapshot>('create_terminal_session', { request })
}

export const listTerminalSessions = async () => {
  if (isMockRuntime()) {
    return mockTerminalSessions
  }

  return invoke<TerminalSessionSnapshot[]>('list_terminal_sessions')
}

export const renameTerminalSession = async (sessionId: number, name: string) => {
  if (isMockRuntime()) {
    mockTerminalSessions = mockTerminalSessions.map((session) =>
      session.sessionId === sessionId
        ? {
            ...session,
            name,
            updatedAt: Date.now(),
            lastEvent: 'session renamed',
          }
        : session,
    )

    return mockTerminalSessions.find((session) => session.sessionId === sessionId)!
  }

  return invoke<TerminalSessionSnapshot>('rename_terminal_session', { sessionId, name })
}

export const closeTerminalSession = async (sessionId: number) => {
  if (isMockRuntime()) {
    const session = mockTerminalSessions.find((entry) => entry.sessionId === sessionId) ?? null
    mockTerminalSessions = mockTerminalSessions.filter((entry) => entry.sessionId !== sessionId)
    delete mockTerminalLogs[sessionId]
    return session
  }

  return invoke<TerminalSessionSnapshot>('close_terminal_session', { sessionId })
}

export const readTerminalSessionLogs = async (sessionId: number, limit = 120) => {
  if (isMockRuntime()) {
    const entries = (mockTerminalLogs[sessionId] || []).slice(-limit)
    return {
      sessionId,
      status:
        mockTerminalSessions.find((entry) => entry.sessionId === sessionId)?.status || 'terminated',
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
  if (isMockRuntime()) {
    const lines = [...(mockTerminalLogs[sessionId] || []), `$ ${command}`, '[mock] command executed']
    mockTerminalLogs[sessionId] = lines
    refreshMockSession(sessionId)
    return mockTerminalSessions.find((entry) => entry.sessionId === sessionId) ?? null
  }

  return invoke<TerminalSessionSnapshot>('execute_terminal_session_command', { sessionId, command })
}

export const appendMockTerminalLine = async (sessionId: number, input: string) => {
  if (!isMockRuntime()) {
    return
  }

  const lines = [...(mockTerminalLogs[sessionId] || []), input, '[mock] output received']
  mockTerminalLogs[sessionId] = lines
  refreshMockSession(sessionId)
}

export const listAgentConnections = async () => {
  if (isMockRuntime()) {
    mockAgentConnections = loadMockConnections()
    return mockAgentConnections
  }

  return invoke<AgentConnectionSnapshot[]>('list_agent_connections')
}

export const beginAgentLogin = async (provider: AgentProviderId, requestedScopes: string[] = []) => {
  if (isMockRuntime()) {
    const now = Date.now()
    const callbackUrl = `gtum://auth/callback?provider=${provider}`
    const authUrl = `https://mock.gtum.local/auth/${provider}`

    mockAgentConnections = loadMockConnections().map((entry) =>
      entry.provider === provider
        ? {
            ...entry,
            status: 'pending',
            scopes: requestedScopes,
            callbackUrl,
            authUrl,
            updatedAt: now,
            lastError: null,
          }
        : entry,
    )

    persistMockConnections(mockAgentConnections)
    return mockAgentConnections.find((entry) => entry.provider === provider)!
  }

  return invoke<AgentConnectionSnapshot>('begin_agent_login', { provider, requestedScopes })
}

export const completeAgentLogin = async (request: CompleteAgentLoginRequest) => {
  if (isMockRuntime()) {
    const now = Date.now()

    mockAgentConnections = loadMockConnections().map((entry) =>
      entry.provider === request.provider
        ? {
            ...entry,
            status: request.failReason ? 'error' : 'connected',
            accountLabel:
              request.failReason ? null : request.accountLabel || `${mockProviderLabels[request.provider]} User`,
            connectedAt: request.failReason ? null : now,
            updatedAt: now,
            lastError: request.failReason || null,
          }
        : entry,
    )

    persistMockConnections(mockAgentConnections)
    return mockAgentConnections.find((entry) => entry.provider === request.provider)!
  }

  return invoke<AgentConnectionSnapshot>('complete_agent_login', { request })
}

export const disconnectAgentProvider = async (provider: AgentProviderId) => {
  if (isMockRuntime()) {
    const nextConnection = {
      provider,
      displayName: mockProviderLabels[provider],
      status: 'disconnected',
      accountLabel: null,
      scopes: [],
      callbackUrl: null,
      authUrl: null,
      connectedAt: null,
      updatedAt: Date.now(),
      lastError: null,
    } satisfies AgentConnectionSnapshot

    mockAgentConnections = loadMockConnections().map((entry) =>
      entry.provider === provider ? nextConnection : entry,
    )
    persistMockConnections(mockAgentConnections)
    return nextConnection
  }

  return invoke<AgentConnectionSnapshot>('disconnect_agent_provider', { provider })
}

export const requestAgentSuggestions = async (
  request: AgentTaskRequest,
): Promise<AgentSuggestion[]> => {
  const safeTask = request.task.trim() || 'Investigate the current workspace state'
  const recentLog = request.activeLogLines.at(-1) ?? 'No recent terminal output'
  const providerLabel = mockProviderLabels[request.provider]

  return [
    {
      id: `${request.provider}-rerun`,
      provider: request.provider,
      title: `${providerLabel} suggests a focused rerun`,
      rationale: `Based on ${request.projectName} and the latest log line "${recentLog}", rerun the current workflow in the active tab to confirm the state.`,
      command:
        request.activeLogLines.length > 0 ? 'npm run test -- --runInBand' : 'git status --short',
      preferredTarget: 'current_tab',
    },
    {
      id: `${request.provider}-inspect`,
      provider: request.provider,
      title: `${providerLabel} suggests a fresh inspection tab`,
      rationale: `Use a separate tab to inspect task "${safeTask}" without disturbing the current terminal session.`,
      command: 'git status --short && git diff --stat',
      preferredTarget: 'new_tab',
    },
  ]
}

export const readTelegramRuntimeSnapshot = async () => {
  if (isMockRuntime()) {
    mockTelegramState = loadMockTelegramState()
    return mockTelegramState
  }

  return invoke<TelegramRuntimeSnapshot>('read_telegram_runtime_snapshot')
}

export const beginTelegramLink = async () => {
  if (isMockRuntime()) {
    const nextSnapshot: TelegramRuntimeSnapshot = {
      ...loadMockTelegramState(),
      bridge: {
        ...loadMockTelegramState().bridge,
        status: 'pending',
        callbackUrl: 'gtum://telegram/callback',
        authUrl: 'https://mock.telegram.local/gtum/connect',
        updatedAt: Date.now(),
        lastError: null,
      },
    }

    mockTelegramState = nextSnapshot
    persistMockTelegramState(nextSnapshot)
    return nextSnapshot.bridge
  }

  return invoke<TelegramBridgeSnapshot>('begin_telegram_link')
}

export const completeTelegramLink = async (request: CompleteTelegramLinkRequest) => {
  if (isMockRuntime()) {
    const now = Date.now()
    const state = loadMockTelegramState()
    const nextBridge: TelegramBridgeSnapshot = {
      ...state.bridge,
      status: request.failReason ? 'error' : 'connected',
      chatLabel: request.failReason ? null : request.chatLabel || '@gtum_ops',
      connectedAt: request.failReason ? null : now,
      updatedAt: now,
      lastError: request.failReason || null,
    }

    mockTelegramState = {
      ...state,
      bridge: nextBridge,
    }
    persistMockTelegramState(mockTelegramState)
    return nextBridge
  }

  return invoke<TelegramBridgeSnapshot>('complete_telegram_link', { request })
}

export const disconnectTelegramBridge = async () => {
  if (isMockRuntime()) {
    const nextSnapshot = {
      ...loadMockTelegramState(),
      bridge: {
        ...createDefaultMockTelegramState().bridge,
        updatedAt: Date.now(),
      },
    }

    mockTelegramState = nextSnapshot
    persistMockTelegramState(nextSnapshot)
    return nextSnapshot.bridge
  }

  return invoke<TelegramBridgeSnapshot>('disconnect_telegram_bridge')
}

export const createTelegramReport = async (request: CreateTelegramReportRequest) => {
  if (isMockRuntime()) {
    const now = Date.now()
    const report: TelegramReportSnapshot = {
      reportId: `telegram-report-${now}`,
      title: request.title.trim(),
      body: request.body.trim(),
      status: 'sent',
      createdAt: now,
      deliveredAt: now,
    }
    const state = loadMockTelegramState()
    mockTelegramState = {
      ...state,
      reports: [report, ...state.reports].slice(0, 8),
    }
    persistMockTelegramState(mockTelegramState)
    return report
  }

  return invoke<TelegramReportSnapshot>('create_telegram_report', { request })
}

export const queueTelegramRemoteCommand = async (request: QueueTelegramRemoteCommandRequest) => {
  if (isMockRuntime()) {
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
    const state = loadMockTelegramState()
    mockTelegramState = {
      ...state,
      remoteCommands: [remoteCommand, ...state.remoteCommands].slice(0, 12),
    }
    persistMockTelegramState(mockTelegramState)
    return remoteCommand
  }

  return invoke<TelegramRemoteCommandSnapshot>('queue_telegram_remote_command', { request })
}

export const resolveTelegramRemoteCommand = async (request: ResolveTelegramRemoteCommandRequest) => {
  if (isMockRuntime()) {
    const now = Date.now()
    const state = loadMockTelegramState()
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

    mockTelegramState = {
      ...state,
      remoteCommands,
    }
    persistMockTelegramState(mockTelegramState)
    return remoteCommands.find((entry) => entry.commandId === request.commandId)!
  }

  return invoke<TelegramRemoteCommandSnapshot>('resolve_telegram_remote_command', { request })
}
