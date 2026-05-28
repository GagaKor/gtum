import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import '../App.css'
import { type ExecutionMode } from '../lib/runtime'
import { useWorkspaceStore } from '../stores/workspace-store'
import { useTaskHistory } from '../features/tasks/model/useTaskHistory'
import { useProjectWorkspace } from '../features/projects/model/useProjectWorkspace'
import { useTerminalWorkspace } from '../features/terminals/model/useTerminalWorkspace'
import { useProviderAuth } from '../features/auth/model/useProviderAuth'
import { buildProviderUiContract } from '../features/auth/model/provider-ui'
import { useAgentSuggestions } from '../features/agents/model/useAgentSuggestions'
import { useTelegramWorkspace } from '../features/telegram/model/useTelegramWorkspace'
import { emptyTelegramReportState } from '../features/telegram/model/types'
import {
  type LeftSidebarMode,
  useWorkbenchLayout,
} from '../features/workspace/model/useWorkbenchLayout'
import { loadUiState, saveUiState } from '../features/workspace/model/ui-state'
import { buildDisplayFileAnchor, buildFileSnippet } from '../shared/lib/file-context'
import { formatModeLabel } from '../shared/lib/formatters'
import { Titlebar } from '../widgets/app-shell/ui/Titlebar'
import { StatusBar } from '../widgets/app-shell/ui/StatusBar'
import { ProjectSidebar } from '../widgets/project-sidebar/ui/ProjectSidebar'
import { WorkspaceStage } from '../widgets/workspace-stage/ui/WorkspaceStage'
import { AgentSidebar } from '../widgets/agent-sidebar/ui/AgentSidebar'

const LEFT_PANEL_DEFAULT_WIDTH = 264
const RIGHT_PANEL_DEFAULT_WIDTH = 380
const LEFT_PANEL_RESIZE = { min: 180, max: 440, collapse: 54 }
const RIGHT_PANEL_RESIZE = { min: 280, max: 560, collapse: 100 }

