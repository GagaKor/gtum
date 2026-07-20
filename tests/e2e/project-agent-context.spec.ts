import { expect, test, type Page } from '@playwright/test'

import {
  AGENT_SESSION_DIRECTORY_V1_STORAGE_KEY,
  AGENT_SESSION_DIRECTORY_V2_STORAGE_KEY,
  beginAgentRequest,
  completeAgentRequest,
  createAgentContextCoordinator,
  createAgentLeaseGenerationCoordinator,
  createAgentRequestState,
  cloneAndDeepFreezeAgentTurn,
  agentAccountOwnerKey,
  agentProfileLeaseKey,
  agentSessionAccountValue,
  hydrateAgentSessionDirectoryV2,
  newAgentSessionAccountSelection,
  persistAgentSessionDirectoryV2,
  projectAgentContextKey,
  stopAgentRequest,
  withAgentSessionAccountValue,
  type AgentContextOwner,
  type AgentSessionProfileSnapshot,
  type PersistedAgentSessionDirectoryV2,
} from '../../src/features/agents/model/projectAgentContext'

const projectA = '/workspace/project-a'
const projectB = '/workspace/project-b'
const sharedSessionId = 'shared-agent-session'
const sameProjectSessionA = 'same-project-session-a'
const sameProjectSessionB = 'same-project-session-b'

const profile = (
  provider: 'codex' | 'claude',
  accountId: string,
  isDefault: boolean,
  kind: 'ambient' | 'codex_home' | 'claude_config_dir',
) => ({ provider, accountId, isDefault, profileKind: { kind } })

const profileSnapshot = (
  profiles: AgentSessionProfileSnapshot['profiles'] = [
    profile('codex', 'codex-default', true, 'ambient'),
    profile('claude', 'claude-default', true, 'ambient'),
  ],
): AgentSessionProfileSnapshot => ({ profiles, tombstones: [] })

const memorySessionStorage = (
  initial: Record<string, string>,
  options: { failV2Writes?: number; failLegacyRemovals?: number } = {},
) => {
  const values = new Map(Object.entries(initial))
  const operations: string[] = []
  let failedV2Writes = 0
  let failedLegacyRemovals = 0

  return {
    values,
    operations,
    getItem(key: string) {
      operations.push(`get:${key}`)
      return values.get(key) ?? null
    },
    setItem(key: string, value: string) {
      operations.push(`set:${key}`)
      if (
        key === AGENT_SESSION_DIRECTORY_V2_STORAGE_KEY &&
        failedV2Writes < (options.failV2Writes ?? 0)
      ) {
        failedV2Writes += 1
        throw new Error('simulated v2 write failure')
      }
      values.set(key, value)
    },
    removeItem(key: string) {
      operations.push(`remove:${key}`)
      if (
        key === AGENT_SESSION_DIRECTORY_V1_STORAGE_KEY &&
        failedLegacyRemovals < (options.failLegacyRemovals ?? 0)
      ) {
        failedLegacyRemovals += 1
        throw new Error('simulated v1 removal failure')
      }
      values.delete(key)
    },
  }
}

const persistedWorkspace = (session: Record<string, unknown>) => ({
  [projectA]: {
    workspaceTitle: 'project-a',
    activeSessionId: session.id,
    sessions: [session],
  },
})

test('account session migration writes v2 before deleting v1 and retries idempotently', () => {
  const legacy = persistedWorkspace({
    id: sharedSessionId,
    title: 'Legacy session',
    createdAt: '10:00',
    updatedAt: '10:01',
    providerId: 'codex',
    selectedModels: { codex: ' gpt-legacy ', claude: 'claude-legacy' },
    selectedReasoningLevels: { codex: ' high ', claude: 'low' },
    fastModes: { codex: true, claude: false },
    attachments: { codex: ['/tmp/must-not-persist.png'] },
  })
  const storage = memorySessionStorage({
    [AGENT_SESSION_DIRECTORY_V1_STORAGE_KEY]: JSON.stringify(legacy),
  }, { failV2Writes: 1 })
  const snapshot = profileSnapshot([
    profile('codex', 'codex-profile-2', true, 'codex_home'),
    profile('codex', 'codex-default', false, 'ambient'),
    profile('claude', 'claude-default', true, 'ambient'),
  ])

  const first = hydrateAgentSessionDirectoryV2(storage, snapshot)
  const firstSession = first[projectA]?.sessions[0]

  expect(firstSession).toEqual(expect.objectContaining({
    providerId: 'codex',
    selectedAccountIds: { codex: 'codex-default' },
    selectedModels: {
      codex: { 'codex-default': 'gpt-legacy' },
      claude: { 'claude-default': 'claude-legacy' },
    },
    selectedReasoningLevels: {
      codex: { 'codex-default': 'high' },
      claude: { 'claude-default': 'low' },
    },
    fastModes: {
      codex: { 'codex-default': true },
      claude: { 'claude-default': false },
    },
  }))
  expect(firstSession).not.toHaveProperty('attachments')
  expect(storage.values.has(AGENT_SESSION_DIRECTORY_V1_STORAGE_KEY)).toBe(true)
  expect(storage.values.has(AGENT_SESSION_DIRECTORY_V2_STORAGE_KEY)).toBe(false)
  expect(storage.operations).not.toContain(`remove:${AGENT_SESSION_DIRECTORY_V1_STORAGE_KEY}`)

  const second = hydrateAgentSessionDirectoryV2(storage, snapshot)
  expect(second).toEqual(first)
  expect(storage.values.has(AGENT_SESSION_DIRECTORY_V1_STORAGE_KEY)).toBe(false)
  expect(JSON.parse(storage.values.get(AGENT_SESSION_DIRECTORY_V2_STORAGE_KEY) || '{}'))
    .toEqual(second)

  const afterDefaultChange = hydrateAgentSessionDirectoryV2(storage, profileSnapshot([
    profile('codex', 'codex-default', false, 'ambient'),
    profile('codex', 'codex-profile-3', true, 'codex_home'),
    profile('claude', 'claude-default', true, 'ambient'),
  ]))
  expect(afterDefaultChange).toEqual(second)
  expect(afterDefaultChange[projectA]?.sessions[0]?.selectedAccountIds)
    .toEqual({ codex: 'codex-default' })
})

test('account session migration retries legacy cleanup from an authoritative v2 after remove failure', () => {
  const legacy = persistedWorkspace({
    id: sharedSessionId,
    title: 'Cleanup retry',
    providerId: 'codex',
  })
  const storage = memorySessionStorage({
    [AGENT_SESSION_DIRECTORY_V1_STORAGE_KEY]: JSON.stringify(legacy),
  }, { failLegacyRemovals: 1 })

  const first = hydrateAgentSessionDirectoryV2(storage, profileSnapshot())

  expect(first[projectA]?.sessions[0]?.selectedAccountIds)
    .toEqual({ codex: 'codex-default' })
  expect(storage.values.has(AGENT_SESSION_DIRECTORY_V2_STORAGE_KEY)).toBe(true)
  expect(storage.values.has(AGENT_SESSION_DIRECTORY_V1_STORAGE_KEY)).toBe(true)
  expect(storage.operations.indexOf(`set:${AGENT_SESSION_DIRECTORY_V2_STORAGE_KEY}`))
    .toBeLessThan(storage.operations.indexOf(`remove:${AGENT_SESSION_DIRECTORY_V1_STORAGE_KEY}`))

  const operationCount = storage.operations.length
  const second = hydrateAgentSessionDirectoryV2(storage, profileSnapshot())
  const retryOperations = storage.operations.slice(operationCount)

  expect(second).toEqual(first)
  expect(storage.values.has(AGENT_SESSION_DIRECTORY_V1_STORAGE_KEY)).toBe(false)
  expect(retryOperations).toEqual([
    `get:${AGENT_SESSION_DIRECTORY_V2_STORAGE_KEY}`,
    `remove:${AGENT_SESSION_DIRECTORY_V1_STORAGE_KEY}`,
  ])
})

test('account session migration leaves unavailable legacy discovery unassigned', () => {
  const storage = memorySessionStorage({
    [AGENT_SESSION_DIRECTORY_V1_STORAGE_KEY]: JSON.stringify(persistedWorkspace({
      id: sharedSessionId,
      title: 'Unavailable discovery',
      providerId: 'claude',
      selectedModels: { claude: 'claude-opus' },
      selectedReasoningLevels: { claude: 'high' },
      fastModes: { claude: true },
    })),
  })

  const directory = hydrateAgentSessionDirectoryV2(storage, null)
  const session = directory[projectA]?.sessions[0]

  expect(session?.selectedAccountIds).toEqual({})
  expect(session?.selectedModels).toEqual({})
  expect(session?.selectedReasoningLevels).toEqual({})
  expect(session?.fastModes).toEqual({})
  expect(storage.values.has(AGENT_SESSION_DIRECTORY_V2_STORAGE_KEY)).toBe(true)
  expect(storage.values.has(AGENT_SESSION_DIRECTORY_V1_STORAGE_KEY)).toBe(false)
})

test('account session migration rejects an explicit invalid v1 provider without changing it to Codex', () => {
  const storage = memorySessionStorage({
    [AGENT_SESSION_DIRECTORY_V1_STORAGE_KEY]: JSON.stringify({
      [projectA]: {
        workspaceTitle: 'project-a',
        activeSessionId: 'invalid-provider',
        sessions: [{
          id: 'invalid-provider',
          title: 'Explicit invalid provider',
          providerId: 'unknown-provider',
          selectedModels: { codex: 'must-not-bind' },
        }],
      },
      [projectB]: {
        workspaceTitle: 'project-b',
        activeSessionId: 'missing-provider',
        sessions: [{
          id: 'missing-provider',
          title: 'Historical missing provider',
          selectedModels: { codex: 'legacy-codex' },
        }],
      },
    }),
  })

  const directory = hydrateAgentSessionDirectoryV2(storage, profileSnapshot())

  expect(directory[projectA]).toBeUndefined()
  expect(directory[projectB]?.sessions[0]).toEqual(expect.objectContaining({
    id: 'missing-provider',
    providerId: 'codex',
    selectedAccountIds: { codex: 'codex-default' },
    selectedModels: { codex: { 'codex-default': 'legacy-codex' } },
  }))
})

test('account session migration keeps missing and tombstoned v2 selections without default fallback', () => {
  const existingV2 = persistedWorkspace({
    id: sharedSessionId,
    title: 'Missing account owner',
    providerId: 'codex',
    selectedAccountIds: { codex: 'codex-profile-9' },
    selectedModels: { codex: { 'codex-profile-9': 'gpt-owned' } },
    selectedReasoningLevels: { codex: { 'codex-profile-9': 'high' } },
    fastModes: { codex: { 'codex-profile-9': true } },
  })
  const legacy = persistedWorkspace({
    id: 'legacy-must-not-win',
    title: 'Legacy must not win',
    providerId: 'codex',
  })
  const storage = memorySessionStorage({
    [AGENT_SESSION_DIRECTORY_V2_STORAGE_KEY]: JSON.stringify(existingV2),
    [AGENT_SESSION_DIRECTORY_V1_STORAGE_KEY]: JSON.stringify(legacy),
  })
  const snapshot: AgentSessionProfileSnapshot = {
    profiles: [
      profile('codex', 'codex-default', false, 'ambient'),
      profile('codex', 'codex-profile-2', true, 'codex_home'),
      profile('claude', 'claude-default', true, 'ambient'),
    ],
    tombstones: [{ provider: 'codex', accountId: 'codex-profile-9' }],
  }

  const directory = hydrateAgentSessionDirectoryV2(storage, snapshot)

  expect(directory[projectA]?.sessions).toHaveLength(1)
  expect(directory[projectA]?.sessions[0]).toEqual(expect.objectContaining({
    id: sharedSessionId,
    selectedAccountIds: { codex: 'codex-profile-9' },
    selectedModels: { codex: { 'codex-profile-9': 'gpt-owned' } },
  }))
  expect(storage.values.has(AGENT_SESSION_DIRECTORY_V1_STORAGE_KEY)).toBe(false)
})

test('account session migration sanitizes malformed nested maps per provider and account', () => {
  const storage = memorySessionStorage({
    [AGENT_SESSION_DIRECTORY_V2_STORAGE_KEY]: JSON.stringify(persistedWorkspace({
      id: sharedSessionId,
      title: 'Sanitize nested state',
      providerId: 'codex',
      selectedAccountIds: {
        codex: 'codex-profile-1',
        claude: 'codex-default',
        local: 'local-default',
      },
      selectedModels: {
        codex: {
          'codex-profile-1': ' gpt-valid ',
          'codex-profile-01': 'bad-account',
          'claude-default': 'wrong-provider',
        },
        claude: ['not', 'a', 'map'],
      },
      selectedReasoningLevels: {
        codex: { 'codex-profile-1': ' high ' },
        claude: { 'claude-default': 'x'.repeat(17) },
      },
      fastModes: {
        codex: { 'codex-profile-1': true, 'codex-profile-2': 'true' },
        claude: null,
      },
      attachments: {
        codex: { 'codex-profile-1': ['/tmp/in-memory-only.png'] },
      },
    })),
  })

  const directory = hydrateAgentSessionDirectoryV2(storage, profileSnapshot())
  const session = directory[projectA]?.sessions[0]

  expect(session).toEqual(expect.objectContaining({
    selectedAccountIds: { codex: 'codex-profile-1' },
    selectedModels: { codex: { 'codex-profile-1': 'gpt-valid' } },
    selectedReasoningLevels: { codex: { 'codex-profile-1': 'high' } },
    fastModes: { codex: { 'codex-profile-1': true } },
  }))
  expect(session).not.toHaveProperty('attachments')
})

test('account session migration preserves independent A and B preferences for one provider', () => {
  const accountA = 'codex-profile-1'
  const accountB = 'codex-profile-2'
  const storage = memorySessionStorage({
    [AGENT_SESSION_DIRECTORY_V2_STORAGE_KEY]: JSON.stringify(persistedWorkspace({
      id: sharedSessionId,
      title: 'Independent account preferences',
      providerId: 'codex',
      selectedAccountIds: { codex: accountA },
      selectedModels: {
        codex: {
          [accountA]: ' gpt-account-a ',
          [accountB]: 'gpt-account-b',
          'codex-profile-01': 'invalid-account-model',
          'claude-default': 'wrong-provider-model',
        },
      },
      selectedReasoningLevels: {
        codex: {
          [accountA]: ' high ',
          [accountB]: 'low',
          'codex-profile-01': 'medium',
        },
      },
      fastModes: {
        codex: {
          [accountA]: true,
          [accountB]: false,
          'codex-profile-01': true,
        },
      },
    })),
  })

  const directory = hydrateAgentSessionDirectoryV2(storage, profileSnapshot())
  const session = directory[projectA]?.sessions[0]

  expect(session?.selectedAccountIds).toEqual({ codex: accountA })
  expect(session?.selectedModels).toEqual({
    codex: { [accountA]: 'gpt-account-a', [accountB]: 'gpt-account-b' },
  })
  expect(session?.selectedReasoningLevels).toEqual({
    codex: { [accountA]: 'high', [accountB]: 'low' },
  })
  expect(session?.fastModes).toEqual({
    codex: { [accountA]: true, [accountB]: false },
  })
  expect(session?.selectedModels.codex).not.toHaveProperty('codex-default')
  expect(session?.selectedReasoningLevels.codex).not.toHaveProperty('codex-default')
  expect(session?.fastModes.codex).not.toHaveProperty('codex-default')

  expect(persistAgentSessionDirectoryV2(storage, directory)).toBe(true)
  const rehydratedDirectory = hydrateAgentSessionDirectoryV2(storage, profileSnapshot())
  const rehydratedSession = rehydratedDirectory[projectA]?.sessions[0]
  expect(rehydratedSession).toEqual(expect.objectContaining({
    selectedAccountIds: { codex: accountA },
    selectedModels: {
      codex: { [accountA]: 'gpt-account-a', [accountB]: 'gpt-account-b' },
    },
    selectedReasoningLevels: {
      codex: { [accountA]: 'high', [accountB]: 'low' },
    },
    fastModes: {
      codex: { [accountA]: true, [accountB]: false },
    },
  }))
  expect(rehydratedSession?.selectedModels.codex).not.toHaveProperty('codex-default')
  expect(rehydratedSession?.selectedReasoningLevels.codex).not.toHaveProperty('codex-default')
  expect(rehydratedSession?.fastModes.codex).not.toHaveProperty('codex-default')
})

test('account session migration isolates same-provider account attachments in memory and persists neither', () => {
  const accountA = 'codex-profile-1'
  const accountB = 'codex-profile-2'
  const attachmentA = [{ path: '/tmp/account-a.png', name: 'account-a.png' }]
  const attachmentB = [{ path: '/tmp/account-b.png', name: 'account-b.png' }]
  let attachments = {}

  attachments = withAgentSessionAccountValue(attachments, 'codex', accountA, attachmentA)
  attachments = withAgentSessionAccountValue(attachments, 'codex', accountB, attachmentB)

  expect(agentSessionAccountValue(attachments, 'codex', accountA)).toEqual(attachmentA)
  expect(agentSessionAccountValue(attachments, 'codex', accountB)).toEqual(attachmentB)
  expect(agentSessionAccountValue(attachments, 'claude', 'claude-default')).toBeNull()

  const storage = memorySessionStorage({})
  const directory = persistedWorkspace({
    id: sharedSessionId,
    title: 'Two account attachments',
    providerId: 'codex',
    selectedAccountIds: { codex: accountA },
    attachments,
  }) as PersistedAgentSessionDirectoryV2

  expect(persistAgentSessionDirectoryV2(storage, directory)).toBe(true)
  const serialized = storage.values.get(AGENT_SESSION_DIRECTORY_V2_STORAGE_KEY) || ''
  const persistedSession = JSON.parse(serialized)[projectA]?.sessions?.[0]
  expect(persistedSession).not.toHaveProperty('attachments')
  expect(serialized).not.toContain(attachmentA[0].path)
  expect(serialized).not.toContain(attachmentB[0].path)
})

test('account session migration treats a present malformed v2 as authoritative and rejects invalid providers', () => {
  const legacy = persistedWorkspace({
    id: 'legacy-must-stay-dormant',
    title: 'Legacy must stay dormant',
    providerId: 'codex',
  })

  for (const malformedV2 of ['{not-json', JSON.stringify(['not-an-object'])]) {
    const storage = memorySessionStorage({
      [AGENT_SESSION_DIRECTORY_V2_STORAGE_KEY]: malformedV2,
      [AGENT_SESSION_DIRECTORY_V1_STORAGE_KEY]: JSON.stringify(legacy),
    })

    expect(hydrateAgentSessionDirectoryV2(storage, profileSnapshot())).toEqual({})
    expect(storage.values.get(AGENT_SESSION_DIRECTORY_V1_STORAGE_KEY))
      .toBe(JSON.stringify(legacy))
    expect(storage.operations).not.toContain(`set:${AGENT_SESSION_DIRECTORY_V2_STORAGE_KEY}`)
  }

  const invalidProviderSession = {
    id: 'invalid-provider',
    title: 'Must not become Codex',
    providerId: 'unknown-provider',
    selectedAccountIds: { codex: 'codex-default' },
  }
  const validClaudeSession = {
    id: 'valid-claude',
    title: 'Valid Claude',
    providerId: 'claude',
    selectedAccountIds: { claude: 'claude-default' },
  }
  const storage = memorySessionStorage({
    [AGENT_SESSION_DIRECTORY_V2_STORAGE_KEY]: JSON.stringify({
      [projectA]: {
        workspaceTitle: 'project-a',
        activeSessionId: invalidProviderSession.id,
        sessions: [invalidProviderSession, validClaudeSession],
      },
    }),
  })

  const directory = hydrateAgentSessionDirectoryV2(storage, profileSnapshot())

  expect(directory[projectA]?.activeSessionId).toBe(validClaudeSession.id)
  expect(directory[projectA]?.sessions).toEqual([
    expect.objectContaining({
      id: validClaudeSession.id,
      providerId: 'claude',
      selectedAccountIds: { claude: 'claude-default' },
    }),
  ])
})

