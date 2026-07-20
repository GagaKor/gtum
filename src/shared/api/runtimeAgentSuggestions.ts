import { invoke } from '@tauri-apps/api/core'

import type {
  AgentAccountLease,
  AgentAccountSuggestionCard,
  AgentModelRef,
  AgentProviderId,
  AgentSuggestionCard,
  AgentSuggestionConfidence,
  AgentSuggestionTarget,
} from '../../entities/agent/model/types'
import {
  EXACT_AGENT_ACCOUNT_LEASE_REQUIRED_ERROR,
  normalizeRuntimeAgentLease,
} from './runtimeAgentAuth'
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

export type RuntimeAgentAccountSuggestionResponse = RuntimeAgentSuggestionResponse &
  AgentAccountLease

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

export type RuntimeAgentAccountProviderDiagnostics = RuntimeAgentProviderDiagnostics &
  AgentAccountLease

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

export type RuntimeAgentModelExecutionOptions = {
  reasoningLevels: RuntimeAgentReasoningLevelCapability[]
  supportsFastMode: boolean
}

export type RuntimeAgentModelCapability = AgentModelRef & {
  executionOptions?: RuntimeAgentModelExecutionOptions
}

export type RuntimeAgentProviderCapabilities = {
  provider: AgentProviderId
  supportsModelSelection: boolean
  currentModel?: RuntimeAgentModelCapability | null
  availableModels: RuntimeAgentModelCapability[]
  reasoningLevels: RuntimeAgentReasoningLevelCapability[]
  defaultReasoningLevel?: RuntimeAgentReasoningLevel | null
  supportsFastMode: boolean
  attachments: RuntimeAgentAttachmentCapability[]
}

export type RuntimeAgentAccountProviderCapabilities = RuntimeAgentProviderCapabilities &
  AgentAccountLease

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
  agentSessionId: string
  project: AgentSuggestionProjectInput
  activeTab?: AgentSuggestionTabInput | null
  userTask: string
  model?: string | null
  reasoningLevel?: RuntimeAgentReasoningLevel | null
  fastMode?: boolean | null
  attachments?: RuntimeAgentAttachmentRef[]
}

export type RequestAgentAccountSuggestionsInput = RequestAgentSuggestionsInput & AgentAccountLease

export type AgentSuggestionRuntimeServiceOptions = {
  hasRuntime?: () => boolean
  invokeRuntime?: RuntimeInvoker
}

export type AgentSuggestionRuntimeService = {
  hasRuntime: () => boolean
  readProviderDiagnostics(provider: AgentProviderId): Promise<RuntimeAgentProviderDiagnostics>
  readProviderCapabilities(provider: AgentProviderId): Promise<RuntimeAgentProviderCapabilities>
  requestSuggestions(input: RequestAgentSuggestionsInput): Promise<AgentSuggestionCard[]>
  readAccountDiagnostics(
    lease: AgentAccountLease,
  ): Promise<RuntimeAgentAccountProviderDiagnostics>
  readAccountCapabilities(
    lease: AgentAccountLease,
  ): Promise<RuntimeAgentAccountProviderCapabilities>
  requestAccountSuggestions(
    input: RequestAgentAccountSuggestionsInput,
  ): Promise<AgentAccountSuggestionCard[]>
}

type RuntimeAgentOverride = {
  hasRuntime?: () => boolean
  invokeRuntime?: RuntimeInvoker
}

const MAX_ATTACHED_LOG_LINES = 50
const MAX_FILE_SNIPPET_CHARS = 4_000

const providerLabel = (provider: AgentProviderId): string =>
  provider === 'codex' ? 'Codex' : 'Claude'

const validateAgentSessionOwner = (input: RequestAgentSuggestionsInput): void => {
  if (input.agentSessionId.trim().length === 0) {
    throw new Error('Agent session owner is missing.')
  }
}

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
  agentSessionId: input.agentSessionId.trim(),
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

