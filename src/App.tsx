import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { type AgentContextSnapshot, useWorkspaceStore } from './stores/workspace-store'
import {
  beginAgentLogin,
  completeAgentLogin,
  disconnectAgentProvider,
  type AgentConnectionSnapshot,
  type AgentProviderId,
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
  readTelegramRuntimeSnapshot,
  readTerminalSessionLogs,
  type RuntimeInfo,
  getRuntimeInfo,
  listAgentConnections,
  listTerminalSessions,
  queueTelegramRemoteCommand,
  resolveTelegramRemoteCommand,
  selectProjectFolder,
  type TelegramRemoteCommandSnapshot,
  type TelegramRuntimeSnapshot,
  type TerminalSessionLogs,
  type TerminalSessionSnapshot,
  renameTerminalSession,
  closeTerminalSession,
  usesMockRuntime,
} from './lib/runtime'

type AgentSuggestionTarget = 'current-tab' | 'new-tab'

type AgentSuggestion = {
  id: string
  provider: AgentProviderId
  providerLabel: string
  request: string
  summary: string
  command: string
  projectLabel: string
  terminalLabel: string
  attachedLogLines: number
  status: 'pending' | 'approved-current-tab' | 'approved-new-tab'
}

type ExecutionMode = 'fast' | 'balanced' | 'deep'

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

type ProviderUxKind = 'mock' | 'prototype' | 'real'

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
      ? 'Needs Approval'
      : status === 'error'
        ? 'Attention Needed'
        : 'Needs Login'

const resolveProviderUxKind = (connection: AgentConnectionSnapshot): ProviderUxKind => {
  if (usesMockRuntime()) {
    return 'mock'
  }

  const authSignals = `${connection.authUrl ?? ''} ${connection.callbackUrl ?? ''}`

  if (
    authSignals.includes('mock.gtum.local') ||
    authSignals.includes('auth.gtum.local') ||
    authSignals.includes('gtum://auth/callback') ||
    authSignals.includes('gtum://resolved/')
  ) {
    return 'prototype'
  }

  return 'real'
}

const formatProviderUxKindLabel = (kind: ProviderUxKind) =>
  kind === 'mock' ? 'Mock' : kind === 'prototype' ? 'Prototype' : 'Real'