test('account session migration assigns an exact isDefault account only to a truly new session', () => {
  const snapshot = profileSnapshot([
    profile('codex', 'codex-default', false, 'ambient'),
    profile('codex', 'codex-profile-1', false, 'codex_home'),
    profile('codex', 'codex-profile-2', true, 'codex_home'),
    profile('claude', 'claude-default', true, 'ambient'),
  ])

  expect(newAgentSessionAccountSelection('codex', snapshot))
    .toEqual({ codex: 'codex-profile-2' })
  expect(newAgentSessionAccountSelection('codex', null)).toEqual({})
  expect(newAgentSessionAccountSelection('codex', profileSnapshot([
    profile('codex', 'codex-default', true, 'ambient'),
    profile('codex', 'codex-profile-2', true, 'codex_home'),
    profile('claude', 'claude-default', true, 'ambient'),
  ]))).toEqual({})

  const existingWithoutSelection = memorySessionStorage({
    [AGENT_SESSION_DIRECTORY_V2_STORAGE_KEY]: JSON.stringify(persistedWorkspace({
      id: sharedSessionId,
      title: 'Existing unassigned session',
      providerId: 'codex',
      selectedAccountIds: {},
    })),
  })
  expect(
    hydrateAgentSessionDirectoryV2(existingWithoutSelection, snapshot)[projectA]
      ?.sessions[0]?.selectedAccountIds,
  ).toEqual({})
})

const owner = (projectPath: string): AgentContextOwner => ({
  projectPath,
  sessionId: sharedSessionId,
})

test('account ownership keys include the exact account and credential lease only', () => {
  const ownerA = { provider: 'codex' as const, accountId: 'codex-profile-1' }
  const ownerB = { provider: 'codex' as const, accountId: 'codex-profile-2' }
  const baseLease = {
    ...ownerA,
    incarnation: '7',
    credentialRevision: '11',
    alias: 'Before rename',
    isDefault: false,
    metadataRevision: '3',
  }

  expect(agentAccountOwnerKey(ownerA)).not.toBe(agentAccountOwnerKey(ownerB))
  expect(agentProfileLeaseKey(baseLease)).toBe(agentProfileLeaseKey({
    ...baseLease,
    alias: 'After rename',
    isDefault: true,
    metadataRevision: '4',
  }))
  expect(agentProfileLeaseKey(baseLease)).not.toBe(agentProfileLeaseKey({
    ...baseLease,
    incarnation: '8',
  }))
  expect(agentProfileLeaseKey(baseLease)).not.toBe(agentProfileLeaseKey({
    ...baseLease,
    credentialRevision: '12',
  }))
})

test('account ownership generations suppress reverse order per lease without staling another account', () => {
  const coordinator = createAgentLeaseGenerationCoordinator()
  const leaseA = {
    provider: 'claude' as const,
    accountId: 'claude-profile-1',
    incarnation: '1',
    credentialRevision: '5',
  }
  const leaseB = {
    ...leaseA,
    accountId: 'claude-profile-2',
    incarnation: '2',
  }

  const firstA = coordinator.begin(leaseA)
  const pendingB = coordinator.begin(leaseB)
  const secondA = coordinator.begin(leaseA)

  expect(coordinator.isCurrent(firstA)).toBe(false)
  expect(coordinator.isCurrent(secondA)).toBe(true)
  expect(coordinator.isCurrent(pendingB)).toBe(true)
})

test('account ownership reconciliation stales credential work but preserves metadata-only work and bounds slots', () => {
  const coordinator = createAgentLeaseGenerationCoordinator(2)
  const leaseA = {
    provider: 'codex' as const,
    accountId: 'codex-profile-1',
    incarnation: '1',
    credentialRevision: '1',
  }
  const leaseB = {
    ...leaseA,
    accountId: 'codex-profile-2',
    incarnation: '2',
  }

  const metadataOnlyA = coordinator.begin(leaseA)
  coordinator.reconcile([{ ...leaseA, alias: 'Renamed', metadataRevision: '99' }, leaseB])
  expect(coordinator.isCurrent(metadataOnlyA)).toBe(true)

  coordinator.reconcile([{ ...leaseA, credentialRevision: '2' }, leaseB])
  expect(coordinator.isCurrent(metadataOnlyA)).toBe(false)

  const currentA = coordinator.begin({ ...leaseA, credentialRevision: '2' })
  const currentB = coordinator.begin(leaseB)
  const leaseC = { ...leaseA, accountId: 'codex-profile-3', incarnation: '3' }
  const currentC = coordinator.begin(leaseC)

  expect(coordinator.slotCount()).toBe(2)
  expect(coordinator.isCurrent(currentA)).toBe(false)
  expect(coordinator.isCurrent(currentB)).toBe(true)
  expect(coordinator.isCurrent(currentC)).toBe(true)

  coordinator.invalidateOwner(leaseB)
  expect(coordinator.isCurrent(currentB)).toBe(false)
  expect(coordinator.slotCount()).toBe(1)
})

test('account request snapshot clones and deep freezes every captured turn field', () => {
  const mutable = {
    project: { path: projectA, runtimeBacked: true },
    profile: {
      provider: 'codex',
      accountId: 'codex-profile-1',
      alias: 'Work account',
      incarnation: '2',
      credentialRevision: '7',
    },
    attachments: [{ kind: 'image', path: '/tmp/a.png', label: 'a.png' }],
    catalog: { attachments: [{ kind: 'image', enabled: true }] },
    tab: { id: 't-source', lines: [{ text: 'before' }] },
  }

  const frozen = cloneAndDeepFreezeAgentTurn(mutable)
  mutable.profile.alias = 'Mutated alias'
  mutable.attachments[0].path = '/tmp/mutated.png'
  mutable.tab.lines[0].text = 'after'

  expect(frozen).toEqual(expect.objectContaining({
    profile: expect.objectContaining({ alias: 'Work account' }),
    attachments: [expect.objectContaining({ path: '/tmp/a.png' })],
    tab: expect.objectContaining({ lines: [{ text: 'before' }] }),
  }))
  expect(Object.isFrozen(frozen)).toBe(true)
  expect(Object.isFrozen(frozen.profile)).toBe(true)
  expect(Object.isFrozen(frozen.attachments)).toBe(true)
  expect(Object.isFrozen(frozen.attachments[0])).toBe(true)
  expect(Object.isFrozen(frozen.catalog.attachments[0])).toBe(true)
  expect(Object.isFrozen(frozen.tab.lines[0])).toBe(true)
})

test('request generations and stop tokens are isolated by full project and session owner', () => {
  const coordinator = createAgentContextCoordinator()
  const tokenA = coordinator.beginRequest(owner(projectA))
  const tokenB = coordinator.beginRequest(owner(projectB))

  expect(tokenA.contextKey).toBe(`${projectA}\u0000${sharedSessionId}`)
  expect(tokenB.contextKey).toBe(`${projectB}\u0000${sharedSessionId}`)
  expect(coordinator.isRequestCurrent(tokenA)).toBe(true)
  expect(coordinator.isRequestCurrent(tokenB)).toBe(true)
  expect(coordinator.hasRequestInFlight(owner(projectA))).toBe(true)
  expect(coordinator.hasRequestInFlight(owner(projectB))).toBe(true)

  coordinator.stopRequest(owner(projectB))

  expect(coordinator.isRequestCurrent(tokenB)).toBe(false)
  expect(coordinator.isRequestCurrent(tokenA)).toBe(true)
  expect(coordinator.hasRequestInFlight(owner(projectA))).toBe(true)
  expect(coordinator.hasRequestInFlight(owner(projectB))).toBe(false)
})

test('rejects same-context request re-entry until the running lease finishes or stops', () => {
  const coordinator = createAgentContextCoordinator()
  const contextA = owner(projectA)
  const first = coordinator.tryBeginRequest(contextA)

  expect(first).not.toBeNull()
  expect(coordinator.tryBeginRequest(contextA)).toBeNull()
  expect(coordinator.finishRequest(first!)).toBe(true)

  const second = coordinator.tryBeginRequest(contextA)
  expect(second?.generation).toBe(2)
  coordinator.stopRequest(contextA)
  expect(coordinator.tryBeginRequest(contextA)?.generation).toBe(4)
})

test('request state rejects stale completion after a scoped stop', () => {
  const running = beginAgentRequest(createAgentRequestState(), 1, 'turn-a', [
    'activityPreparing',
  ])
  const stopped = stopAgentRequest(running, 2)

  expect(stopped).toMatchObject({
    generation: 2,
    phase: 'stopped',
    turnId: 'turn-a',
    activity: [],
  })
  expect(completeAgentRequest(stopped, 1)).toBe(stopped)
  expect(completeAgentRequest(running, 1)).toMatchObject({
    generation: 1,
    phase: 'idle',
    turnId: null,
    activity: [],
  })
})

test('permission and job-create guards allow duplicate ids across owners but dedupe within one owner', () => {
  const coordinator = createAgentContextCoordinator()
  const contextA = owner(projectA)
  const contextB = owner(projectB)

  expect(projectAgentContextKey(contextA)).not.toBe(projectAgentContextKey(contextB))
  expect(coordinator.beginPermission(contextA, 'duplicate-suggestion')).toBe(true)
  expect(coordinator.beginPermission(contextA, 'duplicate-suggestion')).toBe(false)
  expect(coordinator.beginPermission(contextB, 'duplicate-suggestion')).toBe(true)
  expect(coordinator.hasPermissionInFlight(contextA)).toBe(true)
  expect(coordinator.hasPermissionInFlight(contextB)).toBe(true)

  expect(coordinator.jobCreateGeneration(contextA)).toBe(0)
  expect(coordinator.noteJobCreate(contextA)).toBe(1)
  expect(coordinator.jobCreateGeneration(contextA)).toBe(1)
  expect(coordinator.jobCreateGeneration(contextB)).toBe(0)

  coordinator.finishPermission(contextA, 'duplicate-suggestion')
  expect(coordinator.beginPermission(contextA, 'duplicate-suggestion')).toBe(true)
})

test('holds an exclusive project-close lease against new requests permissions and job creates', () => {
  const coordinator = createAgentContextCoordinator()
  const contextA = owner(projectA)
  const contextB = owner(projectB)

  const closeA = coordinator.tryBeginProjectClose(projectA)
  expect(closeA).not.toBeNull()
  expect(coordinator.isProjectClosing(projectA)).toBe(true)
  expect(coordinator.tryBeginProjectClose(projectA)).toBeNull()
  expect(coordinator.tryBeginRequest(contextA)).toBeNull()
  expect(coordinator.beginPermission(contextA, 'close-race')).toBe(false)
  expect(coordinator.noteJobCreate(contextA)).toBeNull()

  expect(coordinator.tryBeginRequest(contextB)).not.toBeNull()
  expect(coordinator.beginPermission(contextB, 'close-race')).toBe(true)
  expect(coordinator.noteJobCreate(contextB)).toBe(1)

  expect(coordinator.finishProjectClose(closeA!)).toBe(true)
  expect(coordinator.isProjectClosing(projectA)).toBe(false)
  expect(coordinator.tryBeginRequest(contextA)).not.toBeNull()
})

test('refuses a project-close lease while its request or permission work is in flight', () => {
  const coordinator = createAgentContextCoordinator()
  const contextA = owner(projectA)
  const request = coordinator.tryBeginRequest(contextA)

  expect(request).not.toBeNull()
  expect(coordinator.tryBeginProjectClose(projectA)).toBeNull()
  expect(coordinator.finishRequest(request!)).toBe(true)
  expect(coordinator.beginPermission(contextA, 'pending-create')).toBe(true)
  expect(coordinator.tryBeginProjectClose(projectA)).toBeNull()
  coordinator.finishPermission(contextA, 'pending-create')
  expect(coordinator.tryBeginProjectClose(projectA)).not.toBeNull()
})

type SessionFixture = {
  id: string
  title: string
  selectedReasoningLevels?: Partial<Record<'codex' | 'claude', string>>
  fastModes?: Partial<Record<'codex' | 'claude', boolean>>
}
type ProjectAgentHarnessOptions = {
  includeClaude?: boolean
  progressStageDelayMs?: number
  delayProfileSnapshot?: boolean
  delayProfileSnapshotAfterDisconnect?: boolean
  deferProfileDisconnects?: boolean
  failProfileSnapshot?: boolean
  seedLegacyDirectory?: boolean
  seedV1DirectoryRaw?: string
  seedV2DirectoryRaw?: string
  failFirstSessionDirectoryRead?: boolean
  logSessionDirectoryStorageOperations?: boolean
  codexDefaultAccountId?: 'codex-default' | `codex-profile-${string}`
  accountProfiles?: Array<{
    provider: 'codex' | 'claude'
    accountId: string
    alias: string
    isDefault?: boolean
    incarnation?: string
    metadataRevision?: string
    credentialRevision?: string
    status?: 'connected' | 'disconnected'
    requiresValidation?: boolean
  }>
  profileTombstones?: Array<{
    provider: 'codex' | 'claude'
    accountId: string
    incarnation: string
  }>
  deferAccountCapabilities?: boolean
  authorizeProfileLease?: 'authorized' | 'denied' | 'reject' | 'mismatch'
  projectFiles?: Array<{
    path: string
    name?: string
    content: string
  }>
  accountAttachmentCatalogs?: Record<string, Array<{
    kind: 'image' | 'file' | 'directory' | 'active_tab'
    label: string
    enabled: boolean
    invocationFlag?: string | null
  }>>
}

