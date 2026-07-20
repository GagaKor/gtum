import { expect, test } from '@playwright/test'

import {
  createAgentSuggestionRuntimeService,
  type RuntimeAgentAccountProviderCapabilities,
  type RuntimeAgentAccountProviderDiagnostics,
  type RuntimeAgentAccountSuggestionResponse,
} from '../../src/shared/api/runtimeAgentSuggestions'

const CODEX_ACCOUNT_ID = 'codex-default'
const CLAUDE_ACCOUNT_ID = 'claude-default'
const CODEX_LEASE = {
  provider: 'codex' as const,
  accountId: CODEX_ACCOUNT_ID,
  incarnation: '11',
  credentialRevision: '17',
}
const CLAUDE_LEASE = {
  provider: 'claude' as const,
  accountId: CLAUDE_ACCOUNT_ID,
  incarnation: '13',
  credentialRevision: '19',
}

const runtimeSuggestion: RuntimeAgentAccountSuggestionResponse = {
  ...CODEX_LEASE,
  id: 'codex-1',
  summary: 'Run the focused test suite',
  command: 'pnpm test:funnel --reporter=verbose',
  preferredTarget: 'current_tab',
  confidence: 'high',
  error: null,
}

const validClaudeAccountCapabilities: RuntimeAgentAccountProviderCapabilities = {
  ...CLAUDE_LEASE,
  supportsModelSelection: true,
  currentModel: {
    providerId: 'claude',
    modelId: ' default ',
    label: ' Default (recommended) · Opus 4.8 with 1M context ',
  },
  availableModels: [
    {
      providerId: 'claude',
      modelId: ' default ',
      label: ' Default (recommended) · Opus 4.8 with 1M context ',
    },
    {
      providerId: 'claude',
      modelId: 'opus[1m]',
      label: 'Opus · Opus 4.8 with 1M context',
    },
    {
      providerId: 'claude',
      modelId: 'sonnet',
      label: 'Sonnet · Sonnet 5',
    },
    {
      providerId: 'claude',
      modelId: 'claude-fable-5[1m]',
      label: 'Fable · Fable 5',
    },
    {
      providerId: 'claude',
      modelId: 'haiku',
      label: 'Haiku · Haiku 4.5',
    },
  ],
  reasoningLevels: [
    {
      level: 'high',
      label: 'High',
      description: 'Greater reasoning depth',
    },
  ],
  defaultReasoningLevel: 'high',
  supportsFastMode: true,
  attachments: [
    {
      kind: 'file',
      label: 'File',
      enabled: true,
      invocationFlag: '--file',
    },
  ],
}

const createCapabilityService = (capabilities: RuntimeAgentAccountProviderCapabilities) =>
  createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => capabilities,
  })

const claudeCapabilitiesWithModelExecutionOptions = (
  executionOptions: unknown,
  overrides: Record<string, unknown> = {},
): RuntimeAgentAccountProviderCapabilities =>
  ({
    ...validClaudeAccountCapabilities,
    availableModels: [
      {
        providerId: 'claude',
        modelId: 'metadata-model',
        label: 'Metadata model',
        executionOptions,
        ...overrides,
      },
    ],
  }) as RuntimeAgentAccountProviderCapabilities

