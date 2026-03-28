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
import { loadUiState, saveUiState } from '../features/workspace/model/ui-state'
import { buildDisplayFileAnchor, buildFileSnippet } from '../shared/lib/file-context'
import { formatModeLabel } from '../shared/lib/formatters'
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

  useEffect(() => {
    saveUiState({
      lastProjectPath: activeProjectPath || projectPathInput,
      selectedFilePath: projectWorkspace.selectedFilePath ?? undefined,
      selectedFileLine: projectWorkspace.selectedFileLine,
      selectedProvider: authWorkspace.selectedProvider,
      executionMode,
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
  const selectedProviderSummary = selectedConnection
    ? `${selectedConnection.displayName} • ${formatProviderStatusLabel(selectedConnection.status)}`
    : 'No provider selected'
  const selectedFileSnippet = buildFileSnippet(
    projectWorkspace.selectedFile,
    projectWorkspace.selectedFileLine,
  )
  const selectedFileLines = projectWorkspace.selectedFile?.isText
    ? projectWorkspace.selectedFile.content.split('\n')
    : []
  const selectedFileAnchorLabel = buildDisplayFileAnchor(
    projectWorkspace.selectedFile?.displayPath ?? null,
    projectWorkspace.selectedFileLine,
  )
  const attachedLogCount = agentWorkspace.requestContextSnapshot?.lines.length ?? 0
  const codeContextReady = Boolean(projectWorkspace.selectedFile?.isText)
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

  const handleExecutionModeChange = (mode: ExecutionMode) => {
    setExecutionMode(mode)
    setActiveContext(`Sprint 14 ${formatModeLabel(mode)} mode selected`)
  }

  return (
    <div className="app-shell">
      <ProjectSidebar
        visible={panels.projects}
        onToggle={() => togglePanel('projects')}
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
        gitLabel={gitLabel}
        selectedFilePath={projectWorkspace.selectedFilePath}
        onSelectProjectFile={projectWorkspace.selectProjectFile}
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
        providerSummaryLabel={selectedConnection ? selectedProviderSummary : 'Not Selected'}
        providerReadyForRequests={Boolean(selectedProviderContract?.canRequestSuggestion)}
        executionMode={executionMode}
        requestContextSnapshot={agentWorkspace.requestContextSnapshot}
        selectedFileSnippet={selectedFileSnippet}
        agentSuggestionsCount={agentWorkspace.agentSuggestions.length}
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
  )
}

export default App