const installProjectAgentHarness = async (
  page: Page,
  projectASessions: SessionFixture[] = [{ id: sharedSessionId, title: 'A Agent' }],
  activeProjectASessionId = projectASessions[0]?.id ?? sharedSessionId,
  options: ProjectAgentHarnessOptions = {},
) => {
  await page.addInitScript(({
    projectA,
    projectB,
    sharedSessionId,
    projectASessions,
    activeProjectASessionId,
    options,
  }) => {
    type RuntimeCall = { command: string; args?: Record<string, unknown> }
    type SessionDirectoryStorageOperation = {
      operation: 'set' | 'remove'
      key: string
      value?: string
    }
    type SuggestionResolver = (value: unknown[]) => void
    type JobResolver = (value: unknown) => void
    type CapabilityResolver = {
      lease: {
        provider: 'codex' | 'claude'
        accountId: string
        incarnation: string
        credentialRevision: string
      }
      resolve(value: unknown): void
      reject(reason: unknown): void
    }
    type TestWindow = Window & {
      __agentCalls: RuntimeCall[]
      __authCalls: RuntimeCall[]
      __agentJobCalls: RuntimeCall[]
      __orderedAgentCalls: Array<RuntimeCall & { surface: 'auth' | 'agent' | 'job' }>
      __terminalCalls: RuntimeCall[]
      __sessionDirectoryStorageOperations: SessionDirectoryStorageOperation[]
      __sessionDirectorySeedApplied: boolean
      __attachmentPickStarted: boolean
      __resolveAgentRequest(projectPath: string, sessionId: string, summary: string, command?: string): void
      __rejectAgentRequest(projectPath: string, sessionId: string, message: string): void
      __resolveAgentJob(projectPath: string, sessionId: string): void
      __resolveAgentAttachment(projectPath: string, sessionId: string, path: string): void
      __delaySessionCloseLists: boolean
      __resolveSessionClose(sessionId: string): void
      __resolveProviderConnect(): void
      __resolveAgentProfileSnapshot(): void
      __resolveAgentDisconnect(ordinal: number, overrides?: {
        provider?: 'codex' | 'claude'
        accountId?: string
        incarnation?: string
        credentialRevision?: string
        status?: 'connected' | 'disconnected'
        commit?: boolean
      }): void
      __rejectAgentDisconnect(ordinal: number, message: string): void
      __failNextAgentProfileSnapshot(message: string): void
      __resolveAgentCapabilities(accountId: string, modelId?: string, label?: string): void
      __rejectAgentCapabilities(accountId: string, message: string): void
      __setDeferAgentCapabilities(deferred: boolean): void
      __updateAgentProfile(request: {
        provider: 'codex' | 'claude'
        accountId: string
        alias?: string
        isDefault?: boolean
        metadataRevision?: string
        credentialRevision?: string
        status?: 'connected' | 'disconnected'
      }): void
      __forgetAgentProfile(request: {
        provider: 'codex' | 'claude'
        accountId: string
      }): void
      __setAgentAttachmentCatalog(accountId: string, attachments: Array<{
        kind: 'image' | 'file' | 'directory' | 'active_tab'
        label: string
        enabled: boolean
        invocationFlag?: string | null
      }>): void
      __profileSnapshotRequested: boolean
      __GTUM_AGENT_PROGRESS_STAGE_DELAY_MS__: number
      __GTUM_AGENT_JOB_POLL_INTERVAL_MS__: number
      __GTUM_WORKSPACE_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
      __GTUM_AGENT_AUTH_RUNTIME__: unknown
      __GTUM_AGENT_RUNTIME__: unknown
      __GTUM_AGENT_JOB_RUNTIME__: unknown
      __GTUM_TERMINAL_RUNTIME__: unknown
      __GTUM_AGENT_ATTACHMENT_PICKER__: unknown
    }
    const bridgeWindow = window as TestWindow
    const requestResolvers = new Map<string, SuggestionResolver>()
    const requestRejectors = new Map<string, (reason: unknown) => void>()
    const requestOwners = new Map<string, {
      provider: 'codex' | 'claude'
      accountId: string
      incarnation: string
      credentialRevision: string
    }>()
    const jobResolvers = new Map<string, JobResolver>()
    const attachmentResolvers = new Map<string, (value: string) => void>()
    const sessionCloseResolvers = new Map<string, (value: unknown[]) => void>()
    const capabilityResolvers = new Map<string, CapabilityResolver>()
    const profileDisconnectResolvers = new Map<number, {
      response: Record<string, unknown>
      resolve(value: unknown): void
      reject(reason: unknown): void
    }>()
    let profileDisconnectOrdinal = 0
    let providerConnectResolver: ((value: unknown) => void) | null = null
    const profileSnapshotResolvers: Array<(value: unknown) => void> = []
    let profileDisconnectCompleted = false
    let nextProfileSnapshotFailure: string | null = null
    let deferAccountCapabilities = Boolean(options.deferAccountCapabilities)
    const accountAttachmentCatalogs = structuredClone(options.accountAttachmentCatalogs || {})
    const contextKey = (projectPath: string, sessionId: string) =>
      `${projectPath}\u0000${sessionId}`
    const workspaceSnapshot = (activeProjectPath: string) => ({
      recentProjects: [projectA, projectB],
      openProjectPaths: [projectA, projectB],
      activeProjectPath,
      lastOpenedProjectPath: activeProjectPath,
      updatedAt: 500,
      storageVersion: 2,
    })
    const connection = {
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
    const profileConnection = (
      provider: 'codex' | 'claude',
      status: 'connected' | 'disconnected' = 'connected',
      requiresValidation = false,
    ) => ({
      status,
      requiresValidation: status === 'connected' && requiresValidation,
      credentialSource: provider === 'claude' && status === 'connected'
        ? 'claude_cli_session'
        : null,
      connectedAt: status === 'connected' ? 100 : null,
      updatedAt: 120,
      lastError: null,
    })
    const runtimeProfile = (
      provider: 'codex' | 'claude',
      accountId: string,
      alias: string,
      isDefault: boolean,
      incarnation: string,
      overrides: {
        metadataRevision?: string
        credentialRevision?: string
        status?: 'connected' | 'disconnected'
        requiresValidation?: boolean
      } = {},
    ) => ({
      provider,
      accountId,
      alias,
      profileKind: {
        kind: accountId === `${provider}-default`
          ? 'ambient'
          : provider === 'codex' ? 'codex_home' : 'claude_config_dir',
      },
      isDefault,
      incarnation,
      metadataRevision: overrides.metadataRevision ?? '1',
      credentialRevision: overrides.credentialRevision ?? '1',
      connection: profileConnection(
        provider,
        overrides.status,
        overrides.requiresValidation,
      ),
    })
    const codexDefaultAccountId = options.codexDefaultAccountId ?? 'codex-default'
    const configuredProfiles = (options.accountProfiles || []).map((configured, index) =>
      runtimeProfile(
        configured.provider,
        configured.accountId,
        configured.alias,
        configured.isDefault ?? false,
        configured.incarnation ?? String(index + 10),
        configured,
      ))
    const authoritativeProfileSnapshot = {
      registryVersion: 2,
      profiles: [
        runtimeProfile(
          'codex',
          'codex-default',
          'Codex ambient',
          codexDefaultAccountId === 'codex-default',
          '1',
        ),
        ...(codexDefaultAccountId === 'codex-default'
          ? []
          : [runtimeProfile('codex', codexDefaultAccountId, 'Codex work', true, '2')]),
        runtimeProfile('claude', 'claude-default', 'Claude ambient', true, '3'),
        ...configuredProfiles,
      ],
      tombstones: options.profileTombstones ?? [],
    }
    const accountCapabilitySnapshot = (
      provider: 'codex' | 'claude',
      accountId: string,
      incarnation: string,
      credentialRevision: string,
      modelId?: string,
      label?: string,
    ) => {
      const resolvedModelId = modelId || (accountId === 'codex-default'
        ? 'gpt-default'
        : `${provider}-${accountId}`)
      const resolvedLabel = label || (accountId === 'codex-default'
        ? 'GPT Default'
        : `${accountId} model`)
      return {
        provider,
        accountId,
        incarnation,
        credentialRevision,
        supportsModelSelection: true,
        currentModel: { providerId: provider, modelId: resolvedModelId, label: resolvedLabel },
        availableModels: [
          {
            providerId: provider,
            modelId: resolvedModelId,
            label: resolvedLabel,
          },
          ...(accountId === 'codex-default'
            ? [{ providerId: 'codex', modelId: 'gpt-project-a', label: 'GPT Project A' }]
            : []),
        ],
        reasoningLevels: [
          { level: 'low', label: 'Low' },
          { level: 'high', label: 'High' },
        ],
        defaultReasoningLevel: 'high',
        supportsFastMode: true,
        attachments: accountAttachmentCatalogs[accountId]
          ?? [{ kind: 'image', label: 'Image', enabled: true, invocationFlag: '--image' }],
      }
    }
    const jobSnapshot = (projectPath: string) => ({
      jobId: projectPath === projectA ? 101 : 202,
      sessionId: sharedSessionId,
      name: projectPath === projectA ? 'A duplicate job' : 'B duplicate job',
      command: projectPath === projectA ? 'node project-a' : 'node project-b',
      cwd: projectPath,
      runner: 'node',
      runnerArgs: [projectPath === projectA ? 'project-a' : 'project-b'],
      processId: 900,
      status: 'running',
      createdAt: 100,
      updatedAt: 101,
      finishedAt: null,
      cancellationRequestedAt: null,
      exitCode: null,
      logsComplete: false,
      logCaptureError: null,
      processError: null,
      persistenceError: null,
      logLineCount: 1,
      maxLogEntries: 100,
      lastEvent: 'running',
    })

    bridgeWindow.__sessionDirectoryStorageOperations = []
    bridgeWindow.__sessionDirectorySeedApplied = false
    if (options.logSessionDirectoryStorageOperations) {
      const originalSetItem = Storage.prototype.setItem
      const originalRemoveItem = Storage.prototype.removeItem
      const isSessionDirectoryKey = (key: string) =>
        key === 'gtum.agent-session-directory.v1' ||
        key === 'gtum.agent-session-directory.v2'
      Storage.prototype.setItem = function setItem(key: string, value: string) {
        if (this === localStorage && isSessionDirectoryKey(key)) {
          bridgeWindow.__sessionDirectoryStorageOperations.push({
            operation: 'set',
            key,
            value,
          })
        }
        return originalSetItem.call(this, key, value)
      }
      Storage.prototype.removeItem = function removeItem(key: string) {
        if (this === localStorage && isSessionDirectoryKey(key)) {
          bridgeWindow.__sessionDirectoryStorageOperations.push({ operation: 'remove', key })
        }
        return originalRemoveItem.call(this, key)
      }
    }
    if (sessionStorage.getItem('gtum.test.session-directory-seeded') !== 'true') {
      bridgeWindow.__sessionDirectorySeedApplied = true
      if (typeof options.seedV1DirectoryRaw === 'string') {
        localStorage.setItem('gtum.agent-session-directory.v1', options.seedV1DirectoryRaw)
      }
      if (typeof options.seedV2DirectoryRaw === 'string') {
        localStorage.setItem('gtum.agent-session-directory.v2', options.seedV2DirectoryRaw)
      }
      if (
        options.seedLegacyDirectory !== false &&
        !localStorage.getItem('gtum.agent-session-directory.v1') &&
        !localStorage.getItem('gtum.agent-session-directory.v2')
      ) {
        localStorage.setItem('gtum.agent-session-directory.v1', JSON.stringify({
          [projectA]: {
            workspaceTitle: 'project-a',
            activeSessionId: activeProjectASessionId,
            sessions: projectASessions.map((session) => ({
              ...session,
              createdAt: '10:00',
              updatedAt: '10:00',
            })),
          },
          [projectB]: {
            workspaceTitle: 'project-b',
            activeSessionId: sharedSessionId,
            sessions: [{
              id: sharedSessionId,
              title: 'B Agent',
              createdAt: '10:00',
              updatedAt: '10:00',
            }],
          },
        }))
      }
      sessionStorage.setItem('gtum.test.session-directory-seeded', 'true')
    }
    if (options.logSessionDirectoryStorageOperations) {
      // Seed writes are harness setup. Keep the wrappers installed, but begin
      // the observable App-write window before the application mounts.
      bridgeWindow.__sessionDirectoryStorageOperations = []
    }
    if (
      options.failFirstSessionDirectoryRead &&
      sessionStorage.getItem('gtum.test.session-directory-read-recovered') !== 'true'
    ) {
      const originalGetItem = Storage.prototype.getItem
      let failedSessionDirectoryRead = false
      Storage.prototype.getItem = function getItem(key: string) {
        if (
          !failedSessionDirectoryRead &&
          key === 'gtum.agent-session-directory.v2'
        ) {
          failedSessionDirectoryRead = true
          throw new Error('simulated session directory read failure')
        }
        return originalGetItem.call(this, key)
      }
    }
    bridgeWindow.__agentCalls = []
    bridgeWindow.__authCalls = []
    bridgeWindow.__agentJobCalls = []
    bridgeWindow.__orderedAgentCalls = []
    bridgeWindow.__terminalCalls = []
    bridgeWindow.__attachmentPickStarted = false
    bridgeWindow.__delaySessionCloseLists = false
    bridgeWindow.__profileSnapshotRequested = false
    bridgeWindow.__GTUM_AGENT_PROGRESS_STAGE_DELAY_MS__ = options.progressStageDelayMs ?? 1
    bridgeWindow.__GTUM_AGENT_JOB_POLL_INTERVAL_MS__ = 10_000
    bridgeWindow.__resolveAgentRequest = (projectPath, sessionId, summary, command = '') => {
      const key = contextKey(projectPath, sessionId)
      const resolve = requestResolvers.get(key)
      if (!resolve) throw new Error(`No pending request for ${key}`)
      requestResolvers.delete(key)
      requestRejectors.delete(key)
      const owner = requestOwners.get(key) || {
        provider: 'codex' as const,
        accountId: 'codex-default',
        incarnation: '1',
        credentialRevision: '1',
      }
      requestOwners.delete(key)
      resolve([{
        id: 'duplicate-suggestion',
        provider: owner.provider,
        accountId: owner.accountId,
        incarnation: owner.incarnation,
        credentialRevision: owner.credentialRevision,
        summary,
        command,
        preferredTarget: 'new_tab',
        confidence: 'high',
        error: null,
      }])
    }
    bridgeWindow.__rejectAgentRequest = (projectPath, sessionId, message) => {
      const key = contextKey(projectPath, sessionId)
      const reject = requestRejectors.get(key)
      if (!reject) throw new Error(`No pending request for ${key}`)
      requestResolvers.delete(key)
      requestRejectors.delete(key)
      requestOwners.delete(key)
      reject(new Error(message))
    }
    bridgeWindow.__resolveAgentJob = (projectPath, sessionId) => {
      const key = contextKey(projectPath, sessionId)
      const resolve = jobResolvers.get(key)
      if (!resolve) throw new Error(`No pending job for ${key}`)
      jobResolvers.delete(key)
      resolve(jobSnapshot(projectPath))
    }
    bridgeWindow.__resolveAgentAttachment = (projectPath, sessionId, path) => {
      const key = contextKey(projectPath, sessionId)
      const resolve = attachmentResolvers.get(key)
      if (!resolve) throw new Error(`No pending attachment picker for ${key}`)
      attachmentResolvers.delete(key)
      resolve(path)
    }
    bridgeWindow.__resolveSessionClose = (sessionId) => {
      const resolve = sessionCloseResolvers.get(sessionId)
      if (!resolve) throw new Error(`No pending close for ${sessionId}`)
      sessionCloseResolvers.delete(sessionId)
      resolve([])
    }
    bridgeWindow.__resolveProviderConnect = () => {
      if (!providerConnectResolver) throw new Error('No pending provider connect')
      const resolve = providerConnectResolver
      providerConnectResolver = null
      const ambientProfile = authoritativeProfileSnapshot.profiles.find((profile) =>
        profile.provider === connection.provider
        && profile.accountId === `${connection.provider}-default`
      )
      if (ambientProfile) {
        ambientProfile.credentialRevision = String(Number(ambientProfile.credentialRevision) + 1)
        ambientProfile.connection = profileConnection(ambientProfile.provider, 'connected')
      }
      resolve(connection)
    }
    bridgeWindow.__resolveAgentProfileSnapshot = () => {
      if (profileSnapshotResolvers.length === 0) {
        throw new Error('No pending Agent profile snapshot')
      }
      const pendingResolvers = profileSnapshotResolvers.splice(0)
      for (const resolve of pendingResolvers) {
        resolve(structuredClone(authoritativeProfileSnapshot))
      }
    }
    bridgeWindow.__resolveAgentDisconnect = (ordinal, overrides = {}) => {
      const pending = profileDisconnectResolvers.get(ordinal)
      if (!pending) throw new Error(`No pending Agent profile disconnect #${ordinal}`)
      profileDisconnectResolvers.delete(ordinal)
      const baseResponse = pending.response as {
        provider?: 'codex' | 'claude'
        accountId?: string
        incarnation?: string
        credentialRevision?: string
        connection?: unknown
      }
      const response = {
        ...structuredClone(pending.response),
        ...overrides,
        connection: overrides.status
          ? profileConnection(overrides.provider ?? baseResponse.provider ?? 'codex', overrides.status)
          : structuredClone(baseResponse.connection),
      }
      delete (response as Record<string, unknown>).status
      delete (response as Record<string, unknown>).commit
      if (overrides.commit !== false) {
        const profile = authoritativeProfileSnapshot.profiles.find((candidate) =>
          candidate.provider === response.provider && candidate.accountId === response.accountId
        )
        if (!profile) throw new Error(`No profile for disconnect #${ordinal}`)
        profile.incarnation = String(response.incarnation)
        profile.credentialRevision = String(response.credentialRevision)
        profile.connection = structuredClone(response.connection) as typeof profile.connection
        profileDisconnectCompleted = true
      }
      pending.resolve(structuredClone(response))
    }
    bridgeWindow.__rejectAgentDisconnect = (ordinal, message) => {
      const pending = profileDisconnectResolvers.get(ordinal)
      if (!pending) throw new Error(`No pending Agent profile disconnect #${ordinal}`)
      profileDisconnectResolvers.delete(ordinal)
      pending.reject(new Error(message))
    }
    bridgeWindow.__failNextAgentProfileSnapshot = (message) => {
      nextProfileSnapshotFailure = message
    }
    bridgeWindow.__resolveAgentCapabilities = (accountId, modelId, label) => {
      const resolver = capabilityResolvers.get(accountId)
      if (!resolver) throw new Error(`No pending capability read for ${accountId}`)
      capabilityResolvers.delete(accountId)
      resolver.resolve(accountCapabilitySnapshot(
        resolver.lease.provider,
        accountId,
        resolver.lease.incarnation,
        resolver.lease.credentialRevision,
        modelId,
        label,
      ))
    }
    bridgeWindow.__rejectAgentCapabilities = (accountId, message) => {
      const resolver = capabilityResolvers.get(accountId)
      if (!resolver) throw new Error(`No pending capability read for ${accountId}`)
      capabilityResolvers.delete(accountId)
      resolver.reject(new Error(message))
    }
    bridgeWindow.__setDeferAgentCapabilities = (deferred) => {
      deferAccountCapabilities = deferred
    }
    bridgeWindow.__updateAgentProfile = (request) => {
      const profile = authoritativeProfileSnapshot.profiles.find((candidate) =>
        candidate.provider === request.provider && candidate.accountId === request.accountId
      )
      if (!profile) throw new Error(`No profile for ${request.provider}/${request.accountId}`)
      if (request.alias !== undefined) profile.alias = request.alias
      if (request.isDefault !== undefined) profile.isDefault = request.isDefault
      if (request.metadataRevision !== undefined) {
        profile.metadataRevision = request.metadataRevision
      }
      if (request.credentialRevision !== undefined) {
        profile.credentialRevision = request.credentialRevision
      }
      if (request.status !== undefined) {
        profile.connection = profileConnection(profile.provider, request.status)
      }
    }
    bridgeWindow.__forgetAgentProfile = (request) => {
      const profileIndex = authoritativeProfileSnapshot.profiles.findIndex((candidate) =>
        candidate.provider === request.provider && candidate.accountId === request.accountId
      )
      if (profileIndex < 0) {
        throw new Error(`No profile for ${request.provider}/${request.accountId}`)
      }
      const [profile] = authoritativeProfileSnapshot.profiles.splice(profileIndex, 1)
      authoritativeProfileSnapshot.tombstones.push({
        provider: profile.provider,
        accountId: profile.accountId,
        incarnation: profile.incarnation,
        credentialRevision: String(Number(profile.credentialRevision) + 1),
        forgottenAt: 500,
      })
    }
    bridgeWindow.__setAgentAttachmentCatalog = (accountId, attachments) => {
      accountAttachmentCatalogs[accountId] = structuredClone(attachments)
    }
    bridgeWindow.__GTUM_AGENT_ATTACHMENT_PICKER__ = {
      pick: async () => {
        bridgeWindow.__attachmentPickStarted = true
        const panel = document.querySelector<HTMLElement>('.agent')
        const key = contextKey(
          panel?.dataset.agentProjectPath || '',
          panel?.dataset.agentSessionId || '',
        )
        return new Promise<string>((resolve) => {
          attachmentResolvers.set(key, resolve)
        })
      },
    }
    bridgeWindow.__GTUM_WORKSPACE_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        if (command === 'read_workspace_runtime_snapshot') {
          return { snapshot: workspaceSnapshot(projectA), restoredAt: 510 }
        }
        if (command === 'activate_workspace_project') {
          const path = String((args?.request as { path?: string } | undefined)?.path)
          return workspaceSnapshot(path)
        }
        throw new Error(`Unexpected workspace command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        const path = String(args?.path)
        if (command === 'read_project_overview') {
          return {
            metadata: { name: path === projectA ? 'project-a' : 'project-b', path },
            tree: {
              name: 'root',
              path,
              kind: 'directory',
              children: (options.projectFiles || []).map((file) => ({
                name: file.name || file.path.split('/').at(-1) || file.path,
                path: file.path,
                kind: 'file',
              })),
            },
            git: { isRepository: true, branch: 'dev', changedFilesCount: 0 },
          }
        }
        if (command === 'read_project_file') {
          const projectPath = String(args?.projectPath)
          const filePath = String(args?.filePath)
          const file = (options.projectFiles || []).find((candidate) => candidate.path === filePath)
          if (!file) throw new Error(`Unknown project file: ${filePath}`)
          return {
            projectPath,
            filePath,
            displayPath: filePath,
            content: file.content,
            contentHash: `hash-${filePath}`,
            isText: true,
            truncated: false,
          }
        }
        throw new Error(`Unexpected project command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_AGENT_AUTH_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__authCalls.push({ command, args })
        bridgeWindow.__orderedAgentCalls.push({ surface: 'auth', command, args })
        if (command === 'read_agent_profile_snapshot') {
          bridgeWindow.__profileSnapshotRequested = true
          if (nextProfileSnapshotFailure) {
            const message = nextProfileSnapshotFailure
            nextProfileSnapshotFailure = null
            throw new Error(message)
          }
          if (options.failProfileSnapshot) {
            throw new Error('authoritative profile discovery unavailable')
          }
          if (
            options.delayProfileSnapshot
            || (options.delayProfileSnapshotAfterDisconnect && profileDisconnectCompleted)
          ) {
            return new Promise((resolve) => {
              profileSnapshotResolvers.push(resolve)
            })
          }
          return structuredClone(authoritativeProfileSnapshot)
        }
        if (command === 'disconnect_agent_profile') {
          const request = args?.request as {
            provider?: 'codex' | 'claude'
            accountId?: string
          }
          const profile = authoritativeProfileSnapshot.profiles.find((candidate) =>
            candidate.provider === request?.provider && candidate.accountId === request?.accountId
          )
          if (!profile) throw new Error('Profile not found for disconnect')
          const response = {
            ...structuredClone(profile),
            credentialRevision: String(Number(profile.credentialRevision) + 1),
            connection: profileConnection(profile.provider, 'disconnected'),
          }
          if (options.deferProfileDisconnects) {
            profileDisconnectOrdinal += 1
            return new Promise((resolve, reject) => {
              profileDisconnectResolvers.set(profileDisconnectOrdinal, {
                response,
                resolve,
                reject,
              })
            })
          }
          profile.credentialRevision = response.credentialRevision
          profile.connection = response.connection
          profileDisconnectCompleted = true
          return structuredClone(response)
        }
        if (command === 'check_agent_profile') {
          const request = args?.request as {
            provider?: 'codex' | 'claude'
            accountId?: string
          }
          const profile = authoritativeProfileSnapshot.profiles.find((candidate) =>
            candidate.provider === request?.provider && candidate.accountId === request?.accountId
          )
          if (!profile) throw new Error('Profile not found for check')
          if (profile.connection.requiresValidation) {
            profile.credentialRevision = String(Number(profile.credentialRevision) + 1)
            profile.connection = profileConnection(profile.provider, 'connected', false)
          }
          return structuredClone(profile)
        }
        if (command === 'authorize_agent_profile_lease') {
          const request = args?.request as {
            provider?: 'codex' | 'claude'
            accountId?: string
            incarnation?: string
            credentialRevision?: string
          }
          if (options.authorizeProfileLease === 'reject') {
            throw new Error('lease authorization unavailable')
          }
          const currentProfile = authoritativeProfileSnapshot.profiles.find((candidate) =>
            candidate.provider === request?.provider && candidate.accountId === request?.accountId
          )
          const currentLeaseMatches = Boolean(
            currentProfile
            && currentProfile.connection.status === 'connected'
            && currentProfile.incarnation === request?.incarnation
            && currentProfile.credentialRevision === request?.credentialRevision
          )
          return {
            provider: options.authorizeProfileLease === 'mismatch'
              ? request?.provider === 'codex' ? 'claude' : 'codex'
              : request?.provider,
            accountId: request?.accountId,
            incarnation: request?.incarnation,
            credentialRevision: request?.credentialRevision,
            authorized: options.authorizeProfileLease !== 'denied' && currentLeaseMatches,
          }
        }
        if (command === 'list_agent_connections') {
          return options.includeClaude
            ? [{
                ...connection,
                provider: 'claude',
                displayName: 'Claude',
                accountLabel: null,
                credentialSource: 'claude_cli_session',
                requiredScopes: ['provider:request', 'credential:cli_session'],
              }, connection]
            : [connection]
        }
        if (command === 'begin_agent_login') {
          return new Promise((resolve) => {
            providerConnectResolver = resolve
          })
        }
        return connection
      },
    }
    bridgeWindow.__GTUM_AGENT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__agentCalls.push({ command, args })
        bridgeWindow.__orderedAgentCalls.push({ surface: 'agent', command, args })
        if (command === 'read_agent_account_capabilities') {
          const request = args?.request as {
            provider?: 'codex' | 'claude'
            accountId?: string
            incarnation?: string
            credentialRevision?: string
          }
          const provider = request?.provider || 'codex'
          const accountId = String(request?.accountId || '')
          const lease = {
            provider,
            accountId,
            incarnation: String(request?.incarnation || ''),
            credentialRevision: String(request?.credentialRevision || ''),
          }
          if (deferAccountCapabilities) {
            return new Promise((resolve, reject) => {
              capabilityResolvers.set(accountId, { lease, resolve, reject })
            })
          }
          return accountCapabilitySnapshot(
            provider,
            accountId,
            lease.incarnation,
            lease.credentialRevision,
          )
        }
        if (command === 'request_agent_account_suggestions') {
          const request = args?.request as {
            provider?: 'codex' | 'claude'
            accountId?: string
            incarnation?: string
            credentialRevision?: string
            projectPath?: string
            agentSessionId?: string
          }
          const path = String(request?.projectPath)
          const sessionId = String(request?.agentSessionId || '')
          const key = contextKey(path, sessionId)
          requestOwners.set(key, {
            provider: request?.provider || 'codex',
            accountId: String(request?.accountId || ''),
            incarnation: String(request?.incarnation || ''),
            credentialRevision: String(request?.credentialRevision || ''),
          })
          return new Promise<unknown[]>((resolve, reject) => {
            requestResolvers.set(key, resolve)
            requestRejectors.set(key, reject)
          })
        }
        throw new Error(`Unexpected Agent command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_AGENT_JOB_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__agentJobCalls.push({ command, args })
        bridgeWindow.__orderedAgentCalls.push({ surface: 'job', command, args })
        if (command === 'list_agent_jobs') {
          if (bridgeWindow.__delaySessionCloseLists && Number(args?.limit) === 100) {
            const sessionId = String(args?.sessionId || '')
            return new Promise<unknown[]>((resolve) => {
              sessionCloseResolvers.set(sessionId, resolve)
            })
          }
          return []
        }
        if (command === 'create_agent_job') {
          const request = args?.request as { projectPath?: string; sessionId?: string }
          const path = String(request?.projectPath)
          const sessionId = String(request?.sessionId)
          return new Promise((resolve) =>
            jobResolvers.set(contextKey(path, sessionId), resolve))
        }
        if (command === 'create_authorized_agent_job') {
          const request = args?.request as {
            provider?: 'codex' | 'claude'
            accountId?: string
            incarnation?: string
            credentialRevision?: string
            projectPath?: string
            sessionId?: string
          }
          if (options.authorizeProfileLease === 'denied') {
            throw new Error('The captured Agent account credential is stale or disconnected.')
          }
          if (options.authorizeProfileLease === 'reject') {
            throw new Error('Agent account authorization is unavailable.')
          }
          if (options.authorizeProfileLease === 'mismatch') {
            throw new Error('Authorized agent job lease mismatch.')
          }
          const currentProfile = authoritativeProfileSnapshot.profiles.find((candidate) =>
            candidate.provider === request?.provider && candidate.accountId === request?.accountId
          )
          const currentLeaseMatches = Boolean(
            currentProfile
            && currentProfile.connection.status === 'connected'
            && !currentProfile.connection.requiresValidation
            && currentProfile.incarnation === request?.incarnation
            && currentProfile.credentialRevision === request?.credentialRevision
          )
          if (!currentLeaseMatches) {
            throw new Error('The captured Agent account credential is stale or disconnected.')
          }
          const path = String(request?.projectPath)
          const sessionId = String(request?.sessionId)
          return new Promise((resolve) =>
            jobResolvers.set(contextKey(path, sessionId), resolve))
        }
        if (command === 'read_agent_job_logs') {
          throw new Error('No job logs expected while create is pending')
        }
        throw new Error(`Unexpected Agent job command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_TERMINAL_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__terminalCalls.push({ command, args })
        throw new Error(`Center terminal must remain untouched: ${command}`)
      },
    }
  }, {
    projectA,
    projectB,
    sharedSessionId,
    projectASessions,
    activeProjectASessionId,
    options,
  })
}