test.describe('model execution options', () => {
  test('normalizes valid nested fields and preserves returned reasoning order', async () => {
    const capabilities = await createCapabilityService({
      ...validClaudeAccountCapabilities,
      availableModels: [
        {
          providerId: 'claude',
          modelId: ' metadata-a ',
          label: ' Metadata A ',
          executionOptions: {
            reasoningLevels: [
              {
                level: 'high',
                label: ' High ',
                description: ' Greater reasoning depth ',
                ignored: 'must not cross the runtime boundary',
              },
              {
                level: 'low',
                label: 'Low',
                description: null,
              },
              {
                level: 'max',
                label: 'é'.repeat(32),
              },
            ],
            supportsFastMode: true,
            ignored: true,
          },
        },
        {
          providerId: 'claude',
          modelId: 'metadata-b',
          label: 'Metadata B',
          executionOptions: {
            reasoningLevels: [],
            supportsFastMode: false,
          },
        },
      ],
    } as RuntimeAgentAccountProviderCapabilities).readAccountCapabilities(CLAUDE_LEASE)

    expect(capabilities.availableModels).toEqual([
      {
        providerId: 'claude',
        modelId: 'metadata-a',
        label: 'Metadata A',
        executionOptions: {
          reasoningLevels: [
            {
              level: 'high',
              label: 'High',
              description: 'Greater reasoning depth',
            },
            {
              level: 'low',
              label: 'Low',
              description: null,
            },
            {
              level: 'max',
              label: 'é'.repeat(32),
            },
          ],
          supportsFastMode: true,
        },
      },
      {
        providerId: 'claude',
        modelId: 'metadata-b',
        label: 'Metadata B',
        executionOptions: {
          reasoningLevels: [],
          supportsFastMode: false,
        },
      },
    ])
  })

  test('rejects null and non-object option envelopes', async () => {
    for (const invalid of [null, 'invalid', 1, true, []]) {
      await expect(
        createCapabilityService(
          claudeCapabilitiesWithModelExecutionOptions(invalid),
        ).readAccountCapabilities(CLAUDE_LEASE),
      ).rejects.toThrow(/executionOptions/)
    }
  })

  test('rejects non-array and excessive reasoning level collections', async () => {
    for (const reasoningLevels of [
      null,
      {},
      'high',
      ['low', 'medium', 'high', 'xhigh', 'max', 'low'].map((level) => ({
        level,
        label: level,
      })),
    ]) {
      await expect(
        createCapabilityService(
          claudeCapabilitiesWithModelExecutionOptions({
            reasoningLevels,
            supportsFastMode: false,
          }),
        ).readAccountCapabilities(CLAUDE_LEASE),
      ).rejects.toThrow(/executionOptions\.reasoningLevels/)
    }
  })

  test('rejects blank, oversized, duplicate, unknown, and nonexact reasoning levels', async () => {
    const invalidLevels = [[''], [' '.repeat(17)], ['low', 'low'], ['ultra'], [' high '], ['HIGH']]

    for (const levels of invalidLevels) {
      await expect(
        createCapabilityService(
          claudeCapabilitiesWithModelExecutionOptions({
            reasoningLevels: levels.map((level) => ({
              level,
              label: 'Valid label',
            })),
            supportsFastMode: false,
          }),
        ).readAccountCapabilities(CLAUDE_LEASE),
      ).rejects.toThrow(/executionOptions\.reasoningLevels/)
    }
  })

  test('rejects blank or oversized reasoning labels and descriptions', async () => {
    const invalidCapabilities = [
      { level: 'low', label: '' },
      { level: 'low', label: 'é'.repeat(33) },
      { level: 'low', label: 'Low', description: '   ' },
      { level: 'low', label: 'Low', description: 'é'.repeat(81) },
      { level: 'low', label: 'Low', description: 42 },
    ]

    for (const capability of invalidCapabilities) {
      await expect(
        createCapabilityService(
          claudeCapabilitiesWithModelExecutionOptions({
            reasoningLevels: [capability],
            supportsFastMode: false,
          }),
        ).readAccountCapabilities(CLAUDE_LEASE),
      ).rejects.toThrow(/executionOptions\.reasoningLevels\[0\]/)
    }
  })

  test('rejects missing and nonboolean Fast support', async () => {
    for (const supportsFastMode of [undefined, null, 0, 1, 'false']) {
      await expect(
        createCapabilityService(
          claudeCapabilitiesWithModelExecutionOptions({
            reasoningLevels: [],
            ...(supportsFastMode === undefined ? {} : { supportsFastMode }),
          }),
        ).readAccountCapabilities(CLAUDE_LEASE),
      ).rejects.toThrow(/executionOptions\.supportsFastMode/)
    }
  })

  test('rejects provider and model ownership drift before publishing metadata', async () => {
    await expect(
      createCapabilityService({
        ...claudeCapabilitiesWithModelExecutionOptions({
          reasoningLevels: [],
          supportsFastMode: false,
        }),
        provider: 'codex',
      }).readAccountCapabilities(CLAUDE_LEASE),
    ).rejects.toThrow(/Provider capability owner mismatch.*claude.*codex/)

    await expect(
      createCapabilityService(
        claudeCapabilitiesWithModelExecutionOptions(
          {
            reasoningLevels: [],
            supportsFastMode: false,
          },
          { providerId: 'codex' },
        ),
      ).readAccountCapabilities(CLAUDE_LEASE),
    ).rejects.toThrow(/Provider capability owner mismatch.*availableModels\[0\].*claude.*codex/)
  })
})

test('accepts Claude account catalog values and normalizes only model identifiers and labels', async () => {
  const capabilities = await createCapabilityService(
    validClaudeAccountCapabilities,
  ).readAccountCapabilities(CLAUDE_LEASE)

  expect(capabilities).toEqual({
    ...validClaudeAccountCapabilities,
    currentModel: {
      providerId: 'claude',
      modelId: 'default',
      label: 'Default (recommended) · Opus 4.8 with 1M context',
    },
    availableModels: [
      {
        providerId: 'claude',
        modelId: 'default',
        label: 'Default (recommended) · Opus 4.8 with 1M context',
      },
      ...validClaudeAccountCapabilities.availableModels.slice(1),
    ],
  })
})

test('accepts a requested-provider current model outside the available account catalog', async () => {
  const capabilities = await createCapabilityService({
    ...validClaudeAccountCapabilities,
    currentModel: {
      providerId: 'claude',
      modelId: 'configured-current',
      label: 'Configured current model',
    },
  }).readAccountCapabilities(CLAUDE_LEASE)

  expect(capabilities.currentModel?.modelId).toBe('configured-current')
})

test('rejects non-object current models with a field-specific schema error', async () => {
  for (const currentModel of [undefined, false, 7, 'claude', []]) {
    const service = createCapabilityService({
      ...validClaudeAccountCapabilities,
      currentModel,
    } as unknown as RuntimeAgentAccountProviderCapabilities)

    await expect(service.readAccountCapabilities(CLAUDE_LEASE)).rejects.toThrow(
      /Provider capability currentModel must be an object/,
    )
  }
})

test('rejects null and primitive available models with an indexed schema error', async () => {
  for (const model of [null, false, 7, 'claude', []]) {
    const service = createCapabilityService({
      ...validClaudeAccountCapabilities,
      availableModels: [model],
    } as unknown as RuntimeAgentAccountProviderCapabilities)

    await expect(service.readAccountCapabilities(CLAUDE_LEASE)).rejects.toThrow(
      /Provider capability availableModels\[0\] must be an object/,
    )
  }
})

