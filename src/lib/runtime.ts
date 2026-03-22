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

export type ProviderId = 'codex' | 'claude'
export type ProviderAuthStatus = 'disconnected' | 'authorizing' | 'connected' | 'error'

export type ProviderSessionSummary = {
  providerId: ProviderId
  displayName: string
  status: ProviderAuthStatus
  accountLabel: string | null
  scopes: string[]
  lastError: string | null
  lastUpdatedAt: number | null
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
const mockProviderLabels: Record<AgentProviderId, string> = {
  codex: 'Codex',
  claude: 'Claude',
}

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

let mockProviderSessions: ProviderSessionSummary[] = [
  {
    providerId: 'codex',
    displayName: 'Codex',
    status: 'disconnected',
    accountLabel: null,
    scopes: ['project.read', 'terminal.read', 'task.propose'],
    lastError: null,
    lastUpdatedAt: null,
  },
  {
    providerId: 'claude',
    displayName: 'Claude',
    status: 'disconnected',
    accountLabel: null,
    scopes: ['project.read', 'terminal.read', 'task.propose'],
    lastError: null,
    lastUpdatedAt: null,
  },
]

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

if (typeof window !== 'undefined' && isMockRuntime()) {
  mockAgentConnections = loadMockConnections()
}

export const usesMockRuntime = isMockRuntime

const waitForMockAuth = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

const getMockAuthScenario = (providerId: ProviderId) => {
  if (typeof window === 'undefined') {
    return 'success'
  }

  const scenario = new URLSearchParams(window.location.search).get('authMock')

  if (!scenario) {
    return 'success'
  }

  if (scenario === 'fail') {
    return 'failure'
  }

  if (scenario === `${providerId}-fail`) {
    return 'failure'
  }

  return 'success'
}

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

export const appendMockTerminalLine = async (sessionId: number, input: string) => {
  if (!isMockRuntime()) {
    return
  }

  const lines = [...(mockTerminalLogs[sessionId] || []), input, '[mock] output received']
  mockTerminalLogs[sessionId] = lines
  refreshMockSession(sessionId)
}

export const listProviderSessions = async () => {
  if (isMockRuntime()) {
    return mockProviderSessions
  }

  return invoke<ProviderSessionSummary[]>('list_provider_sessions')
}

export const startProviderLogin = async (providerId: ProviderId) => {
  if (isMockRuntime()) {
    const startedAt = Date.now()

    mockProviderSessions = mockProviderSessions.map((session) =>
      session.providerId === providerId
        ? {
            ...session,
            status: 'authorizing',
            lastError: null,
            lastUpdatedAt: startedAt,
          }
        : session,
    )

    await waitForMockAuth(120)

    const shouldFail = getMockAuthScenario(providerId) === 'failure'

    mockProviderSessions = mockProviderSessions.map((session) =>
      session.providerId === providerId
        ? {
            ...session,
            status: shouldFail ? 'error' : 'connected',
            accountLabel: shouldFail ? null : `${providerId}@mock.gtum`,
            lastError: shouldFail ? `${session.displayName} login failed in mock callback.` : null,
            lastUpdatedAt: Date.now(),
          }
        : session,
    )

    return mockProviderSessions.find((session) => session.providerId === providerId)!
  }

  return invoke<ProviderSessionSummary>('start_provider_login', { providerId })
}

export const disconnectProviderSession = async (providerId: ProviderId) => {
  if (isMockRuntime()) {
    mockProviderSessions = mockProviderSessions.map((session) =>
      session.providerId === providerId
        ? {
            ...session,
            status: 'disconnected',
            accountLabel: null,
            lastError: null,
            lastUpdatedAt: Date.now(),
          }
        : session,
    )

    return mockProviderSessions.find((session) => session.providerId === providerId)!
  }

  return invoke<ProviderSessionSummary>('disconnect_provider_session', { providerId })
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
