export type AgentProviderId = 'codex' | 'claude' | 'local' | (string & {})

export type AgentExecutionMode = 'fast' | 'balanced' | 'deep'

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
