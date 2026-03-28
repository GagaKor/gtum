import { useCallback, useMemo, useState } from 'react'
import {
  requestAgentSuggestions,
  type AgentConnectionSnapshot,
  type AgentProviderId,
  type ExecutionMode,
  type ProjectFileSnapshot,
  type ProjectOverview,
  type TerminalSessionLogs,
  type TerminalSessionSnapshot,
} from '../../../lib/runtime'
import type { AgentContextSnapshot } from '../../../stores/workspace-store'
import { buildProviderUiContract } from '../../auth/model/provider-ui'
import type { RecordTask } from '../../tasks/model/types'
import { buildDisplayFileAnchor, buildFileSnippet } from '../../../shared/lib/file-context'
import { formatModeLabel } from '../../../shared/lib/formatters'
import type { AgentSuggestion, AgentSuggestionTarget } from './types'

type UseAgentSuggestionsParams = {
  activeProject: string
  activeProjectPath: string
  projectOverview: ProjectOverview | null
  selectedProvider: AgentProviderId
  executionMode: ExecutionMode
  selectedFile: ProjectFileSnapshot | null
  selectedFilePath: string | null
  selectedFileLine: number | null
  agentConnections: AgentConnectionSnapshot[]
  activeSession: TerminalSessionSnapshot | null
  terminalLogs: TerminalSessionLogs | null
  agentContext: AgentContextSnapshot | null
  captureTerminalContext: (snapshot: AgentContextSnapshot | null) => void
  recordTask: RecordTask
  setActiveContext: (context: string) => void
  executeCommandInTarget: (
    command: string,
    target: AgentSuggestionTarget,
    options?: { newTabNameBase?: string },
  ) => Promise<void>
}

export const useAgentSuggestions = ({
  activeProject,
  activeProjectPath,
  projectOverview,
  selectedProvider,
  executionMode,
  selectedFile,
  selectedFilePath,
  selectedFileLine,
  agentConnections,
  activeSession,
  terminalLogs,
  agentContext,
  captureTerminalContext,
  recordTask,
  setActiveContext,
  executeCommandInTarget,
}: UseAgentSuggestionsParams) => {
  const [agentRequestInput, setAgentRequestInput] = useState('')
  const [agentRequestError, setAgentRequestError] = useState<string | null>(null)
  const [agentSuggestions, setAgentSuggestions] = useState<AgentSuggestion[]>([])

  const buildLiveContextSnapshot = useCallback(() => {
    if (activeSession && terminalLogs) {
      return {
        tabId: String(activeSession.sessionId),
        tabTitle: activeSession.name,
        lines: terminalLogs.entries.slice(-50),
        capturedAt: new Date().toISOString(),
      } satisfies AgentContextSnapshot
    }

    return agentContext
  }, [activeSession, agentContext, terminalLogs])

  const requestContextSnapshot = useMemo(
    () => buildLiveContextSnapshot(),
    [buildLiveContextSnapshot],
  )

  const submitAgentRequest = useCallback(async () => {
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
    const activeFileSnippet = buildFileSnippet(selectedFile, selectedFileLine)

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
        activeFilePath: selectedFile?.filePath ?? selectedFilePath,
        activeFileLine: selectedFileLine,
        activeFileSnippet,
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
        fileLabel: buildDisplayFileAnchor(selectedFile?.displayPath ?? null, selectedFileLine),
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
        `${normalizedRequest} • ${buildDisplayFileAnchor(
          selectedFile?.displayPath ?? null,
          selectedFileLine,
        )} • ${mappedSuggestions[0]?.attachedLogLines ?? 0} log line(s) • ${formatModeLabel(
          executionMode,
        )}`,
        mappedSuggestions.some((entry) => entry.error) ? 'error' : 'done',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setAgentRequestError(message)
      recordTask(`${connectedProvider.displayName} suggestion failed`, message, 'error')
    }
  }, [
    activeProject,
    activeProjectPath,
    activeSession,
    agentConnections,
    agentRequestInput,
    buildLiveContextSnapshot,
    captureTerminalContext,
    executionMode,
    projectOverview,
    recordTask,
    selectedFile,
    selectedFileLine,
    selectedFilePath,
    selectedProvider,
    setActiveContext,
  ])

  const approveSuggestion = useCallback(
    async (suggestion: AgentSuggestion, target: AgentSuggestionTarget) => {
      if (suggestion.status !== 'pending' || suggestion.error || !suggestion.command) {
        return
      }

      try {
        await executeCommandInTarget(suggestion.command, target, {
          newTabNameBase: `agent-${suggestion.provider}`,
        })
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
    },
    [executeCommandInTarget, recordTask, setActiveContext],
  )

  return {
    agentRequestInput,
    setAgentRequestInput,
    agentRequestError,
    agentSuggestions,
    requestContextSnapshot,
    submitAgentRequest,
    approveSuggestion,
  }
}
