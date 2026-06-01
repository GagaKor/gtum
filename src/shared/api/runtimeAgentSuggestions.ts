import { invoke } from '@tauri-apps/api/core'

import type {
  AgentExecutionMode,
  AgentProviderId,
  AgentSuggestionCard,
  AgentSuggestionConfidence,
  AgentSuggestionTarget,
} from '../../entities/agent/model/types'
import {
  hasTauriRuntime,
  type RuntimeInvoker,
  type RuntimeProject,
} from './runtimeProjects'
import type { TerminalLine } from './runtimeTerminals'

export type AgentProviderSetupState = 'ready' | 'needs_setup' | 'deferred'

export type RuntimeAgentSuggestionResponse = {
  id: string
  provider: AgentProviderId
  summary: string
  command: string
  preferredTarget: AgentSuggestionTarget
  confidence: AgentSuggestionConfidence
  error?: string | null
}

export type RuntimeAgentProviderRequirement = {
  name: string
  required: boolean
  present: boolean
}

export type RuntimeAgentProviderDiagnostics = {
  provider: AgentProviderId
  setupState: AgentProviderSetupState
  connectionPath: string
  summary: string
  guidance: string
  baseUrl?: string | null
  model?: string | null
  requirements: RuntimeAgentProviderRequirement[]
}

export type AgentSuggestionProjectInput = Pick<RuntimeProject, 'name' | 'path'>

export type AgentSuggestionTabInput = {
  id?: string | null
  type?: string | null
  title?: string | null
  path?: string | null
  displayPath?: string | null
  content?: string | null
  activeLine?: number | null
  lines?: readonly (TerminalLine | string)[]
  runtimeBacked?: boolean | null
  terminalSessionId?: number | null
}

export type RequestAgentSuggestionsInput = {
  provider: AgentProviderId
  project: AgentSuggestionProjectInput
  activeTab?: AgentSuggestionTabInput | null
  userTask: string
  executionMode: AgentExecutionMode
}

export type AgentSuggestionRuntimeServiceOptions = {
  hasRuntime?: () => boolean
  invokeRuntime?: RuntimeInvoker
}

export type AgentSuggestionRuntimeService = {
  hasRuntime: () => boolean
  readProviderDiagnostics(provider: AgentProviderId): Promise<RuntimeAgentProviderDiagnostics>
  requestSuggestions(input: RequestAgentSuggestionsInput): Promise<AgentSuggestionCard[]>
}

type RuntimeAgentOverride = {
  hasRuntime?: () => boolean
  invokeRuntime?: RuntimeInvoker
}

const MAX_ATTACHED_LOG_LINES = 50
const MAX_FILE_SNIPPET_CHARS = 4_000

const agentOverride = (): RuntimeAgentOverride | null => {
  if (typeof window === 'undefined') return null

  return (
    (window as Window & { __GTUM_AGENT_RUNTIME__?: RuntimeAgentOverride })
      .__GTUM_AGENT_RUNTIME__ ?? null
  )
}

const isTerminalLine = (line: TerminalLine | string): line is TerminalLine =>
  typeof line === 'object' && line != null && 'text' in line

export const textFromTerminalLine = (line: TerminalLine | string): string =>
  isTerminalLine(line) ? line.text : String(line)

export const recentLogLinesFromTab = (tab?: AgentSuggestionTabInput | null): string[] => {
  if (!tab || tab.type === 'editor') return []

  return (tab.lines ?? [])
    .map(textFromTerminalLine)
    .filter((line) => line.trim().length > 0)
    .slice(-MAX_ATTACHED_LOG_LINES)
}

export const activeFilePathFromTab = (
  tab?: AgentSuggestionTabInput | null,
): string | null => {
  if (!tab || tab.type !== 'editor') return null

  return tab.displayPath || tab.path || tab.title || null
}

export const activeFileSnippetFromTab = (
  tab?: AgentSuggestionTabInput | null,
): string | null => {
  if (!tab || tab.type !== 'editor') return null
  if (!tab.content) return null

  return tab.content.slice(0, MAX_FILE_SNIPPET_CHARS)
}

