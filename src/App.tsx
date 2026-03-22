import { useCallback, useEffect, useState } from 'react'
import './App.css'
import { type AgentContextSnapshot, useWorkspaceStore } from './stores/workspace-store'
import {
  beginAgentLogin,
  completeAgentLogin,
  disconnectAgentProvider,
  type AgentConnectionSnapshot,
  type AgentProviderId,
  appendMockTerminalLine,
  createTerminalSession,
  executeTerminalSessionCommand,
  type FileTreeNode,
  type ProjectOverview,
  readProjectOverview,
  readTerminalSessionLogs,
  type RuntimeInfo,
  getRuntimeInfo,
  listAgentConnections,
  listTerminalSessions,
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
  const [selectedProvider, setSelectedProvider] = useState<AgentProviderId>('codex')
  const [agentRequestInput, setAgentRequestInput] = useState('')
  const [agentRequestError, setAgentRequestError] = useState<string | null>(null)
  const [agentSuggestions, setAgentSuggestions] = useState<AgentSuggestion[]>([])

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

  useEffect(() => {
    getRuntimeInfo()
      .then(setRuntimeInfo)
      .catch(() => {
        setRuntimeInfo(null)
      })

    void refreshTerminalSessions()
    void refreshAgentConnections()
  }, [refreshAgentConnections, refreshTerminalSessions])

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

  const ensureWorkspaceTerminal = async (cwd: string) => {
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
  }

  const openProject = async (path: string) => {
    const trimmedPath = path.trim()

    if (!trimmedPath) {
      setProjectError('Enter a local project path to load.')
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
      setActiveContext('Sprint 2 Terminal Workspace')
      rememberProject(overview.metadata.path)
      await ensureWorkspaceTerminal(overview.metadata.path)
    } catch (error) {
      setProjectOverview(null)
      setProjectError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsProjectLoading(false)
    }
  }

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
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error))
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
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error))
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
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error))
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

  const buildAgentSuggestion = (provider: AgentConnectionSnapshot, request: string): AgentSuggestion => {
    const normalizedRequest = request.trim()
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
      attachedLogLines: agentContext?.lines.length ?? 0,
      status: 'pending',
    }
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
    } catch (error) {
      setAgentRequestError(error instanceof Error ? error.message : String(error))
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
            <label className="field-block">
              <span className="label">Project Path</span>
              <input
                aria-label="Project Path"
                value={projectPathInput}
                onChange={(event) => setProjectPathInput(event.target.value)}
                placeholder="/home/kwon/project/gtum"
              />
            </label>
            <button onClick={() => void openProject(projectPathInput)}>
              {isProjectLoading ? 'Opening...' : 'Open Project'}
            </button>
            {projectError ? <p className="error-text">{projectError}</p> : null}
          </div>
          <div className="stack">
            <article className="card">
              <span className="label">Active Project</span>
              <strong>{activeProject}</strong>
              <p>{activeProjectPath || 'Open a local path to inspect repository context.'}</p>
            </article>
            <article className="card">
              <span className="label">Sprint Focus</span>
              <strong>{activeContext}</strong>
              <p>Agent request input, suggestion approval, and provider-backed execution routing.</p>
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
          </div>
        </aside>
      ) : (
        <button className="rail-button left" onClick={() => togglePanel('projects')}>
          Show Projects
        </button>
      )}

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <span className="eyebrow">Workspace</span>
            <h2>Terminal workspace with active log context</h2>
          </div>
          <div className="pill-row">
            <span className="pill">Sprint 4</span>
            <span className="pill">Agent Request</span>
            <span className="pill">Approval Flow</span>
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

          <section className="status-grid">
            <article className="card emphasis">
              <span className="label">Project</span>
              <strong>{projectOverview?.metadata.name ?? 'Awaiting Selection'}</strong>
              <p>
                {projectOverview?.metadata.path ??
                  'Pick a local project path to populate terminal working directories.'}
              </p>
            </article>
            <article className="card">
              <span className="label">Git</span>
              <strong>{gitLabel}</strong>
              <p>
                {projectOverview?.git.isRepository
                  ? `${projectOverview.git.changedFilesCount} changed file(s) • ${
                      projectOverview.git.branchType ?? 'other'
                    } branch type`
                  : 'Branch and dirty state will appear for Git repositories.'}
              </p>
            </article>
            <article className="card">
              <span className="label">Active Terminal</span>
              <strong>{activeSession ? activeSession.name : 'No Session'}</strong>
              <p>
                {activeSession
                  ? `${activeSession.logLineCount} line(s) captured • ${activeSession.status}`
                  : 'Create a terminal to start live log capture.'}
              </p>
            </article>
            <article className="card">
              <span className="label">Suggestions</span>
              <strong>{agentSuggestions.length}</strong>
              <p>
                {selectedConnection
                  ? `${selectedConnection.displayName} is ${selectedConnection.status}.`
                  : 'Select a provider to start an agent request.'}
              </p>
            </article>
          </section>

          <section className="project-grid">
            <article className="card project-card">
              <span className="label">Project Metadata</span>
              <strong>{projectOverview?.metadata.name ?? 'No project selected'}</strong>
              <p>{projectOverview?.metadata.path ?? 'Open a project to continue.'}</p>
              <div className="meta-strip">
                <span className="pill soft">
                  {projectOverview?.metadata.exists ? 'Exists' : 'Missing'}
                </span>
                <span className="pill soft">
                  {projectOverview?.metadata.isDirectory ? 'Directory' : 'Unknown'}
                </span>
                <span className="pill soft">
                  {projectOverview ? `${projectOverview.tree.children.length} root entries` : '0 entries'}
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

            <article className="card project-card">
              <span className="label">File Tree</span>
              {projectOverview ? (
                <ul className="tree-list">
                  <TreeNode node={projectOverview.tree} />
                </ul>
              ) : (
                <p>Load a project to inspect its directory structure.</p>
              )}
            </article>
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
              <p>Tracking Sprint 4 request input, suggestion cards, and approval targets.</p>
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
              <strong>Login Foundation</strong>
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
                    <div>
                      <strong>{connection.displayName}</strong>
                      <p>
                        {connection.status}
                        {connection.accountLabel ? ` • ${connection.accountLabel}` : ''}
                      </p>
                    </div>
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
                    <p>
                      scopes: {connection.scopes.length > 0 ? connection.scopes.join(', ') : 'none'}
                    </p>
                    {selectedProvider === connection.provider ? (
                      <p className="provider-selection-note">Selected provider for the next auth action.</p>
                    ) : null}
                    {connection.callbackUrl ? <code>{connection.callbackUrl}</code> : null}
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
            <article className="card">
              <span className="label">Runtime Probe</span>
              <strong>{runtimeInfo ? 'Connected' : 'Fallback Mode'}</strong>
              <p>
                {runtimeInfo
                  ? `${runtimeInfo.app_name} • ${runtimeInfo.platform} • ${runtimeInfo.mode}`
                  : 'Runtime handshake pending or unavailable in browser-only mode.'}
              </p>
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
