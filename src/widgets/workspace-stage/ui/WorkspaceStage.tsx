import { useEffect, useRef } from 'react'
import type {
  ExecutionMode,
  ProjectFileSnapshot,
  ProjectOverview,
  RuntimeInfo,
  TelegramRemoteCommandSnapshot,
  TelegramRuntimeSnapshot,
  TerminalSessionLogs,
  TerminalSessionSnapshot,
} from '../../../lib/runtime'
import { usesMockRuntime } from '../../../lib/runtime'
import type { AgentContextSnapshot } from '../../../stores/workspace-store'
import type { TaskHistoryEntry } from '../../../features/tasks/model/types'
import type { TelegramReportState } from '../../../features/telegram/model/types'
import {
  extractLineReference,
  formatFileSizeLabel,
} from '../../../shared/lib/file-context'
import {
  formatModeLabel,
  formatTerminalStatusLabel,
  summarizePath,
} from '../../../shared/lib/formatters'
import { TerminalRenameField } from '../../../shared/ui/TerminalRenameField'

type WorkspaceStageProps = {
  activeProjectPath: string
  activeProject: string
  projectOverview: ProjectOverview | null
  activeContext: string
  isProjectLoading: boolean
  onChooseProjectFolder: () => void
  onCreateTab: () => void
  onCaptureAgentContextFromActiveTab: () => void
  agentContext: AgentContextSnapshot | null
  canCaptureActiveLog: boolean
  gitLabel: string
  selectedFileAnchorLabel: string
  selectedFile: ProjectFileSnapshot | null
  selectedFileLines: string[]
  selectedFileLine: number | null
  isFileLoading: boolean
  fileError: string | null
  onSelectCodeLine: (lineNumber: number) => void
  onClearSelectedLine: () => void
  activeSession: TerminalSessionSnapshot | null
  terminalSessions: TerminalSessionSnapshot[]
  activeTerminalTabId: string
  onSelectTerminalTab: (tabId: string) => void
  onCloseTab: (sessionId: number) => void
  onRenameTab: (sessionId: number, nextName: string) => Promise<void>
  terminalLogs: TerminalSessionLogs | null
  onOpenLineReference: (line: string) => void
  onSimulateMockActivity: () => void
  terminalError: string | null
  attachedLogCount: number
  codeContextReady: boolean
  providerSummaryLabel: string
  providerReadyForRequests: boolean
  executionMode: ExecutionMode
  requestContextSnapshot: AgentContextSnapshot | null
  selectedFileSnippet: string | null
  agentSuggestionsCount: number
  canSubmitAgentSuggestion: boolean
  taskHistory: TaskHistoryEntry[]
  telegramSnapshot: TelegramRuntimeSnapshot | null
  telegramError: string | null
  telegramReport: TelegramReportState
  telegramPendingCommands: TelegramRemoteCommandSnapshot[]
  onStartTelegramLink: () => void
  onCompleteTelegramMockLink: () => void
  onDisconnectTelegram: () => void
  onSendTelegramStatusReport: () => void
  onQueueTelegramCommand: (command: 'status' | 'rerun' | 'diff') => void
  onApproveTelegramCommand: (
    remoteCommand: TelegramRemoteCommandSnapshot,
    target: 'current-tab' | 'new-tab',
  ) => void
  onRejectTelegramCommand: (remoteCommand: TelegramRemoteCommandSnapshot) => void
  onDraftTelegramReport: () => void
  onQueueTelegramReport: () => void
  usesMockTelegramRuntime: boolean
  runtimeInfo: RuntimeInfo | null
}