test('account session migration waits for authoritative startup profiles before hydrating v1', async ({ page }) => {
  await installProjectAgentHarness(
    page,
    [{ id: sharedSessionId, title: 'Legacy A Agent' }],
    sharedSessionId,
    { delayProfileSnapshot: true },
  )
  await page.goto('/')

  await expect.poll(() => page.evaluate(() => (
    window as Window & { __profileSnapshotRequested?: boolean }
  ).__profileSnapshotRequested ?? false)).toBe(true)
  expect(await page.evaluate(() => (
    window as Window & { __authCalls?: Array<{ command: string }> }
  ).__authCalls?.map((call) => call.command) ?? [])).toEqual([
    'list_agent_connections',
    'read_agent_profile_snapshot',
  ])
  expect(await page.evaluate(() => ({
    v1: localStorage.getItem('gtum.agent-session-directory.v1'),
    v2: localStorage.getItem('gtum.agent-session-directory.v2'),
  }))).toEqual({
    v1: expect.any(String),
    v2: null,
  })
  await expect(page.locator('.agent-session-tab')).toHaveCount(0)

  await page.evaluate(() => (
    window as Window & { __resolveAgentProfileSnapshot(): void }
  ).__resolveAgentProfileSnapshot())

  await expect(page.locator('.agent-session-tab')).toHaveCount(1)
  await expect(page.locator('.agent-session-tab')).toContainText('Legacy A Agent')
  await expect.poll(() => page.evaluate((projectPath) => {
    const raw = localStorage.getItem('gtum.agent-session-directory.v2')
    if (!raw) return null
    return JSON.parse(raw)[projectPath]?.sessions?.[0]?.selectedAccountIds ?? null
  }, projectA)).toEqual({ codex: 'codex-default' })
  expect(await page.evaluate(() => localStorage.getItem('gtum.agent-session-directory.v1')))
    .toBeNull()
})

test('account session migration finishes startup unassigned when profile discovery fails without touching the center terminal', async ({ page }) => {
  await installProjectAgentHarness(
    page,
    [{
      id: sharedSessionId,
      title: 'Discovery failure session',
      selectedReasoningLevels: { codex: 'low' },
      fastModes: { codex: true },
    }],
    sharedSessionId,
    { failProfileSnapshot: true },
  )
  await page.goto('/')

  await expect.poll(() => page.evaluate(() => (
    window as Window & { __profileSnapshotRequested?: boolean }
  ).__profileSnapshotRequested ?? false)).toBe(true)
  expect(await page.evaluate(() => (
    window as Window & { __authCalls?: Array<{ command: string }> }
  ).__authCalls?.map((call) => call.command) ?? [])).toEqual([
    'list_agent_connections',
    'read_agent_profile_snapshot',
  ])
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-project-path', projectA)
  await expect(page.locator('.agent-session-tab')).toHaveCount(1)
  await expect(page.locator('.agent-session-new')).toBeEnabled()
  await expect.poll(() => page.evaluate((projectPath) => {
    const raw = localStorage.getItem('gtum.agent-session-directory.v2')
    if (!raw) return null
    const session = JSON.parse(raw)[projectPath]?.sessions?.[0]
    return session
      ? {
          selectedAccountIds: session.selectedAccountIds,
          selectedModels: session.selectedModels,
          selectedReasoningLevels: session.selectedReasoningLevels,
          fastModes: session.fastModes,
        }
      : null
  }, projectA)).toEqual({
    selectedAccountIds: {},
    selectedModels: {},
    selectedReasoningLevels: {},
    fastModes: {},
  })

  const centerBefore = await page.locator('.center').innerHTML()
  await page.locator('.agent-session-tab').click()
  expect(await page.locator('.center').innerHTML()).toBe(centerBefore)
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('account session migration assigns the authoritative exact default only to startup-created sessions', async ({ page }) => {
  await installProjectAgentHarness(
    page,
    [{ id: sharedSessionId, title: 'Unused legacy fixture' }],
    sharedSessionId,
    { seedLegacyDirectory: false, codexDefaultAccountId: 'codex-profile-2' },
  )
  await page.goto('/')

  await expect.poll(() => page.evaluate((projectPath) => {
    const raw = localStorage.getItem('gtum.agent-session-directory.v2')
    if (!raw) return null
    const sessions = JSON.parse(raw)[projectPath]?.sessions ?? []
    return sessions.map((session: { selectedAccountIds?: unknown }) => session.selectedAccountIds)
  }, projectA)).toEqual([{ codex: 'codex-profile-2' }])
})

test('account session migration keeps an invalid-only existing v2 workspace unresolved on startup', async ({ page }) => {
  await installProjectAgentHarness(
    page,
    [{ id: sharedSessionId, title: 'Unused legacy fixture' }],
    sharedSessionId,
    {
      seedLegacyDirectory: false,
      seedV2DirectoryRaw: JSON.stringify({
        [projectA]: {
          workspaceTitle: 'project-a',
          activeSessionId: 'invalid-provider',
          sessions: [{
            id: 'invalid-provider',
            title: 'Existing invalid session',
            providerId: 'unknown-provider',
            selectedAccountIds: { codex: 'codex-default' },
          }],
        },
      }),
    },
  )
  await page.goto('/')

  await expect(page.locator('.agent-session-tab')).toHaveCount(1)
  await expect.poll(() => page.evaluate((projectPath) => {
    const raw = localStorage.getItem('gtum.agent-session-directory.v2')
    if (!raw) return null
    const session = JSON.parse(raw)[projectPath]?.sessions?.[0]
    return session
      ? { providerId: session.providerId, selectedAccountIds: session.selectedAccountIds }
      : null
  }, projectA)).toEqual({ providerId: 'codex', selectedAccountIds: {} })
})

test('account session migration preserves unread storage until a later reload hydrates successfully', async ({ page }) => {
  const existingV2Raw = JSON.stringify(persistedWorkspace({
    id: 'existing-v2-owner',
    title: 'Existing preserved owner',
    providerId: 'codex',
    selectedAccountIds: { codex: 'codex-profile-9' },
    selectedModels: { codex: { 'codex-profile-9': 'gpt-preserved' } },
    selectedReasoningLevels: { codex: { 'codex-profile-9': 'high' } },
    fastModes: { codex: { 'codex-profile-9': true } },
  }))
  const legacyV1Raw = JSON.stringify(persistedWorkspace({
    id: 'legacy-must-not-be-deleted',
    title: 'Legacy must not be deleted',
    providerId: 'claude',
  }))
  await installProjectAgentHarness(
    page,
    [{ id: sharedSessionId, title: 'Unused legacy fixture' }],
    sharedSessionId,
    {
      seedLegacyDirectory: false,
      seedV1DirectoryRaw: legacyV1Raw,
      seedV2DirectoryRaw: existingV2Raw,
      failFirstSessionDirectoryRead: true,
      logSessionDirectoryStorageOperations: true,
    },
  )
  await page.goto('/')

  await expect(page.locator('.agent')).toHaveAttribute('data-agent-project-path', projectA)
  await expect(page.locator('.agent-session-tab')).toHaveCount(1)
  expect(await page.evaluate(() => (
    window as Window & { __sessionDirectorySeedApplied?: boolean }
  ).__sessionDirectorySeedApplied)).toBe(true)
  await page.locator('.agent-session-new').click()
  await expect(page.locator('.agent-session-tab')).toHaveCount(2)
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setTimeout(resolve, 0))
    })
  }))
  expect(await page.evaluate(() => (
    window as Window & { __sessionDirectoryStorageOperations?: unknown[] }
  ).__sessionDirectoryStorageOperations ?? [])).toEqual([])
  expect(await page.evaluate(() => ({
    v1: localStorage.getItem('gtum.agent-session-directory.v1'),
    v2: localStorage.getItem('gtum.agent-session-directory.v2'),
  }))).toEqual({ v1: legacyV1Raw, v2: existingV2Raw })

  await page.evaluate(() => {
    sessionStorage.setItem('gtum.test.session-directory-read-recovered', 'true')
  })
  await page.reload()

  await expect(page.locator('.agent-session-tab')).toContainText('Existing preserved owner')
  await expect.poll(() => page.evaluate(() =>
    localStorage.getItem('gtum.agent-session-directory.v1'))).toBeNull()
  const reloadStorageState = await page.evaluate(() => ({
    seedApplied: (
      window as Window & { __sessionDirectorySeedApplied?: boolean }
    ).__sessionDirectorySeedApplied,
    operations: (
      window as Window & {
        __sessionDirectoryStorageOperations?: Array<{
          operation: 'set' | 'remove'
          key: string
        }>
      }
    ).__sessionDirectoryStorageOperations ?? [],
  }))
  expect(reloadStorageState.seedApplied).toBe(false)
  expect(reloadStorageState.operations).not.toContainEqual(expect.objectContaining({
    operation: 'set',
    key: AGENT_SESSION_DIRECTORY_V1_STORAGE_KEY,
  }))
  expect(reloadStorageState.operations).toContainEqual(expect.objectContaining({
    operation: 'remove',
    key: AGENT_SESSION_DIRECTORY_V1_STORAGE_KEY,
  }))
  await expect.poll(() => page.evaluate((projectPath) => {
    const raw = localStorage.getItem('gtum.agent-session-directory.v2')
    if (!raw) return null
    return JSON.parse(raw)[projectPath]?.sessions?.[0]?.selectedAccountIds ?? null
  }, projectA)).toEqual({ codex: 'codex-profile-9' })
})

const projectRow = (page: Page, path: string) =>
  page.locator(`[data-project-path="${path}"]`)

const settingsAccountRow = (
  page: Page,
  provider: 'codex' | 'claude',
  accountId: string,
) => page.locator(
  `.settings-account-row[data-provider-id="${provider}"][data-account-id="${accountId}"]`,
)

const sendRequest = async (page: Page, text: string) => {
  await page.getByPlaceholder('Ask Codex').fill(text)
  await page.locator('.composer-input .send').click()
}

const setFastMode = async (page: Page, enabled: boolean) => {
  const trigger = page.locator('.fast-toggle')
  const current = await trigger.getAttribute('aria-pressed')
  expect(
    ['true', 'false'],
    'Fast must expose its current boolean through aria-pressed',
  ).toContain(current)

  if ((current === 'true') !== enabled) await trigger.click()

  await expect(trigger).toHaveAttribute('aria-pressed', String(enabled))
  await expect(trigger).toHaveAttribute(
    'aria-label',
    `Fast mode: ${enabled ? 'Enabled' : 'Disabled'}`,
  )
  expect(await trigger.getAttribute('aria-haspopup')).toBeNull()
  expect(await trigger.getAttribute('aria-expanded')).toBeNull()
  await expect(page.getByRole('listbox', { name: 'Fast mode' })).toHaveCount(0)
}

const requestCalls = (page: Page) => page.evaluate(() => (
  window as Window & { __agentCalls?: Array<{ command: string; args?: Record<string, unknown> }> }
).__agentCalls?.filter((call) => call.command === 'request_agent_account_suggestions') ?? [])

const accountSessionDirectory = (
  sessions: Array<{ id: string; title: string; accountId: string }>,
  activeSessionId = sessions[0]?.id || '',
) => JSON.stringify({
  [projectA]: {
    workspaceTitle: 'project-a',
    activeSessionId,
    sessions: sessions.map((session) => ({
      id: session.id,
      title: session.title,
      providerId: 'codex',
      selectedAccountIds: { codex: session.accountId },
      selectedModels: {},
      selectedReasoningLevels: {},
      fastModes: {},
    })),
  },
})

test('generated account restart requires an exact fresh Check before capability and Send', async ({ page }) => {
  const accountId = 'codex-profile-7'
  await installProjectAgentHarness(page, undefined, undefined, {
    seedLegacyDirectory: false,
    seedV2DirectoryRaw: accountSessionDirectory([
      { id: sameProjectSessionA, title: 'Restarted account', accountId },
    ]),
    accountProfiles: [{
      provider: 'codex',
      accountId,
      alias: 'Restarted generated',
      incarnation: '17',
      credentialRevision: '2',
      requiresValidation: true,
    }],
  })
  await page.goto('/')

  const panel = page.locator('.agent')
  const send = page.locator('.composer-input .send')
  await expect(panel).toHaveAttribute('data-agent-account-id', accountId)
  await expect(panel).toHaveAttribute('data-agent-profile-incarnation', '17')
  await expect(panel).toHaveAttribute('data-agent-credential-revision', '2')
  await expect(panel).toHaveAttribute('data-agent-profile-status', 'needs_verification')
  await expect(page.locator('.composer-provider-chip')).toHaveAttribute(
    'aria-label',
    'Agent account: Codex · Restarted generated · Needs verification',
  )
  await page.getByPlaceholder('Ask Codex').fill('run only after a fresh exact check')
  await expect(send).toBeDisabled()
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => (
    window as Window & { __agentCalls?: Array<{ command: string }> }
  ).__agentCalls?.filter((call) => call.command === 'read_agent_account_capabilities') ?? []))
    .toEqual([])

  await page.locator('.titlebar .pill.icon-only').click()
  const accountRow = settingsAccountRow(page, 'codex', accountId)
  await expect(accountRow).toHaveAttribute('data-profile-status', 'needs_verification')
  await accountRow.getByRole('button', {
    name: `Check Codex account Restarted generated (${accountId})`,
  }).click()

  await expect(accountRow).toHaveAttribute('data-profile-status', 'connected')
  await expect(panel).toHaveAttribute('data-agent-profile-status', 'connected')
  await expect(panel).toHaveAttribute('data-agent-credential-revision', '3')
  await expect.poll(() => page.evaluate(() => (
    window as Window & {
      __agentCalls?: Array<{ command: string; args?: Record<string, unknown> }>
    }
  ).__agentCalls?.find((call) => call.command === 'read_agent_account_capabilities')
    ?.args?.request ?? null)).toEqual({
    provider: 'codex',
    accountId,
    incarnation: '17',
    credentialRevision: '3',
  })
  expect(await page.evaluate(() => (
    window as Window & {
      __authCalls?: Array<{ command: string; args?: Record<string, unknown> }>
    }
  ).__authCalls?.find((call) => call.command === 'check_agent_profile')?.args?.request ?? null))
    .toEqual({ provider: 'codex', accountId })

  await page.locator('.settings-close').click()
  await expect(page.locator('.composer-provider-chip')).toHaveAttribute(
    'aria-label',
    'Agent account: Codex · Restarted generated · Connected',
  )
  await expect(send).toBeEnabled()
  await send.click()
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  expect((await requestCalls(page))[0]?.args?.request).toEqual(expect.objectContaining({
    provider: 'codex',
    accountId,
    incarnation: '17',
    credentialRevision: '3',
  }))
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('account catalog keeps A and B independent when selection switches before reverse-order reads finish', async ({ page }) => {
  const accountA = 'codex-profile-1'
  const accountB = 'codex-profile-2'
  await installProjectAgentHarness(page, undefined, undefined, {
    seedLegacyDirectory: false,
    seedV2DirectoryRaw: accountSessionDirectory([
      { id: sameProjectSessionA, title: 'Account A', accountId: accountA },
      { id: sameProjectSessionB, title: 'Account B', accountId: accountB },
    ], sameProjectSessionA),
    accountProfiles: [
      { provider: 'codex', accountId: accountA, alias: 'A profile', incarnation: '11' },
      { provider: 'codex', accountId: accountB, alias: 'B profile', incarnation: '12' },
    ],
    deferAccountCapabilities: true,
  })
  await page.goto('/')

  const accountCapabilityCalls = () => page.evaluate(() => (
    window as Window & {
      __agentCalls?: Array<{ command: string; args?: Record<string, unknown> }>
    }
  ).__agentCalls?.filter((call) => call.command === 'read_agent_account_capabilities') ?? [])

  await expect.poll(() => accountCapabilityCalls().then((calls) => calls.length)).toBe(1)
  expect((await accountCapabilityCalls())[0]?.args?.request).toEqual({
    provider: 'codex',
    accountId: accountA,
    incarnation: '11',
    credentialRevision: '1',
  })

  await page.locator(`.agent-session-tab[data-agent-session-id="${sameProjectSessionB}"]`).click()
  await expect.poll(() => accountCapabilityCalls().then((calls) => calls.length)).toBe(2)
  expect((await accountCapabilityCalls())[1]?.args?.request).toEqual({
    provider: 'codex',
    accountId: accountB,
    incarnation: '12',
    credentialRevision: '1',
  })

  await page.evaluate((accountId) => (
    window as Window & {
      __resolveAgentCapabilities(accountId: string, modelId?: string, label?: string): void
    }
  ).__resolveAgentCapabilities(accountId, 'gpt-account-b', 'Account B model'), accountB)
  await expect(page.locator('.composer-model-chip'))
    .toHaveAttribute('aria-label', 'Codex model: Account B model')

  await page.evaluate((accountId) => (
    window as Window & {
      __resolveAgentCapabilities(accountId: string, modelId?: string, label?: string): void
    }
  ).__resolveAgentCapabilities(accountId, 'gpt-account-a', 'Account A model'), accountA)
  await page.locator(`.agent-session-tab[data-agent-session-id="${sameProjectSessionA}"]`).click()
  await expect(page.locator('.composer-model-chip'))
    .toHaveAttribute('aria-label', 'Codex model: Account A model')
  await page.locator(`.agent-session-tab[data-agent-session-id="${sameProjectSessionB}"]`).click()
  await expect(page.locator('.composer-model-chip'))
    .toHaveAttribute('aria-label', 'Codex model: Account B model')

  expect(await page.evaluate(() => (
    window as Window & { __agentCalls?: Array<{ command: string }> }
  ).__agentCalls?.filter((call) => call.command === 'read_agent_provider_capabilities') ?? []))
    .toEqual([])
})

test('account ownership leaves an exact missing or tombstoned profile unresolved without default fallback', async ({ page }) => {
  const missingAccount = 'codex-profile-9'
  await installProjectAgentHarness(page, undefined, undefined, {
    seedLegacyDirectory: false,
    seedV2DirectoryRaw: accountSessionDirectory([
      { id: sameProjectSessionA, title: 'Missing account', accountId: missingAccount },
    ]),
    profileTombstones: [{ provider: 'codex', accountId: missingAccount, incarnation: '9' }],
  })
  await page.goto('/')

  await expect(page.locator('.agent')).toHaveAttribute('data-agent-session-id', sameProjectSessionA)
  await expect(page.locator('.composer-tool')).toBeDisabled()
  await expect(page.locator('.composer-model-chip')).toHaveCount(0)
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => (
    window as Window & { __agentCalls?: Array<{ command: string }> }
  ).__agentCalls?.filter((call) => call.command.includes('capabilities')) ?? []))
    .toEqual([])

  const selectedAccount = await page.evaluate(({ projectPath, sessionId }) => {
    const directory = JSON.parse(localStorage.getItem('gtum.agent-session-directory.v2') || '{}')
    return directory[projectPath]?.sessions?.find(
      (session: { id?: string }) => session.id === sessionId,
    )?.selectedAccountIds?.codex
  }, { projectPath: projectA, sessionId: sameProjectSessionA })
  expect(selectedAccount).toBe(missingAccount)
})