test('rejects a top-level provider owner mismatch in Claude capabilities', async () => {
  const service = createCapabilityService({
    ...validClaudeAccountCapabilities,
    provider: 'codex',
  })

  await expect(
    service.readAccountCapabilities(CLAUDE_LEASE),
  ).rejects.toThrow(/Provider capability owner mismatch.*claude.*codex/)
})

test('rejects a top-level account owner mismatch in Claude capabilities', async () => {
  const service = createCapabilityService({
    ...validClaudeAccountCapabilities,
    accountId: 'claude-profile-1',
  } as RuntimeAgentAccountProviderCapabilities)

  await expect(
    service.readAccountCapabilities(CLAUDE_LEASE),
  ).rejects.toThrow(/capability owner mismatch.*claude-default.*claude-profile-1/i)
})

test('rejects a current model owned by another provider in Claude capabilities', async () => {
  const service = createCapabilityService({
    ...validClaudeAccountCapabilities,
    currentModel: {
      providerId: 'codex',
      modelId: 'gpt-5-codex',
      label: 'GPT-5 Codex',
    },
  })

  await expect(
    service.readAccountCapabilities(CLAUDE_LEASE),
  ).rejects.toThrow(/Provider capability owner mismatch.*currentModel.*claude.*codex/)
})

test('rejects an available model owned by another provider in Claude capabilities', async () => {
  const service = createCapabilityService({
    ...validClaudeAccountCapabilities,
    availableModels: [
      ...validClaudeAccountCapabilities.availableModels,
      {
        providerId: 'codex',
        modelId: 'gpt-5-codex',
        label: 'GPT-5 Codex',
      },
    ],
  })

  await expect(
    service.readAccountCapabilities(CLAUDE_LEASE),
  ).rejects.toThrow(/Provider capability owner mismatch.*availableModels\[5\].*claude.*codex/)
})

test('rejects a blank model identifier in Claude capabilities', async () => {
  const service = createCapabilityService({
    ...validClaudeAccountCapabilities,
    availableModels: [
      {
        providerId: 'claude',
        modelId: '   ',
        label: 'Sonnet',
      },
    ],
  })

  await expect(
    service.readAccountCapabilities(CLAUDE_LEASE),
  ).rejects.toThrow(/availableModels\[0\]\.modelId.*non-empty/)
})

test('rejects a blank model label in Claude capabilities', async () => {
  const service = createCapabilityService({
    ...validClaudeAccountCapabilities,
    availableModels: [
      {
        providerId: 'claude',
        modelId: 'sonnet',
        label: '\t ',
      },
    ],
  })

  await expect(
    service.readAccountCapabilities(CLAUDE_LEASE),
  ).rejects.toThrow(/availableModels\[0\]\.label.*non-empty/)
})

test('rejects duplicate Claude model identifiers after trimming', async () => {
  const service = createCapabilityService({
    ...validClaudeAccountCapabilities,
    availableModels: [
      {
        providerId: 'claude',
        modelId: 'sonnet',
        label: 'Sonnet',
      },
      {
        providerId: 'claude',
        modelId: ' sonnet ',
        label: 'Duplicate Sonnet entry',
      },
    ],
  })

  await expect(
    service.readAccountCapabilities(CLAUDE_LEASE),
  ).rejects.toThrow(/duplicate available model ID.*sonnet/i)
})

test('uses the exact account capability command path and full lease', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const accountCapabilities: RuntimeAgentAccountProviderCapabilities = {
    ...CODEX_LEASE,
    supportsModelSelection: false,
    currentModel: null,
    availableModels: [],
    reasoningLevels: [],
    defaultReasoningLevel: null,
    supportsFastMode: false,
    attachments: [],
  }
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })
      return accountCapabilities
    },
  })

  await expect(service.readAccountCapabilities(CODEX_LEASE)).resolves.toEqual(
    accountCapabilities,
  )
  expect(invoked).toEqual([
    {
      command: 'read_agent_account_capabilities',
      args: { request: CODEX_LEASE },
    },
  ])
})

test('projects account capability responses to declared fields and exact lease only', async () => {
  const runtimeCapabilities = {
    ...CODEX_LEASE,
    supportsModelSelection: true,
    currentModel: {
      providerId: 'codex',
      modelId: ' current ',
      label: ' Current ',
      accountId: CODEX_ACCOUNT_ID,
      credentialRevision: '9',
      unknownModelField: 'must not cross',
    },
    availableModels: [
      {
        providerId: 'codex',
        modelId: ' available ',
        label: ' Available ',
        incarnation: '8',
        unknownModelField: 'must not cross',
      },
    ],
    reasoningLevels: [
      {
        level: 'high',
        label: 'High',
        description: 'Greater depth',
        credentialRevision: '7',
      },
    ],
    defaultReasoningLevel: 'high',
    supportsFastMode: true,
    attachments: [
      {
        kind: 'file',
        label: 'File',
        enabled: true,
        invocationFlag: '--file',
        accountId: CODEX_ACCOUNT_ID,
      },
    ],
    metadataRevision: '5',
    unknownTopLevelField: 'must not cross',
  }
  const expectedCapabilities: RuntimeAgentAccountProviderCapabilities = {
    ...CODEX_LEASE,
    supportsModelSelection: true,
    currentModel: {
      providerId: 'codex',
      modelId: 'current',
      label: 'Current',
    },
    availableModels: [
      {
        providerId: 'codex',
        modelId: 'available',
        label: 'Available',
      },
    ],
    reasoningLevels: [
      {
        level: 'high',
        label: 'High',
        description: 'Greater depth',
      },
    ],
    defaultReasoningLevel: 'high',
    supportsFastMode: true,
    attachments: [
      {
        kind: 'file',
        label: 'File',
        enabled: true,
        invocationFlag: '--file',
      },
    ],
  }
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => runtimeCapabilities,
  })

  await expect(service.readAccountCapabilities(CODEX_LEASE)).resolves.toEqual(
    expectedCapabilities,
  )
})