const accountRequestPayloadFromInput = (
  input: RequestAgentAccountSuggestionsInput,
): Record<string, unknown> => ({
  ...requestPayloadFromInput(input),
  accountId: input.accountId,
  incarnation: input.incarnation,
  credentialRevision: input.credentialRevision,
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
  const label = providerLabel(suggestion.provider)
  const command = normalizeText(suggestion.command)
  const error = normalizeText(suggestion.error)
  const summary = normalizeText(suggestion.summary)
  const confidence = normalizeConfidence(suggestion.confidence)
  const preferredTarget = normalizeTarget(suggestion.preferredTarget)

  if (!command && !error && !summary) {
    throw new Error(`${label} CLI returned an empty response without a command or error reason.`)
  }

  return {
    id: normalizeText(suggestion.id) || `${suggestion.provider}-${Date.now()}`,
    provider: suggestion.provider,
    title:
      summary ||
      (error ? `${label} suggestion unavailable` : `${label} response`),
    commands: command
      ? [
          {
            cmd: command,
            risk: riskFromConfidence(confidence),
            target: targetFromRuntime(preferredTarget, activeTab),
          },
        ]
      : [],
    note: error || (command ? `${label} confidence: ${confidence}` : ''),
    error: error || null,
  }
}

export const accountSuggestionCardFromRuntime = (
  suggestion: RuntimeAgentAccountSuggestionResponse,
  activeTab?: AgentSuggestionTabInput | null,
): AgentAccountSuggestionCard => ({
  ...suggestionCardFromRuntime(suggestion, activeTab),
  provider: suggestion.provider,
  accountId: suggestion.accountId,
})

const normalizeAccountSuggestionResponses = (
  value: unknown,
  requestedLease: AgentAccountLease,
): RuntimeAgentAccountSuggestionResponse[] => {
  if (!Array.isArray(value)) throw new Error('Agent suggestion response must be an array.')

  return value.map((response, index) => {
    if (typeof response !== 'object' || response == null || Array.isArray(response)) {
      throw new Error(`Agent suggestion response[${index}] must be an object.`)
    }
    const rawResponse = response as Record<string, unknown>
    const responseLease = normalizeRuntimeAgentLease(
      {
        provider: rawResponse.provider,
        accountId: rawResponse.accountId,
        incarnation: rawResponse.incarnation,
        credentialRevision: rawResponse.credentialRevision,
      },
      `Agent suggestion response[${index}]`,
    )
    if (responseLease.provider !== requestedLease.provider) {
      throw new Error(
        `Agent suggestion provider mismatch: requested ${providerLabel(requestedLease.provider)} but received ${providerLabel(responseLease.provider)}.`,
      )
    }
    if (responseLease.accountId !== requestedLease.accountId) {
      throw new Error(
        `Agent suggestion account mismatch: requested ${requestedLease.accountId} but received ${responseLease.accountId}.`,
      )
    }
    if (
      responseLease.incarnation !== requestedLease.incarnation ||
      responseLease.credentialRevision !== requestedLease.credentialRevision
    ) {
      throw new Error(
        `Agent suggestion lease mismatch: expected ${requestedLease.incarnation}/${requestedLease.credentialRevision} but received ${responseLease.incarnation}/${responseLease.credentialRevision}.`,
      )
    }

    return { ...(response as RuntimeAgentSuggestionResponse), ...responseLease }
  })
}

const normalizeCapabilityModelText = (value: unknown, field: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized.length > 0) return normalized

  throw new Error(`Provider capability ${field} must be a non-empty string.`)
}

const MODEL_EXECUTION_REASONING_LEVELS = new Set([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])
const MAX_MODEL_EXECUTION_REASONING_LEVELS = 5
const MAX_MODEL_EXECUTION_REASONING_LEVEL_BYTES = 16
const MAX_MODEL_EXECUTION_REASONING_LABEL_BYTES = 64
const MAX_MODEL_EXECUTION_REASONING_DESCRIPTION_BYTES = 160

const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).byteLength

const normalizeModelExecutionText = (
  value: unknown,
  field: string,
  maxBytes: number,
): string => {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized.length > 0 && utf8ByteLength(normalized) <= maxBytes) return normalized

  throw new Error(
    `Provider capability ${field} must be a non-empty string no longer than ${maxBytes} bytes.`,
  )
}

