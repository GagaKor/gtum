import { expect, test } from '@playwright/test'

import {
  createTerminalRuntimeService,
  type RawTerminalOutput,
  type RuntimeTerminalLogs,
  type RuntimeTerminalSnapshot,
  type TerminalSessionOwner,
} from '../../src/shared/api/runtimeTerminals'

const PROJECT_A = '/workspace/project-a'
const PROJECT_B = '/workspace/project-b'
const OWNER_A: TerminalSessionOwner = {
  projectPath: PROJECT_A,
  terminalSessionId: 42,
}

const runningSnapshot: RuntimeTerminalSnapshot = {
  projectPath: PROJECT_A,
  sessionId: 42,
  name: 'project-a',
  cwd: '/workspace/project-a/packages/app',
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
  projectPath: PROJECT_A,
  sessionId: 42,
  status: 'running',
  limit: 100,
  logLineCount: 2,
  truncated: false,
  entries: ['ready', '$ echo ok'],
  updatedAt: 130,
}

const rawOutput: RawTerminalOutput = {
  projectPath: PROJECT_A,
  sessionId: 42,
  base: 0,
  cursor: 12,
  chunk: 'hello world\n',
  status: 'running',
}

test('sends immutable project ownership in every terminal runtime envelope', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const service = createTerminalRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })

      if (command === 'list_terminal_sessions') return [runningSnapshot]
      if (command === 'read_terminal_session_logs') return recentLogs
      if (command === 'read_raw_terminal_output') return rawOutput
      if (command === 'write_terminal_input' || command === 'resize_terminal_session') {
        return undefined
      }

      return runningSnapshot
    },
  })

  await service.createTerminalTab({
    projectPath: PROJECT_A,
    title: 'project-a',
    cwd: 'packages/app',
  })
  await service.createTerminalTabWithCommand({
    projectPath: PROJECT_A,
    title: 'command',
    command: 'npm test',
  })
  await service.listSessions(PROJECT_A)
  await service.renameSession(OWNER_A, 'renamed')
  await service.closeSession(OWNER_A)
  await service.readLogs(OWNER_A)
  await service.executeCommand(OWNER_A, 'echo ok')
  await service.writeInput(OWNER_A, 'ls\r')
  await service.readRawOutput(OWNER_A, 7)
  await service.resizeSession(OWNER_A, 31.8, 119.9)

  expect(invoked).toEqual([
    {
      command: 'create_terminal_session',
      args: {
        request: {
          projectPath: PROJECT_A,
          name: 'project-a',
          cwd: '/workspace/project-a/packages/app',
        },
      },
    },
    {
      command: 'create_terminal_session_with_command',
      args: {
        request: {
          session: {
            projectPath: PROJECT_A,
            name: 'command',
            cwd: PROJECT_A,
          },
          command: 'npm test',
        },
      },
    },
    {
      command: 'list_terminal_sessions',
      args: { projectPath: PROJECT_A },
    },
    {
      command: 'rename_terminal_session',
      args: { projectPath: PROJECT_A, sessionId: 42, name: 'renamed' },
    },
    {
      command: 'close_terminal_session',
      args: { projectPath: PROJECT_A, sessionId: 42 },
    },
    {
      command: 'read_terminal_session_logs',
      args: { projectPath: PROJECT_A, sessionId: 42, limit: 100 },
    },
    {
      command: 'execute_terminal_session_command',
      args: { projectPath: PROJECT_A, sessionId: 42, command: 'echo ok' },
    },
    {
      command: 'write_terminal_input',
      args: { projectPath: PROJECT_A, sessionId: 42, data: 'ls\r' },
    },
    {
      command: 'read_raw_terminal_output',
      args: { projectPath: PROJECT_A, sessionId: 42, from: 7 },
    },
    {
      command: 'resize_terminal_session',
      args: { projectPath: PROJECT_A, sessionId: 42, rows: 31, cols: 119 },
    },
  ])
})

test('returns the validated backend owner on terminal tabs, logs, and raw output', async () => {
  const service = createTerminalRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command) => {
      if (command === 'read_terminal_session_logs') return recentLogs
      if (command === 'read_raw_terminal_output') return rawOutput
      return runningSnapshot
    },
  })

  const tab = await service.createTerminalTab({
    projectPath: PROJECT_A,
    title: 'project-a',
  })
  const logs = await service.readLogs(OWNER_A)
  const raw = await service.readRawOutput(OWNER_A, 0)

  expect(tab).toMatchObject({
    projectPath: PROJECT_A,
    cwd: 'packages/app',
    terminalSessionId: 42,
    runtimeBacked: true,
  })
  expect(logs.projectPath).toBe(PROJECT_A)
  expect(logs.sessionId).toBe(42)
  expect(logs.lines).toEqual([
    { kind: 'log', text: 'ready' },
    { kind: 'cmd', text: 'echo ok' },
  ])
  expect(raw.projectPath).toBe(PROJECT_A)
  expect(raw.sessionId).toBe(42)
  expect(raw.chunk).toBe('hello world\n')
  expect(raw.cursor).toBe(12)
})