test('rejects non-string and non-null default reasoning levels', async () => {
  for (const defaultReasoningLevel of [undefined, false, 1, {}, []]) {
    const service = createAgentSuggestionRuntimeService({
      hasRuntime: () => true,
      invokeRuntime: async () => ({
        ...CODEX_LEASE,
        supportsModelSelection: false,
        currentModel: null,
        availableModels: [],
        reasoningLevels: [],
        defaultReasoningLevel,
        supportsFastMode: false,
        attachments: [],
      }),
    })

    await expect(service.readAccountCapabilities(CODEX_LEASE)).rejects.toThrow(
      'Provider capability defaultReasoningLevel must be a string or null.',
    )
  }
})

test('uses the exact account diagnostic command path and full lease', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const accountDiagnostics = {
    ...CODEX_LEASE,
    setupState: 'ready',
    connectionPath: 'Codex CLI',
    summary: 'Ready',
    guidance: '',
    baseUrl: null,
    model: null,
    requirements: [],
  } satisfies RuntimeAgentAccountProviderDiagnostics
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })
      return accountDiagnostics
    },
  })

  await expect(service.readAccountDiagnostics(CODEX_LEASE)).resolves.toEqual(
    accountDiagnostics,
  )
  expect(invoked).toEqual([
    {
      command: 'read_agent_account_diagnostics',
      args: { request: CODEX_LEASE },
    },
  ])
})

test('uses the exact account suggestion path and keeps card ownership', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const accountSuggestion = {
    ...runtimeSuggestion,
    id: 'account-codex-1',
  } satisfies RuntimeAgentAccountSuggestionResponse
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })
      return [accountSuggestion]
    },
  })
  const sharedInput = {
    provider: 'codex' as const,
    agentSessionId: 'agent-session-1',
    project: { name: 'gtum', path: '/workspace/gtum' },
    activeTab: null,
    userTask: 'run tests',
  }

  const accountCards = await service.requestAccountSuggestions({
    ...sharedInput,
    ...CODEX_LEASE,
  })

  expect(accountCards[0]).toMatchObject({
    provider: 'codex',
    accountId: CODEX_ACCOUNT_ID,
  })
  expect(invoked).toEqual([
    {
      command: 'request_agent_account_suggestions',
      args: {
        request: {
          provider: 'codex',
          accountId: CODEX_ACCOUNT_ID,
          incarnation: CODEX_LEASE.incarnation,
          credentialRevision: CODEX_LEASE.credentialRevision,
          agentSessionId: 'agent-session-1',
          model: null,
          reasoningLevel: null,
          fastMode: false,
          attachments: [],
          projectName: 'gtum',
          projectPath: '/workspace/gtum',
          activeTabId: null,
          activeTabTitle: null,
          activeFilePath: null,
          activeFileLine: null,
          activeFileSnippet: null,
          lastNLogLines: [],
          userTask: 'run tests',
        },
      },
    },
  ])
})

test('requires and echoes the exact account lease for capability and paid suggestion IPC', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const lease = {
    provider: 'codex' as const,
    accountId: CODEX_ACCOUNT_ID,
    incarnation: '11',
    credentialRevision: '17',
  }
  const capabilities = {
    ...lease,
    supportsModelSelection: false,
    currentModel: null,
    availableModels: [],
    reasoningLevels: [],
    defaultReasoningLevel: null,
    supportsFastMode: false,
    attachments: [],
  }
  const suggestion = {
    ...runtimeSuggestion,
    ...lease,
  }
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })
      return command === 'read_agent_account_capabilities' ? capabilities : [suggestion]
    },
  })

  await expect(service.readAccountCapabilities(lease)).resolves.toMatchObject(lease)
  await expect(service.requestAccountSuggestions({
    ...lease,
    agentSessionId: 'agent-session-lease',
    project: { name: 'gtum', path: '/workspace/gtum' },
    activeTab: null,
    userTask: 'use only the captured credential',
  })).resolves.toHaveLength(1)

  expect(invoked[0]).toEqual({
    command: 'read_agent_account_capabilities',
    args: { request: lease },
  })
  expect(invoked[1]?.args?.request).toMatchObject(lease)
})

