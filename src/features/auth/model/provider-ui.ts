import {
  usesMockRuntime,
  type AgentConnectionSnapshot,
  type AgentProviderDiagnostics,
} from '../../../lib/runtime'

export type ProviderUiContract = {
  statusLabel: string
  guidance: string
  canStartLogin: boolean
  canDisconnect: boolean
  canCompleteMock: boolean
  canRequestSuggestion: boolean
  primaryActionLabel: string
}

export const formatProviderSetupStateLabel = (state: AgentProviderDiagnostics['setupState']) =>
  state === 'ready' ? 'Ready' : state === 'deferred' ? 'Deferred' : 'Needs Setup'

export const formatProviderSetupStateBadgeClass = (state: AgentProviderDiagnostics['setupState']) =>
  state === 'ready' ? 'connected' : state === 'deferred' ? 'pending' : 'error'

export const formatProviderStatusLabel = (status: AgentConnectionSnapshot['status']) =>
  status === 'connected'
    ? 'Connected'
    : status === 'pending'
      ? 'Pending'
      : status === 'error'
        ? 'Attention Needed'
        : 'Needs Connection'

export const formatProviderUxKindLabel = (kind: AgentConnectionSnapshot['connectionKind']) =>
  kind === 'mock' ? 'Mock' : kind === 'prototype' ? 'Prototype' : 'Real'

const formatProviderHint = (
  connection: AgentConnectionSnapshot,
  kind: AgentConnectionSnapshot['connectionKind'],
) => {
  if (connection.lastError) {
    return connection.lastError
  }

  if (connection.status === 'connected') {
    return kind === 'real'
      ? 'Codex CLI ChatGPT session is connected and ready for suggestion requests.'
      : `${formatProviderUxKindLabel(kind)} provider session is connected for workspace testing.`
  }

  if (connection.status === 'pending') {
    return kind === 'mock'
      ? 'Mock callback is ready for the next auth step.'
      : 'Provider connection is pending.'
  }

  return kind === 'real'
    ? 'Connect this provider after Codex CLI is logged in with ChatGPT on this desktop.'
    : `${formatProviderUxKindLabel(kind)} provider flow remains secondary while the first real path focuses on Codex.`
}

export const buildProviderUiContract = (connection: AgentConnectionSnapshot): ProviderUiContract => {
  const kind = connection.connectionKind
  const statusLabel = `${formatProviderUxKindLabel(kind)} • ${formatProviderStatusLabel(connection.status)}`
  const guidance = formatProviderHint(connection, kind)

  return {
    statusLabel,
    guidance,
    canStartLogin: connection.status === 'disconnected' || connection.status === 'error',
    canDisconnect: connection.status === 'connected',
    canCompleteMock: usesMockRuntime() && connection.status === 'pending',
    canRequestSuggestion: connection.status === 'connected',
    primaryActionLabel:
      connection.status === 'connected'
        ? `Disconnect ${connection.displayName}`
        : `Connect ${connection.displayName}`,
  }
}
