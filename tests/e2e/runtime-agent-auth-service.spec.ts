import { expect, test } from '@playwright/test'

import {
  createAgentAuthRuntimeService,
  providerViewStateFromConnection,
  type RuntimeAgentConnectionSnapshot,
} from '../../src/shared/api/runtimeAgentAuth'

const codexConnected: RuntimeAgentConnectionSnapshot = {
  provider: 'codex',
  displayName: 'Codex',
  status: 'connected',
  connectionKind: 'real',
  accountLabel: 'Codex ChatGPT Session',
  accountEmail: null,
  requiredScopes: ['project:read', 'terminal:read'],
  expiresAt: null,
  callbackUrl: null,
  authUrl: null,
  activeLoginId: null,
  activeLoginState: null,
  connectedAt: 100,
  lastLoginAttemptAt: 95,
  updatedAt: 120,
  lastError: null,
}

test('lists and validates provider connections through the auth runtime commands', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const service = createAgentAuthRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })

      if (command === 'list_agent_connections') return [codexConnected]

      return codexConnected
    },
  })

  const connections = await service.listConnections()
  const login = await service.beginLogin('codex', ['project:read', 'terminal:read'])

  expect(invoked).toEqual([
    { command: 'list_agent_connections', args: undefined },
    {
      command: 'begin_agent_login',
      args: {
        provider: 'codex',
        requestedScopes: ['project:read', 'terminal:read'],
      },
    },
  ])
  expect(connections).toEqual([codexConnected])
  expect(login.status).toBe('connected')
})

test('normalizes runtime connection snapshots for provider UI state', async () => {
  expect(providerViewStateFromConnection(codexConnected)).toMatchObject({
    id: 'codex',
    label: 'Codex',
    abbr: 'Cx',
    state: 'connected',
    scope: ['project:read', 'terminal:read'],
    expiresInDays: null,
    accountLabel: 'Codex ChatGPT Session',
    connectionKind: 'real',
    lastError: null,
  })
})
