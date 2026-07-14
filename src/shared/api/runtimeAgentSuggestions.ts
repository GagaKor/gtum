import { invoke } from '@tauri-apps/api/core'

import type {
  AgentModelRef,
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

export type RuntimeAgentAttachmentKind = 'image' | 'file' | 'directory' | 'active_tab'

export type RuntimeAgentAttachmentCapability = {
  kind: RuntimeAgentAttachmentKind
  label: string
  enabled: boolean
  invocationFlag?: string | null
}

export type RuntimeAgentAttachmentRef = {
  kind: RuntimeAgentAttachmentKind
  path: string
  label?: string | null
}

export type RuntimeAgentReasoningLevel = string

export type RuntimeAgentReasoningLevelCapability = {
  level: RuntimeAgentReasoningLevel
  label: string
  description?: string | null
}

export type RuntimeAgentProviderCapabilities = {
  provider: AgentProviderId
  supportsModelSelection: boolean
  currentModel?: AgentModelRef | null
  availableModels: AgentModelRef[]
  reasoningLevels: RuntimeAgentReasoningLevelCapability[]
  defaultReasoningLevel?: RuntimeAgentReasoningLevel | null
  supportsFastMode: boolean
  attachments: RuntimeAgentAttachmentCapability[]
}

export type AgentSuggestionProjectInput = Pick<RuntimeProject, 'name' | 'path'>

export type AgentSuggestionTabInput = {
  id?: string | null
  projectPath?: string | null
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
  model?: string | null
  reasoningLevel?: RuntimeAgentReasoningLevel | null
  fastMode?: boolean | null
  attachments?: RuntimeAgentAttachmentRef[]
}

export type AgentSuggestionRuntimeServiceOptions = {
  hasRuntime?: () => boolean
  invokeRuntime?: RuntimeInvoker
}

export type AgentSuggestionRuntimeService = {
  hasRuntime: () => boolean
  readProviderDiagnostics(provider: AgentProviderId): Promise<RuntimeAgentProviderDiagnostics>
  readProviderCapabilities(provider: AgentProviderId): Promise<RuntimeAgentProviderCapabilities>
  requestSuggestions(input: RequestAgentSuggestionsInput): Promise<AgentSuggestionCard[]>
}

type RuntimeAgentOverride = {
  hasRuntime?: () => boolean
  invokeRuntime?: RuntimeInvoker
}

const MAX_ATTACHED_LOG_LINES = 50
const MAX_FILE_SNIPPET_CHARS = 4_000

const validateActiveTabOwner = (input: RequestAgentSuggestionsInput): void => {
  const activeTab = input.activeTab
  if (!activeTab) return

  const owner = activeTab.projectPath
  const requiresOwner = activeTab.type === 'editor' || activeTab.runtimeBacked === true
  if (typeof owner !== 'string' || owner.trim().length === 0) {
    if (requiresOwner) throw new Error('Active tab project owner is missing.')
    return
  }

  if (owner !== input.project.path) {
    throw new Error('Active tab project owner mismatch.')
  }
}

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
  model: input.model?.trim() || null,
  reasoningLevel: input.reasoningLevel || null,
  fastMode: input.fastMode ?? false,
  attachments: (input.attachments || [])
    .map((attachment) => ({
      kind: attachment.kind,
      path: attachment.path.trim(),
      label: attachment.label?.trim() || null,
    }))
    .filter((attachment) => attachment.path.length > 0),
  projectName: input.project.name,
  projectPath: input.project.path,
  activeTabId: input.activeTab?.id ?? null,
  activeTabTitle: input.activeTab?.title ?? null,
  activeFilePath: activeFilePathFromTab(input.activeTab),
  activeFileLine: input.activeTab?.type === 'editor' ? input.activeTab.activeLine ?? null : null,
  activeFileSnippet: activeFileSnippetFromTab(input.activeTab),
  lastNLogLines: recentLogLinesFromTab(input.activeTab),
  userTask: input.userTask,
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
  const summary = normalizeText(suggestion.summary)
  const confidence = normalizeConfidence(suggestion.confidence)
  const preferredTarget = normalizeTarget(suggestion.preferredTarget)

  if (!command && !error && !summary) {
    throw new Error('Codex CLI returned an empty response without a command or error reason.')
  }

  return {
    id: normalizeText(suggestion.id) || `codex-${Date.now()}`,
    provider: suggestion.provider,
    title:
      summary ||
      (error ? 'Codex suggestion unavailable' : 'Codex response'),
    commands: command
      ? [
          {
            cmd: command,
            risk: riskFromConfidence(confidence),
            target: targetFromRuntime(preferredTarget, activeTab),
          },
        ]
      : [],
    note: error || (command ? `Codex confidence: ${confidence}` : ''),
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

const fallbackCapabilities = (provider: AgentProviderId): RuntimeAgentProviderCapabilities => ({
  provider,
  supportsModelSelection: false,
  currentModel: null,
  availableModels: [],
  reasoningLevels: [],
  defaultReasoningLevel: null,
  supportsFastMode: false,
  attachments: [],
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
    async readProviderCapabilities(provider) {
      if (!hasRuntime()) return fallbackCapabilities(provider)

      return invokeRuntime<RuntimeAgentProviderCapabilities>('read_agent_provider_capabilities', {
        provider,
      })
    },
    async requestSuggestions(input) {
      if (!hasRuntime()) return []
      validateActiveTabOwner(input)

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
