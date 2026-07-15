import { expect, test } from '@playwright/test'

import {
  createAgentSuggestionRuntimeService,
  type RuntimeAgentProviderCapabilities,
  type RuntimeAgentSuggestionResponse,
} from '../../src/shared/api/runtimeAgentSuggestions'

const runtimeSuggestion: RuntimeAgentSuggestionResponse = {
  id: 'codex-1',
  provider: 'codex',
  summary: 'Run the focused test suite',
  command: 'pnpm test:funnel --reporter=verbose',
  preferredTarget: 'current_tab',
  confidence: 'high',
  error: null,
}

const validClaudeAccountCapabilities: RuntimeAgentProviderCapabilities = {
  provider: 'claude',
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

const createCapabilityService = (capabilities: RuntimeAgentProviderCapabilities) =>
  createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => capabilities,
  })

const claudeCapabilitiesWithModelExecutionOptions = (
  executionOptions: unknown,
  overrides: Record<string, unknown> = {},
): RuntimeAgentProviderCapabilities => ({
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
} as RuntimeAgentProviderCapabilities)

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
    } as RuntimeAgentProviderCapabilities).readProviderCapabilities('claude')

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
        ).readProviderCapabilities('claude'),
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
        createCapabilityService(claudeCapabilitiesWithModelExecutionOptions({
          reasoningLevels,
          supportsFastMode: false,
        })).readProviderCapabilities('claude'),
      ).rejects.toThrow(/executionOptions\.reasoningLevels/)
    }
  })

  test('rejects blank, oversized, duplicate, unknown, and nonexact reasoning levels', async () => {
    const invalidLevels = [
      [''],
      [' '.repeat(17)],
      ['low', 'low'],
      ['ultra'],
      [' high '],
      ['HIGH'],
    ]

    for (const levels of invalidLevels) {
      await expect(
        createCapabilityService(claudeCapabilitiesWithModelExecutionOptions({
          reasoningLevels: levels.map((level) => ({ level, label: 'Valid label' })),
          supportsFastMode: false,
        })).readProviderCapabilities('claude'),
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
        createCapabilityService(claudeCapabilitiesWithModelExecutionOptions({
          reasoningLevels: [capability],
          supportsFastMode: false,
        })).readProviderCapabilities('claude'),
      ).rejects.toThrow(/executionOptions\.reasoningLevels\[0\]/)
    }
  })

  test('rejects missing and nonboolean Fast support', async () => {
    for (const supportsFastMode of [undefined, null, 0, 1, 'false']) {
      await expect(
        createCapabilityService(claudeCapabilitiesWithModelExecutionOptions({
          reasoningLevels: [],
          ...(supportsFastMode === undefined ? {} : { supportsFastMode }),
        })).readProviderCapabilities('claude'),
      ).rejects.toThrow(/executionOptions\.supportsFastMode/)
    }
  })

  test('rejects provider and model ownership drift before publishing metadata', async () => {
    await expect(createCapabilityService({
      ...claudeCapabilitiesWithModelExecutionOptions({
        reasoningLevels: [],
        supportsFastMode: false,
      }),
      provider: 'codex',
    }).readProviderCapabilities('claude')).rejects.toThrow(
      /Provider capability owner mismatch.*claude.*codex/,
    )

    await expect(createCapabilityService(
      claudeCapabilitiesWithModelExecutionOptions({
        reasoningLevels: [],
        supportsFastMode: false,
      }, { providerId: 'codex' }),
    ).readProviderCapabilities('claude')).rejects.toThrow(
      /Provider capability owner mismatch.*availableModels\[0\].*claude.*codex/,
    )
  })
})

test('accepts Claude account catalog values and normalizes only model identifiers and labels', async () => {
  const capabilities = await createCapabilityService(
    validClaudeAccountCapabilities,
  ).readProviderCapabilities('claude')

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
  }).readProviderCapabilities('claude')

  expect(capabilities.currentModel?.modelId).toBe('configured-current')
})

