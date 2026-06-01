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
    executionMode: 'balanced',
  })

  expect(invoked).toEqual([
    {
      command: 'request_agent_suggestions',
      args: {
        request: {
          provider: 'codex',
          projectName: 'gtum',
          projectPath: '/workspace/gtum',
          activeTabId: 't-tests',
          activeTabTitle: 'tests',
          activeFilePath: null,
          activeFileLine: null,
          activeFileSnippet: null,
          lastNLogLines: ['pnpm test', 'expected 50 but got 60'],
          userTask: 'rerun the failing tests',
          executionMode: 'balanced',
        },
      },
    },
  ])
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
    executionMode: 'deep',
  })

  expect(invoked[0]).toMatchObject({
    command: 'request_agent_suggestions',
    args: {
      request: {
        activeFilePath: 'src/shared/api/runtimeAgentSuggestions.ts',
        activeFileSnippet: 'export const service = true',
        lastNLogLines: [],
        executionMode: 'deep',
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
    executionMode: 'balanced',
  })

  expect(suggestions[0].commands[0].target).toBe('new')
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