const normalizeModelExecutionReasoningLevel = (
  value: unknown,
  field: string,
): RuntimeAgentReasoningLevelCapability => {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    throw new Error(`Provider capability ${field} must be an object.`)
  }

  const capability = value as Record<string, unknown>
  const level = capability.level
  if (
    typeof level !== 'string' ||
    utf8ByteLength(level) > MAX_MODEL_EXECUTION_REASONING_LEVEL_BYTES ||
    !MODEL_EXECUTION_REASONING_LEVELS.has(level)
  ) {
    throw new Error(
      `Provider capability ${field}.level must be an exact supported reasoning level no longer than ${MAX_MODEL_EXECUTION_REASONING_LEVEL_BYTES} bytes.`,
    )
  }

  const normalized: RuntimeAgentReasoningLevelCapability = {
    level,
    label: normalizeModelExecutionText(
      capability.label,
      `${field}.label`,
      MAX_MODEL_EXECUTION_REASONING_LABEL_BYTES,
    ),
  }
  if (capability.description === null) {
    normalized.description = null
  } else if (capability.description !== undefined) {
    normalized.description = normalizeModelExecutionText(
      capability.description,
      `${field}.description`,
      MAX_MODEL_EXECUTION_REASONING_DESCRIPTION_BYTES,
    )
  }

  return normalized
}

const normalizeModelExecutionOptions = (
  value: unknown,
  field: string,
): RuntimeAgentModelExecutionOptions => {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    throw new Error(`Provider capability ${field} must be an object.`)
  }

  const options = value as Record<string, unknown>
  if (!Array.isArray(options.reasoningLevels)) {
    throw new Error(`Provider capability ${field}.reasoningLevels must be an array.`)
  }
  if (options.reasoningLevels.length > MAX_MODEL_EXECUTION_REASONING_LEVELS) {
    throw new Error(
      `Provider capability ${field}.reasoningLevels must contain at most ${MAX_MODEL_EXECUTION_REASONING_LEVELS} entries.`,
    )
  }
  if (typeof options.supportsFastMode !== 'boolean') {
    throw new Error(`Provider capability ${field}.supportsFastMode must be a boolean.`)
  }

  const seenLevels = new Set<string>()
  const reasoningLevels = options.reasoningLevels.map((level, index) => {
    const normalized = normalizeModelExecutionReasoningLevel(
      level,
      `${field}.reasoningLevels[${index}]`,
    )
    if (seenLevels.has(normalized.level)) {
      throw new Error(
        `Provider capability ${field}.reasoningLevels contains duplicate level "${normalized.level}".`,
      )
    }
    seenLevels.add(normalized.level)
    return normalized
  })

  return {
    reasoningLevels,
    supportsFastMode: options.supportsFastMode,
  }
}

const normalizeCapabilityModel = (
  value: unknown,
  requestedProvider: AgentProviderId,
  field: string,
): RuntimeAgentModelCapability => {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    throw new Error(`Provider capability ${field} must be an object.`)
  }
  const model = value as Record<string, unknown>
  if (model.providerId !== requestedProvider) {
    throw new Error(
      `Provider capability owner mismatch at ${field}: expected ${requestedProvider} but received ${String(model.providerId)}.`,
    )
  }

  const normalized: RuntimeAgentModelCapability = {
    providerId: requestedProvider,
    modelId: normalizeCapabilityModelText(model.modelId, `${field}.modelId`),
    label: normalizeCapabilityModelText(model.label, `${field}.label`),
  }
  if (Object.prototype.hasOwnProperty.call(model, 'executionOptions')) {
    normalized.executionOptions = normalizeModelExecutionOptions(
      model.executionOptions,
      `${field}.executionOptions`,
    )
  }

  return normalized
}

const projectProviderReasoningLevel = (
  value: unknown,
  field: string,
): RuntimeAgentReasoningLevelCapability => {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    throw new Error(`Provider capability ${field} must be an object.`)
  }
  const reasoning = value as Record<string, unknown>
  if (typeof reasoning.level !== 'string' || typeof reasoning.label !== 'string') {
    throw new Error(`Provider capability ${field} level and label must be strings.`)
  }

  const projected: RuntimeAgentReasoningLevelCapability = {
    level: reasoning.level,
    label: reasoning.label,
  }
  if (reasoning.description === null || typeof reasoning.description === 'string') {
    projected.description = reasoning.description
  } else if (reasoning.description !== undefined) {
    throw new Error(`Provider capability ${field}.description must be a string or null.`)
  }
  return projected
}