test('rejects missing, malformed, and mismatched account leases before accepting runtime data', async () => {
  let invocationCount = 0
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => {
      invocationCount += 1
      return {
        provider: 'codex',
        accountId: CODEX_ACCOUNT_ID,
        incarnation: '12',
        credentialRevision: '17',
        supportsModelSelection: false,
        currentModel: null,
        availableModels: [],
        reasoningLevels: [],
        defaultReasoningLevel: null,
        supportsFastMode: false,
        attachments: [],
      }
    },
  })

  await expect(service.readAccountCapabilities({
    provider: 'codex',
    accountId: CODEX_ACCOUNT_ID,
  } as never)).rejects.toThrow(/incarnation/i)
  await expect(service.readAccountCapabilities({
    provider: 'codex',
    accountId: CODEX_ACCOUNT_ID,
    incarnation: '01',
    credentialRevision: '17',
  })).rejects.toThrow(/incarnation/i)
  expect(invocationCount).toBe(0)

  await expect(service.readAccountCapabilities({
    provider: 'codex',
    accountId: CODEX_ACCOUNT_ID,
    incarnation: '11',
    credentialRevision: '17',
  })).rejects.toThrow(/revision mismatch|lease mismatch/i)
  expect(invocationCount).toBe(1)
})

test('legacy provider-only suggestion APIs fail closed before invoking runtime children', async () => {
  let invocationCount = 0
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => {
      invocationCount += 1
      return []
    },
  })

  await expect(service.readProviderDiagnostics('codex')).rejects.toThrow(/account/i)
  await expect(service.readProviderCapabilities('codex')).rejects.toThrow(/account/i)
  await expect(service.requestSuggestions({
    provider: 'codex',
    agentSessionId: 'legacy-session',
    project: { name: 'gtum', path: '/workspace/gtum' },
    activeTab: null,
    userTask: 'must not infer ambient',
  })).rejects.toThrow(/account/i)
  expect(invocationCount).toBe(0)
})

test('never defaults a missing account owner on v2 suggestion APIs', async () => {
  let invocationCount = 0
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => {
      invocationCount += 1
      return []
    },
  })

  await expect(
    service.readAccountCapabilities({ provider: 'codex' } as never),
  ).rejects.toThrow(/account/i)
  await expect(
    service.readAccountDiagnostics({ provider: 'codex' } as never),
  ).rejects.toThrow(/account/i)
  await expect(
    service.requestAccountSuggestions({
      provider: 'codex',
      agentSessionId: 'agent-session-1',
      project: { name: 'gtum', path: '/workspace/gtum' },
      activeTab: null,
      userTask: 'run tests',
    } as never),
  ).rejects.toThrow(/account/i)
  expect(invocationCount).toBe(0)
})

test('rejects a valid and wrong-provider mixed account batch before publishing cards', async () => {
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => [
      runtimeSuggestion,
      {
        ...runtimeSuggestion,
        ...CLAUDE_LEASE,
        id: 'claude-wrong-owner',
      },
    ],
  })

  await expect(
    service.requestAccountSuggestions({
      ...CODEX_LEASE,
      agentSessionId: 'agent-session-1',
      project: { name: 'gtum', path: '/workspace/gtum' },
      activeTab: null,
      userTask: 'run tests',
    }),
  ).rejects.toThrow(/provider mismatch.*codex.*claude/i)
})

test('requests Codex suggestions with the documented agent envelope', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })

      return [runtimeSuggestion]
    },
  })

  const suggestions = await service.requestAccountSuggestions({
    ...CODEX_LEASE,
    agentSessionId: 'agent-session-1',
    project: {
      name: 'gtum',
      path: '/workspace/gtum',
    },
    activeTab: {
      id: 't-tests',
      projectPath: '/workspace/gtum',
      title: 'tests',
      runtimeBacked: true,
      terminalSessionId: 42,
      lines: [
        { kind: 'cmd', text: 'pnpm test' },
        { kind: 'log', text: 'expected 50 but got 60' },
      ],
    },
    userTask: 'rerun the failing tests',
  })

  expect(invoked).toEqual([
    {
      command: 'request_agent_account_suggestions',
      args: {
        request: {
          provider: 'codex',
          accountId: CODEX_ACCOUNT_ID,
          incarnation: CODEX_LEASE.incarnation,
          credentialRevision: CODEX_LEASE.credentialRevision,
          agentSessionId: 'agent-session-1',
          model: null,
          reasoningLevel: null,
          fastMode: false,
          attachments: [],
          projectName: 'gtum',
          projectPath: '/workspace/gtum',
          activeTabId: 't-tests',
          activeTabTitle: 'tests',
          activeFilePath: null,
          activeFileLine: null,
          activeFileSnippet: null,
          lastNLogLines: ['pnpm test', 'expected 50 but got 60'],
          userTask: 'rerun the failing tests',
        },
      },
    },
  ])
  expect(invoked[0]?.args?.request).not.toHaveProperty('executionMode')
  expect(suggestions).toEqual([
    {
      id: 'codex-1',
      provider: 'codex',
      accountId: CODEX_ACCOUNT_ID,
      title: 'Run the focused test suite',
      commands: [
        {
          cmd: 'pnpm test:funnel --reporter=verbose',
          risk: 'low',
          target: 't-tests',
        },
      ],
      note: 'Codex confidence: high',
      error: null,
    },
  ])
})