test('rejects a top-level provider owner mismatch in Claude capabilities', async () => {
  const service = createCapabilityService({
    ...validClaudeAccountCapabilities,
    provider: 'codex',
  })

  await expect(service.readProviderCapabilities('claude')).rejects.toThrow(
    /Provider capability owner mismatch.*claude.*codex/,
  )
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

  await expect(service.readProviderCapabilities('claude')).rejects.toThrow(
    /Provider capability owner mismatch.*currentModel.*claude.*codex/,
  )
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

  await expect(service.readProviderCapabilities('claude')).rejects.toThrow(
    /Provider capability owner mismatch.*availableModels\[5\].*claude.*codex/,
  )
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

  await expect(service.readProviderCapabilities('claude')).rejects.toThrow(
    /availableModels\[0\]\.modelId.*non-empty/,
  )
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

  await expect(service.readProviderCapabilities('claude')).rejects.toThrow(
    /availableModels\[0\]\.label.*non-empty/,
  )
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

  await expect(service.readProviderCapabilities('claude')).rejects.toThrow(
    /duplicate available model ID.*sonnet/i,
  )
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

  const suggestions = await service.requestSuggestions({
    provider: 'codex',
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
      command: 'request_agent_suggestions',
      args: {
        request: {
          provider: 'codex',
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

test('reads provider capabilities and forwards the selected model in suggestion requests', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })

      if (command === 'read_agent_provider_capabilities') {
        return {
          provider: 'codex',
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

  const capabilities = await service.readProviderCapabilities('codex')
  await service.requestSuggestions({
    provider: 'codex',
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
      command: 'read_agent_provider_capabilities',
      args: { provider: 'codex' },
    },
    {
      command: 'request_agent_suggestions',
      args: {
        request: {
          provider: 'codex',
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

  const suggestions = await service.requestSuggestions({
    provider: 'codex',
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
    command: 'request_agent_suggestions',
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

  const suggestions = await service.requestSuggestions({
    provider: 'codex',
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
    service.requestSuggestions({
      provider: 'codex',
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
    service.requestSuggestions({
      provider: 'codex',
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
    service.requestSuggestions({
      provider: 'claude',
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
    service.requestSuggestions({
      provider: 'codex',
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
    service.requestSuggestions({
      provider: 'codex',
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
    service.requestSuggestions({
      provider: 'codex',
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

  const suggestions = await service.requestSuggestions({
    provider: 'codex',
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

  const suggestions = await service.requestSuggestions({
    provider: 'codex',
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
        id: '   ',
        provider: 'claude',
        summary: '',
        confidence: 'medium',
      },
    ],
  })

  const suggestions = await service.requestSuggestions({
    provider: 'claude',
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
        provider: 'claude',
        summary: ' ',
        command: '',
        error: null,
      },
    ],
  })

  await expect(
    service.requestSuggestions({
      provider: 'claude',
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
    service.requestSuggestions({
      provider: 'codex',
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

test('reads provider diagnostics through the runtime command', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })

      return {
        provider: 'codex',
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

  const diagnostics = await service.readProviderDiagnostics('codex')

  expect(invoked).toEqual([
    {
      command: 'read_agent_provider_diagnostics',
      args: { provider: 'codex' },
    },
  ])
  expect(diagnostics.setupState).toBe('ready')
})

test('keeps browser preview inert without fabricating provider suggestions', async () => {
  let invocationCount = 0
  const service = createAgentSuggestionRuntimeService({
    hasRuntime: () => false,
    invokeRuntime: async () => {
      invocationCount += 1
      return [runtimeSuggestion]
    },
  })

  await expect(
    service.requestSuggestions({
      provider: 'claude',
      agentSessionId: 'claude-session-1',
      project: {
        name: 'gtum',
        path: '/workspace/gtum',
      },
      activeTab: null,
      userTask: 'suggest a next command',
    }),
  ).resolves.toEqual([])
  expect(invocationCount).toBe(0)
})
