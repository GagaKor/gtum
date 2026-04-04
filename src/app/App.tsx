import { useEffect, useMemo, useState } from 'react'
import '../App.css'
import { type ExecutionMode } from '../lib/runtime'
import { useWorkspaceStore } from '../stores/workspace-store'
import { useTaskHistory } from '../features/tasks/model/useTaskHistory'
import { useProjectWorkspace } from '../features/projects/model/useProjectWorkspace'
import { useTerminalWorkspace } from '../features/terminals/model/useTerminalWorkspace'
import { useProviderAuth } from '../features/auth/model/useProviderAuth'
import { buildProviderUiContract, formatProviderStatusLabel } from '../features/auth/model/provider-ui'
import { useAgentSuggestions } from '../features/agents/model/useAgentSuggestions'
import { useTelegramWorkspace } from '../features/telegram/model/useTelegramWorkspace'
import { emptyTelegramReportState } from '../features/telegram/model/types'
import {
  type LeftSidebarMode,
  useWorkbenchLayout,
} from '../features/workspace/model/useWorkbenchLayout'
import { loadUiState, saveUiState } from '../features/workspace/model/ui-state'
import { buildDisplayFileAnchor, buildFileSnippet } from '../shared/lib/file-context'
import { formatModeLabel, summarizePath } from '../shared/lib/formatters'
import { ProjectSidebar } from '../widgets/project-sidebar/ui/ProjectSidebar'
import { WorkspaceStage } from '../widgets/workspace-stage/ui/WorkspaceStage'
import { AgentSidebar } from '../widgets/agent-sidebar/ui/AgentSidebar'