const requestPayloadFromInput = (input: RequestAgentSuggestionsInput): Record<string, unknown> => ({
  provider: input.provider,
  projectName: input.project.name,
  projectPath: input.project.path,
  activeTabId: input.activeTab?.id ?? null,
  activeTabTitle: input.activeTab?.title ?? null,
  activeFilePath: activeFilePathFromTab(input.activeTab),
  activeFileLine: input.activeTab?.type === 'editor' ? input.activeTab.activeLine ?? null : null,
  activeFileSnippet: activeFileSnippetFromTab(input.activeTab),
  lastNLogLines: recentLogLinesFromTab(input.activeTab),
  userTask: input.userTask,
  executionMode: input.executionMode,
})

const riskFromConfidence = (confidence: AgentSuggestionConfidence): 'low' | 'mid' | 'high' => {
  if (confidence === 'low') return 'mid'

  return 'low'
}

const normalizeText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

const normalizeConfidence = (value: unknown): AgentSuggestionConfidence =>
  value === 'low' || value === 'medium' || value === 'high' ? value : 'low'

const normalizeTarget = (value: unknown): AgentSuggestionTarget =>
  value === 'current_tab' ? 'current_tab' : 'new_tab'

const targetFromRuntime = (
  preferredTarget: AgentSuggestionTarget,
  activeTab?: AgentSuggestionTabInput | null,
): string => {
  if (preferredTarget === 'new_tab') return 'new'
  if (!activeTab?.runtimeBacked || activeTab.terminalSessionId == null) return 'new'

  return activeTab?.id || 'new'
}

export const suggestionCardFromRuntime = (
  suggestion: RuntimeAgentSuggestionResponse,
  activeTab?: AgentSuggestionTabInput | null,
): AgentSuggestionCard => {
  const command = normalizeText(suggestion.command)
  const error = normalizeText(suggestion.error)
  const confidence = normalizeConfidence(suggestion.confidence)
  const preferredTarget = normalizeTarget(suggestion.preferredTarget)

  if (!command && !error) {
    throw new Error('Codex CLI returned an empty command without an error reason.')
  }

  return {
    id: normalizeText(suggestion.id) || `codex-${Date.now()}`,
    provider: suggestion.provider,
    title:
      normalizeText(suggestion.summary) ||
      (error ? 'Codex suggestion unavailable' : 'Codex suggestion'),
    commands: command
      ? [
          {
            cmd: command,
            risk: riskFromConfidence(confidence),
            target: targetFromRuntime(preferredTarget, activeTab),
          },
        ]
      : [],
    note: error || `Codex confidence: ${confidence}`,
    error: error || null,
  }
}

const fallbackDiagnostics = (provider: AgentProviderId): RuntimeAgentProviderDiagnostics => ({
  provider,
  setupState: 'deferred',
  connectionPath: 'Browser preview',
  summary: 'Desktop runtime is not connected.',
  guidance: 'Open gtum through the Tauri desktop runtime to request real provider diagnostics.',
  baseUrl: null,
  model: null,
  requirements: [],
})

export const createAgentSuggestionRuntimeService = (
  options: AgentSuggestionRuntimeServiceOptions = {},
): AgentSuggestionRuntimeService => {
  const override = agentOverride()
  const hasRuntime = options.hasRuntime || override?.hasRuntime || hasTauriRuntime
  const invokeRuntime = options.invokeRuntime || override?.invokeRuntime || (invoke as RuntimeInvoker)

  return {
    hasRuntime,
    async readProviderDiagnostics(provider) {
      if (!hasRuntime()) return fallbackDiagnostics(provider)

      return invokeRuntime<RuntimeAgentProviderDiagnostics>('read_agent_provider_diagnostics', {
        provider,
      })
    },
    async requestSuggestions(input) {
      if (!hasRuntime()) return []

      const responses = await invokeRuntime<RuntimeAgentSuggestionResponse[]>(
        'request_agent_suggestions',
        {
          request: requestPayloadFromInput(input),
        },
      )

      return responses.map((response) => suggestionCardFromRuntime(response, input.activeTab))
    },
  }
}

export const agentSuggestionRuntimeService = createAgentSuggestionRuntimeService()