test('reads account capabilities and forwards the selected model with its exact lease', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })

      if (command === 'read_agent_account_capabilities') {
        return {
          ...CODEX_LEASE,
          supportsModelSelection: true,
          currentModel: {
            providerId: 'codex',
            modelId: 'gpt-5.5',
            label: 'GPT-5.5',
          },
          availableModels: [
            {
              providerId: 'codex',
              modelId: 'gpt-5.5',
              label: 'GPT-5.5',
            },
            {
              providerId: 'codex',
              modelId: 'gpt-5-codex',
              label: 'GPT-5 Codex',
            },
          ],
          reasoningLevels: [
            {
              level: 'low',
              label: 'Low',
              description: 'Fast responses with lighter reasoning',
            },
            {
              level: 'medium',
              label: 'Medium',
              description: 'Balances speed and reasoning depth',
            },
            {
              level: 'high',
              label: 'High',
              description: 'Greater reasoning depth',
            },
            {
              level: 'xhigh',
              label: 'XHigh',
              description: 'Extra high reasoning depth',
            },
          ],
          defaultReasoningLevel: 'xhigh',
          supportsFastMode: true,
          attachments: [
            {
              kind: 'image',
              label: 'Image',
              enabled: true,
              invocationFlag: '--image',
            },
          ],
        }
      }

      return [runtimeSuggestion]
    },
  })

  const capabilities = await service.readAccountCapabilities(CODEX_LEASE)
  await service.requestAccountSuggestions({
    ...CODEX_LEASE,
    agentSessionId: 'agent-session-1',
    project: {
      name: 'gtum',
      path: '/workspace/gtum',
    },
    activeTab: null,
    userTask: 'use the selected model',
    model: 'gpt-5-codex',
    reasoningLevel: 'medium',
    fastMode: true,
    attachments: [
      {
        kind: 'image',
        path: '/tmp/screenshot.png',
        label: 'screenshot.png',
      },
    ],
  })

  expect(capabilities.availableModels.map((model) => model.modelId)).toEqual([
    'gpt-5.5',
    'gpt-5-codex',
  ])
  expect(capabilities.reasoningLevels.map((level) => level.level)).toEqual([
    'low',
    'medium',
    'high',
    'xhigh',
  ])
  expect(capabilities.defaultReasoningLevel).toBe('xhigh')
  expect(capabilities.supportsFastMode).toBe(true)
  expect(invoked).toEqual([
    {
      command: 'read_agent_account_capabilities',
      args: { request: CODEX_LEASE },
    },
    {
      command: 'request_agent_account_suggestions',
      args: {
        request: {
          provider: 'codex',
          accountId: CODEX_ACCOUNT_ID,
          incarnation: CODEX_LEASE.incarnation,
          credentialRevision: CODEX_LEASE.credentialRevision,
          agentSessionId: 'agent-session-1',
          model: 'gpt-5-codex',
          reasoningLevel: 'medium',
          fastMode: true,
          attachments: [
            {
              kind: 'image',
              path: '/tmp/screenshot.png',
              label: 'screenshot.png',
            },
          ],
          projectName: 'gtum',
          projectPath: '/workspace/gtum',
          activeTabId: null,
          activeTabTitle: null,
          activeFilePath: null,
          activeFileLine: null,
          activeFileSnippet: null,
          lastNLogLines: [],
          userTask: 'use the selected model',
        },
      },
    },
  ])
})

test('attaches selected editor context instead of terminal logs', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })

      return [{ ...runtimeSuggestion, preferredTarget: 'new_tab' }]
    },
  })

  const suggestions = await service.requestAccountSuggestions({
    ...CODEX_LEASE,
    agentSessionId: 'agent-session-1',
    project: {
      name: 'gtum',
      path: '/workspace/gtum',
    },
    activeTab: {
      id: 'ed-runtime-agent',
      projectPath: '/workspace/gtum',
      type: 'editor',
      title: 'runtimeAgentSuggestions.ts',
      path: 'src/shared/api/runtimeAgentSuggestions.ts',
      displayPath: 'src/shared/api/runtimeAgentSuggestions.ts',
      content: 'export const service = true',
      lines: [],
    },
    userTask: 'wire suggestions',
  })

  expect(invoked[0]).toMatchObject({
    command: 'request_agent_account_suggestions',
    args: {
      request: {
        activeFilePath: 'src/shared/api/runtimeAgentSuggestions.ts',
        activeFileSnippet: 'export const service = true',
        lastNLogLines: [],
      },
    },
  })
  expect(suggestions[0].commands[0].target).toBe('new')
})

test('routes current-tab suggestions to a new tab when the active tab is not runtime-backed', async () => {
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => [runtimeSuggestion],
  })

  const suggestions = await service.requestAccountSuggestions({
    ...CODEX_LEASE,
    agentSessionId: 'agent-session-1',
    project: {
      name: 'gtum',
      path: '/workspace/gtum',
    },
    activeTab: {
      id: 't-mock-tests',
      title: 'tests',
      runtimeBacked: false,
      terminalSessionId: null,
      lines: [{ kind: 'cmd', text: 'pnpm test' }],
    },
    userTask: 'rerun tests',
  })

  expect(suggestions[0].commands[0].target).toBe('new')
})

test('rejects an exact active-tab project owner mismatch before provider invocation', async () => {
  let invocationCount = 0
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => {
      invocationCount += 1
      return [runtimeSuggestion]
    },
  })

  await expect(
    service.requestAccountSuggestions({
      ...CODEX_LEASE,
      agentSessionId: 'agent-session-1',
      project: {
        name: 'project-a',
        path: '/workspace/project-a',
      },
      activeTab: {
        id: 'ed-b',
        type: 'editor',
        projectPath: '/workspace/project-a/',
        path: 'src/app.ts',
        content: 'export const owner = "b"',
      },
      userTask: 'review this file',
    }),
  ).rejects.toThrow(/active tab project owner mismatch/i)

  expect(invocationCount).toBe(0)
})

