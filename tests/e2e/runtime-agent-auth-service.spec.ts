import { expect, test } from '@playwright/test'

import {
  createAgentAuthRuntimeService,
  providerViewStateFromConnection,
  type RuntimeAgentConnectionSnapshot,
  type RuntimeAgentProfile,
  type RuntimeAgentProfileSetupGuidance,
  type RuntimeAgentProfileSnapshot,
  type RuntimeAgentProfileTombstone,
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

const codexDefaultProfile: RuntimeAgentProfile = {
  provider: 'codex',
  accountId: 'codex-default',
  alias: 'Personal Codex',
  profileKind: { kind: 'ambient' },
  isDefault: true,
  incarnation: '1',
  metadataRevision: '2',
  credentialRevision: '3',
  connection: {
    status: 'connected',
    requiresValidation: false,
    credentialSource: null,
    connectedAt: 100,
    updatedAt: 120,
    lastError: null,
  },
}

const codexWorkProfile: RuntimeAgentProfile = {
  ...codexDefaultProfile,
  accountId: 'codex-profile-1',
  alias: 'Work Codex',
  profileKind: { kind: 'codex_home' },
  isDefault: false,
  incarnation: '4',
  metadataRevision: '5',
  credentialRevision: '6',
  connection: {
    status: 'disconnected',
    requiresValidation: false,
    credentialSource: null,
    connectedAt: null,
    updatedAt: 130,
    lastError: null,
  },
}

const claudeDefaultProfile: RuntimeAgentProfile = {
  ...codexDefaultProfile,
  provider: 'claude',
  accountId: 'claude-default',
  alias: 'Personal Claude',
  incarnation: '9',
  metadataRevision: '1',
  credentialRevision: '1',
  connection: {
    ...codexDefaultProfile.connection,
    credentialSource: 'claude_cli_session',
  },
}

const codexForgottenProfile: RuntimeAgentProfileTombstone = {
  provider: 'codex',
  accountId: 'codex-profile-2',
  incarnation: '7',
  credentialRevision: '8',
  forgottenAt: 140,
}

const codexSetupGuidance: RuntimeAgentProfileSetupGuidance = {
  provider: 'codex',
  accountId: 'codex-profile-1',
  supported: true,
  program: 'codex',
  environment: [{ name: 'CODEX_HOME', value: '/tmp/codex-profile-1' }],
  arguments: ['login'],
  renderedCommand: "CODEX_HOME='/tmp/codex-profile-1' codex login",
  warning: 'Run this command in your own terminal.',
  unsupportedReason: null,
}

test('reads one atomic profile snapshot without collapsing same-provider accounts', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const runtimeSnapshot = {
    registryVersion: 2,
    profiles: [
      codexDefaultProfile,
      {
        ...codexWorkProfile,
        incarnation: '4',
        metadataRevision: '5',
        credentialRevision: '6',
      },
      claudeDefaultProfile,
    ],
    tombstones: [codexForgottenProfile],
  }
  const service = createAgentAuthRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })
      return runtimeSnapshot
    },
  })

  await expect(service.readProfileSnapshot()).resolves.toEqual({
    registryVersion: 2,
    profiles: [codexDefaultProfile, codexWorkProfile, claudeDefaultProfile],
    tombstones: [codexForgottenProfile],
  } satisfies RuntimeAgentProfileSnapshot)
  expect(invoked).toEqual([{ command: 'read_agent_profile_snapshot', args: undefined }])
})