const formatProviderHint = (connection: AgentConnectionSnapshot, kind: ProviderUxKind) => {
  if (connection.lastError) {
    return connection.lastError
  }

  if (connection.status === 'connected') {
    return kind === 'real'
      ? 'Official provider session is connected.'
      : `${formatProviderUxKindLabel(kind)} provider session is connected for workspace testing.`
  }

  if (connection.status === 'pending') {
    return kind === 'mock'
      ? 'Mock callback is ready for the next auth step.'
      : 'Desktop callback flow is ready for the next auth step.'
  }

  return kind === 'real'
    ? 'Connect this provider to request live agent suggestions.'
    : `${formatProviderUxKindLabel(kind)} provider flow is available for testing before real integration.`
}

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
    void refreshTelegramState()
  }, [refreshAgentConnections, refreshTelegramState, refreshTerminalSessions])

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
  }, [refreshAgentConnections])

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
      lines: terminalLogs.entries.slice(-8),
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
      setSelectedProvider(provider)
      setActiveContext(`Sprint 4 ${snapshot.displayName} login started`)
      recordTask(
        `${snapshot.displayName} login started`,
        `Requested scopes: ${snapshot.scopes.join(', ') || 'none'}`,
        'pending',
      )
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error))
      recordTask(`${provider} login failed`, String(error), 'error')
    }
  }

  const disconnectProvider = async (provider: AgentProviderId) => {
    try {
      setAuthError(null)
      const snapshot = await disconnectAgentProvider(provider)
      setAgentConnections((current) =>
        current.map((entry) => (entry.provider === snapshot.provider ? snapshot : entry)),
      )
      setActiveContext(`Sprint 4 ${snapshot.displayName} disconnected`)
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

  const buildAgentSuggestion = (provider: AgentConnectionSnapshot, request: string): AgentSuggestion => {
    const normalizedRequest = request.trim()
    const attachedLogLines =
      executionMode === 'fast' ? Math.min(agentContext?.lines.length ?? 0, 4) : agentContext?.lines.length ?? 0
    const commandBase =
      normalizedRequest.toLowerCase().includes('test')
        ? 'npm run test -- --runInBand'
        : normalizedRequest.toLowerCase().includes('lint')
          ? 'npm run lint'
          : 'npm run build'

    return {
      id: `suggestion-${Date.now()}`,
      provider: provider.provider,
      providerLabel: provider.displayName,
      request: normalizedRequest,
      summary: `${provider.displayName} suggests running "${commandBase}" for "${normalizedRequest}".`,
      command: commandBase,
      projectLabel: projectOverview?.metadata.name ?? activeProject,
      terminalLabel: agentContext?.tabTitle ?? activeSession?.name ?? 'workspace',
      attachedLogLines,
      status: 'pending',
    }
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

  const submitAgentRequest = () => {
    const normalizedRequest = agentRequestInput.trim()
    const connectedProvider = agentConnections.find(
      (connection) => connection.provider === selectedProvider && connection.status === 'connected',
    )

    if (!normalizedRequest) {
      setAgentRequestError('Enter an agent request before asking for suggestions.')
      return
    }

    if (!connectedProvider) {
      setAgentRequestError('Connect the selected provider before requesting agent suggestions.')
      return
    }

    setAgentRequestError(null)
    const suggestion = buildAgentSuggestion(connectedProvider, normalizedRequest)
    setAgentSuggestions((current) => [suggestion, ...current].slice(0, 6))
    setActiveContext(`Sprint 4 ${connectedProvider.displayName} suggestion ready`)
    recordTask(
      `${connectedProvider.displayName} suggestion requested`,
      `${normalizedRequest} • mode ${formatModeLabel(executionMode)}`,
      'done',
    )
  }

  const approveSuggestion = async (suggestion: AgentSuggestion, target: AgentSuggestionTarget) => {
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
          ? `Sprint 4 ${suggestion.providerLabel} approved in current tab`
          : `Sprint 4 ${suggestion.providerLabel} approved in new tab`,
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
  const providerRequestPreview = {
    project: projectOverview?.metadata.name ?? activeProject,
    terminal: agentContext?.tabTitle ?? activeSession?.name ?? 'No active terminal',
    lines: agentContext?.lines.length ?? 0,
  }
  const selectedConnection = agentConnections.find((connection) => connection.provider === selectedProvider)
  const selectedProviderKind = selectedConnection ? resolveProviderUxKind(selectedConnection) : null
  const selectedProviderSummary = selectedConnection
    ? `${selectedConnection.displayName} • ${formatProviderStatusLabel(selectedConnection.status)}`
    : 'No provider selected'
  const telegramPendingCommands =
    telegramSnapshot?.remoteCommands.filter((entry) => entry.status === 'pending') ?? []

  return (
    <div className="app-shell">
      {panels.projects ? (
        <aside className="panel sidebar">
          <div className="panel-header">
            <span className="eyebrow">Projects</span>
            <button onClick={() => togglePanel('projects')}>Hide</button>
          </div>
          <h1>gtum</h1>
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
                <button onClick={() => void chooseProjectFolder()} disabled={isProjectLoading}>
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
            <span className="eyebrow">Workspace</span>
            <h2>Project, terminal, and agent workflow</h2>
            <p className="workspace-subtitle">
              Open a project, work in the active terminal, then request and approve agent suggestions.
            </p>
            <p className="support-note">Current focus: {activeContext}</p>
          </div>
          <div className="pill-row">
            <span className="pill">Project: {projectOverview?.metadata.name ?? 'none'}</span>
            <span className="pill">Active Tab: {activeSession?.name ?? 'none'}</span>
            <span className="pill">
              Provider: {selectedConnection ? selectedProviderSummary : 'not selected'}
            </span>
            <span className="pill">Mode: {formatModeLabel(executionMode)}</span>
          </div>
        </header>

        <section className="workspace-body">
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
                <button onClick={() => void createTab()}>+ New Tab</button>
                <button onClick={() => captureAgentContextFromActiveTab()}>
                  Use Active Log As Agent Context
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
              <div className="terminal-line">$ sprint-2:terminal-workspace</div>
              <div className="terminal-line dim">
                {activeSession
                  ? `${activeSession.name} • ${activeSession.status} • ${
                      activeSession.cwd ?? 'no cwd'
                    }`
                  : 'Create or select a terminal tab to inspect live logs.'}
              </div>
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

          <section className="workspace-summary-grid">
            <article className="card project-card">
              <span className="label">Project Summary</span>
              <strong>{projectOverview?.metadata.name ?? 'No project selected'}</strong>
              <p>{projectOverview?.metadata.path ?? 'Open a project to continue.'}</p>
              <div className="meta-strip">
                <span className="pill soft">
                  {projectOverview?.git.isRepository ? gitLabel : 'No Git repository detected'}
                </span>
                <span className="pill soft">
                  {activeSession
                    ? `${activeSession.logLineCount} line(s) • ${activeSession.status}`
                    : 'Create a terminal to start live log capture.'}
                </span>
                <span className="pill soft">
                  {selectedConnection
                    ? selectedProviderSummary
                    : 'Select a provider to start an agent request.'}
                </span>
              </div>
            </article>

            <article className="card project-card">
              <span className="label">Active Log Buffer</span>
              <strong>{activeSession ? activeSession.name : 'No Session'}</strong>
              <p>Recent lines from the selected terminal tab are ready for agent handoff.</p>
              <div className="context-block" data-testid="active-log-buffer">
                {(terminalLogs?.entries || []).slice(-8).map((line, index) => (
                  <code key={`active-log-${index}`}>{line}</code>
                ))}
              </div>
            </article>
          </section>
          <section className="workspace-support">
            <details className="support-panel" open>
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
            <span className="eyebrow">Agents</span>
            <button onClick={() => togglePanel('agents')}>Hide</button>
          </div>
          <div className="stack">
            <article className="card">
              <span className="label">Orchestrator</span>
              <strong>Active</strong>
              <p>Tracking Sprint 7 workspace flow, auth clarity, and approval-based execution.</p>
            </article>
            <article className="card">
              <span className="label">Agent Context</span>
              <strong>{agentContext ? agentContext.tabTitle : 'No Captured Logs'}</strong>
              {agentContext ? (
                <div className="context-block" data-testid="agent-context-buffer">
                  <span className="context-meta">{agentContext.capturedAt}</span>
                  {agentContext.lines.map((line, index) => (
                    <code key={`${agentContext.tabId}-${index}`}>{line}</code>
                  ))}
                </div>
              ) : (
                <div className="context-block" data-testid="agent-context-buffer">
                  <p>Capture active terminal logs to hand the latest output to an agent.</p>
                </div>
              )}
            </article>
            <article className="card" data-testid="provider-auth-panel">
              <span className="label">Providers</span>
              <strong>
                {selectedConnection
                  ? `${selectedConnection.displayName} • ${formatProviderUxKindLabel(selectedProviderKind ?? 'prototype')}`
                  : 'Select a provider'}
              </strong>
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
                {agentConnections.map((connection) => (
                  <div
                    key={connection.provider}
                    className={`provider-card ${selectedProvider === connection.provider ? 'selected' : ''}`}
                    data-testid={`provider-card-${connection.provider}`}
                  >
                    <div className="provider-card-header">
                      <strong>{connection.displayName}</strong>
                      <div className="status-pill-row">
                        <span className={`status-badge kind-${resolveProviderUxKind(connection)}`}>
                          {formatProviderUxKindLabel(resolveProviderUxKind(connection))}
                        </span>
                        <span className={`status-badge state-${connection.status}`}>
                          {formatProviderStatusLabel(connection.status)}
                        </span>
                      </div>
                    </div>
                    <p>
                      {connection.accountLabel
                        ? `${connection.accountLabel} is ready for the next request.`
                        : formatProviderHint(connection, resolveProviderUxKind(connection))}
                    </p>
                    <div className="terminal-actions">
                      {connection.status === 'connected' ? (
                        <button onClick={() => void disconnectProvider(connection.provider)}>
                          Disconnect {connection.displayName}
                        </button>
                      ) : (
                        <button onClick={() => void startProviderLogin(connection.provider)}>
                          Connect {connection.displayName}
                        </button>
                      )}
                      {usesMockRuntime() && connection.status === 'pending' ? (
                        <button onClick={() => void simulateMockCallback(connection.provider)}>
                          Complete Mock Callback
                        </button>
                        ) : null}
                    </div>
                    <div className="status-pill-row">
                      <span className="status-badge scopes">
                        scopes: {connection.scopes.length > 0 ? connection.scopes.join(', ') : 'none'}
                      </span>
                    </div>
                    {selectedProvider === connection.provider ? (
                      <p className="provider-selection-note">Selected provider for the next auth action.</p>
                    ) : null}
                    <details className="subtle-disclosure">
                      <summary>Diagnostics</summary>
                      {connection.callbackUrl ? <code>{connection.callbackUrl}</code> : null}
                      {connection.authUrl ? <code>{connection.authUrl}</code> : null}
                    </details>
                    {connection.lastError ? <p className="error-text">{connection.lastError}</p> : null}
                  </div>
                ))}
                {authError ? <p className="error-text">{authError}</p> : null}
              </div>
            </article>
            <article className="card" data-testid="provider-request-preview">
              <span className="label">Request Contract Preview</span>
              <strong>{providerRequestPreview.project}</strong>
              <p>{providerRequestPreview.terminal}</p>
              <p>{providerRequestPreview.lines} captured line(s) prepared for provider requests.</p>
            </article>
            <article className="card" data-testid="execution-mode-panel">
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
                  ? 'Attach a compact active-log slice for quick suggestions.'
                  : executionMode === 'balanced'
                    ? 'Use the default active-log slice for normal review.'
                  : 'Keep the fullest active-log context for deeper review.'}
              </p>
            </article>
            <article className="card" data-testid="agent-request-panel">
              <span className="label">Agent Request</span>
              <strong>{selectedConnection?.displayName ?? 'No Provider Selected'}</strong>
              <p>Submit a task request using the selected provider, project metadata, and active log buffer.</p>
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
                <button onClick={() => submitAgentRequest()}>Request Suggestion</button>
              </div>
              {agentRequestError ? <p className="error-text">{agentRequestError}</p> : null}
            </article>
            <article className="card" data-testid="agent-suggestions-panel">
              <span className="label">Suggestion Cards</span>
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
                      <code>{suggestion.command}</code>
                      <p>
                        {suggestion.projectLabel} • {suggestion.terminalLabel} •{' '}
                        {suggestion.attachedLogLines} log line(s)
                      </p>
                      <p>Status: {suggestion.status}</p>
                      <div className="terminal-actions">
                        <button
                          onClick={() => void approveSuggestion(suggestion, 'current-tab')}
                          disabled={suggestion.status !== 'pending'}
                        >
                          Approve In Current Tab
                        </button>
                        <button
                          onClick={() => void approveSuggestion(suggestion, 'new-tab')}
                          disabled={suggestion.status !== 'pending'}
                        >
                          Approve In New Tab
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p>Connect a provider and submit a task request to generate mock suggestions.</p>
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
