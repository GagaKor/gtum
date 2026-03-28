import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { type AgentContextSnapshot, useWorkspaceStore } from './stores/workspace-store'
import {
  beginAgentLogin,
  completeAgentLogin,
  disconnectAgentProvider,
  createTerminalSessionWithCommand,
  type AgentConnectionSnapshot,
  type AgentProviderDiagnostics as RuntimeProviderDiagnostics,
  type AgentProviderId,
  type AgentSuggestion as RuntimeAgentSuggestion,
  appendMockTerminalLine,
  beginTelegramLink,
  completeTelegramLink,
  createTelegramReport,
  createTerminalSession,
  disconnectTelegramBridge,
  executeTerminalSessionCommand,
  type FileTreeNode,
  type ProjectOverview,
  readProjectOverview,
  readAgentProviderDiagnostics,
  readTelegramRuntimeSnapshot,
  readTerminalSessionLogs,
  type RuntimeInfo,
  getRuntimeInfo,
  listAgentConnections,
  listTerminalSessions,
  queueTelegramRemoteCommand,
  requestAgentSuggestions,
  resolveTelegramRemoteCommand,
  selectProjectFolder,
  type TelegramRemoteCommandSnapshot,
  type TelegramRuntimeSnapshot,
  type TerminalSessionLogs,
  type TerminalSessionStatus,
  type TerminalSessionSnapshot,
  renameTerminalSession,
  closeTerminalSession,
  type ExecutionMode,
  usesMockRuntime,
} from './lib/runtime'

type AgentSuggestionTarget = 'current-tab' | 'new-tab'

type AgentSuggestion = {
  id: string
  provider: AgentProviderId
  providerLabel: string
  summary: string
  command: string
  projectLabel: string
  terminalLabel: string
  attachedLogLines: number
  confidence: RuntimeAgentSuggestion['confidence']
  error: string | null
  status: 'pending' | 'approved-current-tab' | 'approved-new-tab' | 'error'
}

type TaskHistoryEntry = {
  id: string
  title: string
  detail: string
  status: 'done' | 'pending' | 'error'
  createdAt: string
}

type TelegramReportState = {
  status: 'idle' | 'draft-ready' | 'queued'
  preview: string
  generatedAt: string | null
  queuedAt: string | null
}

type ProviderUiContract = {
  statusLabel: string
  guidance: string
  canStartLogin: boolean
  canDisconnect: boolean
  canCompleteMock: boolean
  canRequestSuggestion: boolean
  primaryActionLabel: string
}

const formatProviderSetupStateLabel = (state: RuntimeProviderDiagnostics['setupState']) =>
  state === 'ready' ? 'Ready' : state === 'deferred' ? 'Deferred' : 'Needs Setup'

const formatProviderSetupStateBadgeClass = (state: RuntimeProviderDiagnostics['setupState']) =>
  state === 'ready' ? 'connected' : state === 'deferred' ? 'pending' : 'error'

const UI_STATE_KEY = 'gtum.app-ui-state'
const TASK_HISTORY_LIMIT = 12

const loadUiState = () => {
  if (typeof window === 'undefined') {
    return null as null | {
      lastProjectPath?: string
      selectedProvider?: AgentProviderId
      executionMode?: ExecutionMode
      taskHistory?: TaskHistoryEntry[]
      telegramReport?: TelegramReportState
    }
  }

  try {
    const raw = window.localStorage.getItem(UI_STATE_KEY)
    return raw
      ? (JSON.parse(raw) as {
          lastProjectPath?: string
          selectedProvider?: AgentProviderId
          executionMode?: ExecutionMode
          taskHistory?: TaskHistoryEntry[]
          telegramReport?: TelegramReportState
        })
      : null
  } catch {
    return null
  }
}

const formatModeLabel = (mode: ExecutionMode) =>
  mode === 'fast' ? 'Fast' : mode === 'balanced' ? 'Balanced' : 'Deep'

const formatProviderStatusLabel = (status: AgentConnectionSnapshot['status']) =>
  status === 'connected'
    ? 'Connected'
    : status === 'pending'
      ? 'Pending'
      : status === 'error'
        ? 'Attention Needed'
        : 'Needs Connection'

const formatProviderUxKindLabel = (kind: AgentConnectionSnapshot['connectionKind']) =>
  kind === 'mock' ? 'Mock' : kind === 'prototype' ? 'Prototype' : 'Real'

const formatProviderHint = (
  connection: AgentConnectionSnapshot,
  kind: AgentConnectionSnapshot['connectionKind'],
) => {
  if (connection.lastError) {
    return connection.lastError
  }

  if (connection.status === 'connected') {
    return kind === 'real'
      ? 'Codex CLI ChatGPT session is connected and ready for suggestion requests.'
      : `${formatProviderUxKindLabel(kind)} provider session is connected for workspace testing.`
  }

  if (connection.status === 'pending') {
    return kind === 'mock'
      ? 'Mock callback is ready for the next auth step.'
      : 'Provider connection is pending.'
  }

  return kind === 'real'
    ? 'Connect this provider after Codex CLI is logged in with ChatGPT on this desktop.'
    : `${formatProviderUxKindLabel(kind)} provider flow remains secondary while the first real path focuses on Codex.`
}

const buildProviderUiContract = (connection: AgentConnectionSnapshot): ProviderUiContract => {
  const kind = connection.connectionKind
  const statusLabel = `${formatProviderUxKindLabel(kind)} • ${formatProviderStatusLabel(connection.status)}`
  const guidance = formatProviderHint(connection, kind)

  return {
    statusLabel,
    guidance,
    canStartLogin: connection.status === 'disconnected' || connection.status === 'error',
    canDisconnect: connection.status === 'connected',
    canCompleteMock: usesMockRuntime() && connection.status === 'pending',
    canRequestSuggestion: connection.status === 'connected',
    primaryActionLabel:
      connection.status === 'connected'
        ? `Disconnect ${connection.displayName}`
        : `Connect ${connection.displayName}`,
  }
}

const formatTerminalStatusLabel = (status: TerminalSessionStatus) =>
  status === 'running'
    ? 'Live'
    : status === 'exited'
      ? 'Exited'
      : status === 'terminated'
        ? 'Terminated'
        : 'Attention'

const summarizePath = (value: string | null) => {
  if (!value) {
    return 'No project selected'
  }

  const segments = value.split(/[\\/]/).filter(Boolean)
  if (segments.length <= 3) {
    return value
  }

  return ['…', ...segments.slice(-3)].join('/')
}

