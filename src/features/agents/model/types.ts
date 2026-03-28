import type { AgentProviderId, AgentSuggestion as RuntimeAgentSuggestion } from '../../../lib/runtime'

export type AgentSuggestionTarget = 'current-tab' | 'new-tab'

export type AgentSuggestion = {
  id: string
  provider: AgentProviderId
  providerLabel: string
  summary: string
  command: string
  projectLabel: string
  fileLabel: string | null
  terminalLabel: string
  attachedLogLines: number
  confidence: RuntimeAgentSuggestion['confidence']
  error: string | null
  status: 'pending' | 'approved-current-tab' | 'approved-new-tab' | 'error'
}