test('account request survives metadata rename and default changes with its captured lease', async ({ page }) => {
  const accountA = 'codex-profile-1'
  const accountB = 'codex-profile-2'
  await installProjectAgentHarness(page, undefined, undefined, {
    seedLegacyDirectory: false,
    seedV2DirectoryRaw: accountSessionDirectory([
      { id: sameProjectSessionA, title: 'Metadata A', accountId: accountA },
      { id: sameProjectSessionB, title: 'Refresh B', accountId: accountB },
    ], sameProjectSessionA),
    accountProfiles: [
      { provider: 'codex', accountId: accountA, alias: 'A captured alias', incarnation: '11' },
      { provider: 'codex', accountId: accountB, alias: 'B profile', incarnation: '12' },
    ],
  })
  await page.goto('/')

  await sendRequest(page, 'keep A alive across metadata changes')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  await page.locator(
    `.agent-session-tab[data-agent-session-id="${sameProjectSessionB}"]`,
  ).click()
  await sendRequest(page, 'force an authoritative metadata refresh')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(2)

  await page.evaluate(({ accountA }) => {
    const testWindow = window as Window & {
      __updateAgentProfile(request: {
        provider: 'codex'
        accountId: string
        alias?: string
        isDefault?: boolean
        metadataRevision?: string
      }): void
    }
    testWindow.__updateAgentProfile({
      provider: 'codex',
      accountId: accountA,
      alias: 'A renamed after capture',
      isDefault: true,
      metadataRevision: '2',
    })
    testWindow.__updateAgentProfile({
      provider: 'codex',
      accountId: 'codex-default',
      isDefault: false,
      metadataRevision: '2',
    })
  }, { accountA })
  await page.evaluate(({ projectPath, sessionId }) => (
    window as Window & {
      __rejectAgentRequest(projectPath: string, sessionId: string, message: string): void
    }
  ).__rejectAgentRequest(projectPath, sessionId, 'metadata refresh sentinel'), {
    projectPath: projectA,
    sessionId: sameProjectSessionB,
  })
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __authCalls?: Array<{ command: string }> }
  ).__authCalls?.filter((call) => call.command === 'read_agent_profile_snapshot').length ?? 0))
    .toBeGreaterThanOrEqual(2)
  await expect(page.locator('.agent-turn')).toContainText('metadata refresh sentinel')

  await page.evaluate(({ projectPath, sessionId }) => (
    window as Window & {
      __resolveAgentRequest(projectPath: string, sessionId: string, summary: string): void
    }
  ).__resolveAgentRequest(projectPath, sessionId, 'A metadata-safe payload'), {
    projectPath: projectA,
    sessionId: sameProjectSessionA,
  })
  await page.locator(
    `.agent-session-tab[data-agent-session-id="${sameProjectSessionA}"]`,
  ).click()
  const capturedTurn = page.locator(`.agent-turn[data-owner-account-id="${accountA}"]`)
  await expect(capturedTurn).toContainText('A metadata-safe payload')
  await expect(capturedTurn).toHaveAttribute('data-owner-profile-alias', 'A captured alias')
  await expect(capturedTurn).toHaveAttribute('data-owner-credential-revision', '1')
  await expect(capturedTurn).not.toContainText('credential changed')
})

for (const profileMutation of ['check revision', 'forget'] as const) {
  for (const lateOutcome of ['success', 'failure'] as const) {
    test(`account request suppresses late ${lateOutcome} after exact ${profileMutation}`, async ({ page }) => {
      const accountA = 'codex-profile-1'
      const accountB = 'codex-profile-2'
      await installProjectAgentHarness(page, undefined, undefined, {
        seedLegacyDirectory: false,
        seedV2DirectoryRaw: accountSessionDirectory([
          { id: sameProjectSessionA, title: 'Stale A', accountId: accountA },
          { id: sameProjectSessionB, title: 'Refresh B', accountId: accountB },
        ], sameProjectSessionA),
        accountProfiles: [
          { provider: 'codex', accountId: accountA, alias: 'A profile', incarnation: '11' },
          { provider: 'codex', accountId: accountB, alias: 'B profile', incarnation: '12' },
        ],
      })
      await page.goto('/')

      await sendRequest(page, `A pending before ${profileMutation}`)
      await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
      await page.locator(
        `.agent-session-tab[data-agent-session-id="${sameProjectSessionB}"]`,
      ).click()
      await sendRequest(page, 'refresh exact profile snapshot through B')
      await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(2)

      await page.evaluate(({ accountId, mutation }) => {
        const testWindow = window as Window & {
          __updateAgentProfile(request: {
            provider: 'codex'
            accountId: string
            credentialRevision: string
            status: 'connected'
          }): void
          __forgetAgentProfile(request: { provider: 'codex'; accountId: string }): void
        }
        if (mutation === 'check revision') {
          testWindow.__updateAgentProfile({
            provider: 'codex',
            accountId,
            credentialRevision: '2',
            status: 'connected',
          })
        } else {
          testWindow.__forgetAgentProfile({ provider: 'codex', accountId })
        }
      }, { accountId: accountA, mutation: profileMutation })
      await page.evaluate(({ projectPath, sessionId }) => (
        window as Window & {
          __rejectAgentRequest(projectPath: string, sessionId: string, message: string): void
        }
      ).__rejectAgentRequest(projectPath, sessionId, 'refresh B after A mutation'), {
        projectPath: projectA,
        sessionId: sameProjectSessionB,
      })
      await expect(page.locator('.agent-turn')).toContainText('refresh B after A mutation')

      await page.locator(
        `.agent-session-tab[data-agent-session-id="${sameProjectSessionA}"]`,
      ).click()
      await expect(page.locator('.agent')).toHaveAttribute('data-request-state', 'idle')
      const staleTurn = page.locator(`.agent-turn[data-owner-account-id="${accountA}"]`)
      await expect(staleTurn).toContainText('captured Agent account credential changed')
      await expect(staleTurn).toHaveAttribute('data-owner-incarnation', '11')
      await expect(staleTurn).toHaveAttribute('data-owner-credential-revision', '1')

      const stalePayload = `${profileMutation} late ${lateOutcome} sentinel`
      if (lateOutcome === 'success') {
        await page.evaluate(({ projectPath, sessionId, payload }) => (
          window as Window & {
            __resolveAgentRequest(projectPath: string, sessionId: string, summary: string): void
          }
        ).__resolveAgentRequest(projectPath, sessionId, payload), {
          projectPath: projectA,
          sessionId: sameProjectSessionA,
          payload: stalePayload,
        })
      } else {
        await page.evaluate(({ projectPath, sessionId, payload }) => (
          window as Window & {
            __rejectAgentRequest(projectPath: string, sessionId: string, message: string): void
          }
        ).__rejectAgentRequest(projectPath, sessionId, payload), {
          projectPath: projectA,
          sessionId: sameProjectSessionA,
          payload: stalePayload,
        })
      }
      await expect(staleTurn).not.toContainText(stalePayload)
      expect(await page.evaluate(() => (
        window as Window & { __terminalCalls?: unknown[] }
      ).__terminalCalls ?? [])).toEqual([])
    })
  }
}

test('account catalog rejects a stale capability failure after exact credential revision', async ({ page }) => {
  const accountA = 'codex-profile-1'
  const accountB = 'codex-profile-2'
  await installProjectAgentHarness(page, undefined, undefined, {
    seedLegacyDirectory: false,
    seedV2DirectoryRaw: accountSessionDirectory([
      { id: sameProjectSessionA, title: 'Capability A', accountId: accountA },
      { id: sameProjectSessionB, title: 'Refresh B', accountId: accountB },
    ], sameProjectSessionA),
    accountProfiles: [
      { provider: 'codex', accountId: accountA, alias: 'A profile', incarnation: '11' },
      { provider: 'codex', accountId: accountB, alias: 'B profile', incarnation: '12' },
    ],
    deferAccountCapabilities: true,
  })
  await page.goto('/')
  const capabilityCalls = () => page.evaluate(() => (
    window as Window & { __agentCalls?: Array<{ command: string }> }
  ).__agentCalls?.filter((call) => call.command === 'read_agent_account_capabilities') ?? [])
  const bCapabilityReadCount = () => capabilityCalls().then((calls) => calls.filter((call) =>
    (call.args?.request as { accountId?: string } | undefined)?.accountId === accountB
  ).length)

  await expect.poll(() => capabilityCalls().then((calls) => calls.length)).toBe(1)
  await page.locator(
    `.agent-session-tab[data-agent-session-id="${sameProjectSessionB}"]`,
  ).click()
  await expect.poll(() => capabilityCalls().then((calls) => calls.length)).toBe(2)
  await page.evaluate((accountId) => (
    window as Window & {
      __resolveAgentCapabilities(accountId: string, modelId?: string, label?: string): void
    }
  ).__resolveAgentCapabilities(accountId, 'gpt-b-ready', 'B ready model'), accountB)
  await expect(page.locator('.composer-model-chip'))
    .toHaveAttribute('aria-label', 'Codex model: B ready model')
  await sendRequest(page, 'refresh after A capability lease stales')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)

  await page.evaluate((accountId) => (
    window as Window & {
      __updateAgentProfile(request: {
        provider: 'codex'
        accountId: string
        credentialRevision: string
        status: 'connected'
      }): void
    }
  ).__updateAgentProfile({
    provider: 'codex',
    accountId,
    credentialRevision: '2',
    status: 'connected',
  }), accountA)
  await page.evaluate(({ projectPath, sessionId }) => (
    window as Window & {
      __rejectAgentRequest(projectPath: string, sessionId: string, message: string): void
    }
  ).__rejectAgentRequest(projectPath, sessionId, 'capability revision refresh'), {
    projectPath: projectA,
    sessionId: sameProjectSessionB,
  })
  await expect(page.locator('.agent-turn')).toContainText('capability revision refresh')
  await page.evaluate((accountId) => (
    window as Window & { __rejectAgentCapabilities(accountId: string, message: string): void }
  ).__rejectAgentCapabilities(accountId, 'stale capability failure'), accountA)
  await expect(page.locator('.composer-model-chip'))
    .toHaveAttribute('aria-label', 'Codex model: B ready model')
  await expect.poll(bCapabilityReadCount).toBe(1)
  await expect(page.locator('.agent')).toHaveAttribute('data-capability-cache-size', '1')

  await page.locator(
    `.agent-session-tab[data-agent-session-id="${sameProjectSessionA}"]`,
  ).click()
  await expect.poll(() => capabilityCalls().then((calls) => calls.length)).toBe(3)
  await expect(page.locator('.composer-model-chip')).toHaveCount(0)
  await page.evaluate((accountId) => (
    window as Window & {
      __resolveAgentCapabilities(accountId: string, modelId?: string, label?: string): void
    }
  ).__resolveAgentCapabilities(accountId, 'gpt-a-revised', 'A revised model'), accountA)
  await expect(page.locator('.composer-model-chip'))
    .toHaveAttribute('aria-label', 'Codex model: A revised model')
  await expect(page.locator('.agent')).not.toContainText('stale capability failure')
  await page.locator(
    `.agent-session-tab[data-agent-session-id="${sameProjectSessionB}"]`,
  ).click()
  await expect(page.locator('.composer-model-chip'))
    .toHaveAttribute('aria-label', 'Codex model: B ready model')
  await expect.poll(bCapabilityReadCount).toBe(1)
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('account catalog bounds renderer capability state across 65 exact credential rotations', async ({ page }) => {
  const accountId = 'codex-profile-1'
  await installProjectAgentHarness(page, undefined, undefined, {
    seedLegacyDirectory: false,
    seedV2DirectoryRaw: accountSessionDirectory([
      { id: sameProjectSessionA, title: 'Rotating account', accountId },
    ]),
    accountProfiles: [{
      provider: 'codex',
      accountId,
      alias: 'Rotating profile',
      incarnation: '11',
    }],
  })
  await page.goto('/')
  const capabilityCalls = () => page.evaluate(() => (
    window as Window & { __agentCalls?: Array<{ command: string }> }
  ).__agentCalls?.filter((call) => call.command === 'read_agent_account_capabilities').length ?? 0)
  await expect.poll(capabilityCalls).toBe(1)

  for (let credentialRevision = 2; credentialRevision <= 66; credentialRevision += 1) {
    await sendRequest(page, `rotate capability lease ${credentialRevision}`)
    await expect.poll(() => requestCalls(page).then((calls) => calls.length))
      .toBe(credentialRevision - 1)
    await page.evaluate(({ accountId: capturedAccountId, revision }) => (
      window as Window & {
        __updateAgentProfile(request: {
          provider: 'codex'
          accountId: string
          credentialRevision: string
          status: 'connected'
        }): void
      }
    ).__updateAgentProfile({
      provider: 'codex',
      accountId: capturedAccountId,
      credentialRevision: revision,
      status: 'connected',
    }), { accountId, revision: String(credentialRevision) })
    await page.evaluate(({ projectPath, sessionId, revision }) => (
      window as Window & {
        __rejectAgentRequest(projectPath: string, sessionId: string, message: string): void
      }
    ).__rejectAgentRequest(projectPath, sessionId, `rotation ${revision}`), {
      projectPath: projectA,
      sessionId: sameProjectSessionA,
      revision: credentialRevision,
    })
    await expect(page.locator('.agent')).toHaveAttribute('data-request-state', 'idle')
    await expect.poll(capabilityCalls).toBe(credentialRevision)
    await expect(page.locator('.composer-model-chip')).toHaveAttribute(
      'aria-label',
      `Codex model: ${accountId} model`,
    )
    await expect(page.locator('.agent')).toHaveAttribute('data-capability-cache-size', '1')
    await expect(page.locator('.agent')).toHaveAttribute('data-capability-generation-slots', '1')
  }
})

test('keeps concurrent request, stop, draft, progress, and permission state with its project session', async ({ page }) => {
  await installProjectAgentHarness(page)
  await page.goto('/')

  const agentPanel = page.locator('.agent')
  await expect(agentPanel).toHaveAttribute('data-agent-project-path', projectA)
  await expect(agentPanel).toHaveAttribute('data-agent-session-id', sharedSessionId)
  await expect(page.locator('.agent-session-tab.active')).toHaveAttribute('aria-pressed', 'true')

  await page.getByPlaceholder('Ask Codex').fill('A draft survives')
  await projectRow(page, projectB).click()
  await expect(page.getByPlaceholder('Ask Codex')).toHaveValue('')
  await page.getByPlaceholder('Ask Codex').fill('B draft survives')
  await projectRow(page, projectA).click()
  await expect(page.getByPlaceholder('Ask Codex')).toHaveValue('A draft survives')

  await sendRequest(page, 'request A')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  await expect(agentPanel).toHaveAttribute('data-request-state', 'running')

  await projectRow(page, projectB).click()
  await expect(page.getByPlaceholder('Ask Codex')).toHaveValue('B draft survives')
  await sendRequest(page, 'request B')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(2)
  await page.locator('.composer-input .send').click()
  await expect(agentPanel).toHaveAttribute('data-request-state', 'stopped')
  await expect(page.locator('.agent-turn').last()).toContainText('Stopped by user')

  await page.evaluate(({ path, sessionId }) => (
    window as Window & { __resolveAgentRequest(path: string, sessionId: string, summary: string, command?: string): void }
  ).__resolveAgentRequest(path, sessionId, 'discarded B result', 'node project-b'), {
    path: projectB,
    sessionId: sharedSessionId,
  })
  await expect(page.locator('.agent')).not.toContainText('discarded B result')

  await projectRow(page, projectA).click()
  await expect(agentPanel).toHaveAttribute('data-request-state', 'running')
  await expect(page.locator('.composer-input .send')).toHaveClass(/stopping/)
  await page.evaluate(({ path, sessionId }) => (
    window as Window & { __resolveAgentRequest(path: string, sessionId: string, summary: string, command?: string): void }
  ).__resolveAgentRequest(path, sessionId, 'A completion only', 'node project-a'), {
    path: projectA,
    sessionId: sharedSessionId,
  })
  await expect(page.locator('.composer-approval')).toContainText('A completion only')
  await expect(page.locator('.composer-approval')).toHaveAttribute('data-owner-project-path', projectA)
  await expect(page.locator('.composer-approval')).toHaveAttribute('data-owner-session-id', sharedSessionId)
  await expect(agentPanel).toHaveAttribute('data-request-state', 'idle')

  await projectRow(page, projectB).click()
  await expect(agentPanel).toHaveAttribute('data-request-state', 'stopped')
  await expect(page.locator('.composer-approval')).toHaveCount(0)
  await expect(page.locator('.agent')).not.toContainText('A completion only')
})

test('returns a delayed attachment and request options only to their starting project session', async ({ page }) => {
  await installProjectAgentHarness(page)
  await page.goto('/')

  await page.getByPlaceholder('Ask Codex').fill('A private draft')
  await page.locator('.composer-model-chip').click()
  await page.locator('.composer-model-option').filter({ hasText: 'GPT Project A' }).click()
  await page.locator('.composer-reasoning-chip').click()
  const reasoningMenu = page.getByRole('listbox', { name: 'Reasoning levels' })
  await expect(reasoningMenu.locator('[role="option"][aria-selected="true"]')).toHaveText('High')
  await reasoningMenu.getByRole('option', { name: 'Low', exact: true }).click()
  await setFastMode(page, true)
  await page.locator('.composer-tool').click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __attachmentPickStarted?: boolean }
  ).__attachmentPickStarted ?? false)).toBe(true)

  await projectRow(page, projectB).click()
  await expect(page.getByPlaceholder('Ask Codex')).toHaveValue('')
  await expect(page.locator('.composer-attachment-chip')).toHaveCount(0)
  await expect(page.locator('.fast-toggle')).toHaveAttribute('aria-label', 'Fast mode: Disabled')
  await page.evaluate(({ projectPath, sessionId }) => (
    window as Window & { __resolveAgentAttachment(projectPath: string, sessionId: string, path: string): void }
  ).__resolveAgentAttachment(projectPath, sessionId, '/tmp/project-a.png'), {
    projectPath: projectA,
    sessionId: sharedSessionId,
  })
  await expect(page.locator('.composer-attachment-chip')).toHaveCount(0)

  await sendRequest(page, 'request B options')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  const bRequest = (await requestCalls(page))[0]?.args?.request as Record<string, unknown>
  expect(bRequest).toMatchObject({
    projectPath: projectB,
    model: null,
    fastMode: false,
    attachments: [],
  })
  await page.locator('.composer-input .send').click()

  await projectRow(page, projectA).click()
  await expect(page.getByPlaceholder('Ask Codex')).toHaveValue('A private draft')
  await expect(page.locator('.composer-attachment-chip')).toContainText('project-a.png')
  await expect(page.locator('.composer-model-chip'))
    .toHaveAttribute('aria-label', 'Codex model: GPT Project A')
  await expect(page.locator('.composer-reasoning-chip'))
    .toHaveAttribute('aria-label', 'Reasoning level: Low')
  await expect(page.locator('.fast-toggle')).toHaveAttribute('aria-label', 'Fast mode: Enabled')
})