function TreeNode({ node, depth = 0 }: { node: FileTreeNode; depth?: number }) {
  return (
    <li>
      <div className={`tree-row ${node.kind}`} style={{ paddingLeft: `${depth * 14}px` }}>
        <span className="tree-icon">{node.kind === 'directory' ? '▸' : '·'}</span>
        <span className="tree-name">{node.name}</span>
        {node.truncated ? <span className="tree-meta">depth limit</span> : null}
      </div>
      {node.children.length > 0 ? (
        <ul className="tree-list">
          {node.children.map((child) => (
            <TreeNode key={child.path} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function TerminalRenameField({
  session,
  onRename,
}: {
  session: TerminalSessionSnapshot
  onRename: (sessionId: number, nextName: string) => Promise<void>
}) {
  const [draftName, setDraftName] = useState(session.name)

  return (
    <label className="field-inline">
      <span className="label">Active Tab Name</span>
      <input
        aria-label="Active Tab Name"
        value={draftName}
        onChange={(event) => setDraftName(event.target.value)}
        onBlur={() => void onRename(session.sessionId, draftName)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            void onRename(session.sessionId, draftName)
            event.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}

function App() {
  const restoredUiState = loadUiState()
  const {
    activeProject,
    activeContext,
    activeProjectPath,
    projectPathInput,
    recentProjects,
    panels,
    activeTerminalTabId,
    agentContext,
    setActiveProject,
    setActiveContext,
    setActiveProjectPath,
    setProjectPathInput,
    rememberProject,
    togglePanel,
    selectTerminalTab,
    captureTerminalContext,
  } = useWorkspaceStore()
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)
  const [projectOverview, setProjectOverview] = useState<ProjectOverview | null>(null)
  const [isProjectLoading, setIsProjectLoading] = useState(false)
  const [projectError, setProjectError] = useState<string | null>(null)
  const [terminalSessions, setTerminalSessions] = useState<TerminalSessionSnapshot[]>([])
  const [terminalLogs, setTerminalLogs] = useState<TerminalSessionLogs | null>(null)
  const [terminalError, setTerminalError] = useState<string | null>(null)
  const [agentConnections, setAgentConnections] = useState<AgentConnectionSnapshot[]>([])
  const [providerDiagnostics, setProviderDiagnostics] = useState<RuntimeProviderDiagnostics[]>([])
  const [authError, setAuthError] = useState<string | null>(null)
  const [telegramSnapshot, setTelegramSnapshot] = useState<TelegramRuntimeSnapshot | null>(null)
  const [telegramError, setTelegramError] = useState<string | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<AgentProviderId>(
    restoredUiState?.selectedProvider ?? 'codex',
  )
  const [agentRequestInput, setAgentRequestInput] = useState('')
  const [agentRequestError, setAgentRequestError] = useState<string | null>(null)
  const [agentSuggestions, setAgentSuggestions] = useState<AgentSuggestion[]>([])
  const [executionMode, setExecutionMode] = useState<ExecutionMode>(
    restoredUiState?.executionMode ?? 'balanced',
  )
  const [taskHistory, setTaskHistory] = useState<TaskHistoryEntry[]>(
    restoredUiState?.taskHistory ?? [],
  )
  const [telegramReport, setTelegramReport] = useState<TelegramReportState>(
    restoredUiState?.telegramReport ?? {
      status: 'idle',
      preview: '',
      generatedAt: null,
      queuedAt: null,
    },
  )
  const hasRestoredWorkspace = useRef(false)

  const refreshTerminalSessions = useCallback(async () => {
    try {
      const sessions = await listTerminalSessions()
      setTerminalSessions(sessions)

      if (sessions.length > 0 && !sessions.some((session) => String(session.sessionId) === activeTerminalTabId)) {
        selectTerminalTab(String(sessions[0].sessionId))
      }
    } catch (error) {
      setTerminalError(error instanceof Error ? error.message : String(error))
    }
  }, [activeTerminalTabId, selectTerminalTab])

  const refreshActiveTerminalLogs = useCallback(async (sessionId: string) => {
    try {
      const logs = await readTerminalSessionLogs(Number(sessionId), 120)
      setTerminalLogs(logs)
    } catch (error) {
      setTerminalError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const refreshAgentConnections = useCallback(async () => {
    try {
      const connections = await listAgentConnections()
      setAgentConnections(connections)
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const refreshProviderDiagnostics = useCallback(async () => {
    try {
      const diagnostics = await Promise.all(
        (['codex', 'claude'] as AgentProviderId[]).map((provider) => readAgentProviderDiagnostics(provider)),
      )
      setProviderDiagnostics(diagnostics)
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const refreshTelegramState = useCallback(async () => {
    try {
      const snapshot = await readTelegramRuntimeSnapshot()
      setTelegramSnapshot(snapshot)
    } catch (error) {
      setTelegramError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const recordTask = useCallback(
    (title: string, detail: string, status: TaskHistoryEntry['status'] = 'done') => {
      setTaskHistory((current) =>
        [
          {
            id: `task-${Date.now()}-${current.length}`,
            title,
            detail,
            status,
            createdAt: new Date().toISOString(),
          },
          ...current,
        ].slice(0, TASK_HISTORY_LIMIT),
      )
    },
    [],
  )

  useEffect(() => {
    getRuntimeInfo()
      .then(setRuntimeInfo)
      .catch(() => {
        setRuntimeInfo(null)
      })

    void refreshTerminalSessions()
    void refreshAgentConnections()
    void refreshProviderDiagnostics()
    void refreshTelegramState()
  }, [refreshAgentConnections, refreshProviderDiagnostics, refreshTelegramState, refreshTerminalSessions])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(
      UI_STATE_KEY,
      JSON.stringify({
        lastProjectPath: activeProjectPath || projectPathInput,
        selectedProvider,
        executionMode,
        taskHistory,
        telegramReport,
      }),
    )
  }, [activeProjectPath, executionMode, projectPathInput, selectedProvider, taskHistory, telegramReport])

  useEffect(() => {
    if (!activeTerminalTabId) {
      setTerminalLogs(null)
      return
    }

    void refreshActiveTerminalLogs(activeTerminalTabId)
    const timer = window.setInterval(() => {
      void refreshActiveTerminalLogs(activeTerminalTabId)
    }, 1200)

    return () => window.clearInterval(timer)
  }, [activeTerminalTabId, refreshActiveTerminalLogs])

  useEffect(() => {
    if (!usesMockRuntime()) {
      return
    }

    const params = new URLSearchParams(window.location.search)
    const provider = params.get('authProvider')
    const authCode = params.get('authCode')

    if (!provider || !authCode) {
      return
    }

    void (async () => {
      try {
        const snapshot = await completeAgentLogin({
          provider: provider as AgentProviderId,
          authorizationCode: authCode,
          accountLabel: `${provider} sandbox`,
        })
        setAgentConnections((current) =>
          current.map((entry) => (entry.provider === snapshot.provider ? snapshot : entry)),
        )
        await refreshProviderDiagnostics()
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : String(error))
      } finally {
        params.delete('authProvider')
        params.delete('authCode')
        const nextQuery = params.toString()
        const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`
        window.history.replaceState({}, '', nextUrl)
      }
    })()
  }, [refreshAgentConnections, refreshProviderDiagnostics])

  const ensureWorkspaceTerminal = useCallback(async (cwd: string) => {
    const sessions = await listTerminalSessions()
    if (sessions.length > 0) {
      setTerminalSessions(sessions)
      if (!activeTerminalTabId) {
        selectTerminalTab(String(sessions[0].sessionId))
      }
      return
    }

    const session = await createTerminalSession({
      name: 'workspace',
      cwd,
      maxLogEntries: 400,
    })
    setTerminalSessions([session])
    selectTerminalTab(String(session.sessionId))
  }, [activeTerminalTabId, selectTerminalTab])

  const openProject = useCallback(async (path: string) => {
    const trimmedPath = path.trim()

    if (!trimmedPath) {
      setProjectError('Choose a project folder to continue.')
      return
    }

    setProjectError(null)
    setIsProjectLoading(true)

    try {
      const overview = await readProjectOverview(trimmedPath)

      setProjectOverview(overview)
      setActiveProject(overview.metadata.name)
      setActiveProjectPath(overview.metadata.path)
      setProjectPathInput(overview.metadata.path)
      setActiveContext('Sprint 5 Workspace Restored')
      rememberProject(overview.metadata.path)
      await ensureWorkspaceTerminal(overview.metadata.path)
      recordTask('Project opened', overview.metadata.path, 'done')
    } catch (error) {
      setProjectOverview(null)
      setProjectError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsProjectLoading(false)
    }
  }, [
    ensureWorkspaceTerminal,
    recordTask,
    rememberProject,
    setActiveContext,
    setActiveProject,
    setActiveProjectPath,
    setProjectPathInput,
  ])

  const chooseProjectFolder = useCallback(async () => {
    const chosenPath = await selectProjectFolder(projectPathInput || activeProjectPath || recentProjects[0])

    if (!chosenPath) {
      return
    }

    setProjectPathInput(chosenPath)
    await openProject(chosenPath)
  }, [activeProjectPath, openProject, projectPathInput, recentProjects, setProjectPathInput])

  useEffect(() => {
    if (hasRestoredWorkspace.current) {
      return
    }

    hasRestoredWorkspace.current = true

    if (restoredUiState?.lastProjectPath) {
      void openProject(restoredUiState.lastProjectPath)
    }
  }, [openProject, restoredUiState?.lastProjectPath])

  const createTab = async () => {
    try {
      const session = await createTerminalSession({
        name: `tab-${terminalSessions.length + 1}`,
        cwd: activeProjectPath || undefined,
        maxLogEntries: 400,
      })
      const nextSessions = [...terminalSessions, session]
      setTerminalSessions(nextSessions)
      selectTerminalTab(String(session.sessionId))
    } catch (error) {
      setTerminalError(error instanceof Error ? error.message : String(error))
    }
  }

  const renameTab = async (sessionId: number, nextName: string) => {
    const trimmedName = nextName.trim()

    if (!trimmedName) {
      return
    }

    try {
      const updated = await renameTerminalSession(sessionId, trimmedName)
      setTerminalSessions((current) =>
        current.map((entry) => (entry.sessionId === updated.sessionId ? updated : entry)),
      )
      if (agentContext?.tabId === String(updated.sessionId)) {
        captureTerminalContext({
          ...agentContext,
          tabTitle: updated.name,
        })
      }
    } catch (error) {
      setTerminalError(error instanceof Error ? error.message : String(error))
    }
  }

  const closeTab = async (sessionId: number) => {
    try {
      await closeTerminalSession(sessionId)
      const nextSessions = terminalSessions.filter((entry) => entry.sessionId !== sessionId)
      setTerminalSessions(nextSessions)
      if (String(sessionId) === activeTerminalTabId) {
        selectTerminalTab(nextSessions[0] ? String(nextSessions[0].sessionId) : '')
      }
      if (agentContext?.tabId === String(sessionId)) {
        captureTerminalContext(null)
      }
    } catch (error) {
      setTerminalError(error instanceof Error ? error.message : String(error))
    }
  }

  const captureAgentContextFromActiveTab = () => {
    const activeSession = terminalSessions.find((session) => String(session.sessionId) === activeTerminalTabId)

    if (!activeSession || !terminalLogs) {
      return
    }

    const snapshot: AgentContextSnapshot = {
      tabId: String(activeSession.sessionId),
      tabTitle: activeSession.name,
      lines: terminalLogs.entries.slice(-50),
      capturedAt: new Date().toISOString(),
    }

    captureTerminalContext(snapshot)
  }

  const simulateMockActivity = async () => {
    if (!usesMockRuntime() || !activeTerminalTabId) {
      return
    }

    const sessionName = activeSession?.name || 'workspace'
    await appendMockTerminalLine(Number(activeTerminalTabId), `${sessionName}: live log sample`)
    await refreshActiveTerminalLogs(activeTerminalTabId)
    await refreshTerminalSessions()
  }

  const resolveMockCallbackFailure = (provider: AgentProviderId) => {
    const scenario = new URLSearchParams(window.location.search).get('authMock')

    if (!scenario) {
      return null
    }

    if (scenario === 'fail' || scenario === `${provider}-fail`) {
      return `${provider} mock callback failed.`
    }

    return null
  }

  const startProviderLogin = async (provider: AgentProviderId) => {
    try {
      setAuthError(null)
      const snapshot = await beginAgentLogin(provider, ['project:read', 'terminal:read'])
      setAgentConnections((current) =>
        current.map((entry) => (entry.provider === snapshot.provider ? snapshot : entry)),
      )
      await refreshProviderDiagnostics()
      setSelectedProvider(provider)
      setActiveContext(
        snapshot.status === 'connected'
          ? `Daily-use ${snapshot.displayName} connected`
          : snapshot.status === 'error'
            ? `Daily-use ${snapshot.displayName} connection blocked`
            : `Daily-use ${snapshot.displayName} connection pending`,
      )
      recordTask(
        snapshot.status === 'connected'
          ? `${snapshot.displayName} connected`
          : snapshot.status === 'error'
            ? `${snapshot.displayName} connection blocked`
            : `${snapshot.displayName} connection pending`,
        snapshot.lastError ?? `Required scopes: ${snapshot.requiredScopes.join(', ') || 'none'}`,
        snapshot.status === 'connected' ? 'done' : snapshot.status === 'error' ? 'error' : 'pending',
      )
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error))
      recordTask(`${provider} login failed`, String(error), 'error')
    }
  }

  const openCodexLogin = async () => {
    try {
      setAuthError(null)
      const session = await createTerminalSessionWithCommand({
        session: {
          name: 'codex-login',
          cwd: projectOverview?.metadata.path ?? activeProjectPath ?? activeSession?.cwd ?? undefined,
          maxLogEntries: 400,
        },
        command: 'codex login --device-auth',
      })
      await refreshTerminalSessions()
      selectTerminalTab(String(session.sessionId))
      await refreshActiveTerminalLogs(String(session.sessionId))
      setActiveContext('Daily-use Codex login launched')
      recordTask(
        'Codex login launched',
        'Complete the ChatGPT browser sign-in, then reconnect Codex inside gtum.',
        'pending',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setAuthError(message)
      recordTask('Codex login launch failed', message, 'error')
    }
  }

  const disconnectProvider = async (provider: AgentProviderId) => {
    try {
      setAuthError(null)
      const snapshot = await disconnectAgentProvider(provider)
      setAgentConnections((current) =>
        current.map((entry) => (entry.provider === snapshot.provider ? snapshot : entry)),
      )
      await refreshProviderDiagnostics()
      setActiveContext(`Daily-use ${snapshot.displayName} disconnected`)
      recordTask(`${snapshot.displayName} disconnected`, 'Provider session cleared.', 'done')
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error))
      recordTask(`${provider} disconnect failed`, String(error), 'error')
    }
  }

  const simulateMockCallback = async (provider: AgentProviderId) => {
    const params = new URLSearchParams(window.location.search)
    params.set('authProvider', provider)
    const failReason = resolveMockCallbackFailure(provider)

    if (failReason) {
      params.delete('authCode')
    } else {
      params.set('authCode', `mock-${provider}-code`)
    }
    const nextQuery = params.toString()
    window.history.replaceState({}, '', `${window.location.pathname}?${nextQuery}`)

    const optimisticTimestamp = Date.now()
    setAgentConnections((current) =>
      current.map((entry) =>
        entry.provider === provider
          ? {
              ...entry,
              status: failReason ? 'error' : 'connected',
              accountLabel: failReason ? null : `${provider} sandbox`,
              connectedAt: failReason ? null : optimisticTimestamp,
              updatedAt: optimisticTimestamp,
              lastError: failReason ?? null,
            }
          : entry,
      ),
    )
    setActiveContext(
      failReason ? `Sprint 4 ${provider} login failed` : `Sprint 4 ${provider} connected`,
    )

    try {
      const snapshot = await completeAgentLogin({
        provider,
        authorizationCode: failReason ? undefined : `mock-${provider}-code`,
        accountLabel: failReason ? undefined : `${provider} sandbox`,
        failReason: failReason ?? undefined,
      })
      setAgentConnections((current) =>
        current.map((entry) => (entry.provider === snapshot.provider ? snapshot : entry)),
      )
      await refreshProviderDiagnostics()
      setActiveContext(
        snapshot.status === 'connected'
          ? `Sprint 4 ${snapshot.displayName} connected`
          : `Sprint 4 ${snapshot.displayName} login failed`,
      )
      recordTask(
        snapshot.status === 'connected'
          ? `${snapshot.displayName} connected`
          : `${snapshot.displayName} login failed`,
        snapshot.lastError ?? 'Mock callback completed.',
        snapshot.status === 'connected' ? 'done' : 'error',
      )
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error))
      recordTask(`${provider} callback failed`, String(error), 'error')
    } finally {
      params.delete('authProvider')
      params.delete('authCode')
      const clearedQuery = params.toString()
      window.history.replaceState(
        {},
        '',
        `${window.location.pathname}${clearedQuery ? `?${clearedQuery}` : ''}`,
      )
    }
  }

  const startTelegramLink = async () => {
    try {
      setTelegramError(null)
      const snapshot = await beginTelegramLink()
      setTelegramSnapshot((current) => ({
        storagePath: current?.storagePath ?? null,
        bridge: snapshot,
        reports: current?.reports ?? [],
        remoteCommands: current?.remoteCommands ?? [],
      }))
      setActiveContext('Sprint 6 Telegram link started')
      recordTask('Telegram link started', 'Awaiting Telegram bridge approval.', 'pending')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setTelegramError(message)
      recordTask('Telegram link failed', message, 'error')
    }
  }

  const completeTelegramMockLink = async () => {
    try {
      setTelegramError(null)
      const snapshot = await completeTelegramLink({
        authorizationCode: 'mock-telegram-code',
        chatLabel: '@gtum_ops',
      })
      setTelegramSnapshot((current) => ({
        storagePath: current?.storagePath ?? null,
        bridge: snapshot,
        reports: current?.reports ?? [],
        remoteCommands: current?.remoteCommands ?? [],
      }))
      setActiveContext('Sprint 6 Telegram connected')
      recordTask('Telegram connected', snapshot.chatLabel ?? '@gtum_ops', 'done')
      await refreshTelegramState()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setTelegramError(message)
      recordTask('Telegram callback failed', message, 'error')
    }
  }

  const disconnectTelegram = async () => {
    try {
      setTelegramError(null)
      const snapshot = await disconnectTelegramBridge()
      setTelegramSnapshot((current) => ({
        storagePath: current?.storagePath ?? null,
        bridge: snapshot,
        reports: current?.reports ?? [],
        remoteCommands: current?.remoteCommands ?? [],
      }))
      setActiveContext('Sprint 6 Telegram disconnected')
      recordTask('Telegram disconnected', 'Telegram bridge cleared.', 'done')
      await refreshTelegramState()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setTelegramError(message)
      recordTask('Telegram disconnect failed', message, 'error')
    }
  }

  const sendTelegramStatusReport = async () => {
    if (telegramSnapshot?.bridge.status !== 'connected') {
      setTelegramError('Connect Telegram before sending a report.')
      return
    }

    const title = `Workspace report for ${projectOverview?.metadata.name ?? activeProject}`
    const recentTask = taskHistory[0]
    const projectPath = (projectOverview?.metadata.path ?? activeProjectPath) || 'unbound'
    const body = [
      `Project: ${projectPath}`,
      `Terminal: ${activeSession?.name ?? 'none'}`,
      `Mode: ${formatModeLabel(executionMode)}`,
      `Captured logs: ${agentContext?.lines.length ?? 0}`,
      `Latest task: ${recentTask ? `${recentTask.title} (${recentTask.status})` : 'none'}`,
    ].join('\n')

    try {
      setTelegramError(null)
      const report = await createTelegramReport({ title, body })
      setTelegramSnapshot((current) =>
        current
          ? {
              ...current,
              reports: [report, ...current.reports].slice(0, 8),
            }
          : current,
      )
      setActiveContext('Sprint 6 Telegram report queued')
      recordTask('Telegram report sent', title, 'done')
      await refreshTelegramState()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setTelegramError(message)
      recordTask('Telegram report failed', message, 'error')
    }
  }

  const queueTelegramCommand = async (command: 'status' | 'rerun' | 'diff') => {
    const presets = {
      status: {
        summary: 'Remote /status request from Telegram',
        command: 'git status --short',
        suggestedTarget: 'new_tab',
      },
      rerun: {
        summary: 'Remote /rerun-tests request from Telegram',
        command: 'npm run test -- --runInBand',
        suggestedTarget: 'current_tab',
      },
      diff: {
        summary: 'Remote /git-diff request from Telegram',
        command: 'git diff --stat',
        suggestedTarget: 'new_tab',
      },
    } as const

    try {
      setTelegramError(null)
      const remoteCommand = await queueTelegramRemoteCommand({
        sourceLabel: telegramSnapshot?.bridge.chatLabel ?? '@gtum_ops',
        summary: presets[command].summary,
        command: presets[command].command,
        suggestedTarget: presets[command].suggestedTarget,
      })
      setTelegramSnapshot((current) =>
        current
          ? {
              ...current,
              remoteCommands: [remoteCommand, ...current.remoteCommands].slice(0, 12),
            }
          : current,
      )
      setActiveContext('Sprint 6 Telegram remote command queued')
      recordTask('Telegram command queued', remoteCommand.summary, 'pending')
      await refreshTelegramState()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setTelegramError(message)
      recordTask('Telegram command queue failed', message, 'error')
    }
  }

  const approveTelegramCommand = async (
    remoteCommand: TelegramRemoteCommandSnapshot,
    target: 'current-tab' | 'new-tab',
  ) => {
    try {
      if (target === 'current-tab' && activeTerminalTabId) {
        if (usesMockRuntime()) {
          await appendMockTerminalLine(
            Number(activeTerminalTabId),
            `[telegram] ${remoteCommand.command}`,
          )
        } else {
          await executeTerminalSessionCommand(Number(activeTerminalTabId), remoteCommand.command)
        }
        await refreshActiveTerminalLogs(activeTerminalTabId)
        await refreshTerminalSessions()
      }

      if (target === 'new-tab') {
        const session = await createTerminalSession({
          name: `telegram-${terminalSessions.length + 1}`,
          cwd: activeProjectPath || undefined,
          maxLogEntries: 400,
        })
        setTerminalSessions((current) => [...current, session])
        selectTerminalTab(String(session.sessionId))

        if (usesMockRuntime()) {
          await appendMockTerminalLine(session.sessionId, `[telegram] ${remoteCommand.command}`)
        } else {
          await executeTerminalSessionCommand(session.sessionId, remoteCommand.command)
        }
        await refreshActiveTerminalLogs(String(session.sessionId))
        await refreshTerminalSessions()
      }

      await resolveTelegramRemoteCommand({
        commandId: remoteCommand.commandId,
        status: 'executed',
        resolutionNote: `Approved in ${target}`,
      })
      setActiveContext('Sprint 6 Telegram command executed')
      recordTask('Telegram command executed', `${remoteCommand.command} -> ${target}`, 'done')
      await refreshTelegramState()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setTelegramError(message)
      recordTask('Telegram command execution failed', message, 'error')
    }
  }

  const rejectTelegramCommand = async (remoteCommand: TelegramRemoteCommandSnapshot) => {
    try {
      await resolveTelegramRemoteCommand({
        commandId: remoteCommand.commandId,
        status: 'rejected',
        resolutionNote: 'Rejected in gtum approval flow.',
      })
      setActiveContext('Sprint 6 Telegram command rejected')
      recordTask('Telegram command rejected', remoteCommand.summary, 'done')
      await refreshTelegramState()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setTelegramError(message)
      recordTask('Telegram rejection failed', message, 'error')
    }
  }

  const buildLiveContextSnapshot = () => {
    if (activeSession && terminalLogs) {
      return {
        tabId: String(activeSession.sessionId),
        tabTitle: activeSession.name,
        lines: terminalLogs.entries.slice(-50),
        capturedAt: new Date().toISOString(),
      } satisfies AgentContextSnapshot
    }

    return agentContext
  }

  const draftTelegramReport = () => {
    const projectLabel = projectOverview?.metadata.name ?? activeProject
    const projectPath = projectOverview?.metadata.path ?? activeProjectPath ?? 'No active project path'
    const terminalLabel = agentContext?.tabTitle ?? activeSession?.name ?? 'No active terminal'
    const latestTask = taskHistory[0]
    const recentLines = (terminalLogs?.entries || []).slice(-4)

    setTelegramReport({
      status: 'draft-ready',
      preview: [
        'Telegram status report draft',
        `Project: ${projectLabel}`,
        `Project path: ${projectPath}`,
        `Terminal: ${terminalLabel}`,
        `Execution mode: ${formatModeLabel(executionMode)}`,
        `Agent context: ${agentContext ? 'captured' : 'pending'}`,
        `Recent task: ${latestTask ? latestTask.title : 'No recent tasks'}`,
        `Log lines: ${recentLines.length > 0 ? recentLines.join(' | ') : 'No active terminal lines'}`,
      ].join('\n'),
      generatedAt: new Date().toISOString(),
      queuedAt: null,
    })
    setActiveContext('Post-MVP Telegram draft ready')
    recordTask('Telegram report drafted', `${projectLabel} • ${projectPath}`, 'done')
  }

  const queueTelegramReport = () => {
    setTelegramReport((current) => {
      if (current.status === 'idle') {
        return current
      }

      return {
        ...current,
        status: 'queued',
        queuedAt: new Date().toISOString(),
      }
    })
    setActiveContext('Post-MVP Telegram draft queued')
    recordTask('Telegram report queued', 'Draft prepared for external channel handoff.', 'done')
  }

  const submitAgentRequest = async () => {
    const normalizedRequest = agentRequestInput.trim()
    const connectedProvider = agentConnections.find(
      (connection) =>
        connection.provider === selectedProvider && buildProviderUiContract(connection).canRequestSuggestion,
    )

    if (!normalizedRequest) {
      setAgentRequestError('Enter an agent request before asking for suggestions.')
      return
    }

    if (!connectedProvider) {
      setAgentRequestError('Connect the selected provider before requesting agent suggestions.')
      return
    }

    const liveContextSnapshot = buildLiveContextSnapshot()

    if (liveContextSnapshot) {
      captureTerminalContext(liveContextSnapshot)
    }

    setAgentRequestError(null)

    try {
      const suggestions = await requestAgentSuggestions({
        provider: connectedProvider.provider,
        projectName: projectOverview?.metadata.name ?? activeProject,
        projectPath: projectOverview?.metadata.path ?? activeProjectPath,
        activeTabId: liveContextSnapshot?.tabId ?? (activeSession ? String(activeSession.sessionId) : null),
        activeTabTitle: liveContextSnapshot?.tabTitle ?? activeSession?.name ?? null,
        lastNLogLines: liveContextSnapshot?.lines ?? [],
        userTask: normalizedRequest,
        executionMode,
      })

      const mappedSuggestions: AgentSuggestion[] = suggestions.map((suggestion) => ({
        id: suggestion.id,
        provider: suggestion.provider,
        providerLabel: connectedProvider.displayName,
        summary: suggestion.summary,
        command: suggestion.command,
        projectLabel: projectOverview?.metadata.name ?? activeProject,
        terminalLabel: liveContextSnapshot?.tabTitle ?? activeSession?.name ?? 'workspace',
        attachedLogLines: liveContextSnapshot?.lines.length ?? 0,
        confidence: suggestion.confidence,
        error: suggestion.error,
        status: suggestion.error ? 'error' : 'pending',
      }))

      setAgentSuggestions((current) => [...mappedSuggestions, ...current].slice(0, 6))
      setActiveContext(`Daily-use ${connectedProvider.displayName} suggestion ready`)
      recordTask(
        `${connectedProvider.displayName} suggestion requested`,
        `${normalizedRequest} • ${mappedSuggestions[0]?.attachedLogLines ?? 0} log line(s) • ${formatModeLabel(executionMode)}`,
        mappedSuggestions.some((entry) => entry.error) ? 'error' : 'done',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setAgentRequestError(message)
      recordTask(`${connectedProvider.displayName} suggestion failed`, message, 'error')
    }
  }

  const approveSuggestion = async (suggestion: AgentSuggestion, target: AgentSuggestionTarget) => {
    if (suggestion.status !== 'pending' || suggestion.error || !suggestion.command) {
      return
    }

    try {
      if (target === 'current-tab' && activeTerminalTabId) {
        if (usesMockRuntime()) {
          await appendMockTerminalLine(
            Number(activeTerminalTabId),
            `[agent:${suggestion.provider}] ${suggestion.command}`,
          )
        } else {
          await executeTerminalSessionCommand(Number(activeTerminalTabId), suggestion.command)
        }
        await refreshActiveTerminalLogs(activeTerminalTabId)
        await refreshTerminalSessions()
      }

      if (target === 'new-tab') {
        const session = await createTerminalSession({
          name: `agent-${suggestion.provider}-${terminalSessions.length + 1}`,
          cwd: activeProjectPath || undefined,
          maxLogEntries: 400,
        })
        setTerminalSessions((current) => [...current, session])
        selectTerminalTab(String(session.sessionId))

        if (usesMockRuntime()) {
          await appendMockTerminalLine(
            session.sessionId,
            `[agent:${suggestion.provider}] ${suggestion.command}`,
          )
        } else {
          await executeTerminalSessionCommand(session.sessionId, suggestion.command)
        }
        await refreshActiveTerminalLogs(String(session.sessionId))
        await refreshTerminalSessions()
      }

      setAgentSuggestions((current) =>
        current.map((entry) =>
          entry.id === suggestion.id
            ? {
                ...entry,
                status: target === 'current-tab' ? 'approved-current-tab' : 'approved-new-tab',
              }
            : entry,
        ),
      )
      setActiveContext(
        target === 'current-tab'
          ? `Daily-use ${suggestion.providerLabel} approved in current tab`
          : `Daily-use ${suggestion.providerLabel} approved in new tab`,
      )
      recordTask(
        `${suggestion.providerLabel} suggestion approved`,
        `${suggestion.command} -> ${target}`,
        'done',
      )
    } catch (error) {
      setAgentRequestError(error instanceof Error ? error.message : String(error))
      recordTask(`${suggestion.providerLabel} approval failed`, String(error), 'error')
    }
  }

  const gitLabel = projectOverview?.git.isRepository
    ? `${projectOverview.git.branch ?? 'detached'} • ${
        projectOverview.git.isDirty ? 'Dirty' : 'Clean'
      }`
    : 'No Git repository detected'

  const activeSession = terminalSessions.find((session) => String(session.sessionId) === activeTerminalTabId)
  const requestContextSnapshot = buildLiveContextSnapshot()
  const providerRequestPreview = {
    project: projectOverview?.metadata.name ?? activeProject,
    terminal: requestContextSnapshot?.tabTitle ?? activeSession?.name ?? 'No active terminal',
    lines: requestContextSnapshot?.lines.length ?? 0,
  }
  const selectedConnection = agentConnections.find((connection) => connection.provider === selectedProvider)
  const diagnosticsByProvider = new Map(providerDiagnostics.map((entry) => [entry.provider, entry]))
  const selectedProviderSummary = selectedConnection
    ? `${selectedConnection.displayName} • ${formatProviderStatusLabel(selectedConnection.status)}`
    : 'No provider selected'
  const selectedProviderContract = selectedConnection ? buildProviderUiContract(selectedConnection) : null
  const telegramPendingCommands =
    telegramSnapshot?.remoteCommands.filter((entry) => entry.status === 'pending') ?? []
  const attachedLogCount = requestContextSnapshot?.lines.length ?? 0
  const canCaptureActiveLog = Boolean(activeSession && terminalLogs)
  const canSubmitAgentSuggestion =
    Boolean(selectedProviderContract?.canRequestSuggestion) && agentRequestInput.trim().length > 0
  const workspaceHeroTitle = activeProjectPath
    ? projectOverview?.metadata.name ?? activeProject
    : 'Open a project to start'
  const workspaceHeroDetail = activeProjectPath
    ? `${summarizePath(activeProjectPath)} • ${gitLabel}`
    : 'Choose a project, connect Codex, ask from the active terminal, then approve the next command.'

  return (
    <div className="app-shell">
      {panels.projects ? (
        <aside className="panel sidebar">
          <div className="panel-header">
            <span className="eyebrow">Projects</span>
            <button onClick={() => togglePanel('projects')}>Hide</button>
          </div>
          <div className="brand-lockup">
            <img className="brand-logo" src="/brand/gtum-logo.svg" alt="gtum" />
            <h1 className="visually-hidden">gtum</h1>
          </div>
          <p className="lead">
            Project-centric terminal workspace for agents, code, and live logs.
          </p>
          <div className="stack">
            <article className="card emphasis">
              <span className="label">Start</span>
              <strong>{activeProjectPath ? projectOverview?.metadata.name ?? activeProject : 'Open a project'}</strong>
              <p>
                {activeProjectPath
                  ? `${summarizePath(activeProjectPath)} is ready for terminal and agent work.`
                  : 'Use the folder picker to open a local project without pasting paths manually.'}
              </p>
              <div className="button-row">
                <button
                  data-testid="start-open-project-button"
                  onClick={() => void chooseProjectFolder()}
                  disabled={isProjectLoading}
                >
                  {isProjectLoading ? 'Opening...' : 'Open Folder'}
                </button>
              </div>
              {projectError ? <p className="error-text">{projectError}</p> : null}
              <details className="subtle-disclosure">
                <summary>Manual Path Fallback</summary>
                <div className="stack compact">
                  <label className="field-block">
                    <span className="label">Project Path</span>
                    <input
                      aria-label="Project Path"
                      value={projectPathInput}
                      onChange={(event) => setProjectPathInput(event.target.value)}
                      placeholder="/home/kwon/project/gtum"
                    />
                  </label>
                  <button onClick={() => void openProject(projectPathInput)} disabled={isProjectLoading}>
                    Open Project
                  </button>
                </div>
              </details>
            </article>
            <article className="card">
              <span className="label">Recent Projects</span>
              <div className="stack compact">
                {recentProjects.length > 0 ? (
                  recentProjects.map((project) => (
                    <button
                      key={project}
                      className="recent-project"
                      onClick={() => void openProject(project)}
                    >
                      {project}
                    </button>
                  ))
                ) : (
                  <p>No recent projects yet.</p>
                )}
              </div>
            </article>
            <article className="card">
              <span className="label">Repository</span>
              <strong>{projectOverview?.metadata.name ?? 'No project selected'}</strong>
              <p>{gitLabel}</p>
              <div className="meta-strip">
                <span className="pill soft">
                  {projectOverview?.metadata.exists ? 'Exists' : 'Missing'}
                </span>
                <span className="pill soft">
                  {projectOverview?.metadata.isDirectory ? 'Directory' : 'Unknown'}
                </span>
              </div>
            </article>
            <article className="card project-tree-card">
              <span className="label">File Tree</span>
              {projectOverview ? (
                <ul className="tree-list">
                  <TreeNode node={projectOverview.tree} />
                </ul>
              ) : (
                <p>Open a project to inspect its directory structure.</p>
              )}
            </article>
          </div>
        </aside>
      ) : (
        <button className="rail-button left" onClick={() => togglePanel('projects')}>
          Show Projects
        </button>
      )}

      <main className="workspace">
        <header className="workspace-topbar">
          <div className="workspace-title-group">
            <span className="eyebrow">Sprint 9 Workspace</span>
            <h2>{workspaceHeroTitle}</h2>
            <p className="workspace-subtitle">
              {workspaceHeroDetail}
            </p>
            <p className="support-note">Current focus: {activeContext}</p>
          </div>
          <div className="workspace-command-bar">
            <button
              className="accent-button"
              data-testid="workspace-open-project-button"
              onClick={() => void chooseProjectFolder()}
              disabled={isProjectLoading}
            >
              {isProjectLoading ? 'Opening...' : activeProjectPath ? 'Switch Project' : 'Open Folder'}
            </button>
            <button onClick={() => void createTab()} disabled={!activeProjectPath}>
              + New Tab
            </button>
            <button onClick={() => captureAgentContextFromActiveTab()} disabled={!canCaptureActiveLog}>
              {agentContext ? 'Refresh Pinned Log Snapshot' : 'Pin Active Log Snapshot'}
            </button>
          </div>
        </header>

        <section className="workspace-body">
          <section className="workspace-status-strip">
            <span className="pill">Project: {projectOverview?.metadata.name ?? 'none'}</span>
            <span className="pill">Tab: {activeSession?.name ?? 'none'}</span>
            <span className="pill">
              Terminal: {activeSession ? formatTerminalStatusLabel(activeSession.status) : 'Not Ready'}
            </span>
            <span className="pill">
              Provider: {selectedConnection ? selectedProviderSummary : 'Not Selected'}
            </span>
            <span className="pill">Mode: {formatModeLabel(executionMode)}</span>
            <span className={`pill ${attachedLogCount > 0 ? 'soft success' : 'soft'}`}>
              Log Context: {attachedLogCount > 0 ? `${attachedLogCount} line(s) ready` : 'Waiting for terminal output'}
            </span>
          </section>

          <div className="terminal-stage" data-testid="terminal-workspace">
            <div className="terminal-toolbar">
              <div className="terminal-tabs" role="tablist" aria-label="Terminal Tabs">
                {terminalSessions.length > 0 ? (
                  terminalSessions.map((session) => (
                    <div
                      key={session.sessionId}
                      className={`tab-shell ${
                        String(session.sessionId) === activeTerminalTabId ? 'active' : ''
                      }`}
                    >
                      <button
                        className={`tab ${
                          String(session.sessionId) === activeTerminalTabId ? 'active' : ''
                        }`}
                        role="tab"
                        aria-selected={String(session.sessionId) === activeTerminalTabId}
                        aria-controls={`terminal-panel-${session.sessionId}`}
                        onClick={() => selectTerminalTab(String(session.sessionId))}
                      >
                        {session.name}
                      </button>
                      <button
                        className="tab-action"
                        aria-label={`Close ${session.name}`}
                        onClick={() => void closeTab(session.sessionId)}
                      >
                        Close
                      </button>
                    </div>
                  ))
                ) : (
                  <span className="tab-empty">No terminal sessions yet.</span>
                )}
              </div>
              <div className="terminal-actions">
                <button onClick={() => void createTab()} disabled={!activeProjectPath}>+ New Tab</button>
                <button onClick={() => captureAgentContextFromActiveTab()} disabled={!canCaptureActiveLog}>
                  {agentContext ? 'Refresh Pinned Log' : 'Pin Active Log'}
                </button>
                {usesMockRuntime() ? (
                  <button onClick={() => void simulateMockActivity()}>Append Sample Log</button>
                ) : null}
              </div>
            </div>
            {activeSession ? (
              <div className="terminal-toolbar terminal-toolbar-secondary">
                <TerminalRenameField
                  key={activeSession.sessionId}
                  session={activeSession}
                  onRename={renameTab}
                />
              </div>
            ) : null}
            <div
              className="terminal-window"
              id={activeSession ? `terminal-panel-${activeSession.sessionId}` : undefined}
              role="tabpanel"
              aria-label={activeSession ? `${activeSession.name} logs` : 'Terminal logs'}
            >
              <div className="terminal-meta">
                <span>{activeSession ? activeSession.name : 'No active tab'}</span>
                <span>{activeSession ? formatTerminalStatusLabel(activeSession.status) : 'Idle'}</span>
                <span>{activeSession?.cwd ?? 'no cwd'}</span>
                <span>{attachedLogCount > 0 ? `${attachedLogCount} request line(s)` : 'request context pending'}</span>
              </div>
              <div className="terminal-line">$ sprint-9:workspace-redesign</div>
              {(terminalLogs?.entries || []).length > 0 ? (
                terminalLogs?.entries.map((line, index) => (
                  <div className="terminal-line" key={`${terminalLogs.sessionId}-${index}`}>
                    {line || ' '}
                  </div>
                ))
              ) : (
                <div className="terminal-line dim">
                  No recent lines yet. Interactive shell output will appear here.
                </div>
              )}
            </div>
          </div>

          <section className="workspace-flow-grid">
            <article className="card workspace-flow-card">
              <span className="label">Workspace Flow</span>
              <strong>Project / Terminal / Agent</strong>
              <div className="flow-steps">
                <div className={`flow-step ${activeProjectPath ? 'done' : 'current'}`}>
                  <span className="flow-step-index">1</span>
                  <div>
                    <strong>Project</strong>
                    <p>{activeProjectPath ? summarizePath(activeProjectPath) : 'Open a project folder first.'}</p>
                  </div>
                </div>
                <div
                  className={`flow-step ${
                    selectedProviderContract?.canRequestSuggestion ? 'done' : activeProjectPath ? 'current' : ''
                  }`}
                >
                  <span className="flow-step-index">2</span>
                  <div>
                    <strong>Codex</strong>
                    <p>
                      {selectedProviderContract?.canRequestSuggestion
                        ? `${selectedConnection?.displayName ?? 'Codex'} is connected for live suggestions.`
                        : 'Connect Codex to unlock the request and approval flow.'}
                    </p>
                  </div>
                </div>
                <div
                  className={`flow-step ${
                    attachedLogCount > 0 ? 'done' : selectedProviderContract?.canRequestSuggestion ? 'current' : ''
                  }`}
                >
                  <span className="flow-step-index">3</span>
                  <div>
                    <strong>Terminal + Context</strong>
                    <p>
                      {attachedLogCount > 0
                        ? `${attachedLogCount} active log line(s) will be sent from ${requestContextSnapshot?.tabTitle ?? activeSession?.name}.`
                        : activeSession
                          ? `${activeSession.name} is active. The latest output will auto-attach when logs appear.`
                          : 'Create or select a terminal tab to prepare active logs.'}
                    </p>
                  </div>
                </div>
                <div className={`flow-step ${agentSuggestions.length > 0 ? 'done' : canSubmitAgentSuggestion ? 'current' : ''}`}>
                  <span className="flow-step-index">4</span>
                  <div>
                    <strong>Approval</strong>
                    <p>
                      {agentSuggestions.length > 0
                        ? `${agentSuggestions.length} suggestion(s) ready for review.`
                        : 'Submit a provider-backed request from the right agent panel.'}
                    </p>
                  </div>
                </div>
              </div>
            </article>

            <article className="card workspace-flow-card" data-testid="active-log-buffer">
              <span className="label">Active Log Buffer</span>
              <strong>{requestContextSnapshot?.tabTitle ?? activeSession?.name ?? 'No Session'}</strong>
              <p>
                The next request will auto-attach the latest active terminal lines. Pinning keeps the exact slice visible.
              </p>
              <div className="context-block">
                {(requestContextSnapshot?.lines ?? []).map((line, index) => (
                  <code key={`active-log-${index}`}>{line}</code>
                ))}
                {(requestContextSnapshot?.lines ?? []).length === 0 ? (
                  <p>No active terminal lines yet. Run a command or pin the current log snapshot.</p>
                ) : null}
              </div>
            </article>
          </section>
          <section className="workspace-support">
            <details className="support-panel">
              <summary>Task History</summary>
              <article className="card" data-testid="task-history-panel">
                <span className="label">Task History</span>
                <strong>{taskHistory.length > 0 ? 'Recent Activity' : 'No Tasks Recorded Yet'}</strong>
                <div className="stack compact">
                  {taskHistory.length > 0 ? (
                    taskHistory.map((entry) => (
                      <div key={entry.id} className="history-entry">
                        <strong>{entry.title}</strong>
                        <p>{entry.detail}</p>
                        <p>
                          {entry.status} • {entry.createdAt}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p>Open a project or request an agent suggestion to start building history.</p>
                  )}
                </div>
              </article>
            </details>

            <details className="support-panel">
              <summary>Telegram</summary>
              <div className="support-grid">
                <article className="card telegram-card" data-testid="telegram-bridge-panel">
                  <span className="label">Telegram Bridge</span>
                  <strong>
                    {telegramSnapshot?.bridge.chatLabel ??
                      (telegramSnapshot?.bridge.status === 'connected' ? 'Telegram Connected' : 'Disconnected')}
                  </strong>
                  <p>
                    Queue status reports and remote commands through the same approval model used in
                    the app.
                  </p>
                  <div className="terminal-actions">
                    {telegramSnapshot?.bridge.status === 'connected' ? (
                      <button onClick={() => void disconnectTelegram()}>Disconnect Telegram</button>
                    ) : (
                      <button onClick={() => void startTelegramLink()}>Connect Telegram</button>
                    )}
                    {usesMockRuntime() && telegramSnapshot?.bridge.status === 'pending' ? (
                      <button onClick={() => void completeTelegramMockLink()}>Complete Telegram Mock Link</button>
                    ) : null}
                    <button
                      onClick={() => void sendTelegramStatusReport()}
                      disabled={telegramSnapshot?.bridge.status !== 'connected'}
                    >
                      Send Status Report
                    </button>
                  </div>
                  <p>
                    Status: {telegramSnapshot?.bridge.status ?? 'disconnected'} • allowed commands:{' '}
                    {telegramSnapshot?.bridge.allowedCommands.join(', ') ?? 'none'}
                  </p>
                  {telegramError ? <p className="error-text">{telegramError}</p> : null}
                  <details className="subtle-disclosure">
                    <summary>Diagnostics</summary>
                    {telegramSnapshot?.bridge.callbackUrl ? <code>{telegramSnapshot.bridge.callbackUrl}</code> : null}
                  </details>
                  <div className="stack compact telegram-list">
                    {(telegramSnapshot?.reports ?? []).slice(0, 2).map((report) => (
                      <div key={report.reportId} className="history-entry">
                        <strong>{report.title}</strong>
                        <p>{report.status}</p>
                        <p>{report.body}</p>
                      </div>
                    ))}
                  </div>
                </article>
                <article className="card telegram-card" data-testid="telegram-remote-commands-panel">
                  <span className="label">Telegram Remote Commands</span>
                  <strong>
                    {telegramPendingCommands.length > 0
                      ? `${telegramPendingCommands.length} pending approval`
                      : 'No pending remote commands'}
                  </strong>
                  <div className="terminal-actions">
                    <button
                      onClick={() => void queueTelegramCommand('status')}
                      disabled={telegramSnapshot?.bridge.status !== 'connected'}
                    >
                      Queue /status
                    </button>
                    <button
                      onClick={() => void queueTelegramCommand('rerun')}
                      disabled={telegramSnapshot?.bridge.status !== 'connected'}
                    >
                      Queue /rerun-tests
                    </button>
                    <button
                      onClick={() => void queueTelegramCommand('diff')}
                      disabled={telegramSnapshot?.bridge.status !== 'connected'}
                    >
                      Queue /git-diff
                    </button>
                  </div>
                  <div className="stack compact telegram-list">
                    {telegramPendingCommands.length > 0 ? (
                      telegramPendingCommands.map((remoteCommand) => (
                        <div key={remoteCommand.commandId} className="suggestion-card">
                          <strong>{remoteCommand.sourceLabel}</strong>
                          <p>{remoteCommand.summary}</p>
                          <code>{remoteCommand.command}</code>
                          <p>
                            suggested target: {remoteCommand.suggestedTarget} • status:{' '}
                            {remoteCommand.status}
                          </p>
                          <div className="terminal-actions">
                            <button
                              onClick={() => void approveTelegramCommand(remoteCommand, 'current-tab')}
                            >
                              Approve In Current Tab
                            </button>
                            <button onClick={() => void approveTelegramCommand(remoteCommand, 'new-tab')}>
                              Approve In New Tab
                            </button>
                            <button onClick={() => void rejectTelegramCommand(remoteCommand)}>Reject</button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p>Connect Telegram to queue a remote status or rerun command.</p>
                    )}
                  </div>
                </article>
                <article className="card telegram-card" data-testid="telegram-report-panel">
                  <span className="label">Telegram Draft</span>
                  <strong>Post-MVP Reporting Prototype</strong>
                  <p>
                    This panel drafts status reports for Telegram without touching the runtime bridge yet.
                  </p>
                  <div className="telegram-status-row">
                    <span className="pill soft">Status: {telegramReport.status}</span>
                    <span className="pill soft">
                      Last draft: {telegramReport.generatedAt ? telegramReport.generatedAt : 'not generated'}
                    </span>
                  </div>
                  <div className="terminal-actions">
                    <button onClick={() => draftTelegramReport()}>Generate Telegram Draft</button>
                    <button
                      onClick={() => queueTelegramReport()}
                      disabled={telegramReport.status === 'idle'}
                    >
                      Queue Telegram Draft
                    </button>
                  </div>
                  <div className="telegram-policy">
                    <span className="label">Command Policy Draft</span>
                    <p>
                      Only `status`, `summary`, and `report`-style commands should be allowed through the
                      future Telegram bridge.
                    </p>
                    <ul>
                      <li>Read-only task and workspace summaries only.</li>
                      <li>Any destructive action still requires in-app approval.</li>
                      <li>Queueing the draft does not send a real Telegram message yet.</li>
                    </ul>
                  </div>
                  <div className="telegram-preview" data-testid="telegram-report-preview">
                    {telegramReport.preview ? (
                      <pre>{telegramReport.preview}</pre>
                    ) : (
                      <p>Generate a draft to inspect the Telegram-ready summary.</p>
                    )}
                  </div>
                  {telegramReport.queuedAt ? (
                    <p className="provider-selection-note">Queued at {telegramReport.queuedAt}</p>
                  ) : null}
                </article>
              </div>
            </details>

            <details className="support-panel">
              <summary>Runtime / Debug</summary>
              <article className="card">
                <span className="label">Runtime Probe</span>
                <strong>{runtimeInfo ? 'Connected' : 'Fallback Mode'}</strong>
                <p>
                  {runtimeInfo
                    ? `${runtimeInfo.app_name} • ${runtimeInfo.platform} • ${runtimeInfo.mode}`
                    : 'Runtime handshake pending or unavailable in browser-only mode.'}
                </p>
                <p className="support-note">
                  Diagnostics and callback details stay here so they do not compete with the main workflow.
                </p>
              </article>
            </details>
          </section>
          {terminalError ? <p className="error-text terminal-error">{terminalError}</p> : null}
        </section>
      </main>

      {panels.agents ? (
        <aside className="panel inspector">
          <div className="panel-header">
            <span className="eyebrow">Agent Panel</span>
            <button onClick={() => togglePanel('agents')}>Hide</button>
          </div>
          <div className="stack agent-panel-stack">
            <article className="card agent-stage-card" data-testid="provider-auth-panel">
              <span className="label">Step 1 · Provider</span>
              <strong>{selectedConnection ? selectedProviderContract?.statusLabel : 'No provider selected'}</strong>
              <p>
                {selectedConnection
                  ? selectedProviderContract?.guidance
                  : 'Choose a provider, then use the matching contract state to unlock the request flow.'}
              </p>
              <div className="provider-selector" role="radiogroup" aria-label="Provider Selection">
                {agentConnections.map((connection) => (
                  <label key={`selector-${connection.provider}`} className="provider-selector-option">
                    <input
                      type="radio"
                      name="provider-selection"
                      checked={selectedProvider === connection.provider}
                      onChange={() => setSelectedProvider(connection.provider)}
                    />
                    <span>{connection.displayName}</span>
                  </label>
                ))}
              </div>
              <div className="stack compact">
                {agentConnections.map((connection) => {
                  const contract = buildProviderUiContract(connection)
                  const diagnostics = diagnosticsByProvider.get(connection.provider)
                  const displayedSetupState =
                    diagnostics && connection.connectionKind === 'real' && connection.status === 'error'
                      ? 'needs_setup'
                      : diagnostics?.setupState

                  return (
                    <div
                      key={connection.provider}
                      className={`provider-card ${selectedProvider === connection.provider ? 'selected' : ''}`}
                      data-testid={`provider-card-${connection.provider}`}
                    >
                      <div className="provider-card-header">
                        <strong>{connection.displayName}</strong>
                        <div className="status-pill-row">
                          <span className={`status-badge kind-${connection.connectionKind}`}>
                            {formatProviderUxKindLabel(connection.connectionKind)}
                          </span>
                          <span className={`status-badge state-${connection.status}`}>
                            {formatProviderStatusLabel(connection.status)}
                          </span>
                        </div>
                      </div>
                      <p>{connection.accountLabel ? `${connection.accountLabel} is ready for requests.` : contract.guidance}</p>
                      <div className="terminal-actions">
                        {contract.canDisconnect ? (
                          <button
                            data-testid={`provider-action-${connection.provider}`}
                            onClick={() => void disconnectProvider(connection.provider)}
                          >
                            {contract.primaryActionLabel}
                          </button>
                        ) : (
                          <button
                            data-testid={`provider-action-${connection.provider}`}
                            onClick={() => void startProviderLogin(connection.provider)}
                            disabled={!contract.canStartLogin}
                          >
                            {contract.primaryActionLabel}
                          </button>
                        )}
                        {connection.provider === 'codex' && connection.connectionKind !== 'mock' && !contract.canDisconnect ? (
                          <button onClick={() => void openCodexLogin()}>Open Codex Login</button>
                        ) : null}
                        {contract.canCompleteMock ? (
                          <button onClick={() => void simulateMockCallback(connection.provider)}>
                            Complete Mock Callback
                          </button>
                        ) : null}
                      </div>
                      <div className="status-pill-row">
                        <span className="status-badge scopes">
                          scopes: {connection.requiredScopes.length > 0 ? connection.requiredScopes.join(', ') : 'none'}
                        </span>
                      </div>
                      {selectedProvider === connection.provider ? (
                        <p className="provider-selection-note">Selected provider for the next request.</p>
                      ) : null}
                      <details
                        className="subtle-disclosure"
                        data-testid={`provider-diagnostics-${connection.provider}`}
                      >
                        <summary>Diagnostics</summary>
                        {diagnostics ? (
                          <div className="stack compact">
                            <p>{diagnostics.summary}</p>
                            <p>{diagnostics.guidance}</p>
                            <div className="status-pill-row">
                              <span
                                className={`status-badge state-${formatProviderSetupStateBadgeClass(
                                  displayedSetupState ?? diagnostics.setupState,
                                )}`}
                              >
                                {formatProviderSetupStateLabel(displayedSetupState ?? diagnostics.setupState)}
                              </span>
                              <span className="status-badge scopes">{diagnostics.connectionPath}</span>
                            </div>
                            {diagnostics.model ? <code>model: {diagnostics.model}</code> : null}
                            {diagnostics.baseUrl ? <code>base URL: {diagnostics.baseUrl}</code> : null}
                            {diagnostics.requirements.map((requirement) => (
                              <p key={`${connection.provider}-${requirement.name}`}>
                                {requirement.required ? 'required' : 'optional'} check • {requirement.name} •{' '}
                                {requirement.present ? 'present' : 'missing'}
                              </p>
                            ))}
                          </div>
                        ) : (
                          <p>Provider diagnostics are not available yet.</p>
                        )}
                        {connection.callbackUrl ? <code>{connection.callbackUrl}</code> : null}
                        {connection.authUrl ? <code>{connection.authUrl}</code> : null}
                      </details>
                      {connection.lastError ? <p className="error-text">{connection.lastError}</p> : null}
                    </div>
                  )
                })}
                {authError ? <p className="error-text">{authError}</p> : null}
              </div>
            </article>

            <article className="card agent-stage-card">
              <span className="label">Step 2 · Context</span>
              <strong>{requestContextSnapshot ? requestContextSnapshot.tabTitle : 'No Active Logs Yet'}</strong>
              <p>
                The request uses the active terminal by default and keeps the latest 50 lines ready for Codex.
              </p>
              {requestContextSnapshot ? (
                <div className="context-block" data-testid="agent-context-buffer">
                  <span className="context-meta">{requestContextSnapshot.capturedAt}</span>
                  {requestContextSnapshot.lines.map((line, index) => (
                    <code key={`${requestContextSnapshot.tabId}-${index}`}>{line}</code>
                  ))}
                </div>
              ) : (
                <div className="context-block" data-testid="agent-context-buffer">
                  <p>Once the active terminal has output, gtum will auto-attach the latest 50 lines for the next request.</p>
                </div>
              )}
            </article>

            <article className="card agent-stage-card" data-testid="provider-request-preview">
              <span className="label">Step 3 · Request Contract</span>
              <strong>{providerRequestPreview.project}</strong>
              <p>{providerRequestPreview.terminal}</p>
              <p>{providerRequestPreview.lines} active log line(s) prepared for the provider request.</p>
            </article>

            <article className="card agent-stage-card" data-testid="execution-mode-panel">
              <span className="label">Execution Mode</span>
              <strong>{formatModeLabel(executionMode)}</strong>
              <div className="provider-selector" role="radiogroup" aria-label="Execution Mode">
                {(['fast', 'balanced', 'deep'] as ExecutionMode[]).map((mode) => (
                  <label key={mode} className="provider-selector-option">
                    <input
                      type="radio"
                      name="execution-mode"
                      checked={executionMode === mode}
                      onChange={() => {
                        setExecutionMode(mode)
                        setActiveContext(`Sprint 5 ${formatModeLabel(mode)} mode selected`)
                      }}
                    />
                    <span>{formatModeLabel(mode)}</span>
                  </label>
                ))}
              </div>
              <p>
                {executionMode === 'fast'
                  ? 'Ask quickly with a shorter, lighter review path.'
                  : executionMode === 'balanced'
                    ? 'Use the default review path with the active terminal context.'
                  : 'Use the fullest review path before approving the next command.'}
              </p>
            </article>

            <article className="card agent-stage-card" data-testid="agent-request-panel">
              <span className="label">Step 4 · Request</span>
              <strong>{selectedConnection?.displayName ?? 'No Provider Selected'}</strong>
              <p>Submit a task request using the selected provider, project metadata, and the latest active terminal logs.</p>
              <label className="field-block">
                <span className="label">Task Request</span>
                <textarea
                  aria-label="Task Request"
                  className="request-textarea"
                  value={agentRequestInput}
                  onChange={(event) => setAgentRequestInput(event.target.value)}
                  placeholder="Analyze the failing test logs and suggest the next command."
                />
              </label>
              <div className="terminal-actions">
                <button onClick={() => void submitAgentRequest()} disabled={!canSubmitAgentSuggestion}>
                  {selectedProvider === 'codex' ? 'Ask Codex' : 'Request Suggestion'}
                </button>
              </div>
              {!selectedProviderContract?.canRequestSuggestion ? (
                <p className="provider-selection-note">
                  Connect Codex after the desktop Codex CLI session is ready, then use the validated request flow.
                </p>
              ) : null}
              {agentRequestError ? <p className="error-text">{agentRequestError}</p> : null}
            </article>

            <article className="card agent-stage-card" data-testid="agent-suggestions-panel">
              <span className="label">Step 5 · Review And Approve</span>
              <strong>{agentSuggestions.length > 0 ? 'Pending Review' : 'No Suggestions Yet'}</strong>
              <div className="stack compact">
                {agentSuggestions.length > 0 ? (
                  agentSuggestions.map((suggestion) => (
                    <div
                      key={suggestion.id}
                      className="suggestion-card"
                      data-testid={`suggestion-card-${suggestion.provider}`}
                    >
                      <strong>{suggestion.providerLabel}</strong>
                      <p>{suggestion.summary}</p>
                      {suggestion.command ? <code>{suggestion.command}</code> : null}
                      <p>
                        {suggestion.projectLabel} • {suggestion.terminalLabel} •{' '}
                        {suggestion.attachedLogLines} log line(s)
                      </p>
                      <p>Status: {suggestion.status} • confidence: {suggestion.confidence}</p>
                      {suggestion.error ? <p className="error-text">{suggestion.error}</p> : null}
                      <div className="terminal-actions">
                        <button
                          onClick={() => void approveSuggestion(suggestion, 'current-tab')}
                          disabled={suggestion.status !== 'pending' || !suggestion.command || Boolean(suggestion.error)}
                        >
                          Approve In Current Tab
                        </button>
                        <button
                          onClick={() => void approveSuggestion(suggestion, 'new-tab')}
                          disabled={suggestion.status !== 'pending' || !suggestion.command || Boolean(suggestion.error)}
                        >
                          Approve In New Tab
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p>Connect Codex and submit a task request to generate the next CLI-backed command suggestion.</p>
                )}
              </div>
            </article>
          </div>
        </aside>
      ) : (
        <button className="rail-button right" onClick={() => togglePanel('agents')}>
          Show Agents
        </button>
      )}
    </div>
  )
}

export default App