function App() {
  const restoredUiState = useMemo(() => loadUiState(), [])
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
    setPanelOpen,
    selectTerminalTab,
    captureTerminalContext,
  } = useWorkspaceStore()

  const { taskHistory, recordTask } = useTaskHistory(restoredUiState?.taskHistory ?? [])
  const [executionMode, setExecutionMode] = useState<ExecutionMode>(
    restoredUiState?.executionMode ?? 'balanced',
  )

  const terminalWorkspace = useTerminalWorkspace({
    activeProjectPath,
    activeTerminalTabId,
    agentContext,
    selectTerminalTab,
    captureTerminalContext,
  })

  const projectWorkspace = useProjectWorkspace({
    initialLastProjectPath: restoredUiState?.lastProjectPath,
    initialSelectedFilePath: restoredUiState?.selectedFilePath ?? null,
    initialSelectedFileLine: restoredUiState?.selectedFileLine ?? null,
    activeProjectPath,
    projectPathInput,
    recentProjects,
    setActiveProject,
    setActiveProjectPath,
    setProjectPathInput,
    rememberProject,
    setActiveContext,
    ensureWorkspaceTerminal: terminalWorkspace.ensureWorkspaceTerminal,
    recordTask,
  })

  const authWorkspace = useProviderAuth({
    initialSelectedProvider: restoredUiState?.selectedProvider ?? 'codex',
    activeProjectPath,
    activeTerminalCwd: terminalWorkspace.activeSession?.cwd ?? null,
    setActiveContext,
    recordTask,
    launchCommandSession: terminalWorkspace.launchCommandSession,
  })

  const agentWorkspace = useAgentSuggestions({
    activeProject,
    activeProjectPath,
    projectOverview: projectWorkspace.projectOverview,
    selectedProvider: authWorkspace.selectedProvider,
    executionMode,
    selectedFile: projectWorkspace.selectedFile,
    selectedFilePath: projectWorkspace.selectedFilePath,
    selectedFileLine: projectWorkspace.selectedFileLine,
    agentConnections: authWorkspace.agentConnections,
    activeSession: terminalWorkspace.activeSession,
    terminalLogs: terminalWorkspace.terminalLogs,
    agentContext,
    captureTerminalContext,
    recordTask,
    setActiveContext,
    executeCommandInTarget: terminalWorkspace.executeCommandInTarget,
  })

  const telegramWorkspace = useTelegramWorkspace({
    initialReport: restoredUiState?.telegramReport ?? emptyTelegramReportState(),
    activeProject,
    activeProjectPath,
    projectName: projectWorkspace.projectOverview?.metadata.name ?? null,
    activeSession: terminalWorkspace.activeSession,
    terminalLogs: terminalWorkspace.terminalLogs,
    agentContext,
    executionMode,
    taskHistory,
    setActiveContext,
    recordTask,
    executeCommandInTarget: terminalWorkspace.executeCommandInTarget,
  })

  const workbenchLayout = useWorkbenchLayout({
    activeProjectPath,
    selectedFile: projectWorkspace.selectedFile,
    recentProjects,
    initialLeftSidebarMode: restoredUiState?.leftPanelMode,
    recordTask,
    setActiveContext,
    refreshProject: projectWorkspace.refreshProject,
  })

  useEffect(() => {
    saveUiState({
      lastProjectPath: activeProjectPath || projectPathInput,
      selectedFilePath: projectWorkspace.selectedFilePath ?? undefined,
      selectedFileLine: projectWorkspace.selectedFileLine,
      selectedProvider: authWorkspace.selectedProvider,
      executionMode,
      leftPanelMode: workbenchLayout.leftSidebarMode,
      taskHistory,
      telegramReport: telegramWorkspace.telegramReport,
    })
  }, [
    activeProjectPath,
    authWorkspace.selectedProvider,
    executionMode,
    projectPathInput,
    projectWorkspace.selectedFileLine,
    projectWorkspace.selectedFilePath,
    taskHistory,
    telegramWorkspace.telegramReport,
    workbenchLayout.leftSidebarMode,
  ])

  const gitLabel = projectWorkspace.projectOverview?.git.isRepository
    ? `${projectWorkspace.projectOverview.git.branch ?? 'detached'} • ${
        projectWorkspace.projectOverview.git.isDirty ? 'Dirty' : 'Clean'
      }`
    : 'No Git repository detected'

  const selectedConnection = authWorkspace.selectedConnection
  const selectedProviderContract = selectedConnection
    ? buildProviderUiContract(selectedConnection)
    : null
  const selectedFileLines = projectWorkspace.selectedFile?.isText
    ? projectWorkspace.selectedFile.content.split('\n')
    : []
  const selectedFileAnchorLabel = buildDisplayFileAnchor(
    projectWorkspace.selectedFile?.displayPath ?? null,
    projectWorkspace.selectedFileLine,
  )
  const selectedFileSnippet = buildFileSnippet(
    projectWorkspace.selectedFile,
    projectWorkspace.selectedFileLine,
  )
  const attachedLogCount = agentWorkspace.requestContextSnapshot?.lines.length ?? 0
  const connectedProviderCount = authWorkspace.agentConnections.filter(
    (connection) => connection.status === 'connected',
  ).length
  const pendingSuggestionCount = agentWorkspace.agentSuggestions.filter(
    (suggestion) => suggestion.status === 'pending',
  ).length
  const canSubmitAgentSuggestion =
    Boolean(selectedProviderContract?.canRequestSuggestion) &&
    agentWorkspace.agentRequestInput.trim().length > 0
  const providerRequestPreview = {
    project: projectWorkspace.projectOverview?.metadata.name ?? activeProject,
    file: selectedFileAnchorLabel,
    terminal:
      agentWorkspace.requestContextSnapshot?.tabTitle ??
      terminalWorkspace.activeSession?.name ??
      'No active terminal',
    lines: attachedLogCount,
  }
  const codeContextReady = Boolean(selectedFileSnippet)
  const providerSummaryLabel = selectedProviderContract?.statusLabel ?? 'No provider selected'
  const providerReadyForRequests = Boolean(selectedProviderContract?.canRequestSuggestion)
  const agentSuggestionsCount = agentWorkspace.agentSuggestions.length

  const handleExecutionModeChange = (mode: ExecutionMode) => {
    setExecutionMode(mode)
    setActiveContext(`Mission Control ${formatModeLabel(mode)} mode selected`)
  }

  const handleLeftModeSelection = (mode: LeftSidebarMode) => {
    workbenchLayout.setLeftSidebarMode(mode)
    setPanelOpen('projects', true)
  }

  return (
    <div className="mission-control-app">
      <header className="mission-header">
        <div className="mission-brand">
          <img className="brand-mark" src="/brand/gtum-mark.svg" alt="gtum mark" />
          <div className="mission-brand-copy">
            <strong>gtum mission workspace</strong>
            <span>{activeProjectPath ? summarizePath(activeProjectPath) : '프로젝트를 열어 시작하세요.'}</span>
          </div>
        </div>
        <div className="mission-header-chips">
          <span className="status-badge kind-real">
            {selectedConnection?.displayName ?? 'Codex'}{' '}
            {selectedConnection ? formatProviderStatusLabel(selectedConnection.status) : 'Not Selected'}
          </span>
          <span className="status-badge scopes">현재 작업: {activeContext}</span>
          <span className="status-badge scopes">왼쪽 패널: {workbenchLayout.leftSidebarMode}</span>
          <span className="status-badge scopes">활성 세션: {terminalWorkspace.activeSession?.name ?? 'none'}</span>
          <span className="status-badge scopes">연결 {connectedProviderCount}</span>
          <span className="status-badge scopes">대기 제안 {pendingSuggestionCount}</span>
        </div>
      </header>

      <div
        className={`app-shell ${panels.projects ? 'left-open' : 'left-collapsed'} ${
          panels.agents ? 'right-open' : 'right-collapsed'
        }`}
      >
        <ProjectSidebar
          visible={panels.projects}
          activeMode={workbenchLayout.leftSidebarMode}
          onSelectMode={handleLeftModeSelection}
          onToggleVisibility={() => togglePanel('projects')}
          activeProjectPath={activeProjectPath}
          activeProject={activeProject}
          projectOverview={projectWorkspace.projectOverview}
          isProjectLoading={projectWorkspace.isProjectLoading}
          projectError={projectWorkspace.projectError}
          projectPathInput={projectPathInput}
          onProjectPathInputChange={setProjectPathInput}
          onChooseProjectFolder={() => void projectWorkspace.chooseProjectFolder()}
          onOpenProject={(path) => void projectWorkspace.openProject(path)}
          recentProjects={recentProjects}
          projectList={workbenchLayout.projectList}
          gitLabel={gitLabel}
          selectedFilePath={projectWorkspace.selectedFilePath}
          onSelectProjectFile={projectWorkspace.selectProjectFile}
          searchQuery={workbenchLayout.searchQuery}
          onSearchQueryChange={workbenchLayout.setSearchQuery}
          recentQueries={workbenchLayout.recentQueries}
          searchResults={workbenchLayout.searchResults}
          isSearchLoading={workbenchLayout.isSearchLoading}
          searchError={workbenchLayout.searchError}
          onOpenSearchResult={(filePath, lineNumber) =>
            void projectWorkspace.openProjectFileAtLine(filePath, lineNumber)
          }
          sourceControl={workbenchLayout.sourceControl}
          isSourceControlLoading={workbenchLayout.isSourceControlLoading}
          sourceControlError={workbenchLayout.sourceControlError}
          onOpenSourceDiff={(entry, staged) => void workbenchLayout.openDiff(entry, staged)}
          onStageSourceFile={(entry) => void workbenchLayout.applyFileAction(entry, 'stage')}
          onUnstageSourceFile={(entry) => void workbenchLayout.applyFileAction(entry, 'unstage')}
          commitMessage={workbenchLayout.commitMessage}
          onCommitMessageChange={workbenchLayout.setCommitMessage}
          onCommitSourceControl={() => void workbenchLayout.submitCommit()}
          onPushSourceControl={() => void workbenchLayout.submitPush()}
          outlineEntries={workbenchLayout.outlineEntries}
          onOpenOutlineLine={projectWorkspace.selectCodeLine}
          runtimeInfo={authWorkspace.runtimeInfo}
        />

        <WorkspaceStage
          activeProjectPath={activeProjectPath}
          activeProject={activeProject}
          projectOverview={projectWorkspace.projectOverview}
          activeContext={activeContext}
          isProjectLoading={projectWorkspace.isProjectLoading}
          onChooseProjectFolder={() => void projectWorkspace.chooseProjectFolder()}
          onCreateTab={() => void terminalWorkspace.createTab()}
          onCaptureAgentContextFromActiveTab={terminalWorkspace.captureAgentContextFromActiveTab}
          agentContext={agentContext}
          canCaptureActiveLog={terminalWorkspace.canCaptureActiveLog}
          gitLabel={gitLabel}
          selectedFileAnchorLabel={selectedFileAnchorLabel}
          selectedFile={projectWorkspace.selectedFile}
          selectedFileLines={selectedFileLines}
          selectedFileLine={projectWorkspace.selectedFileLine}
          isFileLoading={projectWorkspace.isFileLoading}
          fileError={projectWorkspace.fileError}
          onSelectCodeLine={projectWorkspace.selectCodeLine}
          onClearSelectedLine={projectWorkspace.clearSelectedLine}
          activeSession={terminalWorkspace.activeSession}
          terminalSessions={terminalWorkspace.terminalSessions}
          activeTerminalTabId={activeTerminalTabId}
          onSelectTerminalTab={selectTerminalTab}
          onCloseTab={(sessionId) => void terminalWorkspace.closeTab(sessionId)}
          onRenameTab={terminalWorkspace.renameTab}
          terminalLogs={terminalWorkspace.terminalLogs}
          onOpenLineReference={(line) => void projectWorkspace.openLineReference(line)}
          onSimulateMockActivity={() => void terminalWorkspace.simulateMockActivity()}
          terminalError={terminalWorkspace.terminalError}
          attachedLogCount={attachedLogCount}
          codeContextReady={codeContextReady}
          providerSummaryLabel={providerSummaryLabel}
          providerReadyForRequests={providerReadyForRequests}
          executionMode={executionMode}
          requestContextSnapshot={agentWorkspace.requestContextSnapshot}
          selectedFileSnippet={selectedFileSnippet}
          agentSuggestionsCount={agentSuggestionsCount}
          canSubmitAgentSuggestion={canSubmitAgentSuggestion}
          taskHistory={taskHistory}
          telegramSnapshot={telegramWorkspace.telegramSnapshot}
          telegramError={telegramWorkspace.telegramError}
          telegramReport={telegramWorkspace.telegramReport}
          telegramPendingCommands={telegramWorkspace.telegramPendingCommands}
          onStartTelegramLink={() => void telegramWorkspace.startTelegramLink()}
          onCompleteTelegramMockLink={() => void telegramWorkspace.completeTelegramMockLink()}
          onDisconnectTelegram={() => void telegramWorkspace.disconnectTelegram()}
          onSendTelegramStatusReport={() => void telegramWorkspace.sendTelegramStatusReport()}
          onQueueTelegramCommand={(command) => void telegramWorkspace.queueTelegramCommand(command)}
          onApproveTelegramCommand={(command, target) =>
            void telegramWorkspace.approveTelegramCommand(command, target)
          }
          onRejectTelegramCommand={(command) => void telegramWorkspace.rejectTelegramCommand(command)}
          onDraftTelegramReport={telegramWorkspace.draftTelegramReport}
          onQueueTelegramReport={telegramWorkspace.queueTelegramReport}
          usesMockTelegramRuntime={telegramWorkspace.usesMockTelegramRuntime}
          runtimeInfo={authWorkspace.runtimeInfo}
          secondaryView={workbenchLayout.secondaryView}
          onSelectSecondaryView={workbenchLayout.setSecondaryView}
          activeDiff={workbenchLayout.activeDiff}
          isDiffLoading={workbenchLayout.isDiffLoading}
          diffError={workbenchLayout.diffError}
        />

        <AgentSidebar
          visible={panels.agents}
          onToggle={() => togglePanel('agents')}
          agentConnections={authWorkspace.agentConnections}
          providerDiagnostics={authWorkspace.providerDiagnostics}
          authError={authWorkspace.authError}
          selectedProvider={authWorkspace.selectedProvider}
          onSelectProvider={authWorkspace.setSelectedProvider}
          onStartProviderLogin={(provider) => void authWorkspace.startProviderLogin(provider)}
          onDisconnectProvider={(provider) => void authWorkspace.disconnectProvider(provider)}
          onOpenCodexLogin={() => void authWorkspace.openCodexLogin()}
          onSimulateMockCallback={(provider) => void authWorkspace.simulateMockCallback(provider)}
          selectedConnection={selectedConnection}
          selectedFileAnchorLabel={selectedFileAnchorLabel}
          selectedFileSnippet={selectedFileSnippet}
          requestContextSnapshot={agentWorkspace.requestContextSnapshot}
          onOpenLineReference={(line) => void projectWorkspace.openLineReference(line)}
          providerRequestPreview={providerRequestPreview}
          executionMode={executionMode}
          onSelectExecutionMode={handleExecutionModeChange}
          agentRequestInput={agentWorkspace.agentRequestInput}
          onAgentRequestInputChange={agentWorkspace.setAgentRequestInput}
          canSubmitAgentSuggestion={canSubmitAgentSuggestion}
          onSubmitAgentRequest={() => void agentWorkspace.submitAgentRequest()}
          agentRequestError={agentWorkspace.agentRequestError}
          agentSuggestions={agentWorkspace.agentSuggestions}
          onApproveSuggestion={(suggestion, target) =>
            void agentWorkspace.approveSuggestion(suggestion, target)
          }
        />
      </div>
    </div>
  )
}

export default App