test('enforces provider and status ownership for profile credential sources', async () => {
  for (const credentialSource of [
    'claude_cli_session',
    'anthropic_api_key',
    'api_key_helper',
  ] as const) {
    const claudeProfile = {
      ...claudeDefaultProfile,
      connection: { ...claudeDefaultProfile.connection, credentialSource },
    }
    const service = createAgentAuthRuntimeService({
      hasRuntime: () => true,
      invokeRuntime: async () => ({
        registryVersion: 2,
        profiles: [codexDefaultProfile, claudeProfile],
        tombstones: [],
      }),
    })

    await expect(service.readProfileSnapshot()).resolves.toMatchObject({
      profiles: [
        codexDefaultProfile,
        { connection: { credentialSource } },
      ],
    })
  }

  for (const invalidProfile of [
    {
      ...codexDefaultProfile,
      connection: {
        ...codexDefaultProfile.connection,
        credentialSource: 'claude_cli_session',
      },
    },
    {
      ...claudeDefaultProfile,
      connection: { ...claudeDefaultProfile.connection, credentialSource: null },
    },
    {
      ...claudeDefaultProfile,
      connection: {
        ...claudeDefaultProfile.connection,
        credentialSource: 'oauth-token-secret',
      },
    },
    {
      ...claudeDefaultProfile,
      connection: {
        ...claudeDefaultProfile.connection,
        status: 'disconnected',
        credentialSource: 'api_key_helper',
        connectedAt: null,
      },
    },
  ]) {
    const service = createAgentAuthRuntimeService({
      hasRuntime: () => true,
      invokeRuntime: async () => ({
        registryVersion: 2,
        profiles:
          invalidProfile.provider === 'codex'
            ? [invalidProfile, claudeDefaultProfile]
            : [codexDefaultProfile, invalidProfile],
        tombstones: [],
      }),
    })

    await expect(service.readProfileSnapshot()).rejects.toThrow(/credentialSource/i)
  }
})

test('sends exact nested profile lifecycle, guidance, and lease authorization payloads', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const service = createAgentAuthRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })
      if (command === 'create_agent_profile') return codexWorkProfile
      if (command === 'rename_agent_profile') {
        return {
          ...codexWorkProfile,
          alias: 'Renamed Codex',
          metadataRevision: '6',
        }
      }
      if (command === 'set_default_agent_profile') {
        return { ...codexWorkProfile, isDefault: true, metadataRevision: '6' }
      }
      if (command === 'check_agent_profile') {
        return {
          ...codexWorkProfile,
          credentialRevision: '7',
          connection: { ...codexWorkProfile.connection, status: 'connected' },
        }
      }
      if (command === 'disconnect_agent_profile') {
        return { ...codexWorkProfile, credentialRevision: '8' }
      }
      if (command === 'forget_agent_profile') {
        return { ...codexForgottenProfile, accountId: 'codex-profile-1' }
      }
      if (command === 'read_agent_profile_setup_guidance') return codexSetupGuidance
      if (command === 'authorize_agent_profile_lease') {
        return {
          provider: 'codex',
          accountId: 'codex-profile-1',
          incarnation: '4',
          credentialRevision: '6',
          authorized: false,
        }
      }
      throw new Error(`Unexpected command: ${command}`)
    },
  })

  await service.createProfile({ provider: 'codex', alias: 'Work Codex' })
  await service.renameProfile({
    provider: 'codex',
    accountId: 'codex-profile-1',
    alias: 'Renamed Codex',
  })
  await service.setDefaultProfile({
    provider: 'codex',
    accountId: 'codex-profile-1',
  })
  await service.checkProfile({
    provider: 'codex',
    accountId: 'codex-profile-1',
    requestedScopes: ['project:read'],
  })
  await service.disconnectProfile({
    provider: 'codex',
    accountId: 'codex-profile-1',
  })
  await service.forgetProfile({
    provider: 'codex',
    accountId: 'codex-profile-1',
  })
  await service.readProfileSetupGuidance({
    provider: 'codex',
    accountId: 'codex-profile-1',
    shell: 'zsh',
  })
  await expect(
    service.authorizeProfileLease({
      provider: 'codex',
      accountId: 'codex-profile-1',
      incarnation: '4',
      credentialRevision: '6',
    }),
  ).resolves.toEqual({
    provider: 'codex',
    accountId: 'codex-profile-1',
    incarnation: '4',
    credentialRevision: '6',
    authorized: false,
  })

  expect(invoked).toEqual([
    {
      command: 'create_agent_profile',
      args: { request: { provider: 'codex', alias: 'Work Codex' } },
    },
    {
      command: 'rename_agent_profile',
      args: {
        request: {
          provider: 'codex',
          accountId: 'codex-profile-1',
          alias: 'Renamed Codex',
        },
      },
    },
    {
      command: 'set_default_agent_profile',
      args: { request: { provider: 'codex', accountId: 'codex-profile-1' } },
    },
    {
      command: 'check_agent_profile',
      args: {
        request: {
          provider: 'codex',
          accountId: 'codex-profile-1',
          requestedScopes: ['project:read'],
        },
      },
    },
    {
      command: 'disconnect_agent_profile',
      args: { request: { provider: 'codex', accountId: 'codex-profile-1' } },
    },
    {
      command: 'forget_agent_profile',
      args: { request: { provider: 'codex', accountId: 'codex-profile-1' } },
    },
    {
      command: 'read_agent_profile_setup_guidance',
      args: {
        request: {
          provider: 'codex',
          accountId: 'codex-profile-1',
          shell: 'zsh',
        },
      },
    },
    {
      command: 'authorize_agent_profile_lease',
      args: {
        request: {
          provider: 'codex',
          accountId: 'codex-profile-1',
          incarnation: '4',
          credentialRevision: '6',
        },
      },
    },
  ])
})