test('account request freezes provider account alias lease model reasoning Fast attachments project session and tab before await', async ({ page }) => {
  const originFileContent = [
    'export function originContext() {',
    '  return "captured before await"',
    '}',
  ].join('\n')
  const destinationFileContent = 'export const destination = "initial"'
  await installProjectAgentHarness(page, [
    { id: sameProjectSessionA, title: 'Session A' },
    { id: sameProjectSessionB, title: 'Session B' },
  ], sameProjectSessionA, {
    includeClaude: true,
    progressStageDelayMs: 2_000,
    projectFiles: [
      { path: 'src/origin.ts', content: originFileContent },
      { path: 'src/destination.ts', content: destinationFileContent },
    ],
  })
  await page.goto('/')

  await page.locator('.tree-row.file').filter({ hasText: 'origin.ts' }).click()
  await expect(page.locator('.editor-textarea')).toHaveValue(originFileContent)
  await page.locator('.tree-row.file').filter({ hasText: 'destination.ts' }).click()
  await expect(page.locator('.editor-textarea')).toHaveValue(destinationFileContent)
  await page.locator('.gt[data-tab-id="ed-src-origin-ts"]').click()
  await expect(page.locator('.editor-textarea')).toHaveValue(originFileContent)

  await page.locator('.composer-model-chip').click()
  await page.locator('.composer-model-option').filter({ hasText: 'GPT Project A' }).click()
  await page.locator('.composer-reasoning-chip').click()
  await page.getByRole('listbox', { name: 'Reasoning levels' })
    .getByRole('option', { name: 'Low', exact: true })
    .click()
  await setFastMode(page, true)
  await page.locator('.composer-tool').click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __attachmentPickStarted?: boolean }
  ).__attachmentPickStarted ?? false)).toBe(true)
  await page.evaluate(({ projectPath, sessionId }) => (
    window as Window & {
      __resolveAgentAttachment(projectPath: string, sessionId: string, path: string): void
    }
  ).__resolveAgentAttachment(projectPath, sessionId, '/tmp/request-snapshot.png'), {
    projectPath: projectA,
    sessionId: sameProjectSessionA,
  })
  await expect(page.locator('.composer-attachment-chip')).toContainText('request-snapshot.png')

  await sendRequest(page, 'capture every send-time option')
  expect(await requestCalls(page)).toHaveLength(0)
  await page.locator('.gt[data-tab-id="ed-src-destination-ts"]').click()
  await page.locator('.editor-textarea').fill('export const destination = "mutated while awaiting"')
  await page.locator('.composer-provider-chip').click()
  await page.getByRole('option', { name: /^Claude/ }).click()
  await page.locator(`.agent-session-tab[data-agent-session-id="${sameProjectSessionB}"]`).click()
  await projectRow(page, projectB).click()
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-project-path', projectB)
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-session-id', sharedSessionId)

  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  const request = (await requestCalls(page))[0]?.args?.request
  expect(request).toEqual(expect.objectContaining({
    provider: 'codex',
    accountId: 'codex-default',
    projectPath: projectA,
    agentSessionId: sameProjectSessionA,
    model: 'gpt-project-a',
    attachments: [{
      kind: 'image',
      path: '/tmp/request-snapshot.png',
      label: 'request-snapshot.png',
    }],
    reasoningLevel: 'low',
    fastMode: true,
    activeTabId: 'ed-src-origin-ts',
    activeTabTitle: 'origin.ts',
    activeFilePath: 'src/origin.ts',
    activeFileLine: null,
    activeFileSnippet: originFileContent,
    lastNLogLines: [],
  }))

  await page.evaluate(({ projectPath, sessionId }) => (
    window as Window & {
      __resolveAgentRequest(projectPath: string, sessionId: string, summary: string, command?: string): void
    }
  ).__resolveAgentRequest(
    projectPath,
    sessionId,
    'snapshot request completed',
    'node captured-owner',
  ), {
    projectPath: projectA,
    sessionId: sameProjectSessionA,
  })
  await projectRow(page, projectA).click()
  await page.locator(`.agent-session-tab[data-agent-session-id="${sameProjectSessionA}"]`).click()
  await expect(page.locator('.agent')).toContainText('snapshot request completed')
  const permission = page.locator('.composer-approval')
  await expect(permission).toHaveAttribute('data-owner-project-path', projectA)
  await expect(permission).toHaveAttribute('data-owner-session-id', sameProjectSessionA)
  await expect(permission).toHaveAttribute('data-owner-provider-id', 'codex')
  await expect(permission).toHaveAttribute('data-owner-account-id', 'codex-default')
  await expect(permission).toHaveAttribute('data-owner-profile-alias', 'Codex ambient')
  await expect(permission).toHaveAttribute('data-owner-incarnation', '1')
  await expect(permission).toHaveAttribute('data-owner-credential-revision', '1')
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('account request keeps a delayed attachment picker on its captured account', async ({ page }) => {
  const accountA = 'codex-profile-1'
  const accountB = 'codex-profile-2'
  const accountC = 'codex-profile-3'
  const sessionC = 'same-project-session-c'
  await installProjectAgentHarness(page, undefined, undefined, {
    seedLegacyDirectory: false,
    seedV2DirectoryRaw: accountSessionDirectory([
      { id: sameProjectSessionA, title: 'Account A', accountId: accountA },
      { id: sameProjectSessionB, title: 'Account B', accountId: accountB },
      { id: sessionC, title: 'Refresh C', accountId: accountC },
    ], sameProjectSessionA),
    accountProfiles: [
      { provider: 'codex', accountId: accountA, alias: 'A profile', incarnation: '11' },
      { provider: 'codex', accountId: accountB, alias: 'B profile', incarnation: '12' },
      { provider: 'codex', accountId: accountC, alias: 'C profile', incarnation: '13' },
    ],
    accountAttachmentCatalogs: {
      [accountA]: [
        { kind: 'image', label: 'A images', enabled: true, invocationFlag: '--image' },
        { kind: 'file', label: 'A files disabled', enabled: false },
      ],
      [accountB]: [
        { kind: 'image', label: 'B images disabled', enabled: false },
        { kind: 'file', label: 'B files', enabled: true },
      ],
      [accountC]: [],
    },
  })
  await page.goto('/')

  const sessionA = page.locator(`.agent-session-tab[data-agent-session-id="${sameProjectSessionA}"]`)
  const sessionB = page.locator(`.agent-session-tab[data-agent-session-id="${sameProjectSessionB}"]`)
  const refreshSession = page.locator(`.agent-session-tab[data-agent-session-id="${sessionC}"]`)
  await expect(page.locator('.composer-tool')).toBeEnabled()
  await page.locator('.composer-tool').click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __attachmentPickStarted?: boolean }
  ).__attachmentPickStarted ?? false)).toBe(true)

  await sessionB.click()
  await page.evaluate(({ projectPath, sessionId }) => (
    window as Window & {
      __resolveAgentAttachment(projectPath: string, sessionId: string, path: string): void
    }
  ).__resolveAgentAttachment(projectPath, sessionId, '/tmp/account-a.png'), {
    projectPath: projectA,
    sessionId: sameProjectSessionA,
  })
  await expect(page.locator('.composer-attachment-chip')).toHaveCount(0)

  await expect(page.locator('.composer-tool')).toBeEnabled()
  await page.locator('.composer-tool').click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __attachmentPickStarted?: boolean }
  ).__attachmentPickStarted ?? false)).toBe(true)
  await page.evaluate(({ projectPath, sessionId }) => (
    window as Window & {
      __resolveAgentAttachment(projectPath: string, sessionId: string, path: string): void
    }
  ).__resolveAgentAttachment(projectPath, sessionId, '/tmp/account-b.txt'), {
    projectPath: projectA,
    sessionId: sameProjectSessionB,
  })
  await expect(page.locator('.composer-attachment-chip')).toContainText('account-b.txt')

  await sessionA.click()
  await expect(page.locator('.composer-attachment-chip')).toContainText('account-a.png')
  await expect(page.locator('.composer-attachment-chip')).not.toContainText('account-b.txt')
  await refreshSession.click()
  await expect(page.locator('.composer-attachment-chip')).toHaveCount(0)
  await sendRequest(page, 'refresh B after its credential lease rotates through C')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  expect((await requestCalls(page))[0]?.args?.request).toEqual(expect.objectContaining({
    provider: 'codex',
    accountId: accountC,
    attachments: [],
  }))

  await page.evaluate((accountId) => {
    const testWindow = window as Window & {
      __updateAgentProfile(request: {
        provider: 'codex'
        accountId: string
        credentialRevision: string
        status: 'connected'
      }): void
      __setAgentAttachmentCatalog(accountId: string, attachments: Array<{
        kind: 'image' | 'file' | 'directory'
        label: string
        enabled: boolean
      }>): void
    }
    testWindow.__updateAgentProfile({
      provider: 'codex',
      accountId,
      credentialRevision: '2',
      status: 'connected',
    })
    testWindow.__setAgentAttachmentCatalog(accountId, [
      { kind: 'image', label: 'B images remain disabled', enabled: false },
      { kind: 'file', label: 'B old files disabled', enabled: false },
      { kind: 'directory', label: 'B directories', enabled: true },
    ])
  }, accountB)
  await page.evaluate(({ projectPath, sessionId }) => (
    window as Window & {
      __rejectAgentRequest(projectPath: string, sessionId: string, message: string): void
    }
  ).__rejectAgentRequest(projectPath, sessionId, 'refresh B rotated catalog'), {
    projectPath: projectA,
    sessionId: sessionC,
  })
  await expect(page.locator('.agent-turn')).toContainText('refresh B rotated catalog')

  await sessionB.click()
  await expect(page.locator('.composer-attachment-chip')).toContainText('account-b.txt')
  await page.getByPlaceholder('Ask Codex').fill('block B stale file attachment')
  await expect(page.locator('.composer-input .send')).toBeDisabled()
  expect(await requestCalls(page)).toHaveLength(1)
  await expect(page.getByPlaceholder('Ask Codex')).toHaveValue('block B stale file attachment')

  await sessionA.click()
  await expect(page.locator('.composer-attachment-chip')).toContainText('account-a.png')
  await sendRequest(page, 'send A with its still-valid image catalog')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(2)
  expect((await requestCalls(page))[1]?.args?.request).toEqual(expect.objectContaining({
    provider: 'codex',
    accountId: accountA,
    attachments: [{
      kind: 'image',
      path: '/tmp/account-a.png',
      label: 'account-a.png',
    }],
  }))
  await page.locator('.composer-input .send').click()
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('account request suppresses a late success after exact profile disconnect and leaves its origin non-running', async ({ page }) => {
  await installProjectAgentHarness(page, undefined, undefined, {
    delayProfileSnapshotAfterDisconnect: true,
  })
  await page.goto('/')

  await sendRequest(page, 'disconnect this exact account while pending')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)

  await page.locator('.titlebar .pill.icon-only').click()
  const codexRow = settingsAccountRow(page, 'codex', 'codex-default')
  await codexRow.getByRole('button', { name: /^Disconnect Codex account/ }).click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __authCalls?: Array<{ command: string }> }
  ).__authCalls?.filter((call) => call.command === 'disconnect_agent_profile').length ?? 0))
    .toBe(1)
  await page.locator('.settings-close').click()

  await page.evaluate(({ projectPath, sessionId }) => (
    window as Window & {
      __resolveAgentRequest(projectPath: string, sessionId: string, summary: string): void
    }
  ).__resolveAgentRequest(projectPath, sessionId, 'late disconnected payload'), {
    projectPath: projectA,
    sessionId: sharedSessionId,
  })

  await expect(page.locator('.agent')).toHaveAttribute('data-request-state', 'idle')
  await expect(page.locator('.agent')).not.toContainText('late disconnected payload')
  await expect(page.locator('.agent-turn')).toContainText('captured Agent account credential changed')
  await expect(page.locator('.agent-turn')).toHaveAttribute('data-owner-account-id', 'codex-default')
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])

  await page.evaluate(() => (
    window as Window & { __resolveAgentProfileSnapshot(): void }
  ).__resolveAgentProfileSnapshot())
})

test('account ownership dedupes a same-tick delayed disconnect for one exact lease', async ({ page }) => {
  await installProjectAgentHarness(page, undefined, undefined, {
    deferProfileDisconnects: true,
  })
  await page.goto('/')

  await page.locator('.titlebar .pill.icon-only').click()
  const codexRow = settingsAccountRow(page, 'codex', 'codex-default')
  const disconnect = codexRow.getByRole('button', { name: /^Disconnect Codex account/ })
  await disconnect.evaluate((button) => {
    button.click()
    button.click()
  })
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __authCalls?: Array<{ command: string }> }
  ).__authCalls?.filter((call) => call.command === 'disconnect_agent_profile').length ?? 0))
    .toBe(1)

  await page.evaluate(() => (
    window as Window & { __resolveAgentDisconnect(ordinal: number): void }
  ).__resolveAgentDisconnect(1))
  await expect(codexRow).toHaveAttribute('data-profile-status', 'disconnected')
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-account-id', 'codex-default')
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-profile-incarnation', '1')
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-credential-revision', '2')
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-profile-status', 'disconnected')

  await page.waitForTimeout(100)
  expect(await page.evaluate(() => (
    window as Window & { __authCalls?: Array<{ command: string }> }
  ).__authCalls?.filter((call) => call.command === 'read_agent_profile_snapshot').length ?? 0))
    .toBe(2)
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-credential-revision', '2')
  await expect(page.locator('.agent')).not.toContainText('Could not disconnect')
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('account ownership keeps a delayed disconnect failure on its exact Settings row', async ({ page }) => {
  await installProjectAgentHarness(page, undefined, undefined, {
    deferProfileDisconnects: true,
  })
  await page.goto('/')

  await page.locator('.titlebar .pill.icon-only').click()
  const codexRow = settingsAccountRow(page, 'codex', 'codex-default')
  const disconnect = codexRow.getByRole('button', { name: /^Disconnect Codex account/ })
  await disconnect.evaluate((button) => {
    button.click()
    button.click()
  })
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __authCalls?: Array<{ command: string }> }
  ).__authCalls?.filter((call) => call.command === 'disconnect_agent_profile').length ?? 0))
    .toBe(1)

  await page.evaluate(() => (
    window as Window & { __rejectAgentDisconnect(ordinal: number, message: string): void }
  ).__rejectAgentDisconnect(1, 'captured disconnect failure'))
  const capturedError = codexRow.getByRole('alert')
  await expect(capturedError).toHaveCount(1)
  await expect(capturedError).toContainText('captured disconnect failure')
  await page.waitForTimeout(100)
  await expect(page.locator('.msg.assistant').filter({
    hasText: 'captured disconnect failure',
  })).toHaveCount(0)
  expect(await page.evaluate(() => (
    window as Window & { __authCalls?: Array<{ command: string }> }
  ).__authCalls?.filter((call) => call.command === 'read_agent_profile_snapshot').length ?? 0))
    .toBe(2)
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-credential-revision', '1')
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-profile-status', 'connected')
  await expect(codexRow.getByRole('button', { name: /^Disconnect Codex account/ })).toBeVisible()
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('account ownership rejects a mismatched disconnect response without installing another account', async ({ page }) => {
  const accountA = 'codex-profile-1'
  const accountB = 'codex-profile-2'
  await installProjectAgentHarness(page, undefined, undefined, {
    seedLegacyDirectory: false,
    seedV2DirectoryRaw: accountSessionDirectory([
      { id: sameProjectSessionA, title: 'Disconnect A', accountId: accountA },
      { id: sameProjectSessionB, title: 'Preserve B', accountId: accountB },
    ], sameProjectSessionA),
    accountProfiles: [
      { provider: 'codex', accountId: accountA, alias: 'A profile', incarnation: '11' },
      { provider: 'codex', accountId: accountB, alias: 'B profile', incarnation: '12' },
    ],
    deferProfileDisconnects: true,
  })
  await page.goto('/')

  await page.locator('.titlebar .pill.icon-only').click()
  const codexRow = settingsAccountRow(page, 'codex', accountA)
  await codexRow.getByRole('button', { name: /^Disconnect Codex account/ }).click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __authCalls?: Array<{ command: string }> }
  ).__authCalls?.filter((call) => call.command === 'disconnect_agent_profile').length ?? 0))
    .toBe(1)
  await page.evaluate(({ accountId }) => (
    window as Window & {
      __resolveAgentDisconnect(ordinal: number, overrides: {
        provider: 'codex'
        accountId: string
        incarnation: string
        credentialRevision: string
        status: 'disconnected'
        commit: boolean
      }): void
    }
  ).__resolveAgentDisconnect(1, {
    provider: 'codex',
    accountId,
    incarnation: '12',
    credentialRevision: '2',
    status: 'disconnected',
    commit: false,
  }), { accountId: accountB })

  const ownerError = codexRow.getByRole('alert')
  await expect(ownerError).toHaveCount(1)
  await expect(ownerError).toContainText('response owner mismatch')
  await expect(page.locator('.msg.assistant').filter({
    hasText: 'response owner mismatch',
  })).toHaveCount(0)
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-account-id', accountA)
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-profile-status', 'connected')
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-credential-revision', '1')

  await page.locator('.settings-close').click()
  await page.locator(
    `.agent-session-tab[data-agent-session-id="${sameProjectSessionB}"]`,
  ).click()
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-account-id', accountB)
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-profile-status', 'connected')
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-credential-revision', '1')
  await expect(page.locator('.composer-model-chip'))
    .toHaveAttribute('aria-label', `Codex model: ${accountB} model`)
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('account catalog preserves unrelated cached account state when disconnect refresh fails', async ({ page }) => {
  const accountA = 'codex-profile-1'
  const accountB = 'codex-profile-2'
  await installProjectAgentHarness(page, undefined, undefined, {
    seedLegacyDirectory: false,
    seedV2DirectoryRaw: accountSessionDirectory([
      { id: sameProjectSessionA, title: 'Disconnect A', accountId: accountA },
      { id: sameProjectSessionB, title: 'Cached B', accountId: accountB },
    ], sameProjectSessionA),
    accountProfiles: [
      { provider: 'codex', accountId: accountA, alias: 'A profile', incarnation: '11' },
      { provider: 'codex', accountId: accountB, alias: 'B profile', incarnation: '12' },
    ],
  })
  await page.goto('/')
  const bCapabilityReadCount = () => page.evaluate((accountId) => (
    window as Window & {
      __agentCalls?: Array<{ command: string; args?: Record<string, unknown> }>
    }
  ).__agentCalls?.filter((call) =>
    call.command === 'read_agent_account_capabilities'
    && (call.args?.request as { accountId?: string } | undefined)?.accountId === accountId
  ).length ?? 0, accountB)

  await page.locator(
    `.agent-session-tab[data-agent-session-id="${sameProjectSessionB}"]`,
  ).click()
  await expect(page.locator('.composer-model-chip'))
    .toHaveAttribute('aria-label', `Codex model: ${accountB} model`)
  await expect.poll(bCapabilityReadCount).toBe(1)
  await page.locator(
    `.agent-session-tab[data-agent-session-id="${sameProjectSessionA}"]`,
  ).click()

  await page.evaluate(() => (
    window as Window & { __failNextAgentProfileSnapshot(message: string): void }
  ).__failNextAgentProfileSnapshot('post-disconnect refresh unavailable'))
  await page.locator('.titlebar .pill.icon-only').click()
  const codexRow = settingsAccountRow(page, 'codex', accountA)
  await codexRow.getByRole('button', { name: /^Disconnect Codex account/ }).click()
  await expect(codexRow).toHaveAttribute('data-profile-status', 'disconnected')
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-account-id', accountA)
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-profile-status', 'disconnected')
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-credential-revision', '2')

  await page.locator('.settings-close').click()
  await page.locator(
    `.agent-session-tab[data-agent-session-id="${sameProjectSessionB}"]`,
  ).click()
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-account-id', accountB)
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-profile-status', 'connected')
  await expect(page.locator('.composer-model-chip'))
    .toHaveAttribute('aria-label', `Codex model: ${accountB} model`)
  await expect.poll(bCapabilityReadCount).toBe(1)
  await expect(page.locator('.agent')).not.toContainText('post-disconnect refresh unavailable')
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('account request releases a never-settling origin immediately when its exact lease disconnects', async ({ page }) => {
  await installProjectAgentHarness(page, [
    { id: sameProjectSessionA, title: 'Hung account request' },
    { id: sameProjectSessionB, title: 'Closable sibling' },
  ], sameProjectSessionA, {
    delayProfileSnapshotAfterDisconnect: true,
  })
  await page.goto('/')

  await sendRequest(page, 'never settle this exact account request')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)

  await page.locator('.titlebar .pill.icon-only').click()
  const codexRow = settingsAccountRow(page, 'codex', 'codex-default')
  await codexRow.getByRole('button', { name: /^Disconnect Codex account/ }).click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __authCalls?: Array<{ command: string }> }
  ).__authCalls?.filter((call) => call.command === 'disconnect_agent_profile').length ?? 0))
    .toBe(1)
  await page.locator('.settings-close').click()

  await expect(page.locator('.agent')).toHaveAttribute('data-request-state', 'idle')
  const failedTurn = page.locator('.agent-turn[data-owner-account-id="codex-default"]')
  await expect(failedTurn).toContainText('captured Agent account credential changed')
  await expect(failedTurn).toHaveAttribute('data-owner-incarnation', '1')
  await expect(failedTurn).toHaveAttribute('data-owner-credential-revision', '1')

  await page.locator(
    `.agent-session-tab[data-agent-session-id="${sameProjectSessionB}"]`,
  ).click()
  await page.locator('.agent-session-tab-wrap')
    .filter({ hasText: 'Hung account request' })
    .getByRole('button', { name: /Close Hung account request agent session/ })
    .click()
  await expect(page.locator('.agent-session-tab')).toHaveCount(1)

  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
  await page.evaluate(() => (
    window as Window & { __resolveAgentProfileSnapshot(): void }
  ).__resolveAgentProfileSnapshot())
})

