import { invoke } from '@tauri-apps/api/core'

import type { AgentProviderId } from '../../entities/agent/model/types'
import {
  hasTauriRuntime,
  type RuntimeInvoker,
} from './runtimeProjects'

export const CODEX_REQUIRED_SCOPES = ['project:read', 'terminal:read'] as const

export type RuntimeAgentConnectionStatus =
  | 'disconnected'
  | 'pending'
  | 'connected'
  | 'error'

export type RuntimeAgentConnectionKind = 'mock' | 'prototype' | 'real'
export type RuntimeAgentProviderAvailability = 'available' | 'deferred'
export type RuntimeAgentCredentialSource =
  | 'claude_cli_session'
  | 'anthropic_api_key'
  | 'api_key_helper'

export type RuntimeAgentConnectionSnapshot = {
  provider: AgentProviderId
  displayName: string
  availability: RuntimeAgentProviderAvailability
  status: RuntimeAgentConnectionStatus
  connectionKind: RuntimeAgentConnectionKind
  accountLabel?: string | null
  accountEmail?: string | null
  credentialSource?: RuntimeAgentCredentialSource | null
  requiredScopes: string[]
  expiresAt?: number | null
  callbackUrl?: string | null
  authUrl?: string | null
  activeLoginId?: string | null
  activeLoginState?: string | null
  connectedAt?: number | null
  lastLoginAttemptAt?: number | null
  updatedAt: number
  lastError?: string | null
}

export type RuntimeAgentPendingLoginSnapshot = {
  loginId: string
  provider: AgentProviderId
  state: string
  callbackUrl: string
  authUrl?: string | null
  scopes: string[]
  createdAt: number
  expiresAt: number
  consumedAt?: number | null
  lastError?: string | null
}

export type RuntimeAgentAuthSnapshot = {
  storagePath?: string | null
  supportedProviders: AgentProviderId[]
  connections: RuntimeAgentConnectionSnapshot[]
  pendingLogins: RuntimeAgentPendingLoginSnapshot[]
  lastSyncedAt: number
}

export type AgentProviderViewState = {
  id: AgentProviderId
  label: string
  abbr: string
  state: RuntimeAgentConnectionStatus
  scope: string[]
  expiresInDays: number | null
  accountLabel?: string | null
  credentialSource?: RuntimeAgentCredentialSource | null
  connectionKind?: RuntimeAgentConnectionKind
  availability: RuntimeAgentProviderAvailability
  lastError?: string | null
}

export type AgentAuthRuntimeServiceOptions = {
  hasRuntime?: () => boolean
  invokeRuntime?: RuntimeInvoker
}

export type AgentAuthRuntimeService = {
  hasRuntime: () => boolean
  listConnections(): Promise<RuntimeAgentConnectionSnapshot[]>
  beginLogin(
    provider: AgentProviderId,
    requestedScopes?: readonly string[],
  ): Promise<RuntimeAgentConnectionSnapshot>
  disconnect(provider: AgentProviderId): Promise<RuntimeAgentConnectionSnapshot>
  readRuntimeSnapshot(): Promise<RuntimeAgentAuthSnapshot | null>
}

type RuntimeAgentAuthOverride = {
  hasRuntime?: () => boolean
  invokeRuntime?: RuntimeInvoker
}

const providerAbbr = (provider: AgentProviderId): string =>
  provider === 'codex' ? 'Cx' : 'Cl'

const authOverride = (): RuntimeAgentAuthOverride | null => {
  if (typeof window === 'undefined') return null

  return (
    (window as Window & { __GTUM_AGENT_AUTH_RUNTIME__?: RuntimeAgentAuthOverride })
      .__GTUM_AGENT_AUTH_RUNTIME__ ?? null
  )
}

const omitUndefined = (values: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))

const expiresInDays = (expiresAt?: number | null): number | null => {
  if (expiresAt == null) return null

  const diff = expiresAt - Date.now()
  if (diff <= 0) return 0

  return Math.ceil(diff / 86_400_000)
}

const normalizeConnection = (
  connection: RuntimeAgentConnectionSnapshot,
): RuntimeAgentConnectionSnapshot => ({
  ...connection,
  availability: connection.availability ?? 'available',
})

const unavailableConnection = (
  provider: AgentProviderId,
  status: RuntimeAgentConnectionStatus,
  lastError: string | null,
): RuntimeAgentConnectionSnapshot =>
  normalizeConnection({
    provider,
    displayName: provider === 'codex' ? 'Codex' : 'Claude',
    availability: 'available',
    status,
    connectionKind: 'real',
    accountLabel: null,
    accountEmail: null,
    credentialSource: null,
    requiredScopes: [],
    expiresAt: null,
    callbackUrl: null,
    authUrl: null,
    activeLoginId: null,
    activeLoginState: null,
    connectedAt: null,
    lastLoginAttemptAt: status === 'error' ? Date.now() : null,
    updatedAt: Date.now(),
    lastError,
  })

export const providerViewStateFromConnection = (
  connection: RuntimeAgentConnectionSnapshot,
): AgentProviderViewState => {
  const normalized = normalizeConnection(connection)

  return {
    id: normalized.provider,
    label: normalized.displayName,
    abbr: providerAbbr(normalized.provider),
    state: normalized.status,
    scope: normalized.requiredScopes,
    expiresInDays: expiresInDays(normalized.expiresAt),
    accountLabel: normalized.accountLabel ?? null,
    credentialSource: normalized.credentialSource ?? null,
    connectionKind: normalized.connectionKind,
    availability: normalized.availability,
    lastError: normalized.lastError ?? null,
  }
}

const beginLoginPayload = (
  provider: AgentProviderId,
  requestedScopes?: readonly string[],
): Record<string, unknown> =>
  omitUndefined({
    provider,
    requestedScopes: requestedScopes ? [...requestedScopes] : undefined,
  })

export const createAgentAuthRuntimeService = (
  options: AgentAuthRuntimeServiceOptions = {},
): AgentAuthRuntimeService => {
  const override = authOverride()
  const hasRuntime = options.hasRuntime || override?.hasRuntime || hasTauriRuntime
  const invokeRuntime = options.invokeRuntime || override?.invokeRuntime || (invoke as RuntimeInvoker)

  return {
    hasRuntime,
    async listConnections() {
      if (!hasRuntime()) return []

      const connections = await invokeRuntime<RuntimeAgentConnectionSnapshot[]>(
        'list_agent_connections',
      )
      return connections.map(normalizeConnection)
    },
    async beginLogin(provider, requestedScopes) {
      if (!hasRuntime()) {
        return unavailableConnection(
          provider,
          'error',
          'Desktop runtime is not connected.',
        )
      }

      const connection = await invokeRuntime<RuntimeAgentConnectionSnapshot>(
        'begin_agent_login',
        beginLoginPayload(provider, requestedScopes),
      )
      return normalizeConnection(connection)
    },
    async disconnect(provider) {
      if (!hasRuntime()) {
        return unavailableConnection(provider, 'disconnected', null)
      }

      const connection = await invokeRuntime<RuntimeAgentConnectionSnapshot>(
        'disconnect_agent_provider',
        { provider },
      )
      return normalizeConnection(connection)
    },
    async readRuntimeSnapshot() {
      if (!hasRuntime()) return null

      const snapshot = await invokeRuntime<RuntimeAgentAuthSnapshot>(
        'agent_auth_runtime_snapshot',
      )
      return {
        ...snapshot,
        connections: snapshot.connections.map(normalizeConnection),
        pendingLogins: snapshot.pendingLogins,
      }
    },
  }
}

export const agentAuthRuntimeService = createAgentAuthRuntimeService()
