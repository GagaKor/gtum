import { expect, test } from '@playwright/test'

import {
  createAgentAuthRuntimeService,
  providerViewStateFromConnection,
  type RuntimeAgentConnectionSnapshot,
} from '../../src/shared/api/runtimeAgentAuth'

const codexConnected: RuntimeAgentConnectionSnapshot = {
  provider: 'codex',
  displayName: 'Codex',
  availability: 'available',
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

const claudeCliConnected: RuntimeAgentConnectionSnapshot = {
  provider: 'claude',
  displayName: 'Claude',
  availability: 'available',
  status: 'connected',
  connectionKind: 'real',
  accountLabel: null,
  accountEmail: null,
  credentialSource: 'claude_cli_session',
  requiredScopes: ['provider:request', 'credential:cli_session'],
  expiresAt: null,
  callbackUrl: null,
  authUrl: null,
  activeLoginId: null,
  activeLoginState: null,
  connectedAt: 200,
  lastLoginAttemptAt: 195,
  updatedAt: 220,
  lastError: null,
}

const claudeEnvironmentApiKeyConnected: RuntimeAgentConnectionSnapshot = {
  ...claudeCliConnected,
  credentialSource: 'anthropic_api_key',
  requiredScopes: ['provider:request', 'credential:api_key'],
  connectedAt: 300,
  lastLoginAttemptAt: 295,
  updatedAt: 320,
}

const claudeApiKeyHelperConnected: RuntimeAgentConnectionSnapshot = {
  ...claudeEnvironmentApiKeyConnected,
  credentialSource: 'api_key_helper',
  connectedAt: 400,
  lastLoginAttemptAt: 395,
  updatedAt: 420,
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
    availability: 'available',
    lastError: null,
  })
})

test('preserves a Claude CLI-session source and scopes for provider UI state', () => {
  expect(providerViewStateFromConnection(claudeCliConnected)).toMatchObject({
    id: 'claude',
    label: 'Claude',
    abbr: 'Cl',
    availability: 'available',
    state: 'connected',
    connectionKind: 'real',
    accountLabel: null,
    credentialSource: 'claude_cli_session',
    scope: ['provider:request', 'credential:cli_session'],
    lastError: null,
  })
})

test('preserves a Claude environment API-key source and scopes for provider UI state', () => {
  expect(providerViewStateFromConnection(claudeEnvironmentApiKeyConnected)).toMatchObject({
    id: 'claude',
    credentialSource: 'anthropic_api_key',
    scope: ['provider:request', 'credential:api_key'],
  })
})

test('preserves a Claude apiKeyHelper source and scopes for provider UI state', () => {
  expect(providerViewStateFromConnection(claudeApiKeyHelperConnected)).toMatchObject({
    id: 'claude',
    credentialSource: 'api_key_helper',
    scope: ['provider:request', 'credential:api_key'],
  })
})

test('lists, connects, and disconnects Claude through the runtime unchanged', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const claudeDisconnected = {
    ...claudeCliConnected,
    status: 'disconnected',
    accountLabel: null,
    credentialSource: null,
    requiredScopes: ['provider:request'],
    connectedAt: null,
    updatedAt: 230,
  } satisfies RuntimeAgentConnectionSnapshot
  const service = createAgentAuthRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })

      if (command === 'list_agent_connections') return [claudeCliConnected]
      if (command === 'disconnect_agent_provider') return claudeDisconnected

      return claudeCliConnected
    },
  })

  const connections = await service.listConnections()
  const connected = await service.beginLogin('claude', ['provider:request'])
  const disconnected = await service.disconnect('claude')

  expect(invoked).toEqual([
    { command: 'list_agent_connections', args: undefined },
    {
      command: 'begin_agent_login',
      args: {
        provider: 'claude',
        requestedScopes: ['provider:request'],
      },
    },
    {
      command: 'disconnect_agent_provider',
      args: { provider: 'claude' },
    },
  ])
  expect(connections).toEqual([claudeCliConnected])
  expect(connected).toEqual(claudeCliConnected)
  expect(disconnected).toEqual(claudeDisconnected)
})

test('preserves Claude pending connection state from the runtime snapshot', async () => {
  const runtimeSnapshot = {
    storagePath: '/tmp/agent-auth.json',
    supportedProviders: ['codex', 'claude'],
    connections: [codexConnected, claudeCliConnected],
    pendingLogins: [
      {
        loginId: 'claude-connect-1',
        provider: 'claude',
        state: 'validating',
        callbackUrl: '',
        authUrl: null,
        scopes: ['provider:request'],
        createdAt: 200,
        expiresAt: 260,
        consumedAt: null,
        lastError: null,
      },
    ],
    lastSyncedAt: 220,
  } as const
  const service = createAgentAuthRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => runtimeSnapshot,
  })

  await expect(service.readRuntimeSnapshot()).resolves.toEqual(runtimeSnapshot)
})

test('keeps browser preview disconnected without invoking or fabricating a connection', async () => {
  let invocationCount = 0
  const service = createAgentAuthRuntimeService({
    hasRuntime: () => false,
    invokeRuntime: async () => {
      invocationCount += 1
      return claudeCliConnected
    },
  })

  await expect(service.listConnections()).resolves.toEqual([])
  await expect(service.readRuntimeSnapshot()).resolves.toBeNull()
  await expect(service.beginLogin('claude')).resolves.toMatchObject({
    provider: 'claude',
    availability: 'available',
    connectionKind: 'real',
    status: 'error',
    accountLabel: null,
  })
  await expect(service.disconnect('claude')).resolves.toMatchObject({
    provider: 'claude',
    availability: 'available',
    connectionKind: 'real',
    status: 'disconnected',
    accountLabel: null,
  })
  expect(invocationCount).toBe(0)
})