test('rejects malformed, duplicate, and provider-mismatched profile owners atomically', async () => {
  for (const snapshot of [
    {
      registryVersion: 2,
      profiles: [
        codexDefaultProfile,
        claudeDefaultProfile,
        { ...codexDefaultProfile, alias: 'Duplicate' },
      ],
      tombstones: [],
    },
    {
      registryVersion: 2,
      profiles: [
        codexDefaultProfile,
        claudeDefaultProfile,
        { ...codexWorkProfile, accountId: 'claude-profile-1' },
      ],
      tombstones: [],
    },
    {
      registryVersion: 2,
      profiles: [
        codexDefaultProfile,
        claudeDefaultProfile,
        { ...codexWorkProfile, accountId: 'codex-profile-01' },
      ],
      tombstones: [],
    },
  ]) {
    const service = createAgentAuthRuntimeService({
      hasRuntime: () => true,
      invokeRuntime: async () => snapshot,
    })
    await expect(service.readProfileSnapshot()).rejects.toThrow(/profile|account|duplicate/i)
  }
})

test('treats a generated base36 default suffix as a generated profile, not a reserved account', async () => {
  const generatedProfile = {
    ...codexWorkProfile,
    accountId: 'codex-profile-default',
    incarnation: '10',
  } satisfies RuntimeAgentProfile
  const service = createAgentAuthRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => ({
      registryVersion: 2,
      profiles: [codexDefaultProfile, claudeDefaultProfile, generatedProfile],
      tombstones: [],
    }),
  })

  await expect(service.readProfileSnapshot()).resolves.toMatchObject({
    profiles: [codexDefaultProfile, claudeDefaultProfile, generatedProfile],
  })
})

test('rejects snapshots that violate provider defaults or the per-provider capacity', async () => {
  const tooManyCodexProfiles = Array.from({ length: 16 }, (_, index) => ({
    ...codexWorkProfile,
    accountId: `codex-profile-${index + 1}`,
    incarnation: String(index + 20),
  }))
  for (const snapshot of [
    {
      registryVersion: 2,
      profiles: [codexDefaultProfile],
      tombstones: [],
    },
    {
      registryVersion: 2,
      profiles: [{ ...codexDefaultProfile, isDefault: false }, claudeDefaultProfile],
      tombstones: [],
    },
    {
      registryVersion: 2,
      profiles: [
        codexDefaultProfile,
        claudeDefaultProfile,
        { ...codexWorkProfile, isDefault: true },
      ],
      tombstones: [],
    },
    {
      registryVersion: 2,
      profiles: [codexDefaultProfile, claudeDefaultProfile, ...tooManyCodexProfiles],
      tombstones: [],
    },
    {
      registryVersion: 2,
      profiles: [codexDefaultProfile, claudeDefaultProfile],
      tombstones: [{ ...codexForgottenProfile, accountId: 'codex-default' }],
    },
  ]) {
    const service = createAgentAuthRuntimeService({
      hasRuntime: () => true,
      invokeRuntime: async () => snapshot,
    })

    await expect(service.readProfileSnapshot()).rejects.toThrow(/profile|default|capacity/i)
  }
})

