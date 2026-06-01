import { expect, test } from '@playwright/test'

import {
  createTerminalRuntimeService,
  type RuntimeTerminalLogs,
  type RuntimeTerminalSnapshot,
} from '../../src/shared/api/runtimeTerminals'

const runningSnapshot: RuntimeTerminalSnapshot = {
  sessionId: 42,
  name: 'project',
  cwd: '/workspace/project',
  shell: '/bin/zsh',
  shellArgs: ['-i'],
  processId: 1234,
  status: 'running',
  createdAt: 100,
  updatedAt: 120,
  exitCode: null,
  logLineCount: 2,
  maxLogEntries: 400,
  lastEvent: 'session created',
}

const recentLogs: RuntimeTerminalLogs = {
  sessionId: 42,
  status: 'running',
  limit: 100,
  logLineCount: 2,
  truncated: false,
  entries: ['ready', '$ echo ok'],
  updatedAt: 130,
}

test('creates a runtime-backed terminal tab through Tauri PTY commands', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const service = createTerminalRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })

      return runningSnapshot
    },
  })

  const tab = await service.createTerminalTab({
    projectPath: '/workspace/project',
    title: 'project',
  })

  expect(invoked).toEqual([
    {
      command: 'create_terminal_session',
      args: {
        request: {
          name: 'project',
          cwd: '/workspace/project',
        },
      },
    },
  ])
  expect(tab).toMatchObject({
    title: 'project',
    cwd: '.',
    shell: 'zsh',
    status: 'running',
    terminalSessionId: 42,
    runtimeBacked: true,
  })
})

test('executes commands and converts recent PTY logs into terminal lines', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const service = createTerminalRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })

      if (command === 'read_terminal_session_logs') return recentLogs

      return runningSnapshot
    },
  })

  const snapshot = await service.executeCommand(42, 'echo ok')
  const logs = await service.readLogs(42)

  expect(invoked).toEqual([
    {
      command: 'execute_terminal_session_command',
      args: { sessionId: 42, command: 'echo ok' },
    },
    {
      command: 'read_terminal_session_logs',
      args: { sessionId: 42, limit: 100 },
    },
  ])
  expect(snapshot.lastEvent).toBe('session created')
  expect(logs.lines).toEqual([
    { kind: 'log', text: 'ready' },
    { kind: 'log', text: '$ echo ok' },
  ])
})

test('keeps browser preview terminal tabs local when desktop runtime is unavailable', async () => {
  let invokedRuntime = false
  const service = createTerminalRuntimeService({
    hasRuntime: () => false,
    invokeRuntime: async () => {
      invokedRuntime = true
      throw new Error('runtime should not be invoked in browser fallback')
    },
  })

  const tab = await service.createTerminalTab({
    projectPath: '/workspace/project',
    title: 'preview',
  })
  const snapshot = await service.executeCommand(null, 'echo skipped')

  expect(invokedRuntime).toBe(false)
  expect(tab.runtimeBacked).toBe(false)
  expect(tab.terminalSessionId).toBeNull()
  expect(tab.lines.at(-1)?.text).toContain('desktop runtime is not connected')
  expect(snapshot.status).toBe('failed')
})