test('account request cancellation and late failure retain the captured account lease', async ({ page }) => {
  await installProjectAgentHarness(page)
  await page.goto('/')

  await sendRequest(page, 'cancel this captured account request')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  await page.locator('.composer-input .send').click()
  await expect(page.locator('.agent')).toHaveAttribute('data-request-state', 'stopped')

  await page.evaluate(({ projectPath, sessionId }) => (
    window as Window & {
      __rejectAgentRequest(projectPath: string, sessionId: string, message: string): void
    }
  ).__rejectAgentRequest(projectPath, sessionId, 'late cancellation failure'), {
    projectPath: projectA,
    sessionId: sharedSessionId,
  })

  await expect(page.locator('.agent')).toHaveAttribute('data-request-state', 'stopped')
  await expect(page.locator('.agent-turn')).toContainText('Stopped by user.')
  await expect(page.locator('.agent-turn')).not.toContainText('late cancellation failure')
  await expect(page.locator('.agent-turn')).toHaveAttribute('data-owner-provider-id', 'codex')
  await expect(page.locator('.agent-turn')).toHaveAttribute('data-owner-account-id', 'codex-default')
  await expect(page.locator('.agent-turn')).toHaveAttribute('data-owner-incarnation', '1')
  await expect(page.locator('.agent-turn')).toHaveAttribute('data-owner-credential-revision', '1')
})

test('account request recovers a failure only for the originating account', async ({ page }) => {
  const accountA = 'codex-profile-1'
  const accountB = 'codex-profile-2'
  await installProjectAgentHarness(page, undefined, undefined, {
    seedLegacyDirectory: false,
    seedV2DirectoryRaw: accountSessionDirectory([
      { id: sameProjectSessionA, title: 'Account A', accountId: accountA },
      { id: sameProjectSessionB, title: 'Account B', accountId: accountB },
    ], sameProjectSessionA),
    accountProfiles: [
      { provider: 'codex', accountId: accountA, alias: 'A profile', incarnation: '11' },
      { provider: 'codex', accountId: accountB, alias: 'B profile', incarnation: '12' },
    ],
  })
  await page.goto('/')

  await sendRequest(page, 'fail only account A')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  const listCallsBeforeFailure = await page.evaluate(() => (
    window as Window & { __authCalls?: Array<{ command: string }> }
  ).__authCalls?.filter((call) => call.command === 'list_agent_connections').length ?? 0)

  await page.locator(`.agent-session-tab[data-agent-session-id="${sameProjectSessionB}"]`).click()
  await expect(page.locator('.composer-model-chip'))
    .toHaveAttribute('aria-label', `Codex model: ${accountB} model`)
  await page.evaluate(({ projectPath, sessionId }) => (
    window as Window & {
      __rejectAgentRequest(projectPath: string, sessionId: string, message: string): void
    }
  ).__rejectAgentRequest(projectPath, sessionId, 'origin A failed safely'), {
    projectPath: projectA,
    sessionId: sameProjectSessionA,
  })

  await expect(page.locator('.agent')).not.toContainText('origin A failed safely')
  await page.locator(`.agent-session-tab[data-agent-session-id="${sameProjectSessionA}"]`).click()
  await expect(page.locator('.agent-turn')).toContainText('origin A failed safely')
  await expect(page.locator('.agent-turn')).toHaveAttribute('data-owner-account-id', accountA)
  await expect(page.locator('.agent-turn')).toHaveAttribute('data-owner-incarnation', '11')
  await expect(page.locator('.agent')).toHaveAttribute('data-request-state', 'idle')
  expect(await page.evaluate(() => (
    window as Window & { __authCalls?: Array<{ command: string }> }
  ).__authCalls?.filter((call) => call.command === 'list_agent_connections').length ?? 0))
    .toBe(listCallsBeforeFailure)
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('account request creates isolated jobs through one atomic captured-lease boundary', async ({ page }) => {
  await installProjectAgentHarness(page)
  await page.goto('/')

  await sendRequest(page, 'approve duplicate A')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  await page.evaluate(({ path, sessionId }) => (
    window as Window & { __resolveAgentRequest(path: string, sessionId: string, summary: string, command?: string): void }
  ).__resolveAgentRequest(path, sessionId, 'duplicate permission A', 'node project-a'), {
    path: projectA,
    sessionId: sharedSessionId,
  })
  const permissionA = page.locator('.composer-approval')
  await expect(permissionA).toHaveAttribute('data-owner-project-path', projectA)
  await expect(permissionA).toHaveAttribute('data-owner-provider-id', 'codex')
  const centerBeforeA = await page.locator('.workspace-root').innerHTML()
  await page.locator('.composer-provider-chip').click()
  await page.getByRole('option', { name: /^Claude/ }).click()
  await expect(permissionA).toHaveAttribute('data-owner-provider-id', 'codex')
  await permissionA.getByRole('button', { name: 'Allow once' }).evaluate((button) => {
    button.click()
    button.click()
  })
  await page.locator('.composer-provider-chip').click()
  await page.getByRole('option', { name: /^Codex/ }).click()

  await projectRow(page, projectB).click()
  await sendRequest(page, 'approve duplicate B')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(2)
  await page.evaluate(({ path, sessionId }) => (
    window as Window & { __resolveAgentRequest(path: string, sessionId: string, summary: string, command?: string): void }
  ).__resolveAgentRequest(path, sessionId, 'duplicate permission B', 'node project-b'), {
    path: projectB,
    sessionId: sharedSessionId,
  })
  const permissionB = page.locator('.composer-approval')
  await expect(permissionB).toHaveAttribute('data-owner-project-path', projectB)
  await permissionB.getByRole('button', { name: 'Allow once' }).evaluate((button) => {
    button.click()
    button.click()
  })

  await expect.poll(() => page.evaluate(() => (
    window as Window & { __agentJobCalls?: Array<{ command: string; args?: Record<string, unknown> }> }
  ).__agentJobCalls?.filter((call) => (
    call.command === 'create_authorized_agent_job'
  )) ?? [])).toHaveLength(2)

  const creates = await page.evaluate(() => (
    window as Window & { __agentJobCalls?: Array<{ command: string; args?: Record<string, unknown> }> }
  ).__agentJobCalls?.filter((call) => call.command === 'create_authorized_agent_job') ?? [])
  expect(creates.map((call) => call.args?.request)).toEqual([
    expect.objectContaining({
      provider: 'codex',
      accountId: 'codex-default',
      incarnation: '1',
      credentialRevision: '1',
      projectPath: projectA,
      sessionId: sharedSessionId,
    }),
    expect.objectContaining({
      provider: 'codex',
      accountId: 'codex-default',
      incarnation: '1',
      credentialRevision: '1',
      projectPath: projectB,
      sessionId: sharedSessionId,
    }),
  ])
  const atomicCreateOrder = await page.evaluate(() => (
    window as Window & {
      __orderedAgentCalls?: Array<{
        surface: 'auth' | 'agent' | 'job'
        command: string
        args?: Record<string, unknown>
      }>
    }
  ).__orderedAgentCalls?.filter((call) => (
    call.command === 'authorize_agent_profile_lease'
      || call.command === 'create_agent_job'
      || call.command === 'create_authorized_agent_job'
  )) ?? [])
  expect(atomicCreateOrder.map((call) => call.command)).toEqual([
    'create_authorized_agent_job',
    'create_authorized_agent_job',
  ])

  await page.evaluate(({ path, sessionId }) => (
    window as Window & { __resolveAgentJob(path: string, sessionId: string): void }
  ).__resolveAgentJob(path, sessionId), { path: projectB, sessionId: sharedSessionId })
  await expect(page.locator('.agent')).toContainText('agent job #202')
  await page.evaluate(({ path, sessionId }) => (
    window as Window & { __resolveAgentJob(path: string, sessionId: string): void }
  ).__resolveAgentJob(path, sessionId), { path: projectA, sessionId: sharedSessionId })
  await expect(page.locator('.agent')).not.toContainText('agent job #101')

  await projectRow(page, projectA).click()
  await expect(page.locator('.agent')).toContainText('agent job #101')
  expect(await page.locator('.workspace-root').innerHTML()).toBe(centerBeforeA)
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
})

for (const authorizationMode of ['denied', 'reject', 'mismatch'] as const) {
  test(`account request blocks ${authorizationMode} lease inside atomic job creation`, async ({ page }) => {
    await installProjectAgentHarness(page, undefined, undefined, {
      authorizeProfileLease: authorizationMode,
    })
    await page.goto('/')

    await sendRequest(page, `block ${authorizationMode} authorization`)
    await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
    await page.evaluate(({ projectPath, sessionId, summary }) => (
      window as Window & {
        __resolveAgentRequest(
          projectPath: string,
          sessionId: string,
          summary: string,
          command?: string,
        ): void
      }
    ).__resolveAgentRequest(
      projectPath,
      sessionId,
      summary,
      'node must-not-start',
    ), {
      projectPath: projectA,
      sessionId: sharedSessionId,
      summary: `${authorizationMode} authorization card`,
    })

    const permission = page.locator('.composer-approval')
    await permission.getByRole('button', { name: 'Allow once' }).click()
    await expect.poll(() => page.evaluate(() => (
      window as Window & { __agentJobCalls?: Array<{ command: string }> }
    ).__agentJobCalls?.filter((call) => (
      call.command === 'create_authorized_agent_job'
    )).length ?? 0))
      .toBe(1)
    await page.waitForTimeout(100)
    expect(await page.evaluate(() => (
      window as Window & { __agentJobCalls?: Array<{ command: string }> }
    ).__agentJobCalls?.filter((call) => call.command === 'create_agent_job') ?? []))
      .toEqual([])
    expect(await page.evaluate(() => (
      window as Window & { __authCalls?: Array<{ command: string }> }
    ).__authCalls?.filter((call) => call.command === 'authorize_agent_profile_lease') ?? []))
      .toEqual([])
    await expect(page.locator('.agent')).toContainText('Agent job authorization was blocked.')
    await expect(page.locator('.msg.assistant').last())
      .toHaveAttribute('data-owner-account-id', 'codex-default')
    expect(await page.evaluate(() => (
      window as Window & { __terminalCalls?: unknown[] }
    ).__terminalCalls ?? [])).toEqual([])
  })
}

test('account request blocks approval after the captured profile disconnects', async ({ page }) => {
  await installProjectAgentHarness(page)
  await page.goto('/')

  await sendRequest(page, 'disconnect before approving')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  await page.evaluate(({ projectPath, sessionId }) => (
    window as Window & {
      __resolveAgentRequest(
        projectPath: string,
        sessionId: string,
        summary: string,
        command?: string,
      ): void
    }
  ).__resolveAgentRequest(
    projectPath,
    sessionId,
    'stale approval card',
    'node stale-approval',
  ), { projectPath: projectA, sessionId: sharedSessionId })

  await page.locator('.titlebar .pill.icon-only').click()
  const codexRow = settingsAccountRow(page, 'codex', 'codex-default')
  await codexRow.getByRole('button', { name: /^Disconnect Codex account/ }).click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __authCalls?: Array<{ command: string }> }
  ).__authCalls?.filter((call) => call.command === 'disconnect_agent_profile').length ?? 0))
    .toBe(1)
  await page.locator('.settings-close').click()

  await page.locator('.composer-approval').getByRole('button', { name: 'Allow once' }).click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __agentJobCalls?: Array<{ command: string }> }
  ).__agentJobCalls?.filter((call) => call.command === 'create_authorized_agent_job').length ?? 0))
    .toBe(1)
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => (
    window as Window & {
      __agentJobCalls?: Array<{ command: string; args?: Record<string, unknown> }>
    }
  ).__agentJobCalls?.find((call) => call.command === 'create_authorized_agent_job')
    ?.args?.request ?? null)).toEqual({
    provider: 'codex',
    accountId: 'codex-default',
    incarnation: '1',
    credentialRevision: '1',
    projectPath: projectA,
    command: 'node stale-approval',
    name: 'agent-duplicate-suggestion-1',
    sessionId: sharedSessionId,
  })
  expect(await page.evaluate(() => (
    window as Window & { __authCalls?: Array<{ command: string }> }
  ).__authCalls?.filter((call) => call.command === 'authorize_agent_profile_lease') ?? []))
    .toEqual([])
  expect(await page.evaluate(() => (
    window as Window & { __agentJobCalls?: Array<{ command: string }> }
  ).__agentJobCalls?.filter((call) => call.command === 'create_agent_job') ?? []))
    .toEqual([])
  await expect(page.locator('.agent')).toContainText('Agent job authorization was blocked.')
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('account request permission decisions isolate the same suggestion id by captured lease', async ({ page }) => {
  await installProjectAgentHarness(page)
  await page.goto('/')

  await sendRequest(page, 'Codex revision one duplicate id')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  await page.evaluate(({ projectPath, sessionId }) => (
    window as Window & {
      __resolveAgentRequest(
        projectPath: string,
        sessionId: string,
        summary: string,
        command?: string,
      ): void
    }
  ).__resolveAgentRequest(projectPath, sessionId, 'Codex revision one card', 'node codex-rev1'), {
    projectPath: projectA,
    sessionId: sharedSessionId,
  })
  const revisionOneTurn = page.locator(
    '.agent-turn[data-suggestion-id="duplicate-suggestion"]' +
    '[data-owner-provider-id="codex"]' +
    '[data-owner-account-id="codex-default"]' +
    '[data-owner-credential-revision="1"]',
  )
  await expect(revisionOneTurn).toHaveCount(1)
  await expect(page.locator('.composer-approval')).toHaveCount(1)

  await page.locator('.titlebar .pill.icon-only').click()
  const codexRow = settingsAccountRow(page, 'codex', 'codex-default')
  await codexRow.getByRole('button', { name: /^Disconnect Codex account/ }).click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __authCalls?: Array<{ command: string }> }
  ).__authCalls?.filter((call) => call.command === 'disconnect_agent_profile').length ?? 0))
    .toBe(1)
  await expect(codexRow).toHaveAttribute('data-profile-status', 'disconnected')
  await page.evaluate(() => (
    window as Window & {
      __updateAgentProfile(request: {
        provider: 'codex'
        accountId: string
        credentialRevision: string
        status: 'connected'
      }): void
    }
  ).__updateAgentProfile({
    provider: 'codex',
    accountId: 'codex-default',
    credentialRevision: '3',
    status: 'connected',
  }))
  await codexRow.getByRole('button', { name: /^Check Codex account/ }).click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __authCalls?: Array<{ command: string }> }
  ).__authCalls?.filter((call) => call.command === 'check_agent_profile').length ?? 0))
    .toBe(1)
  await expect(codexRow).toHaveAttribute('data-profile-status', 'connected')
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-credential-revision', '3')
  expect(await page.evaluate(() => (
    window as Window & {
      __authCalls?: Array<{ command: string; args?: Record<string, unknown> }>
    }
  ).__authCalls?.find((call) => call.command === 'check_agent_profile')?.args?.request))
    .toEqual({ provider: 'codex', accountId: 'codex-default' })
  await page.locator('.settings-close').click()
  await expect(page.locator('.composer-model-chip')).toHaveAttribute('aria-label', /Codex model:/)

  await sendRequest(page, 'Codex revision three duplicate id')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(2)
  await page.evaluate(({ projectPath, sessionId }) => (
    window as Window & {
      __resolveAgentRequest(
        projectPath: string,
        sessionId: string,
        summary: string,
        command?: string,
      ): void
    }
  ).__resolveAgentRequest(projectPath, sessionId, 'Codex revision three card', 'node codex-rev3'), {
    projectPath: projectA,
    sessionId: sharedSessionId,
  })

  const revisionThreeTurn = page.locator(
    '.agent-turn[data-suggestion-id="duplicate-suggestion"]' +
    '[data-owner-provider-id="codex"]' +
    '[data-owner-account-id="codex-default"]' +
    '[data-owner-credential-revision="3"]',
  )
  await expect(revisionThreeTurn).toHaveCount(1)
  await expect(page.locator('.composer-approval')).toHaveCount(1)
  await expect(page.locator('.composer-approval'))
    .toHaveAttribute('data-owner-credential-revision', '3')

  await page.locator('.composer-approval')
    .getByRole('button', { name: 'Allow once' })
    .click({ clickCount: 2 })
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __agentJobCalls?: Array<{ command: string }> }
  ).__agentJobCalls?.filter((call) => call.command === 'create_authorized_agent_job').length ?? 0))
    .toBe(1)
  expect(await page.evaluate(() => (
    window as Window & { __agentJobCalls?: Array<{ command: string }> }
  ).__agentJobCalls?.filter((call) => call.command === 'create_agent_job') ?? []))
    .toEqual([])
  expect(await page.evaluate(() => (
    window as Window & {
      __agentJobCalls?: Array<{ command: string; args?: Record<string, unknown> }>
    }
  ).__agentJobCalls?.filter((call) => (
    call.command === 'create_authorized_agent_job'
  ))[0]?.args?.request))
    .toEqual({
      provider: 'codex',
      accountId: 'codex-default',
      incarnation: '1',
      credentialRevision: '3',
      projectPath: projectA,
      command: 'node codex-rev3',
      name: 'agent-duplicate-suggestion-1',
      sessionId: sharedSessionId,
    })
  expect(await page.evaluate(() => (
    window as Window & { __authCalls?: Array<{ command: string }> }
  ).__authCalls?.filter((call) => call.command === 'authorize_agent_profile_lease') ?? []))
    .toEqual([])
  await page.evaluate(({ projectPath, sessionId }) => (
    window as Window & { __resolveAgentJob(projectPath: string, sessionId: string): void }
  ).__resolveAgentJob(projectPath, sessionId), {
    projectPath: projectA,
    sessionId: sharedSessionId,
  })
  await expect(revisionThreeTurn).toHaveAttribute('data-permission-decision', 'allow_once')
  await expect(revisionOneTurn).not.toHaveAttribute('data-permission-decision', 'allow_once')

  await expect(page.locator('.composer-approval')).toHaveCount(1)
  await expect(page.locator('.composer-approval'))
    .toHaveAttribute('data-owner-credential-revision', '1')
  await page.locator('.composer-approval').getByRole('button', { name: 'Allow once' }).click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __agentJobCalls?: Array<{ command: string }> }
  ).__agentJobCalls?.filter((call) => call.command === 'create_authorized_agent_job').length ?? 0))
    .toBe(2)
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => (
    window as Window & { __agentJobCalls?: Array<{ command: string }> }
  ).__agentJobCalls?.filter((call) => call.command === 'create_agent_job') ?? []))
    .toEqual([])
  expect(await page.evaluate(() => (
    window as Window & {
      __agentJobCalls?: Array<{ command: string; args?: Record<string, unknown> }>
    }
  ).__agentJobCalls?.filter((call) => (
    call.command === 'create_authorized_agent_job'
  ))[1]?.args?.request)).toEqual({
    provider: 'codex',
    accountId: 'codex-default',
    incarnation: '1',
    credentialRevision: '1',
    projectPath: projectA,
    command: 'node codex-rev1',
    name: 'agent-duplicate-suggestion-1',
    sessionId: sharedSessionId,
  })
  expect(await page.evaluate(() => (
    window as Window & { __authCalls?: Array<{ command: string }> }
  ).__authCalls?.filter((call) => call.command === 'authorize_agent_profile_lease') ?? []))
    .toEqual([])
  await expect(revisionOneTurn).not.toHaveAttribute('data-permission-decision', 'allow_once')
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('account request dedupes a same-tick deny for one captured lease and suggestion', async ({ page }) => {
  await installProjectAgentHarness(page)
  await page.goto('/')

  await sendRequest(page, 'deny this exact permission only once')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  await page.evaluate(({ projectPath, sessionId }) => (
    window as Window & {
      __resolveAgentRequest(
        projectPath: string,
        sessionId: string,
        summary: string,
        command?: string,
      ): void
    }
  ).__resolveAgentRequest(
    projectPath,
    sessionId,
    'single deny card',
    'node deny-exactly-once',
  ), { projectPath: projectA, sessionId: sharedSessionId })

  await expect(page.locator('.composer-approval')).toHaveCount(1)
  await page.locator('.composer-approval')
    .getByRole('button', { name: 'Deny' })
    .click({ clickCount: 2 })
  const denialMessages = page.locator('.msg.assistant').filter({
    hasText: 'node deny-exactly-once',
  })
  await expect(denialMessages).toHaveCount(1)
  const deniedTurn = page.locator(
    '.agent-turn[data-suggestion-id="duplicate-suggestion"]' +
    '[data-owner-provider-id="codex"]' +
    '[data-owner-account-id="codex-default"]' +
    '[data-owner-credential-revision="1"]',
  )
  await expect(deniedTurn).toHaveAttribute('data-permission-decision', 'denied')
  expect(await page.evaluate(() => (
    window as Window & { __authCalls?: Array<{ command: string }> }
  ).__authCalls?.filter((call) => call.command === 'authorize_agent_profile_lease') ?? []))
    .toEqual([])
  expect(await page.evaluate(() => (
    window as Window & { __agentJobCalls?: Array<{ command: string }> }
  ).__agentJobCalls?.filter((call) => call.command === 'create_agent_job') ?? []))
    .toEqual([])
  expect(await page.evaluate(() => (
    window as Window & { __agentJobCalls?: Array<{ command: string }> }
  ).__agentJobCalls?.filter((call) => call.command === 'create_authorized_agent_job') ?? []))
    .toEqual([])
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('keeps session selection and close actions as sibling buttons', async ({ page }) => {
  await installProjectAgentHarness(page)
  await page.goto('/')
  await page.locator('.agent-session-new').click()

  await expect(page.locator('.agent-session-tab')).toHaveCount(2)
  await expect(page.locator('.agent-session-tabs')).toHaveAttribute('role', 'group')
  await expect(page.locator('.agent-session-tab.active')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.agent-session-tab[aria-selected]')).toHaveCount(0)
  await expect(page.locator('.agent-session-tab').first()).toHaveAttribute('data-agent-project-path', projectA)
  await expect(page.locator('.ws-item').first()).toHaveAttribute('data-agent-project-path', projectA)
  await expect(page.locator('button [role="button"]')).toHaveCount(0)
  await expect(page.locator('.agent-session-tab .agent-session-close')).toHaveCount(0)
  await expect(page.locator('.ws-item .ws-remove')).toHaveCount(0)
  const close = page.locator('.agent-session-close').first()
  await expect(close).toHaveAttribute('aria-label', /Close .+ agent session/)
  const closeMetrics = await close.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return { width: rect.width, height: rect.height, cursor: style.cursor }
  })
  expect(closeMetrics.width).toBeGreaterThanOrEqual(24)
  expect(closeMetrics.height).toBeGreaterThanOrEqual(24)
  expect(closeMetrics.cursor).toBe('pointer')
})

test('same-project Agent session A/B execution preferences stay isolated across reload', async ({ page }) => {
  await installProjectAgentHarness(page, [
    {
      id: sameProjectSessionA,
      title: 'Session A',
      selectedReasoningLevels: { codex: 'low' },
      fastModes: { codex: false },
    },
    {
      id: sameProjectSessionB,
      title: 'Session B',
      selectedReasoningLevels: { codex: 'high' },
      fastModes: { codex: true },
    },
  ], sameProjectSessionA)
  await page.goto('/')

  const reasoningTrigger = page.locator('.composer-reasoning-chip')
  const fastTrigger = page.locator('.fast-toggle')
  const sessionTab = (sessionId: string) =>
    page.locator(`.agent-session-tab[data-agent-session-id="${sessionId}"]`)
  const expectExecution = async (reasoning: 'Low' | 'High', fast: 'Disabled' | 'Enabled') => {
    await expect(reasoningTrigger).toHaveAttribute('aria-label', `Reasoning level: ${reasoning}`)
    await expect(fastTrigger).toHaveAttribute('aria-label', `Fast mode: ${fast}`)
  }
  const chooseReasoning = async (reasoning: 'Low' | 'High') => {
    await reasoningTrigger.click()
    await page.getByRole('listbox', { name: 'Reasoning levels' })
      .getByRole('option', { name: reasoning, exact: true })
      .click()
  }
  const chooseFast = async (fast: 'Disabled' | 'Enabled') => {
    await setFastMode(page, fast === 'Enabled')
  }
  const storedPreferencesBySession = () => page.evaluate((projectPath) => {
    const directory = JSON.parse(localStorage.getItem('gtum.agent-session-directory.v2') || '{}')
    return Object.fromEntries((directory[projectPath]?.sessions || []).map((session: {
      id: string
      selectedReasoningLevels?: Record<string, unknown>
      fastModes?: Record<string, unknown>
      reasoningLevel?: unknown
      fastMode?: unknown
    }) => [session.id, session]))
  }, projectA)

  await expect(page.locator('.agent')).toHaveAttribute('data-agent-session-id', sameProjectSessionA)
  await expectExecution('Low', 'Disabled')
  await chooseReasoning('High')
  await chooseFast('Enabled')
  await expectExecution('High', 'Enabled')

  await sessionTab(sameProjectSessionB).click()
  await expectExecution('High', 'Enabled')
  await chooseReasoning('Low')
  await chooseFast('Disabled')
  await expectExecution('Low', 'Disabled')

  await sessionTab(sameProjectSessionA).click()
  await expectExecution('High', 'Enabled')
  await sessionTab(sameProjectSessionB).click()
  await expectExecution('Low', 'Disabled')

  await expect.poll(storedPreferencesBySession).toEqual(expect.objectContaining({
    [sameProjectSessionA]: expect.objectContaining({
      selectedAccountIds: { codex: 'codex-default' },
      selectedReasoningLevels: { codex: { 'codex-default': 'high' } },
      fastModes: { codex: { 'codex-default': true } },
    }),
    [sameProjectSessionB]: expect.objectContaining({
      selectedAccountIds: { codex: 'codex-default' },
      selectedReasoningLevels: { codex: { 'codex-default': 'low' } },
      fastModes: { codex: { 'codex-default': false } },
    }),
  }))

  await page.reload()
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-session-id', sameProjectSessionB)
  await expectExecution('Low', 'Disabled')
  await sessionTab(sameProjectSessionA).click()
  await expectExecution('High', 'Enabled')
  await sessionTab(sameProjectSessionB).click()
  await expectExecution('Low', 'Disabled')

  const persisted = await storedPreferencesBySession()
  for (const [sessionId, reasoningLevel, fastMode] of [
    [sameProjectSessionA, 'high', true],
    [sameProjectSessionB, 'low', false],
  ] as const) {
    expect(persisted[sessionId]).toEqual(expect.objectContaining({
      selectedAccountIds: { codex: 'codex-default' },
      selectedReasoningLevels: { codex: { 'codex-default': reasoningLevel } },
      fastModes: { codex: { 'codex-default': fastMode } },
    }))
    expect(persisted[sessionId]).not.toHaveProperty('reasoningLevel')
    expect(persisted[sessionId]).not.toHaveProperty('fastMode')
  }
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('keeps same-project background request and attachment updates in session A while B stays selected', async ({ page }) => {
  await installProjectAgentHarness(page, [
    { id: sameProjectSessionA, title: 'Session A' },
    { id: sameProjectSessionB, title: 'Session B' },
  ], sameProjectSessionA)
  await page.goto('/')

  const composer = page.getByPlaceholder('Ask Codex')
  await composer.fill('first line\nsecond line\nthird line')
  const expandedHeight = await composer.evaluate((element) => element.style.height)
  expect(expandedHeight).toMatch(/px$/)
  await page.locator(`.agent-session-tab[data-agent-session-id="${sameProjectSessionB}"]`).click()
  await page.locator(`.agent-session-tab[data-agent-session-id="${sameProjectSessionA}"]`).click()
  await expect(composer).toHaveValue('first line\nsecond line\nthird line')
  await expect.poll(() => composer.evaluate((element) => element.style.height)).toBe(expandedHeight)

  await sendRequest(page, 'session A request')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  await page.locator('.composer-tool').click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __attachmentPickStarted?: boolean }
  ).__attachmentPickStarted ?? false)).toBe(true)

  const sessionB = page.locator(`.agent-session-tab[data-agent-session-id="${sameProjectSessionB}"]`)
  await sessionB.click()
  await expect(sessionB).toHaveAttribute('aria-pressed', 'true')
  await page.evaluate(({ projectA, sessionId }) => (
    window as Window & {
      __resolveAgentAttachment(projectPath: string, sessionId: string, path: string): void
      __resolveAgentRequest(projectPath: string, sessionId: string, summary: string): void
    }
  ).__resolveAgentAttachment(projectA, sessionId, '/tmp/session-a.png'), {
    projectA,
    sessionId: sameProjectSessionA,
  })
  await page.evaluate(({ projectA, sessionId }) => (
    window as Window & {
      __resolveAgentRequest(projectPath: string, sessionId: string, summary: string): void
    }
  ).__resolveAgentRequest(projectA, sessionId, 'session A background result'), {
    projectA,
    sessionId: sameProjectSessionA,
  })

  await expect(sessionB).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-session-id', sameProjectSessionB)
  await expect(page.locator('.agent')).not.toContainText('session A background result')
  await expect(page.locator('.composer-attachment-chip')).toHaveCount(0)

  await page.locator(`.agent-session-tab[data-agent-session-id="${sameProjectSessionA}"]`).click()
  await expect(page.locator('.agent')).toContainText('session A background result')
  await expect(page.locator('.composer-attachment-chip')).toContainText('session-a.png')
  await expect(page.locator('.agent')).toHaveAttribute('data-request-state', 'idle')
})