test('accepts the maximum u64 profile revisions as canonical decimal strings', async () => {
  const maximum = '18446744073709551615'
  const maximumProfile = {
    ...codexDefaultProfile,
    incarnation: maximum,
    metadataRevision: maximum,
    credentialRevision: maximum,
  } satisfies RuntimeAgentProfile
  const service = createAgentAuthRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => ({
      registryVersion: 2,
      profiles: [maximumProfile, claudeDefaultProfile],
      tombstones: [],
    }),
  })

  await expect(service.readProfileSnapshot()).resolves.toMatchObject({
    profiles: [maximumProfile, claudeDefaultProfile],
  })
})

test('rejects numeric, zero, leading-zero, and overflowing profile revision wire values', async () => {
  const invalidValues = [1, 0, '0', '01', '18446744073709551616']
  for (const field of ['incarnation', 'metadataRevision', 'credentialRevision'] as const) {
    for (const invalidValue of invalidValues) {
      const service = createAgentAuthRuntimeService({
        hasRuntime: () => true,
        invokeRuntime: async () => ({
          registryVersion: 2,
          profiles: [
            { ...codexDefaultProfile, [field]: invalidValue },
            claudeDefaultProfile,
          ],
          tombstones: [],
        }),
      })

      await expect(service.readProfileSnapshot()).rejects.toThrow(new RegExp(field, 'i'))
    }
  }

  for (const field of ['incarnation', 'credentialRevision'] as const) {
    const service = createAgentAuthRuntimeService({
      hasRuntime: () => true,
      invokeRuntime: async () => ({
        registryVersion: 2,
        profiles: [codexDefaultProfile, claudeDefaultProfile],
        tombstones: [{ ...codexForgottenProfile, [field]: 7 }],
      }),
    })

    await expect(service.readProfileSnapshot()).rejects.toThrow(new RegExp(field, 'i'))
  }
})

test('requires canonical decimal string lease requests and echoed authorization revisions', async () => {
  let invocationCount = 0
  const rejectingService = createAgentAuthRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => {
      invocationCount += 1
      return {
        provider: 'codex',
        accountId: 'codex-profile-1',
        incarnation: 4,
        credentialRevision: '6',
        authorized: true,
      }
    },
  })

  for (const field of ['incarnation', 'credentialRevision'] as const) {
    for (const invalidValue of [4, '0', '04', '18446744073709551616']) {
      await expect(
        rejectingService.authorizeProfileLease({
          provider: 'codex',
          accountId: 'codex-profile-1',
          incarnation: '4',
          credentialRevision: '6',
          [field]: invalidValue,
        } as never),
      ).rejects.toThrow(new RegExp(field, 'i'))
    }
  }
  expect(invocationCount).toBe(0)

  await expect(
    rejectingService.authorizeProfileLease({
      provider: 'codex',
      accountId: 'codex-profile-1',
      incarnation: '4',
      credentialRevision: '6',
    }),
  ).rejects.toThrow(/incarnation/i)
  expect(invocationCount).toBe(1)

  const maximum = '18446744073709551615'
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const maximumService = createAgentAuthRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })
      return {
        provider: 'codex',
        accountId: 'codex-profile-1',
        incarnation: maximum,
        credentialRevision: maximum,
        authorized: true,
      }
    },
  })
  await expect(
    maximumService.authorizeProfileLease({
      provider: 'codex',
      accountId: 'codex-profile-1',
      incarnation: maximum,
      credentialRevision: maximum,
    }),
  ).resolves.toMatchObject({ incarnation: maximum, credentialRevision: maximum })
  expect(invoked).toEqual([
    {
      command: 'authorize_agent_profile_lease',
      args: {
        request: {
          provider: 'codex',
          accountId: 'codex-profile-1',
          incarnation: maximum,
          credentialRevision: maximum,
        },
      },
    },
  ])
})