test('rejects project and session response mismatches instead of attaching foreign data', async () => {
  const foreignProjectService = createTerminalRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => ({ ...runningSnapshot, projectPath: PROJECT_B }),
  })
  const foreignSessionService = createTerminalRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => ({ ...runningSnapshot, sessionId: 99 }),
  })

  await expect(foreignProjectService.executeCommand(OWNER_A, 'pwd')).rejects.toThrow(
    /terminal session owner mismatch/i,
  )
  await expect(foreignSessionService.renameSession(OWNER_A, 'wrong')).rejects.toThrow(
    /terminal session owner mismatch/i,
  )
})

test('rejects mismatched create, log, raw, and foreign list responses', async () => {
  const createService = createTerminalRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => ({ ...runningSnapshot, projectPath: PROJECT_B }),
  })
  await expect(
    createService.createTerminalTab({ projectPath: PROJECT_A }),
  ).rejects.toThrow(/terminal session owner mismatch/i)

  const logsService = createTerminalRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => ({ ...recentLogs, sessionId: 99 }),
  })
  await expect(logsService.readLogs(OWNER_A)).rejects.toThrow(
    /terminal session owner mismatch/i,
  )

  const rawService = createTerminalRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => ({ ...rawOutput, projectPath: PROJECT_B }),
  })
  await expect(rawService.readRawOutput(OWNER_A, 0)).rejects.toThrow(
    /terminal session owner mismatch/i,
  )

  const listService = createTerminalRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => [
      runningSnapshot,
      { ...runningSnapshot, sessionId: 84, projectPath: PROJECT_B },
    ],
  })
  await expect(listService.listSessions(PROJECT_A)).rejects.toThrow(
    /terminal session owner mismatch/i,
  )
})

test('validates nonblank projects and safe session IDs before runtime invocation', async () => {
  let invocationCount = 0
  const service = createTerminalRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => {
      invocationCount += 1
      return runningSnapshot
    },
  })

  await expect(service.listSessions('   ')).rejects.toThrow(/projectPath/i)
  await expect(
    service.executeCommand({ projectPath: PROJECT_A, terminalSessionId: 0 }, 'pwd'),
  ).rejects.toThrow(/terminalSessionId/i)
  await expect(
    service.executeCommand(
      { projectPath: PROJECT_A, terminalSessionId: Number.MAX_SAFE_INTEGER + 1 },
      'pwd',
    ),
  ).rejects.toThrow(/terminalSessionId/i)
  expect(invocationCount).toBe(0)
})

test('keeps browser and null-owner no-op behavior deliberate without invoking runtime', async () => {
  let invocationCount = 0
  const browserService = createTerminalRuntimeService({
    hasRuntime: () => false,
    invokeRuntime: async () => {
      invocationCount += 1
      throw new Error('runtime should not be invoked in browser fallback')
    },
  })

  const tab = await browserService.createTerminalTab({
    projectPath: PROJECT_A,
    title: 'preview',
  })
  const browserRaw = await browserService.readRawOutput(OWNER_A, 7)

  const runtimeService = createTerminalRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => {
      invocationCount += 1
      throw new Error('null owners must not invoke runtime')
    },
  })
  await runtimeService.writeInput(null, 'ls\r')
  const raw = await runtimeService.readRawOutput(null, 9)
  const logs = await runtimeService.readLogs(null)
  await runtimeService.resizeSession(null, 24, 80)
  const snapshot = await runtimeService.executeCommand(null, 'echo skipped')
  const closed = await runtimeService.closeSession(null)

  expect(invocationCount).toBe(0)
  expect(tab).toMatchObject({
    projectPath: PROJECT_A,
    runtimeBacked: false,
    terminalSessionId: null,
  })
  expect(tab.lines.at(-1)?.text).toContain('desktop runtime is not connected')
  expect(browserRaw).toMatchObject({ projectPath: PROJECT_A, cursor: 7 })
  expect(raw).toMatchObject({ projectPath: null, cursor: 9, status: 'unavailable' })
  expect(logs).toMatchObject({ projectPath: null, sessionId: null })
  expect(snapshot).toMatchObject({ projectPath: null, status: 'failed' })
  expect(closed).toMatchObject({ projectPath: null, status: 'terminated' })
})