function clampPanelWidth(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function App() {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const scalerRef = useRef<HTMLDivElement | null>(null)
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
  const [leftPanelWidth, setLeftPanelWidth] = useState(LEFT_PANEL_DEFAULT_WIDTH)
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_DEFAULT_WIDTH)

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
    initialLeftSidebarMode: 'project',
    recordTask,
    setActiveContext,
    refreshProject: projectWorkspace.refreshProject,
  })

  useLayoutEffect(() => {
    const fit = () => {
      const stage = stageRef.current
      const scaler = scalerRef.current

      if (!stage || !scaler) {
        return
      }

      const scale = Math.min(stage.clientWidth / 1320, stage.clientHeight / 824, 1)
      scaler.style.setProperty('--scale', String(scale))
    }

    fit()

    const observer = new ResizeObserver(fit)
    observer.observe(document.documentElement)

    return () => observer.disconnect()
  }, [])

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
  const activeWorkbenchTabLabel =
    projectWorkspace.selectedFile?.displayPath ?? terminalWorkspace.activeSession?.name ?? 'workspace'
  const workbenchGroupCount = 1
  const workbenchTabCount = terminalWorkspace.terminalSessions.length + (projectWorkspace.selectedFile ? 1 : 0)
  const changedFileCount = projectWorkspace.projectOverview?.git.changedFilesCount ?? null

  const handleExecutionModeChange = (mode: ExecutionMode) => {
    setExecutionMode(mode)
    setActiveContext(`Mission Control ${formatModeLabel(mode)} mode selected`)
  }

  const handleLeftModeSelection = (mode: LeftSidebarMode) => {
    workbenchLayout.setLeftSidebarMode(mode)
    setPanelOpen('projects', true)
  }

  const handleOpenSettings = () => {
    handleLeftModeSelection('settings')
  }

  const startPanelResize = useCallback(
    (side: 'left' | 'right') => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return
      }

      event.preventDefault()

      const startX = event.clientX
      const startWidth = side === 'left' ? leftPanelWidth : rightPanelWidth
      const resizeBounds = side === 'left' ? LEFT_PANEL_RESIZE : RIGHT_PANEL_RESIZE
      const bodyClass = side === 'left' ? 'resizing-h-left' : 'resizing-h-right'
      let nextWidth = startWidth

      const updateWidth = (width: number) => {
        nextWidth = clampPanelWidth(width, resizeBounds.collapse, resizeBounds.max)

        if (side === 'left') {
          setLeftPanelWidth(nextWidth)
        } else {
          setRightPanelWidth(nextWidth)
        }
      }

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientX - startX
        const rawWidth = side === 'left' ? startWidth + delta : startWidth - delta

        updateWidth(rawWidth)
      }

      const handlePointerUp = () => {
        document.removeEventListener('pointermove', handlePointerMove)
        document.body.classList.remove(bodyClass)

        if (nextWidth <= resizeBounds.collapse + 4) {
          setPanelOpen(side === 'left' ? 'projects' : 'agents', false)
          if (side === 'left') {
            setLeftPanelWidth(LEFT_PANEL_DEFAULT_WIDTH)
          } else {
            setRightPanelWidth(RIGHT_PANEL_DEFAULT_WIDTH)
          }
          return
        }

        const normalizedWidth = clampPanelWidth(nextWidth, resizeBounds.min, resizeBounds.max)
        if (side === 'left') {
          setLeftPanelWidth(normalizedWidth)
        } else {
          setRightPanelWidth(normalizedWidth)
        }
      }

      document.body.classList.add(bodyClass)
      document.addEventListener('pointermove', handlePointerMove)
      document.addEventListener('pointerup', handlePointerUp, { once: true })
    },
    [leftPanelWidth, rightPanelWidth, setPanelOpen],
  )

  const bodyGridStyle = {
    gridTemplateColumns: `${panels.projects ? `${leftPanelWidth}px 4px ` : ''}minmax(0, 1fr)${
      panels.agents ? ` 4px ${rightPanelWidth}px` : ''
    }`,
  } as CSSProperties

  return (
    <div className="gtum-stage" ref={stageRef}>
      <div className="gtum-scaler" ref={scalerRef}>
        <div className="gtum-window" data-testid="gtum-window">
          <Titlebar
            projectName={projectWorkspace.projectOverview?.metadata.name ?? activeProject}
            projectPath={activeProjectPath || null}
            gitLabel={gitLabel}
            activeTabLabel={activeWorkbenchTabLabel}
            groupCount={workbenchGroupCount}
            connectedProviderCount={connectedProviderCount}
            selectedProvider={selectedConnection}
            onOpenSettings={handleOpenSettings}
          />

          <div
            className={`body-grid ${!panels.projects ? 'sidebar-closed' : ''} ${
              !panels.agents ? 'agent-closed' : ''
            }`}
            style={bodyGridStyle}
          >
            {panels.projects ? (
              <>
                <ProjectSidebar
                  visible={panels.projects}
                  onResizeStart={startPanelResize('left')}
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
                <div
                  className="resize-handle handle-left"
                  data-testid="left-resize-handle"
                  role="separator"
                  aria-label="Resize project panel"
                  aria-orientation="vertical"
                  onPointerDown={startPanelResize('left')}
                />
              </>
            ) : null}

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

            {panels.agents ? (
              <>
                <div
                  className="resize-handle handle-right"
                  data-testid="right-resize-handle"
                  role="separator"
                  aria-label="Resize agent panel"
                  aria-orientation="vertical"
                  onPointerDown={startPanelResize('right')}
                />
                <AgentSidebar
                  visible={panels.agents}
                  onResizeStart={startPanelResize('right')}
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
              </>
            ) : null}
          </div>

          <StatusBar
            gitLabel={gitLabel}
            changedFileCount={changedFileCount}
            tabCount={workbenchTabCount}
            groupCount={workbenchGroupCount}
            executionMode={executionMode}
            activeContext={activeContext}
          />
        </div>
      </div>
    </div>
  )
}

export default App
