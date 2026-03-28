import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  beginAgentLogin,
  completeAgentLogin,
  disconnectAgentProvider,
  getRuntimeInfo,
  listAgentConnections,
  readAgentProviderDiagnostics,
  type AgentConnectionSnapshot,
  type AgentProviderDiagnostics,
  type AgentProviderId,
  type RuntimeInfo,
} from '../../../lib/runtime'
import type { RecordTask } from '../../tasks/model/types'

type UseProviderAuthParams = {
  initialSelectedProvider?: AgentProviderId
  activeProjectPath: string
  activeTerminalCwd: string | null
  setActiveContext: (context: string) => void
  recordTask: RecordTask
  launchCommandSession: (options: {
    name: string
    command: string
    cwd?: string
  }) => Promise<unknown>
}

export const useProviderAuth = ({
  initialSelectedProvider = 'codex',
  activeProjectPath,
  activeTerminalCwd,
  setActiveContext,
  recordTask,
  launchCommandSession,
}: UseProviderAuthParams) => {
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)
  const [agentConnections, setAgentConnections] = useState<AgentConnectionSnapshot[]>([])
  const [providerDiagnostics, setProviderDiagnostics] = useState<AgentProviderDiagnostics[]>([])
  const [authError, setAuthError] = useState<string | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<AgentProviderId>(initialSelectedProvider)

  const refreshAgentConnections = useCallback(async () => {
    try {
      const connections = await listAgentConnections()
      setAgentConnections(connections)
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const refreshProviderDiagnostics = useCallback(async () => {
    try {
      const diagnostics = await Promise.all(
        (['codex', 'claude'] as AgentProviderId[]).map((provider) => readAgentProviderDiagnostics(provider)),
      )
      setProviderDiagnostics(diagnostics)
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => {
    getRuntimeInfo()
      .then(setRuntimeInfo)
      .catch(() => {
        setRuntimeInfo(null)
      })

    void refreshAgentConnections()
    void refreshProviderDiagnostics()
  }, [refreshAgentConnections, refreshProviderDiagnostics])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const params = new URLSearchParams(window.location.search)
    const provider = params.get('authProvider')
    const authCode = params.get('authCode')

    if (!provider || !authCode) {
      return
    }

    void (async () => {
      try {
        const snapshot = await completeAgentLogin({
          provider: provider as AgentProviderId,
          authorizationCode: authCode,
          accountLabel: `${provider} sandbox`,
        })
        setAgentConnections((current) =>
          current.map((entry) => (entry.provider === snapshot.provider ? snapshot : entry)),
        )
        await refreshProviderDiagnostics()
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : String(error))
      } finally {
        params.delete('authProvider')
        params.delete('authCode')
        const nextQuery = params.toString()
        const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`
        window.history.replaceState({}, '', nextUrl)
      }
    })()
  }, [refreshProviderDiagnostics])

  const resolveMockCallbackFailure = useCallback((provider: AgentProviderId) => {
    const scenario = new URLSearchParams(window.location.search).get('authMock')

    if (!scenario) {
      return null
    }

    if (scenario === 'fail' || scenario === `${provider}-fail`) {
      return `${provider} mock callback failed.`
    }

    return null
  }, [])

  const startProviderLogin = useCallback(
    async (provider: AgentProviderId) => {
      try {
        setAuthError(null)
        const snapshot = await beginAgentLogin(provider, ['project:read', 'terminal:read'])
        setAgentConnections((current) =>
          current.map((entry) => (entry.provider === snapshot.provider ? snapshot : entry)),
        )
        await refreshProviderDiagnostics()
        setSelectedProvider(provider)
        setActiveContext(
          snapshot.status === 'connected'
            ? `Daily-use ${snapshot.displayName} connected`
            : snapshot.status === 'error'
              ? `Daily-use ${snapshot.displayName} connection blocked`
              : `Daily-use ${snapshot.displayName} connection pending`,
        )
        recordTask(
          snapshot.status === 'connected'
            ? `${snapshot.displayName} connected`
            : snapshot.status === 'error'
              ? `${snapshot.displayName} connection blocked`
              : `${snapshot.displayName} connection pending`,
          snapshot.lastError ?? `Required scopes: ${snapshot.requiredScopes.join(', ') || 'none'}`,
          snapshot.status === 'connected' ? 'done' : snapshot.status === 'error' ? 'error' : 'pending',
        )
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : String(error))
        recordTask(`${provider} login failed`, String(error), 'error')
      }
    },
    [recordTask, refreshProviderDiagnostics, setActiveContext],
  )

  const openCodexLogin = useCallback(async () => {
    try {
      setAuthError(null)
      await launchCommandSession({
        name: 'codex-login',
        cwd: activeProjectPath || activeTerminalCwd || undefined,
        command: 'codex login --device-auth',
      })
      setActiveContext('Daily-use Codex login launched')
      recordTask(
        'Codex login launched',
        'Complete the ChatGPT browser sign-in, then reconnect Codex inside gtum.',
        'pending',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setAuthError(message)
      recordTask('Codex login launch failed', message, 'error')
    }
  }, [activeProjectPath, activeTerminalCwd, launchCommandSession, recordTask, setActiveContext])

  const disconnectProvider = useCallback(
    async (provider: AgentProviderId) => {
      try {
        setAuthError(null)
        const snapshot = await disconnectAgentProvider(provider)
        setAgentConnections((current) =>
          current.map((entry) => (entry.provider === snapshot.provider ? snapshot : entry)),
        )
        await refreshProviderDiagnostics()
        setActiveContext(`Daily-use ${snapshot.displayName} disconnected`)
        recordTask(`${snapshot.displayName} disconnected`, 'Provider session cleared.', 'done')
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : String(error))
        recordTask(`${provider} disconnect failed`, String(error), 'error')
      }
    },
    [recordTask, refreshProviderDiagnostics, setActiveContext],
  )

  const simulateMockCallback = useCallback(
    async (provider: AgentProviderId) => {
      if (typeof window === 'undefined') {
        return
      }

      const params = new URLSearchParams(window.location.search)
      params.set('authProvider', provider)
      const failReason = resolveMockCallbackFailure(provider)

      if (failReason) {
        params.delete('authCode')
      } else {
        params.set('authCode', `mock-${provider}-code`)
      }
      const nextQuery = params.toString()
      window.history.replaceState({}, '', `${window.location.pathname}?${nextQuery}`)

      const optimisticTimestamp = Date.now()
      setAgentConnections((current) =>
        current.map((entry) =>
          entry.provider === provider
            ? {
                ...entry,
                status: failReason ? 'error' : 'connected',
                accountLabel: failReason ? null : `${provider} sandbox`,
                connectedAt: failReason ? null : optimisticTimestamp,
                updatedAt: optimisticTimestamp,
                lastError: failReason ?? null,
              }
            : entry,
        ),
      )
      setActiveContext(
        failReason ? `Sprint 14 ${provider} login failed` : `Sprint 14 ${provider} connected`,
      )

      try {
        const snapshot = await completeAgentLogin({
          provider,
          authorizationCode: failReason ? undefined : `mock-${provider}-code`,
          accountLabel: failReason ? undefined : `${provider} sandbox`,
          failReason: failReason ?? undefined,
        })
        setAgentConnections((current) =>
          current.map((entry) => (entry.provider === snapshot.provider ? snapshot : entry)),
        )
        await refreshProviderDiagnostics()
        setActiveContext(
          snapshot.status === 'connected'
            ? `Sprint 14 ${snapshot.displayName} connected`
            : `Sprint 14 ${snapshot.displayName} login failed`,
        )
        recordTask(
          snapshot.status === 'connected'
            ? `${snapshot.displayName} connected`
            : `${snapshot.displayName} login failed`,
          snapshot.lastError ?? 'Mock callback completed.',
          snapshot.status === 'connected' ? 'done' : 'error',
        )
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : String(error))
        recordTask(`${provider} callback failed`, String(error), 'error')
      } finally {
        params.delete('authProvider')
        params.delete('authCode')
        const clearedQuery = params.toString()
        window.history.replaceState(
          {},
          '',
          `${window.location.pathname}${clearedQuery ? `?${clearedQuery}` : ''}`,
        )
      }
    },
    [recordTask, refreshProviderDiagnostics, resolveMockCallbackFailure, setActiveContext],
  )

  const selectedConnection = useMemo(
    () => agentConnections.find((connection) => connection.provider === selectedProvider) ?? null,
    [agentConnections, selectedProvider],
  )

  return {
    runtimeInfo,
    agentConnections,
    providerDiagnostics,
    authError,
    selectedProvider,
    setSelectedProvider,
    selectedConnection,
    refreshAgentConnections,
    refreshProviderDiagnostics,
    startProviderLogin,
    openCodexLogin,
    disconnectProvider,
    simulateMockCallback,
  }
}
