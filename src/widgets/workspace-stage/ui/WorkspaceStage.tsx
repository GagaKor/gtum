import { useEffect, useRef } from 'react'
import type {
  ExecutionMode,
  ProjectFileSnapshot,
  ProjectOverview,
  RuntimeInfo,
  SourceControlDiff,
  TelegramRemoteCommandSnapshot,
  TelegramRuntimeSnapshot,
  TerminalSessionLogs,
  TerminalSessionSnapshot,
} from '../../../lib/runtime'
import { usesMockRuntime } from '../../../lib/runtime'
import type { TaskHistoryEntry } from '../../../features/tasks/model/types'
import type { TelegramReportState } from '../../../features/telegram/model/types'
import type { AgentContextSnapshot } from '../../../stores/workspace-store'
import { extractLineReference, formatFileSizeLabel } from '../../../shared/lib/file-context'
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
  secondaryView: 'terminal' | 'diff'
  onSelectSecondaryView: (view: 'terminal' | 'diff') => void
  activeDiff: SourceControlDiff | null
  isDiffLoading: boolean
  diffError: string | null
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
  secondaryView,
  onSelectSecondaryView,
  activeDiff,
  isDiffLoading,
  diffError,
}: WorkspaceStageProps) {
  const codeWindowRef = useRef<HTMLDivElement | null>(null)
  const codeTabLabel = selectedFile?.displayPath ?? 'code'
  const isTerminalView = secondaryView === 'terminal'

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

  if (!activeProjectPath) {
    return (
      <main className="workspace workspace-shell">
        <section className="empty-workbench card">
          <span className="label">Mission Control</span>
          <strong>{activeProject || '프로젝트를 열어 시작하세요.'}</strong>
          <p>
            프로젝트를 열면 왼쪽에서 프로젝트와 검색, Git, 아웃라인을 전환하고 가운데에서는 코드와
            터미널을 나란히 보면서 오른쪽에서 에이전트와 바로 대화할 수 있습니다.
          </p>
          <div className="button-row">
            <button
              className="accent-button"
              data-testid="workspace-open-project-button"
              onClick={onChooseProjectFolder}
              disabled={isProjectLoading}
            >
              {isProjectLoading ? 'Opening...' : 'Open Folder'}
            </button>
            <button type="button" disabled>
              + New Tab
            </button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="workspace workspace-shell">
      <section className="workspace-status-strip compact-strip">
        <span className="pill">Project: {projectOverview?.metadata.name ?? activeProject}</span>
        <span className="pill">{gitLabel}</span>
        <span className="pill">{summarizePath(activeProjectPath)}</span>
        <span className="pill">{selectedFileAnchorLabel}</span>
        <span className="pill">Provider: {providerSummaryLabel}</span>
        <span className="pill">Mode: {formatModeLabel(executionMode)}</span>
        <span className={`pill ${codeContextReady ? 'soft success' : 'soft'}`}>
          Code Context: {codeContextReady ? 'Ready' : 'Select a file'}
        </span>
        <span className={`pill ${providerReadyForRequests ? 'soft success' : 'soft'}`}>
          {providerReadyForRequests ? 'Provider Ready' : 'Provider Pending'}
        </span>
        <span className={`pill ${attachedLogCount > 0 ? 'soft success' : 'soft'}`}>
          Log Context: {attachedLogCount > 0 ? `${attachedLogCount} line(s) ready` : 'Waiting for output'}
        </span>
        <span className={`pill ${canSubmitAgentSuggestion ? 'soft success' : 'soft'}`}>
          Suggestions: {agentSuggestionsCount}
        </span>
      </section>

      <div className="workspace-main-grid mission-workbench-grid">
        <section className="code-stage workbench-pane" data-testid="code-viewer">
          <div className="pane-tab-strip">
            <div className="pane-tab active">{codeTabLabel}</div>
            <button
              className="pane-plus-button"
              type="button"
              aria-label="Open Folder"
              onClick={onChooseProjectFolder}
            >
              +
            </button>
          </div>

          <div className="pane-toolbar">
            <div>
              <span className="label">Code Surface</span>
              <strong>{selectedFileAnchorLabel}</strong>
              <p>
                선택한 파일과 line anchor를 기준으로 코드를 읽고, 같은 맥락으로 에이전트 요청까지
                이어집니다.
              </p>
            </div>
            <div className="meta-strip">
              <span className="pill soft">
                {selectedFile ? (selectedFile.isText ? `${selectedFile.lineCount} line(s)` : 'Binary') : 'No file'}
              </span>
              <span className="pill soft">
                {selectedFile ? formatFileSizeLabel(selectedFile.sizeBytes) : '0 B'}
              </span>
              <span
                className={`pill ${selectedFileLine ? 'soft success' : 'soft'}`}
                data-testid="code-anchor-pill"
              >
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
                  <p>텍스트 파일을 선택하면 코드 surface와 outline이 함께 살아납니다.</p>
                </div>
              )
            ) : (
              <div className="code-empty">
                <p>프로젝트에서 파일을 선택하면 이 pane에 코드가 표시됩니다.</p>
              </div>
            )}
          </div>
        </section>

        <section className="terminal-stage workbench-pane" data-testid="terminal-workspace">
          <div className="pane-tab-strip">
            <div className="terminal-side-tabs">
              <button
                type="button"
                className={`pane-tab ${isTerminalView ? 'active' : ''}`}
                onClick={() => onSelectSecondaryView('terminal')}
              >
                Terminal
              </button>
              <button
                type="button"
                className={`pane-tab ${!isTerminalView ? 'active' : ''}`}
                onClick={() => onSelectSecondaryView('diff')}
                disabled={!activeDiff && !isDiffLoading && !diffError}
              >
                Diff
              </button>
            </div>
            <button type="button" className="pane-plus-button" onClick={onCreateTab} disabled={!activeProjectPath}>
              + New Tab
            </button>
          </div>

          {isTerminalView ? (
            <>
              <div className="pane-toolbar terminal-toolbar">
                <div>
                  <span className="label">Terminal Surface</span>
                  <strong>{activeSession ? activeSession.name : 'No active tab'}</strong>
                  <p>
                    {activeSession
                      ? `${activeSession.cwd ?? 'no cwd'} · ${formatTerminalStatusLabel(activeSession.status)}`
                      : '터미널 탭을 열면 로그와 명령 실행이 여기 표시됩니다.'}
                  </p>
                </div>
                <div className="terminal-actions">
                  <button type="button" onClick={onCaptureAgentContextFromActiveTab} disabled={!canCaptureActiveLog}>
                    {agentContext ? 'Refresh Pinned Log' : 'Pin Active Log'}
                  </button>
                  {usesMockRuntime() ? (
                    <button type="button" onClick={onSimulateMockActivity}>
                      Append Sample Log
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="pane-subtabs">
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
                          type="button"
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
              </div>

              {activeSession ? (
                <div className="terminal-toolbar terminal-toolbar-secondary">
                  <TerminalRenameField
                    key={activeSession.sessionId}
                    session={activeSession}
                    onRename={onRenameTab}
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
                  <span>{activeSession?.cwd ?? summarizePath(activeProjectPath)}</span>
                  <span>
                    {attachedLogCount > 0 ? `${attachedLogCount} request line(s)` : 'request context pending'}
                  </span>
                </div>
                {terminalError ? <p className="terminal-error">{terminalError}</p> : null}
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
                  <div className="terminal-line dim">
                    No recent lines yet. Interactive shell output will appear here.
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="pane-toolbar">
                <div>
                  <span className="label">Diff Surface</span>
                  <strong>{activeDiff?.displayPath ?? 'No diff selected'}</strong>
                  <p>왼쪽 Source Control에서 선택한 파일의 변경 내용을 이 pane에서 비교합니다.</p>
                </div>
                <div className="meta-strip">
                  <span className="pill soft">
                    {activeDiff ? (activeDiff.staged ? 'Staged Diff' : 'Working Tree Diff') : 'No Diff'}
                  </span>
                </div>
              </div>
              <div className="diff-window" role="tabpanel" aria-label="Diff preview">
                {isDiffLoading ? (
                  <div className="code-empty">Loading diff preview...</div>
                ) : diffError ? (
                  <div className="code-empty">
                    <p>{diffError}</p>
                  </div>
                ) : activeDiff ? (
                  <div className="diff-frame">
                    {activeDiff.diff.split('\n').map((line, index) => (
                      <div className="diff-line" key={`${activeDiff.filePath}-${index}`}>
                        <span className="diff-line-number">{index + 1}</span>
                        <code>{line || ' '}</code>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="code-empty">
                    <p>Open a file from Source Control to preview its diff.</p>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <section className="workspace-flow-grid">
        <article
          className="context-buffer-card"
          data-testid="active-log-buffer"
          data-active-context={activeContext}
        >
          <span className="label">Attached Context</span>
          <strong>{selectedFileSnippet ? selectedFileAnchorLabel : 'No file context yet'}</strong>
          <p>다음 요청은 선택된 파일과 활성 터미널 로그를 함께 사용합니다.</p>
          <p className="secondary-text">Current focus stays synced with the mission header.</p>
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
                  (telegramSnapshot?.bridge.status === 'connected'
                    ? 'Telegram Connected'
                    : 'Disconnected')}
              </strong>
              <p>Queue status reports and remote commands through the same approval model used in the app.</p>
              <div className="terminal-actions">
                {telegramSnapshot?.bridge.status === 'connected' ? (
                  <button type="button" onClick={onDisconnectTelegram}>
                    Disconnect Telegram
                  </button>
                ) : (
                  <button type="button" onClick={onStartTelegramLink}>
                    Connect Telegram
                  </button>
                )}
                {usesMockTelegramRuntime && telegramSnapshot?.bridge.status === 'pending' ? (
                  <button type="button" onClick={onCompleteTelegramMockLink}>
                    Complete Telegram Mock Link
                  </button>
                ) : null}
                <button
                  type="button"
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
                  type="button"
                  onClick={() => onQueueTelegramCommand('status')}
                  disabled={telegramSnapshot?.bridge.status !== 'connected'}
                >
                  Queue /status
                </button>
                <button
                  type="button"
                  onClick={() => onQueueTelegramCommand('rerun')}
                  disabled={telegramSnapshot?.bridge.status !== 'connected'}
                >
                  Queue /rerun-tests
                </button>
                <button
                  type="button"
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
                        <button
                          type="button"
                          onClick={() => onApproveTelegramCommand(remoteCommand, 'current-tab')}
                        >
                          Approve In Current Tab
                        </button>
                        <button
                          type="button"
                          onClick={() => onApproveTelegramCommand(remoteCommand, 'new-tab')}
                        >
                          Approve In New Tab
                        </button>
                        <button type="button" onClick={() => onRejectTelegramCommand(remoteCommand)}>
                          Reject
                        </button>
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
                <button type="button" onClick={onDraftTelegramReport}>
                  Generate Telegram Draft
                </button>
                <button
                  type="button"
                  onClick={onQueueTelegramReport}
                  disabled={telegramReport.status === 'idle'}
                >
                  Queue Telegram Draft
                </button>
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
              Diagnostics stay in a collapsed support drawer so the main workbench remains editor-first.
            </p>
          </article>
        </details>
      </section>
    </main>
  )
}