test('rejects invalid profile requests before invocation and mismatched lifecycle responses', async () => {
  let invocationCount = 0
  const invalidService = createAgentAuthRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => {
      invocationCount += 1
      return codexWorkProfile
    },
  })

  await expect(
    invalidService.disconnectProfile({
      provider: 'codex',
      accountId: 'claude-default',
    }),
  ).rejects.toThrow(/account.*provider|provider.*account/i)
  await expect(
    invalidService.authorizeProfileLease({
      provider: 'codex',
      accountId: 'codex-profile-1',
      incarnation: '04',
      credentialRevision: '6',
    }),
  ).rejects.toThrow(/incarnation/i)
  expect(invocationCount).toBe(0)

  const mismatchedService = createAgentAuthRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => ({
      ...codexWorkProfile,
      provider: 'claude',
      accountId: 'claude-default',
    }),
  })
  await expect(
    mismatchedService.checkProfile({
      provider: 'codex',
      accountId: 'codex-profile-1',
    }),
  ).rejects.toThrow(/owner mismatch/i)
})

test('keeps v2 profile APIs inert when the desktop runtime is unavailable', async () => {
  let invocationCount = 0
  const service = createAgentAuthRuntimeService({
    hasRuntime: () => false,
    invokeRuntime: async () => {
      invocationCount += 1
      return codexDefaultProfile
    },
  })

  await expect(service.readProfileSnapshot()).resolves.toBeNull()
  await expect(
    service.createProfile({
      provider: 'codex',
      alias: 'Unavailable',
    }),
  ).rejects.toThrow(/desktop runtime/i)
  await expect(
    service.authorizeProfileLease({
      provider: 'codex',
      accountId: 'codex-default',
      incarnation: '1',
      credentialRevision: '3',
    }),
  ).rejects.toThrow(/desktop runtime/i)
  expect(invocationCount).toBe(0)
})

test('lists provider connections while legacy provider-only validation fails closed', async () => {
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
  await expect(
    service.beginLogin('codex', ['project:read', 'terminal:read']),
  ).rejects.toThrow(/account/i)

  expect(invoked).toEqual([{ command: 'list_agent_connections', args: undefined }])
  expect(connections).toEqual([codexConnected])
})

test('projects legacy connection responses to declared fields only', async () => {
  const runtimeConnection = {
    ...codexConnected,
    accountId: 'codex-default',
    incarnation: '1',
    metadataRevision: '2',
    credentialRevision: '3',
    runtimeRevision: 4,
    runtimeValidated: true,
    privateToken: 'must not cross',
    unknownConnectionField: 'must not cross',
  }
  const service = createAgentAuthRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command) =>
      command === 'list_agent_connections' ? [runtimeConnection] : runtimeConnection,
  })

  await expect(service.listConnections()).resolves.toEqual([codexConnected])
  await expect(service.beginLogin('codex')).rejects.toThrow(/account/i)
  await expect(service.disconnect('codex')).rejects.toThrow(/account/i)
})

test('rejects malformed legacy connection fields and response owners', async () => {
  const malformedService = createAgentAuthRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command) => {
      const connection = {
        ...codexConnected,
        requiredScopes: ['project:read', 7],
      }
      return command === 'list_agent_connections' ? [connection] : connection
    },
  })
  await expect(malformedService.listConnections()).rejects.toThrow(
    /requiredScopes\[1\].*string/i,
  )
})

test('rejects fractional and unsafe legacy timestamps', async () => {
  for (const invalidTimestamp of [120.5, Number.MAX_SAFE_INTEGER + 1]) {
    const connectionService = createAgentAuthRuntimeService({
      hasRuntime: () => true,
      invokeRuntime: async () => [
        { ...codexConnected, updatedAt: invalidTimestamp },
      ],
    })
    const snapshotService = createAgentAuthRuntimeService({
      hasRuntime: () => true,
      invokeRuntime: async () => ({
        storagePath: null,
        supportedProviders: ['codex'],
        connections: [codexConnected],
        pendingLogins: [],
        lastSyncedAt: invalidTimestamp,
      }),
    })

    await expect(connectionService.listConnections()).rejects.toThrow(
      /updatedAt.*safe integer/i,
    )
    await expect(snapshotService.readRuntimeSnapshot()).rejects.toThrow(
      /lastSyncedAt.*safe integer/i,
    )
  }
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

test('lists Claude while legacy provider-only connect and disconnect fail closed', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const service = createAgentAuthRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })

      if (command === 'list_agent_connections') return [claudeCliConnected]
      return claudeCliConnected
    },
  })

  const connections = await service.listConnections()
  await expect(service.beginLogin('claude', ['provider:request'])).rejects.toThrow(/account/i)
  await expect(service.disconnect('claude')).rejects.toThrow(/account/i)

  expect(invoked).toEqual([{ command: 'list_agent_connections', args: undefined }])
  expect(connections).toEqual([claudeCliConnected])
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