const projectProviderAttachment = (
  value: unknown,
  field: string,
): RuntimeAgentAttachmentCapability => {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    throw new Error(`Provider capability ${field} must be an object.`)
  }
  const attachment = value as Record<string, unknown>
  if (
    attachment.kind !== 'image' &&
    attachment.kind !== 'file' &&
    attachment.kind !== 'directory' &&
    attachment.kind !== 'active_tab'
  ) {
    throw new Error(`Provider capability ${field}.kind is invalid.`)
  }
  if (typeof attachment.label !== 'string' || typeof attachment.enabled !== 'boolean') {
    throw new Error(`Provider capability ${field} label and enabled fields are invalid.`)
  }

  const projected: RuntimeAgentAttachmentCapability = {
    kind: attachment.kind,
    label: attachment.label,
    enabled: attachment.enabled,
  }
  if (attachment.invocationFlag === null || typeof attachment.invocationFlag === 'string') {
    projected.invocationFlag = attachment.invocationFlag
  } else if (attachment.invocationFlag !== undefined) {
    throw new Error(`Provider capability ${field}.invocationFlag must be a string or null.`)
  }
  return projected
}

const normalizeProviderCapabilities = (
  value: unknown,
  requestedProvider: AgentProviderId,
): RuntimeAgentProviderCapabilities => {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    throw new Error('Provider capabilities must be an object.')
  }
  const rawCapabilities = value as Record<string, unknown>
  if (rawCapabilities.provider !== requestedProvider) {
    throw new Error(
      `Provider capability owner mismatch: requested ${requestedProvider} but received ${String(rawCapabilities.provider)}.`,
    )
  }

  const capabilities = value as RuntimeAgentProviderCapabilities
  if (!Array.isArray(capabilities.availableModels)) {
    throw new Error('Provider capability availableModels must be an array.')
  }
  if (!Array.isArray(capabilities.reasoningLevels)) {
    throw new Error('Provider capability reasoningLevels must be an array.')
  }
  if (!Array.isArray(capabilities.attachments)) {
    throw new Error('Provider capability attachments must be an array.')
  }
  if (
    typeof capabilities.supportsModelSelection !== 'boolean' ||
    typeof capabilities.supportsFastMode !== 'boolean'
  ) {
    throw new Error('Provider capability support flags must be booleans.')
  }

  const availableModelIds = new Set<string>()
  const availableModels = capabilities.availableModels.map((model, index) => {
    const normalized = normalizeCapabilityModel(
      model,
      requestedProvider,
      `availableModels[${index}]`,
    )
    if (availableModelIds.has(normalized.modelId)) {
      throw new Error(
        `Provider capabilities contain duplicate available model ID "${normalized.modelId}".`,
      )
    }
    availableModelIds.add(normalized.modelId)
    return normalized
  })

  const normalized: RuntimeAgentProviderCapabilities = {
    provider: requestedProvider,
    supportsModelSelection: capabilities.supportsModelSelection,
    currentModel:
      rawCapabilities.currentModel === null
        ? null
        : normalizeCapabilityModel(
            rawCapabilities.currentModel,
            requestedProvider,
            'currentModel',
          ),
    availableModels,
    reasoningLevels: capabilities.reasoningLevels.map((reasoning, index) =>
      projectProviderReasoningLevel(reasoning, `reasoningLevels[${index}]`),
    ),
    supportsFastMode: capabilities.supportsFastMode,
    attachments: capabilities.attachments.map((attachment, index) =>
      projectProviderAttachment(attachment, `attachments[${index}]`),
    ),
  }
  if (Object.prototype.hasOwnProperty.call(rawCapabilities, 'defaultReasoningLevel')) {
    const defaultReasoningLevel = rawCapabilities.defaultReasoningLevel
    if (defaultReasoningLevel !== null && typeof defaultReasoningLevel !== 'string') {
      throw new Error(
        'Provider capability defaultReasoningLevel must be a string or null.',
      )
    }
    normalized.defaultReasoningLevel = defaultReasoningLevel
  }
  return normalized
}