test('rejects a blank agent session owner before provider invocation', async () => {
  let invocationCount = 0
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => {
      invocationCount += 1
      return [runtimeSuggestion]
    },
  })

  await expect(
    service.requestAccountSuggestions({
      ...CODEX_LEASE,
      agentSessionId: '   ',
      project: {
        name: 'gtum',
        path: '/workspace/gtum',
      },
      activeTab: null,
      userTask: 'review the project',
    }),
  ).rejects.toThrow(/agent session owner is missing/i)

  expect(invocationCount).toBe(0)
})

test('rejects a returned provider mismatch before rendering a suggestion', async () => {
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => [
      {
        ...runtimeSuggestion,
        provider: 'codex',
        summary: '',
        command: '',
      },
    ],
  })

  await expect(
    service.requestAccountSuggestions({
      ...CLAUDE_LEASE,
      agentSessionId: 'claude-session-1',
      project: {
        name: 'gtum',
        path: '/workspace/gtum',
      },
      activeTab: null,
      userTask: 'review the project',
    }),
  ).rejects.toThrow(/provider mismatch.*claude.*codex/i)
})

test('rejects one mixed account suggestion before publishing any cards', async () => {
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => [
      runtimeSuggestion,
      {
        ...runtimeSuggestion,
        id: 'codex-wrong-account',
        accountId: 'codex-profile-1',
      },
    ],
  })

  await expect(
    service.requestAccountSuggestions({
      ...CODEX_LEASE,
      agentSessionId: 'agent-session-1',
      project: { name: 'gtum', path: '/workspace/gtum' },
      activeTab: null,
      userTask: 'review the project',
    }),
  ).rejects.toThrow(/suggestion account mismatch.*codex-default.*codex-profile-1/i)
})

test('rejects malformed account owners before provider invocation', async () => {
  let invocationCount = 0
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => {
      invocationCount += 1
      return [runtimeSuggestion]
    },
  })

  await expect(
    service.readAccountCapabilities({
      ...CODEX_LEASE,
      accountId: 'claude-default',
    }),
  ).rejects.toThrow(/account.*provider|provider.*account/i)
  await expect(
    service.requestAccountSuggestions({
      ...CODEX_LEASE,
      accountId: 'codex-profile-01',
      agentSessionId: 'agent-session-1',
      project: { name: 'gtum', path: '/workspace/gtum' },
      activeTab: null,
      userTask: 'review the project',
    }),
  ).rejects.toThrow(/account/i)
  expect(invocationCount).toBe(0)
})

test('rejects missing owners for runtime-backed terminal and editor context before invocation', async () => {
  let invocationCount = 0
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => {
      invocationCount += 1
      return [runtimeSuggestion]
    },
  })
  const project = { name: 'gtum', path: '/workspace/gtum' }

  await expect(
    service.requestAccountSuggestions({
      ...CODEX_LEASE,
      agentSessionId: 'agent-session-1',
      project,
      activeTab: {
        id: 't-runtime',
        type: 'terminal',
        runtimeBacked: true,
        terminalSessionId: 42,
      },
      userTask: 'inspect terminal output',
    }),
  ).rejects.toThrow(/active tab project owner is missing/i)

  await expect(
    service.requestAccountSuggestions({
      ...CODEX_LEASE,
      agentSessionId: 'agent-session-1',
      project,
      activeTab: {
        id: 'ed-runtime',
        type: 'editor',
        path: 'src/app.ts',
      },
      userTask: 'review editor context',
    }),
  ).rejects.toThrow(/active tab project owner is missing/i)

  expect(invocationCount).toBe(0)
})

test('surfaces Codex CLI invocation failures', async () => {
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => {
      throw new Error('Codex CLI exited with status 1.')
    },
  })

  await expect(
    service.requestAccountSuggestions({
      ...CODEX_LEASE,
      agentSessionId: 'agent-session-1',
      project: {
        name: 'gtum',
        path: '/workspace/gtum',
      },
      activeTab: null,
      userTask: 'suggest a next command',
    }),
  ).rejects.toThrow('Codex CLI exited with status 1.')
})

test('normalizes Codex error-only responses without approval commands', async () => {
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => [
      {
        ...runtimeSuggestion,
        summary: 'No safe command',
        command: '   ',
        confidence: 'medium',
        error: 'No safe read-only command is available.',
      },
    ],
  })

  const suggestions = await service.requestAccountSuggestions({
    ...CODEX_LEASE,
    agentSessionId: 'agent-session-1',
    project: {
      name: 'gtum',
      path: '/workspace/gtum',
    },
    activeTab: null,
    userTask: 'delete the project',
  })

  expect(suggestions).toEqual([
    {
      id: 'codex-1',
      provider: 'codex',
      accountId: CODEX_ACCOUNT_ID,
      title: 'No safe command',
      commands: [],
      note: 'No safe read-only command is available.',
      error: 'No safe read-only command is available.',
    },
  ])
})

test('normalizes Codex reply-only responses without approval commands', async () => {
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => [
      {
        ...runtimeSuggestion,
        summary: 'I reviewed the current state and no command is needed.',
        command: '',
        confidence: 'high',
        error: null,
      },
    ],
  })

  const suggestions = await service.requestAccountSuggestions({
    ...CODEX_LEASE,
    agentSessionId: 'agent-session-1',
    project: {
      name: 'gtum',
      path: '/workspace/gtum',
    },
    activeTab: null,
    userTask: 'explain the current state',
  })

  expect(suggestions).toEqual([
    {
      id: 'codex-1',
      provider: 'codex',
      accountId: CODEX_ACCOUNT_ID,
      title: 'I reviewed the current state and no command is needed.',
      commands: [],
      note: '',
      error: null,
    },
  ])
})