test('projects runtime auth snapshots and pending logins to declared fields only', async () => {
  const pendingLogin = {
    loginId: 'claude-connect-1',
    provider: 'claude' as const,
    state: 'validating',
    callbackUrl: '',
    authUrl: null,
    scopes: ['provider:request'],
    createdAt: 200,
    expiresAt: 260,
    consumedAt: null,
    lastError: null,
  }
  const expectedSnapshot = {
    storagePath: '/tmp/agent-auth.json',
    supportedProviders: ['codex', 'claude'] as const,
    connections: [codexConnected],
    pendingLogins: [pendingLogin],
    lastSyncedAt: 220,
  }
  const runtimeSnapshot = {
    ...expectedSnapshot,
    connections: [
      {
        ...codexConnected,
        accountId: 'codex-default',
        credentialRevision: '3',
        privateConnectionState: 'must not cross',
      },
    ],
    pendingLogins: [
      {
        ...pendingLogin,
        accountId: 'claude-default',
        incarnation: '1',
        metadataRevision: '2',
        credentialRevision: '3',
        privateVerifier: 'must not cross',
        unknownPendingLoginField: 'must not cross',
      },
    ],
    registryVersion: 2,
    profiles: [{ accountId: 'codex-default' }],
    privateStoreRevision: 9,
    unknownSnapshotField: 'must not cross',
  }
  const service = createAgentAuthRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => runtimeSnapshot,
  })

  await expect(service.readRuntimeSnapshot()).resolves.toEqual(expectedSnapshot)
})

test('rejects malformed runtime auth snapshot fields and owners', async () => {
  const baseSnapshot = {
    storagePath: null,
    supportedProviders: ['codex'],
    connections: [codexConnected],
    pendingLogins: [],
    lastSyncedAt: 220,
  }
  const malformedTimestampService = createAgentAuthRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => ({ ...baseSnapshot, lastSyncedAt: '220' }),
  })
  const malformedPendingLoginService = createAgentAuthRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => ({
      ...baseSnapshot,
      pendingLogins: [
        {
          loginId: 'unknown-connect-1',
          provider: 'unknown',
          state: 'pending',
          callbackUrl: '',
          authUrl: null,
          scopes: ['provider:request'],
          createdAt: 200,
          expiresAt: 260,
          consumedAt: null,
          lastError: null,
        },
      ],
    }),
  })
  const unsupportedConnectionService = createAgentAuthRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => ({
      ...baseSnapshot,
      connections: [claudeCliConnected],
    }),
  })

  await expect(malformedTimestampService.readRuntimeSnapshot()).rejects.toThrow(
    /lastSyncedAt.*safe integer/i,
  )
  await expect(malformedPendingLoginService.readRuntimeSnapshot()).rejects.toThrow(
    /pendingLogins\[0\].*provider/i,
  )
  await expect(unsupportedConnectionService.readRuntimeSnapshot()).rejects.toThrow(
    /connections\[0\].*supported provider/i,
  )
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
  await expect(service.beginLogin('claude')).rejects.toThrow(/account/i)
  await expect(service.disconnect('claude')).rejects.toThrow(/account/i)
  expect(invocationCount).toBe(0)
})

test('legacy provider-only auth mutations fail closed before invoking runtime', async () => {
  let invocationCount = 0
  const service = createAgentAuthRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => {
      invocationCount += 1
      return codexConnected
    },
  })

  await expect(service.beginLogin('codex')).rejects.toThrow(/account/i)
  await expect(service.disconnect('codex')).rejects.toThrow(/account/i)
  expect(invocationCount).toBe(0)
})