test('ignores a delayed callback for a removed session without persisting a nonexistent selection', async ({ page }) => {
  await installProjectAgentHarness(page, [
    { id: sameProjectSessionA, title: 'Session A' },
    { id: sameProjectSessionB, title: 'Session B' },
  ], sameProjectSessionA)
  await page.goto('/')

  await page.locator('.composer-tool').click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __attachmentPickStarted?: boolean }
  ).__attachmentPickStarted ?? false)).toBe(true)
  await page.locator(`.agent-session-tab[data-agent-session-id="${sameProjectSessionB}"]`).click()
  await page.evaluate(() => {
    (window as Window & { __delaySessionCloseLists: boolean }).__delaySessionCloseLists = true
  })
  await page.locator('.agent-session-tab-wrap')
    .filter({ hasText: 'Session A' })
    .getByRole('button', { name: /Close Session A agent session/ })
    .click()
  await expect.poll(() => page.evaluate((sessionId) => (
    window as Window & { __agentJobCalls?: Array<{ command: string; args?: Record<string, unknown> }> }
  ).__agentJobCalls?.some((call) =>
    call.command === 'list_agent_jobs' && call.args?.sessionId === sessionId && call.args?.limit === 100,
  ) ?? false, sameProjectSessionA)).toBe(true)
  await page.evaluate((sessionId) => (
    window as Window & { __resolveSessionClose(sessionId: string): void }
  ).__resolveSessionClose(sessionId), sameProjectSessionA)
  await expect(page.locator('.agent-session-tab')).toHaveCount(1)

  await page.evaluate(({ projectA, sessionId }) => (
    window as Window & {
      __resolveAgentAttachment(projectPath: string, sessionId: string, path: string): void
    }
  ).__resolveAgentAttachment(projectA, sessionId, '/tmp/removed-session.png'), {
    projectA,
    sessionId: sameProjectSessionA,
  })
  await expect(page.locator('.agent')).toHaveAttribute('data-agent-session-id', sameProjectSessionB)
  await expect(page.locator('.composer-attachment-chip')).toHaveCount(0)
  await expect.poll(() => page.evaluate(({ projectA }) => {
    const directory = JSON.parse(localStorage.getItem('gtum.agent-session-directory.v2') || '{}')
    return directory[projectA]?.activeSessionId
  }, { projectA })).toBe(sameProjectSessionB)
})

test('keeps a session open while its provider request is running', async ({ page }) => {
  await installProjectAgentHarness(page, [
    { id: sameProjectSessionA, title: 'Session A' },
    { id: sameProjectSessionB, title: 'Session B' },
  ], sameProjectSessionA)
  await page.goto('/')

  await sendRequest(page, 'keep the running owner')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  await page.locator('.agent-session-tab-wrap')
    .filter({ hasText: 'Session A' })
    .getByRole('button', { name: /Close Session A agent session/ })
    .click()

  await expect(page.locator('.agent-session-tab')).toHaveCount(2)
  await expect(page.locator('.agent')).toContainText(
    'This session has a running provider request. Stop it or wait for it to finish before closing the session.',
  )

  await page.evaluate(({ projectA, sessionId }) => (
    window as Window & {
      __resolveAgentRequest(projectPath: string, sessionId: string, summary: string): void
    }
  ).__resolveAgentRequest(projectA, sessionId, 'running owner completed'), {
    projectA,
    sessionId: sameProjectSessionA,
  })
  await expect(page.locator('.agent')).toContainText('running owner completed')
})

test('keeps exact account check lifecycle in Settings without writing project messages', async ({ page }) => {
  await installProjectAgentHarness(page)
  await page.goto('/')

  await projectRow(page, projectB).click()
  await page.locator('.titlebar .pill.icon-only').click()
  const codexRow = settingsAccountRow(page, 'codex', 'codex-default')
  await codexRow.getByRole('button', { name: /^Disconnect Codex account/ }).click()
  await expect(codexRow).toHaveAttribute('data-profile-status', 'disconnected')
  await page.evaluate(() => (
    window as Window & {
      __updateAgentProfile(request: {
        provider: 'codex'
        accountId: string
        credentialRevision: string
        status: 'connected'
      }): void
    }
  ).__updateAgentProfile({
    provider: 'codex',
    accountId: 'codex-default',
    credentialRevision: '3',
    status: 'connected',
  }))
  await codexRow.getByRole('button', { name: /^Check Codex account/ }).click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & {
      __authCalls?: Array<{ command: string; args?: Record<string, unknown> }>
    }
  ).__authCalls?.filter((call) => call.command === 'check_agent_profile').length ?? 0))
    .toBe(1)
  await expect(codexRow).toHaveAttribute('data-profile-status', 'connected')
  await expect(page.locator('.settings-modal')).toBeVisible()
  await page.locator('.settings-close').click()
  await projectRow(page, projectA).click()
  await expect(page.locator('.agent')).not.toContainText('Codex connected through the local CLI session.')

  await projectRow(page, projectB).click()
  await expect(page.locator('.agent')).not.toContainText('Codex connected through the local CLI session.')
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls?: unknown[] }
  ).__terminalCalls ?? [])).toEqual([])
})

test('retains the last session request lease across deterministic concurrent closes', async ({ page }) => {
  await installProjectAgentHarness(page, [
    { id: sameProjectSessionA, title: 'Session A' },
    { id: sameProjectSessionB, title: 'Session B' },
  ], sameProjectSessionB)
  await page.goto('/')

  await sendRequest(page, 'session B survives close race')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  await page.evaluate(() => {
    (window as Window & { __delaySessionCloseLists: boolean }).__delaySessionCloseLists = true
  })
  const closeListsBefore = await page.evaluate(({ sessionA, sessionB }) => {
    const calls = (
      window as Window & { __agentJobCalls?: Array<{ command: string; args?: Record<string, unknown> }> }
    ).__agentJobCalls ?? []
    const countFor = (sessionId: string) => calls.filter((call) =>
      call.command === 'list_agent_jobs' &&
      call.args?.limit === 100 &&
      call.args?.sessionId === sessionId,
    ).length
    return { sessionA: countFor(sessionA), sessionB: countFor(sessionB) }
  }, { sessionA: sameProjectSessionA, sessionB: sameProjectSessionB })
  const closeButtons = page.locator('.agent-session-close')
  await closeButtons.nth(0).click()
  await closeButtons.nth(1).click()
  await expect.poll(() => page.evaluate((sessionId) => (
    window as Window & { __agentJobCalls?: Array<{ command: string; args?: Record<string, unknown> }> }
  ).__agentJobCalls?.filter((call) =>
    call.command === 'list_agent_jobs' &&
    call.args?.limit === 100 &&
    call.args?.sessionId === sessionId,
  ).length ?? 0, sameProjectSessionA)).toBe(closeListsBefore.sessionA + 1)
  expect(await page.evaluate((sessionId) => (
    window as Window & { __agentJobCalls?: Array<{ command: string; args?: Record<string, unknown> }> }
  ).__agentJobCalls?.filter((call) =>
    call.command === 'list_agent_jobs' &&
    call.args?.limit === 100 &&
    call.args?.sessionId === sessionId,
  ).length ?? 0, sameProjectSessionB)).toBe(closeListsBefore.sessionB)

  await page.evaluate((sessionId) => (
    window as Window & { __resolveSessionClose(sessionId: string): void }
  ).__resolveSessionClose(sessionId), sameProjectSessionA)
  await expect(page.locator('.agent-session-tab')).toHaveCount(1)
  await expect(page.locator('.agent-session-tab')).toHaveAttribute('data-agent-session-id', sameProjectSessionB)

  await page.evaluate(({ projectA, sessionId }) => (
    window as Window & {
      __resolveAgentRequest(projectPath: string, sessionId: string, summary: string): void
    }
  ).__resolveAgentRequest(projectA, sessionId, 'retained request completed'), {
    projectA,
    sessionId: sameProjectSessionB,
  })
  await expect(page.locator('.agent')).toContainText('retained request completed')
  await expect(page.locator('.agent')).toHaveAttribute('data-request-state', 'idle')
})

test('rejects rapid same-context double send before React can render the busy state', async ({ page }) => {
  await installProjectAgentHarness(page)
  await page.goto('/')

  await page.getByPlaceholder('Ask Codex').fill('rapid request')
  await page.locator('.composer-input .send').evaluate((button) => {
    button.click()
    button.click()
  })
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  await expect(page.locator('.msg.user').filter({ hasText: 'rapid request' })).toHaveCount(1)
  await expect(page.locator('.agent-turn[data-request-turn-id]')).toHaveCount(1)

  await page.evaluate(({ projectA, sessionId }) => (
    window as Window & {
      __resolveAgentRequest(projectPath: string, sessionId: string, summary: string): void
    }
  ).__resolveAgentRequest(projectA, sessionId, 'single rapid result'), {
    projectA,
    sessionId: sharedSessionId,
  })
  await expect(page.locator('.agent')).toContainText('single rapid result')
  await expect(page.locator('.agent')).toHaveAttribute('data-request-state', 'idle')
})

test('keeps fast B and late successful A results in their project owners without stopping either', async ({ page }) => {
  await installProjectAgentHarness(page)
  await page.goto('/')

  await sendRequest(page, 'successful request A')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  await projectRow(page, projectB).click()
  await sendRequest(page, 'successful request B')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(2)
  await page.evaluate(({ projectB, sessionId }) => (
    window as Window & {
      __resolveAgentRequest(projectPath: string, sessionId: string, summary: string): void
    }
  ).__resolveAgentRequest(projectB, sessionId, 'fast B result'), {
    projectB,
    sessionId: sharedSessionId,
  })
  await expect(page.locator('.agent')).toContainText('fast B result')

  await page.evaluate(({ projectA, sessionId }) => (
    window as Window & {
      __resolveAgentRequest(projectPath: string, sessionId: string, summary: string): void
    }
  ).__resolveAgentRequest(projectA, sessionId, 'late A result'), {
    projectA,
    sessionId: sharedSessionId,
  })
  await expect(projectRow(page, projectB)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.agent')).not.toContainText('late A result')
  await projectRow(page, projectA).click()
  await expect(page.locator('.agent')).toContainText('late A result')
})

test('keeps an old numbered choice retryable when a running request lease rejects it', async ({ page }) => {
  await installProjectAgentHarness(page)
  await page.goto('/')

  await sendRequest(page, 'create a numbered choice')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(1)
  await page.evaluate(({ projectPath, sessionId }) => (
    window as Window & {
      __resolveAgentRequest(projectPath: string, sessionId: string, summary: string): void
    }
  ).__resolveAgentRequest(
    projectPath,
    sessionId,
    'Choose how to continue. 1. Keep waiting 2. Retry after the current request',
  ), { projectPath: projectA, sessionId: sharedSessionId })

  const choiceCard = page.locator('.agent-event-card.choice')
  const retryChoice = choiceCard.getByRole('button', {
    name: /2 Retry after the current request/,
  })
  await expect(retryChoice).toBeEnabled()

  await sendRequest(page, 'hold the request lease')
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(2)
  await retryChoice.click()

  await expect(choiceCard).not.toContainText('Selected')
  await expect(retryChoice).toBeEnabled()
  await expect(page.locator('.msg.user').filter({
    hasText: '2. Retry after the current request',
  })).toHaveCount(0)
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(2)

  await page.locator('.composer-input .send').click()
  await expect(page.locator('.agent')).toHaveAttribute('data-request-state', 'stopped')
  await retryChoice.click()

  await expect(choiceCard).toContainText('Selected')
  await expect(page.locator('.msg.user').filter({
    hasText: '2. Retry after the current request',
  })).toHaveCount(1)
  await expect.poll(() => requestCalls(page).then((calls) => calls.length)).toBe(3)

  await page.evaluate(({ projectPath, sessionId }) => (
    window as Window & {
      __resolveAgentRequest(projectPath: string, sessionId: string, summary: string): void
    }
  ).__resolveAgentRequest(projectPath, sessionId, 'choice retry accepted'), {
    projectPath: projectA,
    sessionId: sharedSessionId,
  })
  await expect(page.locator('.agent')).toContainText('choice retry accepted')
  await expect(page.locator('.agent')).toHaveAttribute('data-request-state', 'idle')
})
