export type AgentProviderId = 'codex' | 'claude' | 'local' | (string & {})

export type AgentExecutionMode = 'fast' | 'balanced' | 'deep'

export type AgentSuggestionTarget = 'current_tab' | 'new_tab'

export type AgentSuggestionConfidence = 'low' | 'medium' | 'high'

export interface AgentModelRef {
  readonly providerId: AgentProviderId
  readonly modelId: string
  readonly label: string
}

export interface AgentMessage {
  readonly id: string
  readonly role: 'user' | 'assistant' | 'system'
  readonly content: string
  readonly createdAt: string
}

export interface AgentSuggestionCommand {
  readonly cmd: string
  readonly risk: 'low' | 'mid' | 'high'
  readonly target: string
}

export interface AgentSuggestionCard {
  readonly id: string
  readonly provider: AgentProviderId
  readonly title: string
  readonly commands: readonly AgentSuggestionCommand[]
  readonly note: string
  readonly error?: string | null
}