test('derives fallback card metadata from the Claude provider', async () => {
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => [
      {
        ...runtimeSuggestion,
        ...CLAUDE_LEASE,
        id: '   ',
        summary: '',
        confidence: 'medium',
      },
    ],
  })

  const suggestions = await service.requestAccountSuggestions({
    ...CLAUDE_LEASE,
    agentSessionId: 'claude-session-1',
    project: {
      name: 'gtum',
      path: '/workspace/gtum',
    },
    activeTab: null,
    userTask: 'suggest a focused test command',
  })

  expect(suggestions).toHaveLength(1)
  expect(suggestions[0]).toMatchObject({
    provider: 'claude',
    accountId: CLAUDE_ACCOUNT_ID,
    title: 'Claude response',
    note: 'Claude confidence: medium',
    error: null,
  })
  expect(suggestions[0].id).toMatch(/^claude-\d+$/)
})

test('uses the actual provider label in empty-response errors', async () => {
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => [
      {
        ...runtimeSuggestion,
        ...CLAUDE_LEASE,
        summary: ' ',
        command: '',
        error: null,
      },
    ],
  })

  await expect(
    service.requestAccountSuggestions({
      ...CLAUDE_LEASE,
      agentSessionId: 'claude-session-1',
      project: {
        name: 'gtum',
        path: '/workspace/gtum',
      },
      activeTab: null,
      userTask: 'suggest a next command',
    }),
  ).rejects.toThrow('Claude CLI returned an empty response without a command or error reason.')
})

test('rejects empty Codex responses without an error reason', async () => {
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => [
      {
        ...runtimeSuggestion,
        summary: ' ',
        command: '',
        error: null,
      },
    ],
  })

  await expect(
    service.requestAccountSuggestions({
      ...CODEX_LEASE,
      agentSessionId: 'agent-session-1',
      project: {
        name: 'gtum',
        path: '/workspace/gtum',
      },
      activeTab: null,
      userTask: 'suggest a next command',
    }),
  ).rejects.toThrow('Codex CLI returned an empty response without a command or error reason.')
})

test('reads exact account diagnostics through the runtime command', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })

      return {
        ...CODEX_LEASE,
        setupState: 'ready',
        connectionPath: 'Codex CLI ChatGPT session',
        summary: 'Codex is ready',
        guidance: 'Connect Codex before requesting suggestions.',
        baseUrl: null,
        model: 'Codex CLI default',
        requirements: [],
      }
    },
  })

  const diagnostics = await service.readAccountDiagnostics(CODEX_LEASE)

  expect(invoked).toEqual([
    {
      command: 'read_agent_account_diagnostics',
      args: { request: CODEX_LEASE },
    },
  ])
  expect(diagnostics.setupState).toBe('ready')
  expect(diagnostics).toMatchObject({
    provider: 'codex',
    accountId: CODEX_ACCOUNT_ID,
  })
})

test('rejects a diagnostic account owner mismatch', async () => {
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => ({
      ...CODEX_LEASE,
      accountId: 'codex-profile-1',
      setupState: 'ready',
      connectionPath: 'Codex CLI',
      summary: 'Ready',
      guidance: '',
      baseUrl: null,
      model: null,
      requirements: [],
    }),
  })

  await expect(
    service.readAccountDiagnostics(CODEX_LEASE),
  ).rejects.toThrow(/diagnostic owner mismatch.*codex-default.*codex-profile-1/i)
})

test('keeps browser preview inert without fabricating exact account suggestions', async () => {
  let invocationCount = 0
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => false,
    invokeRuntime: async () => {
      invocationCount += 1
      return [runtimeSuggestion]
    },
  })

  await expect(
    service.requestAccountSuggestions({
      ...CLAUDE_LEASE,
      agentSessionId: 'claude-session-1',
      project: {
        name: 'gtum',
        path: '/workspace/gtum',
      },
      activeTab: null,
      userTask: 'suggest a next command',
    }),
  ).resolves.toEqual([])
  await expect(
    service.readAccountDiagnostics(CLAUDE_LEASE),
  ).resolves.toEqual({
    ...CLAUDE_LEASE,
    setupState: 'deferred',
    connectionPath: 'Browser preview',
    summary: 'Desktop runtime is not connected.',
    guidance: 'Open gtum through the Tauri desktop runtime to request real provider diagnostics.',
    baseUrl: null,
    model: null,
    requirements: [],
  })
  await expect(
    service.readAccountCapabilities(CLAUDE_LEASE),
  ).resolves.toEqual({
    ...CLAUDE_LEASE,
    supportsModelSelection: false,
    currentModel: null,
    availableModels: [],
    reasoningLevels: [],
    defaultReasoningLevel: null,
    supportsFastMode: false,
    attachments: [],
  })
  await expect(
    service.requestAccountSuggestions({
      ...CLAUDE_LEASE,
      agentSessionId: 'claude-session-1',
      project: { name: 'gtum', path: '/workspace/gtum' },
      activeTab: null,
      userTask: 'suggest a next command',
    }),
  ).resolves.toEqual([])
  expect(invocationCount).toBe(0)
})