export function WorkspaceStage({
  activeProjectPath,
  activeProject,
  projectOverview,
  activeContext,
  isProjectLoading,
  onChooseProjectFolder,
  onCreateTab,
  onCaptureAgentContextFromActiveTab,
  agentContext,
  canCaptureActiveLog,
  gitLabel,
  selectedFileAnchorLabel,
  selectedFile,
  selectedFileLines,
  selectedFileLine,
  isFileLoading,
  fileError,
  onSelectCodeLine,
  onClearSelectedLine,
  activeSession,
  terminalSessions,
  activeTerminalTabId,
  onSelectTerminalTab,
  onCloseTab,
  onRenameTab,
  terminalLogs,
  onOpenLineReference,
  onSimulateMockActivity,
  terminalError,
  attachedLogCount,
  codeContextReady,
  providerSummaryLabel,
  providerReadyForRequests,
  executionMode,
  requestContextSnapshot,
  selectedFileSnippet,
  agentSuggestionsCount,
  canSubmitAgentSuggestion,
  taskHistory,
  telegramSnapshot,
  telegramError,
  telegramReport,
  telegramPendingCommands,
  onStartTelegramLink,
  onCompleteTelegramMockLink,
  onDisconnectTelegram,
  onSendTelegramStatusReport,
  onQueueTelegramCommand,
  onApproveTelegramCommand,
  onRejectTelegramCommand,
  onDraftTelegramReport,
  onQueueTelegramReport,
  usesMockTelegramRuntime,
  runtimeInfo,
}: WorkspaceStageProps) {
  const codeWindowRef = useRef<HTMLDivElement | null>(null)
  const workspaceHeroTitle = activeProjectPath
    ? projectOverview?.metadata.name ?? activeProject
    : 'Open a project to start'
  const workspaceHeroDetail = activeProjectPath
    ? `${summarizePath(activeProjectPath)} • ${gitLabel}`
    : 'Choose a project, review code beside the terminal, connect Codex, then approve the next command.'

  useEffect(() => {
    if (!selectedFile?.isText || !selectedFileLine || !codeWindowRef.current) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      const target = codeWindowRef.current?.querySelector<HTMLElement>(
        `[data-code-line="${selectedFileLine}"]`,
      )
      target?.scrollIntoView({ block: 'center' })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [selectedFile?.filePath, selectedFile?.isText, selectedFileLine])

  return (
    <main className="workspace">
      <header className="workspace-topbar">
        <div className="workspace-title-group">
          <span className="eyebrow">Sprint 14 Workspace</span>
          <h2>{workspaceHeroTitle}</h2>
          <p className="workspace-subtitle">{workspaceHeroDetail}</p>
          <p className="support-note">Current focus: {activeContext}</p>
        </div>
        <div className="workspace-command-bar">
          <button
            className="accent-button"
            data-testid="workspace-open-project-button"
            onClick={onChooseProjectFolder}
            disabled={isProjectLoading}
          >
            {isProjectLoading ? 'Opening...' : activeProjectPath ? 'Switch Project' : 'Open Folder'}
          </button>
          <button onClick={onCreateTab} disabled={!activeProjectPath}>
            + New Tab
          </button>
          <button onClick={onCaptureAgentContextFromActiveTab} disabled={!canCaptureActiveLog}>
            {agentContext ? 'Refresh Pinned Log Snapshot' : 'Pin Active Log Snapshot'}
          </button>
        </div>
      </header>

      <section className="workspace-body">
        <section className="workspace-status-strip">
          <span className="pill">Project: {projectOverview?.metadata.name ?? 'none'}</span>
          <span className="pill">File: {selectedFileAnchorLabel}</span>
          <span className="pill">Tab: {activeSession?.name ?? 'none'}</span>
          <span className="pill">
            Terminal: {activeSession ? formatTerminalStatusLabel(activeSession.status) : 'Not Ready'}
          </span>
          <span className="pill">Provider: {providerSummaryLabel}</span>
          <span className="pill">Mode: {formatModeLabel(executionMode)}</span>
          <span className={`pill ${codeContextReady ? 'soft success' : 'soft'}`}>
            Code Context: {codeContextReady ? 'Ready' : 'Select a file'}
          </span>
          <span className={`pill ${attachedLogCount > 0 ? 'soft success' : 'soft'}`}>
            Log Context: {attachedLogCount > 0 ? `${attachedLogCount} line(s) ready` : 'Waiting for terminal output'}
          </span>
        </section>

        <div className="workspace-main-grid">
          <section className="code-stage" data-testid="code-viewer">
            <div className="code-toolbar">
              <div>
                <span className="label">Code Surface</span>
                <strong>{selectedFileAnchorLabel}</strong>
                <p>
                  {selectedFile
                    ? 'Use the selected file, optional line anchor, and active terminal together before asking Codex.'
                    : 'Choose a file from the project tree to inspect real project contents here.'}
                </p>
              </div>
              <div className="meta-strip">
                <span className="pill soft">
                  {selectedFile ? (selectedFile.isText ? `${selectedFile.lineCount} line(s)` : 'Binary') : 'No file'}
                </span>
                <span className="pill soft">
                  {selectedFile ? formatFileSizeLabel(selectedFile.sizeBytes) : '0 B'}
                </span>
                <span className={`pill ${selectedFileLine ? 'soft success' : 'soft'}`} data-testid="code-anchor-pill">
                  {selectedFileLine ? `Anchor: L${selectedFileLine}` : 'No Anchor'}
                </span>
                <span className={`pill ${selectedFile?.truncated ? 'soft warning' : 'soft'}`}>
                  {selectedFile?.truncated ? 'Preview Truncated' : 'Full Preview'}
                </span>
                {selectedFileLine ? (
                  <button type="button" onClick={onClearSelectedLine}>
                    Clear Anchor
                  </button>
                ) : null}
              </div>
            </div>
            <div className="code-window" ref={codeWindowRef}>
              {isFileLoading ? (
                <div className="code-empty">Loading file preview...</div>
              ) : fileError ? (
                <div className="code-empty">
                  <p>{fileError}</p>
                </div>
              ) : selectedFile ? (
                selectedFile.isText ? (
                  <div className="code-frame">
                    {selectedFileLines.map((line, index) => (
                      <div
                        className={`code-line ${selectedFileLine === index + 1 ? 'anchored' : ''}`}
                        key={`${selectedFile.filePath}-${index}`}
                        data-code-line={index + 1}
                      >
                        <button
                          type="button"
                          className={`code-line-number ${selectedFileLine === index + 1 ? 'active' : ''}`}
                          data-testid={`code-line-button-${index + 1}`}
                          onClick={() => onSelectCodeLine(index + 1)}
                        >
                          {index + 1}
                        </button>
                        <code>{line || ' '}</code>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="code-empty">
                    <p>Binary preview unavailable for {selectedFile.displayPath}.</p>
                    <p>Use the project tree or terminal workflow to inspect a text file before asking Codex.</p>
                  </div>
                )
              ) : (
                <div className="code-empty">
                  <p>Open a project and choose a file to start reading code in the main workspace.</p>
                </div>
              )}
            </div>
            {selectedFile?.truncated ? (
              <div className="code-footer-note">
                Preview truncated for safety. The full file is larger than the current preview window.
              </div>
            ) : null}
          </section>

          <div className="terminal-stage" data-testid="terminal-workspace">
            <div className="terminal-toolbar">
              <div className="terminal-tabs" role="tablist" aria-label="Terminal Tabs">
                {terminalSessions.length > 0 ? (
                  terminalSessions.map((session) => (
                    <div
                      key={session.sessionId}
                      className={`tab-shell ${String(session.sessionId) === activeTerminalTabId ? 'active' : ''}`}
                    >
                      <button
                        className={`tab ${String(session.sessionId) === activeTerminalTabId ? 'active' : ''}`}
                        role="tab"
                        aria-selected={String(session.sessionId) === activeTerminalTabId}
                        aria-controls={`terminal-panel-${session.sessionId}`}
                        onClick={() => onSelectTerminalTab(String(session.sessionId))}
                      >
                        {session.name}
                      </button>
                      <button
                        className="tab-action"
                        aria-label={`Close ${session.name}`}
                        onClick={() => onCloseTab(session.sessionId)}
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
                <button onClick={onCreateTab} disabled={!activeProjectPath}>
                  + New Tab
                </button>
                <button onClick={onCaptureAgentContextFromActiveTab} disabled={!canCaptureActiveLog}>
                  {agentContext ? 'Refresh Pinned Log' : 'Pin Active Log'}
                </button>
                {usesMockRuntime() ? (
                  <button onClick={onSimulateMockActivity}>Append Sample Log</button>
                ) : null}
              </div>
            </div>
            {activeSession ? (
              <div className="terminal-toolbar terminal-toolbar-secondary">
                <TerminalRenameField key={activeSession.sessionId} session={activeSession} onRename={onRenameTab} />
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
              <div className="terminal-line">$ sprint-14:fsd-shell</div>
              {(terminalLogs?.entries || []).length > 0 ? (
                terminalLogs?.entries.map((line, index) => {
                  const reference = extractLineReference(line)

                  return (
                    <div
                      className={`terminal-line ${reference ? 'with-reference' : ''}`}
                      key={`${terminalLogs.sessionId}-${index}`}
                    >
                      <span>{line || ' '}</span>
                      {reference ? (
                        <button
                          type="button"
                          className="line-reference-button"
                          data-testid={`terminal-reference-${index}`}
                          onClick={() => onOpenLineReference(line)}
                        >
                          Open {reference.label}
                        </button>
                      ) : null}
                    </div>
                  )
                })
              ) : (
                <div className="terminal-line dim">No recent lines yet. Interactive shell output will appear here.</div>
              )}
            </div>
          </div>
        </div>

        <section className="workspace-flow-grid">
          <article className="card workspace-flow-card">
            <span className="label">Workspace Flow</span>
            <strong>Project / Code / Terminal / Agent</strong>
            <div className="flow-steps">
              <div className={`flow-step ${activeProjectPath ? 'done' : 'current'}`}>
                <span className="flow-step-index">1</span>
                <div>
                  <strong>Project</strong>
                  <p>{activeProjectPath ? summarizePath(activeProjectPath) : 'Open a project folder first.'}</p>
                </div>
              </div>
              <div className={`flow-step ${codeContextReady ? 'done' : activeProjectPath ? 'current' : ''}`}>
                <span className="flow-step-index">2</span>
                <div>
                  <strong>Code Surface</strong>
                  <p>
                    {selectedFile
                      ? `${selectedFile.displayPath} is visible in the main workspace.`
                      : 'Select a file so the next request can include code context as well as logs.'}
                  </p>
                </div>
              </div>
              <div className={`flow-step ${providerReadyForRequests ? 'done' : codeContextReady ? 'current' : ''}`}>
                <span className="flow-step-index">3</span>
                <div>
                  <strong>Codex</strong>
                  <p>
                    {providerReadyForRequests
                      ? `${providerSummaryLabel} is active for live suggestions.`
                      : 'Connect Codex to unlock the request and approval flow.'}
                  </p>
                </div>
              </div>
              <div className={`flow-step ${attachedLogCount > 0 ? 'done' : providerReadyForRequests ? 'current' : ''}`}>
                <span className="flow-step-index">4</span>
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
              <div
                className={`flow-step ${
                  agentSuggestionsCount > 0 ? 'done' : canSubmitAgentSuggestion ? 'current' : ''
                }`}
              >
                <span className="flow-step-index">5</span>
                <div>
                  <strong>Approval</strong>
                  <p>
                    {agentSuggestionsCount > 0
                      ? `${agentSuggestionsCount} suggestion(s) ready for review.`
                      : 'Submit a provider-backed request from the right agent panel.'}
                  </p>
                </div>
              </div>
            </div>
          </article>

          <article className="card workspace-flow-card" data-testid="active-log-buffer">
            <span className="label">Attached Context</span>
            <strong>{selectedFileAnchorLabel ?? requestContextSnapshot?.tabTitle ?? activeSession?.name ?? 'No Context Yet'}</strong>
            <p>The next request combines the selected file preview with the latest active terminal lines.</p>
            <div className="context-block">
              <span className="context-meta">File preview</span>
              {selectedFileSnippet ? <code>{selectedFileSnippet}</code> : <p>No file snippet selected yet.</p>}
            </div>
            <div className="context-block">
              <span className="context-meta">Active terminal logs</span>
              {(requestContextSnapshot?.lines ?? []).map((line, index) => {
                const reference = extractLineReference(line)

                return (
                  <div className="context-line" key={`active-log-${index}`}>
                    <code>{line}</code>
                    {reference ? (
                      <button
                        type="button"
                        className="line-reference-button"
                        onClick={() => onOpenLineReference(line)}
                      >
                        Open {reference.label}
                      </button>
                    ) : null}
                  </div>
                )
              })}
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
                <p>Queue status reports and remote commands through the same approval model used in the app.</p>
                <div className="terminal-actions">
                  {telegramSnapshot?.bridge.status === 'connected' ? (
                    <button onClick={onDisconnectTelegram}>Disconnect Telegram</button>
                  ) : (
                    <button onClick={onStartTelegramLink}>Connect Telegram</button>
                  )}
                  {usesMockTelegramRuntime && telegramSnapshot?.bridge.status === 'pending' ? (
                    <button onClick={onCompleteTelegramMockLink}>Complete Telegram Mock Link</button>
                  ) : null}
                  <button
                    onClick={onSendTelegramStatusReport}
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
                    onClick={() => onQueueTelegramCommand('status')}
                    disabled={telegramSnapshot?.bridge.status !== 'connected'}
                  >
                    Queue /status
                  </button>
                  <button
                    onClick={() => onQueueTelegramCommand('rerun')}
                    disabled={telegramSnapshot?.bridge.status !== 'connected'}
                  >
                    Queue /rerun-tests
                  </button>
                  <button
                    onClick={() => onQueueTelegramCommand('diff')}
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
                          suggested target: {remoteCommand.suggestedTarget} • status: {remoteCommand.status}
                        </p>
                        <div className="terminal-actions">
                          <button onClick={() => onApproveTelegramCommand(remoteCommand, 'current-tab')}>
                            Approve In Current Tab
                          </button>
                          <button onClick={() => onApproveTelegramCommand(remoteCommand, 'new-tab')}>
                            Approve In New Tab
                          </button>
                          <button onClick={() => onRejectTelegramCommand(remoteCommand)}>Reject</button>
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
                <p>This panel drafts status reports for Telegram without touching the runtime bridge yet.</p>
                <div className="telegram-status-row">
                  <span className="pill soft">Status: {telegramReport.status}</span>
                  <span className="pill soft">
                    Last draft: {telegramReport.generatedAt ? telegramReport.generatedAt : 'not generated'}
                  </span>
                </div>
                <div className="terminal-actions">
                  <button onClick={onDraftTelegramReport}>Generate Telegram Draft</button>
                  <button onClick={onQueueTelegramReport} disabled={telegramReport.status === 'idle'}>
                    Queue Telegram Draft
                  </button>
                </div>
                <div className="telegram-policy">
                  <span className="label">Command Policy Draft</span>
                  <p>
                    Only `status`, `summary`, and `report`-style commands should be allowed through the future
                    Telegram bridge.
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
  )
}