const normalizeAccountProviderCapabilities = (
  value: unknown,
  requestedLease: AgentAccountLease,
): RuntimeAgentAccountProviderCapabilities => {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    throw new Error('Provider capabilities must be an object.')
  }
  const rawCapabilities = value as Record<string, unknown>
  if (rawCapabilities.provider !== requestedLease.provider) {
    throw new Error(
      `Provider capability owner mismatch: requested ${requestedLease.provider}/${requestedLease.accountId} but received ${String(rawCapabilities.provider)}/${String(rawCapabilities.accountId)}.`,
    )
  }
  const responseLease = normalizeRuntimeAgentLease(
    {
      provider: rawCapabilities.provider,
      accountId: rawCapabilities.accountId,
      incarnation: rawCapabilities.incarnation,
      credentialRevision: rawCapabilities.credentialRevision,
    },
    'Provider capability response',
  )
  if (responseLease.accountId !== requestedLease.accountId) {
    throw new Error(
      `Provider capability owner mismatch: requested ${requestedLease.provider}/${requestedLease.accountId} but received ${responseLease.provider}/${responseLease.accountId}.`,
    )
  }
  if (
    responseLease.incarnation !== requestedLease.incarnation ||
    responseLease.credentialRevision !== requestedLease.credentialRevision
  ) {
    throw new Error(
      `Provider capability lease mismatch: expected ${requestedLease.incarnation}/${requestedLease.credentialRevision} but received ${responseLease.incarnation}/${responseLease.credentialRevision}.`,
    )
  }

  return {
    ...normalizeProviderCapabilities(value, requestedLease.provider),
    ...responseLease,
  }
}

const normalizeProviderDiagnostics = (
  value: unknown,
  requestedProvider: AgentProviderId,
): RuntimeAgentProviderDiagnostics => {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    throw new Error('Provider diagnostics must be an object.')
  }
  const diagnostics = value as Record<string, unknown>
  if (diagnostics.provider !== requestedProvider) {
    throw new Error(
      `Provider diagnostic owner mismatch: requested ${requestedProvider} but received ${String(diagnostics.provider)}.`,
    )
  }
  if (
    diagnostics.setupState !== 'ready' &&
    diagnostics.setupState !== 'needs_setup' &&
    diagnostics.setupState !== 'deferred'
  ) {
    throw new Error('Provider diagnostic setupState is invalid.')
  }
  for (const field of ['connectionPath', 'summary', 'guidance'] as const) {
    if (typeof diagnostics[field] !== 'string') {
      throw new Error(`Provider diagnostic ${field} must be a string.`)
    }
  }
  if (!Array.isArray(diagnostics.requirements)) {
    throw new Error('Provider diagnostic requirements must be an array.')
  }

  const requirements = diagnostics.requirements.map((requirement, index) => {
    if (typeof requirement !== 'object' || requirement == null || Array.isArray(requirement)) {
      throw new Error(`Provider diagnostic requirements[${index}] must be an object.`)
    }
    const item = requirement as Record<string, unknown>
    if (
      typeof item.name !== 'string' ||
      typeof item.required !== 'boolean' ||
      typeof item.present !== 'boolean'
    ) {
      throw new Error(
        `Provider diagnostic requirements[${index}] must contain a string name and boolean flags.`,
      )
    }
    return { name: item.name, required: item.required, present: item.present }
  })
  const optionalString = (field: 'baseUrl' | 'model'): string | null | undefined => {
    const fieldValue = diagnostics[field]
    if (fieldValue === undefined || fieldValue === null || typeof fieldValue === 'string') {
      return fieldValue
    }
    throw new Error(`Provider diagnostic ${field} must be a string or null.`)
  }

  return {
    provider: requestedProvider,
    setupState: diagnostics.setupState,
    connectionPath: diagnostics.connectionPath as string,
    summary: diagnostics.summary as string,
    guidance: diagnostics.guidance as string,
    baseUrl: optionalString('baseUrl'),
    model: optionalString('model'),
    requirements,
  }
}

