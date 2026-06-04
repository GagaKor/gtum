import { expect, test } from '@playwright/test'

import {
  createAgentSuggestionRuntimeService,
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
    project: {
      name: 'gtum',
      path: '/workspace/gtum',
    },
    activeTab: {
      id: 't-tests',
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
    project: {
      name: 'gtum',
      path: '/workspace/gtum',
    },
    activeTab: {
      id: 'ed-runtime-agent',
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