const normalizeAccountProviderDiagnostics = (
  value: unknown,
  requestedLease: AgentAccountLease,
): RuntimeAgentAccountProviderDiagnostics => {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    throw new Error('Provider diagnostics must be an object.')
  }
  const diagnostics = value as Record<string, unknown>
  if (diagnostics.provider !== requestedLease.provider) {
    throw new Error(
      `Provider diagnostic owner mismatch: requested ${requestedLease.provider}/${requestedLease.accountId} but received ${String(diagnostics.provider)}/${String(diagnostics.accountId)}.`,
    )
  }
  const responseLease = normalizeRuntimeAgentLease(
    {
      provider: diagnostics.provider,
      accountId: diagnostics.accountId,
      incarnation: diagnostics.incarnation,
      credentialRevision: diagnostics.credentialRevision,
    },
    'Provider diagnostic response',
  )
  if (responseLease.accountId !== requestedLease.accountId) {
    throw new Error(
      `Provider diagnostic owner mismatch: requested ${requestedLease.provider}/${requestedLease.accountId} but received ${responseLease.provider}/${responseLease.accountId}.`,
    )
  }
  if (
    responseLease.incarnation !== requestedLease.incarnation ||
    responseLease.credentialRevision !== requestedLease.credentialRevision
  ) {
    throw new Error(
      `Provider diagnostic lease mismatch: expected ${requestedLease.incarnation}/${requestedLease.credentialRevision} but received ${responseLease.incarnation}/${responseLease.credentialRevision}.`,
    )
  }

  return {
    ...normalizeProviderDiagnostics(value, requestedLease.provider),
    ...responseLease,
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

const fallbackAccountDiagnostics = (
  lease: AgentAccountLease,
): RuntimeAgentAccountProviderDiagnostics => ({
  ...fallbackDiagnostics(lease.provider),
  ...lease,
})

const fallbackAccountCapabilities = (
  lease: AgentAccountLease,
): RuntimeAgentAccountProviderCapabilities => ({
  ...fallbackCapabilities(lease.provider),
  ...lease,
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
      void provider
      throw new Error(EXACT_AGENT_ACCOUNT_LEASE_REQUIRED_ERROR)
    },
    async readProviderCapabilities(provider) {
      void provider
      throw new Error(EXACT_AGENT_ACCOUNT_LEASE_REQUIRED_ERROR)
    },
    async requestSuggestions(input) {
      void input
      throw new Error(EXACT_AGENT_ACCOUNT_LEASE_REQUIRED_ERROR)
    },
    async readAccountDiagnostics(requestedLease) {
      const lease = normalizeRuntimeAgentLease(requestedLease, 'Account diagnostic request')
      if (!hasRuntime()) return fallbackAccountDiagnostics(lease)

      return normalizeAccountProviderDiagnostics(
        await invokeRuntime<unknown>('read_agent_account_diagnostics', {
          request: lease,
        }),
        lease,
      )
    },
    async readAccountCapabilities(requestedLease) {
      const lease = normalizeRuntimeAgentLease(requestedLease, 'Account capability request')
      if (!hasRuntime()) return fallbackAccountCapabilities(lease)

      return normalizeAccountProviderCapabilities(
        await invokeRuntime<unknown>('read_agent_account_capabilities', {
          request: lease,
        }),
        lease,
      )
    },
    async requestAccountSuggestions(input) {
      const lease = normalizeRuntimeAgentLease(input, 'Agent account suggestion request')
      validateAgentSessionOwner(input)
      validateActiveTabOwner(input)
      if (!hasRuntime()) return []

      const response = await invokeRuntime<unknown>('request_agent_account_suggestions', {
        request: accountRequestPayloadFromInput({ ...input, ...lease }),
      })

      const responses = normalizeAccountSuggestionResponses(response, lease)
      return responses.map((response) => accountSuggestionCardFromRuntime(response, input.activeTab))
    },
  }
}

export const agentSuggestionRuntimeService = createAgentSuggestionRuntimeService()
