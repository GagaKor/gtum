import { invoke } from '@tauri-apps/api/core'

import {
  basenameOfPath,
  hasTauriRuntime,
  type RuntimeInvoker,
} from './runtimeProjects'

export type RuntimeTerminalStatus = 'running' | 'exited' | 'terminated' | 'failed'

export type RuntimeTerminalSnapshot = {
  projectPath: string | null
  sessionId: number | null
  name: string
  cwd?: string | null
  shell: string
  shellArgs: string[]
  processId?: number | null
  status: RuntimeTerminalStatus
  createdAt: number
  updatedAt: number
  exitCode?: number | null
  logLineCount: number
  maxLogEntries: number
  lastEvent?: string | null
}

export type RuntimeTerminalLogs = {
  projectPath: string
  sessionId: number
  status: RuntimeTerminalStatus
  limit: number
  logLineCount: number
  truncated: boolean
  entries: string[]
  updatedAt: number
}

export type TerminalLine = {
  kind: 'cmd' | 'log'
  text: string
  color?: string
}

export type TerminalTabStatus = 'running' | 'idle' | 'failed' | 'passing'

export type RuntimeTerminalTab = {
  id: string
  type?: 'terminal'
  projectPath: string
  title: string
  shell: string
  cwd: string
  status: TerminalTabStatus
  cmd: string | null
  lines: TerminalLine[]
  terminalSessionId: number | null
  runtimeBacked: boolean
  runtimeStatus: RuntimeTerminalStatus | 'unavailable'
  lastLogLineCount: number
  runtimeUpdatedAt: number
}

export type TerminalLogsView = {
  projectPath: string | null
  sessionId: number | null
  status: TerminalTabStatus
  runtimeStatus: RuntimeTerminalStatus | 'unavailable'
  logLineCount: number
  truncated: boolean
  lines: TerminalLine[]
  updatedAt: number
}

export type RawTerminalOutput = {
  projectPath: string | null
  sessionId: number | null
  base: number
  cursor: number
  chunk: string
  status: RuntimeTerminalStatus | 'unavailable'
}

export type CreateTerminalTabRequest = {
  projectPath: string
  title?: string
  cwd?: string
  shell?: string
  rows?: number
  cols?: number
  maxLogEntries?: number
}

export type CreateTerminalTabWithCommandRequest = CreateTerminalTabRequest & {
  command: string
}

export type TerminalSessionOwner = Readonly<{
  projectPath: string
  terminalSessionId: number
}>

export type TerminalRuntimeServiceOptions = {
  hasRuntime?: () => boolean
  invokeRuntime?: RuntimeInvoker
}

export type TerminalRuntimeService = {
  hasRuntime: () => boolean
  createTerminalTab(request: CreateTerminalTabRequest): Promise<RuntimeTerminalTab>
  createTerminalTabWithCommand(
    request: CreateTerminalTabWithCommandRequest,
  ): Promise<RuntimeTerminalTab>
  listSessions(projectPath: string): Promise<RuntimeTerminalSnapshot[]>
  renameSession(owner: TerminalSessionOwner, name: string): Promise<RuntimeTerminalSnapshot>
  closeSession(owner: TerminalSessionOwner | null): Promise<RuntimeTerminalSnapshot>
  readLogs(owner: TerminalSessionOwner | null, limit?: number): Promise<TerminalLogsView>
  executeCommand(
    owner: TerminalSessionOwner | null,
    command: string,
  ): Promise<RuntimeTerminalSnapshot>
  writeInput(owner: TerminalSessionOwner | null, data: string): Promise<void>
  readRawOutput(owner: TerminalSessionOwner | null, from: number): Promise<RawTerminalOutput>
  resizeSession(
    owner: TerminalSessionOwner | null,
    rows: number,
    cols: number,
  ): Promise<void>
}

type RuntimeTerminalOverride = {
  hasRuntime?: () => boolean
  invokeRuntime?: RuntimeInvoker
}

const DEFAULT_LOG_LIMIT = 100

const terminalOverride = (): RuntimeTerminalOverride | null => {
  if (typeof window === 'undefined') return null

  return (
    (window as Window & { __GTUM_TERMINAL_RUNTIME__?: RuntimeTerminalOverride })
      .__GTUM_TERMINAL_RUNTIME__ ?? null
  )
}

const omitUndefined = (values: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))

const requiredProjectPath = (value: unknown, field = 'projectPath'): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a nonblank string`)
  }

  return value
}

const requiredSessionId = (value: unknown, field = 'terminalSessionId'): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`${field} must be a positive safe integer`)
  }

  return Number(value)
}

const requiredOwner = (owner: TerminalSessionOwner): TerminalSessionOwner => {
  if (!owner || typeof owner !== 'object') {
    throw new Error('terminal session owner is required')
  }

  return {
    projectPath: requiredProjectPath(owner.projectPath),
    terminalSessionId: requiredSessionId(owner.terminalSessionId),
  }
}

const ownerMismatch = (
  expectedProjectPath: string,
  expectedSessionId: number | null,
  actualProjectPath: unknown,
  actualSessionId: unknown,
): Error =>
  new Error(
    `terminal session owner mismatch: expected ${JSON.stringify(expectedProjectPath)}:${expectedSessionId ?? '*'}, received ${JSON.stringify(actualProjectPath)}:${String(actualSessionId)}`,
  )

const validatedRuntimeOwner = (
  value: unknown,
  expectedProjectPath: string,
  expectedSessionId: number | null,
): { projectPath: string; sessionId: number } => {
  if (!value || typeof value !== 'object') {
    throw ownerMismatch(expectedProjectPath, expectedSessionId, undefined, undefined)
  }

  const candidate = value as { projectPath?: unknown; sessionId?: unknown }
  let projectPath: string
  let sessionId: number
  try {
    projectPath = requiredProjectPath(candidate.projectPath, 'response.projectPath')
    sessionId = requiredSessionId(candidate.sessionId, 'response.sessionId')
  } catch {
    throw ownerMismatch(
      expectedProjectPath,
      expectedSessionId,
      candidate.projectPath,
      candidate.sessionId,
    )
  }

  if (
    projectPath !== expectedProjectPath ||
    (expectedSessionId != null && sessionId !== expectedSessionId)
  ) {
    throw ownerMismatch(expectedProjectPath, expectedSessionId, projectPath, sessionId)
  }

  return { projectPath, sessionId }
}

const validatedSnapshot = (
  value: unknown,
  expectedProjectPath: string,
  expectedSessionId: number | null,
): RuntimeTerminalSnapshot => {
  validatedRuntimeOwner(value, expectedProjectPath, expectedSessionId)
  return value as RuntimeTerminalSnapshot
}

const validatedLogs = (
  value: unknown,
  owner: TerminalSessionOwner,
): RuntimeTerminalLogs => {
  validatedRuntimeOwner(value, owner.projectPath, owner.terminalSessionId)
  return value as RuntimeTerminalLogs
}

const validatedRawOutput = (
  value: unknown,
  owner: TerminalSessionOwner,
): RawTerminalOutput => {
  validatedRuntimeOwner(value, owner.projectPath, owner.terminalSessionId)
  return value as RawTerminalOutput
}

const normalizedPath = (value: string | null | undefined): string =>
  String(value || '').replace(/\\/g, '/').replace(/\/+$/, '')

export const resolveRuntimeCwd = (projectPath: string, cwd?: string): string => {
  const candidate = String(cwd || '.').trim()
  if (!candidate || candidate === '.') return projectPath
  if (candidate.startsWith('/') || /^[A-Za-z]:[\\/]/.test(candidate)) return candidate

  return `${projectPath.replace(/[\\/]+$/, '')}/${candidate.replace(/^[\\/]+/, '')}`
}

export const displayCwdForProject = (
  projectPath: string,
  cwd: string | null | undefined,
): string => {
  const project = normalizedPath(projectPath)
  const current = normalizedPath(cwd)
  if (!current || current === project) return '.'
  if (project && current.startsWith(`${project}/`)) return current.slice(project.length + 1) || '.'

  return cwd || '.'
}

export const terminalStatusFromRuntime = (
  snapshot: Pick<RuntimeTerminalSnapshot, 'status' | 'exitCode'>,
): TerminalTabStatus => {
  if (snapshot.status === 'running') return 'running'
  if (snapshot.status === 'failed') return 'failed'
  if (snapshot.status === 'exited') return snapshot.exitCode === 0 ? 'idle' : 'failed'

  return 'idle'
}

export const terminalLinesFromRuntime = (entries: readonly string[]): TerminalLine[] =>
  entries.map((entry) => {
    if (entry.startsWith('$ ')) return { kind: 'cmd', text: entry.slice(2) }

    return { kind: 'log', text: entry }
  })

export const terminalTabFromRuntime = (
  snapshot: RuntimeTerminalSnapshot,
  request: CreateTerminalTabRequest,
  lines: TerminalLine[] = [],
): RuntimeTerminalTab => {
  const projectPath = requiredProjectPath(snapshot.projectPath, 'snapshot.projectPath')

  return {
    id: `t-runtime-${snapshot.sessionId ?? 'local'}`,
    type: 'terminal',
    projectPath,
    title: request.title || snapshot.name || 'terminal',
    shell: basenameOfPath(snapshot.shell || request.shell || 'shell'),
    cwd: displayCwdForProject(projectPath, snapshot.cwd),
    status: terminalStatusFromRuntime(snapshot),
    cmd: null,
    lines,
    terminalSessionId: snapshot.sessionId,
    runtimeBacked: snapshot.sessionId != null,
    runtimeStatus: snapshot.status,
    lastLogLineCount: snapshot.logLineCount,
    runtimeUpdatedAt: snapshot.updatedAt,
  }
}

const fallbackSnapshot = (
  projectPath: string | null,
  status: RuntimeTerminalStatus = 'failed',
  lastEvent = 'desktop runtime is not connected',
): RuntimeTerminalSnapshot => ({
  projectPath,
  sessionId: null,
  name: 'local preview',
  cwd: null,
  shell: 'preview',
  shellArgs: [],
  processId: null,
  status,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  exitCode: 1,
  logLineCount: 0,
  maxLogEntries: DEFAULT_LOG_LIMIT,
  lastEvent,
})

const fallbackTerminalTab = (request: CreateTerminalTabRequest): RuntimeTerminalTab =>
  terminalTabFromRuntime(fallbackSnapshot(request.projectPath), request, [
    {
      kind: 'log',
      text: 'desktop runtime is not connected; terminal preview is local only.',
      color: 'warn',
    },
  ])

const createSessionPayload = (
  request: CreateTerminalTabRequest,
  projectPath: string,
): Record<string, unknown> =>
  omitUndefined({
    projectPath,
    name: request.title,
    cwd: resolveRuntimeCwd(projectPath, request.cwd),
    shell: request.shell,
    rows: request.rows,
    cols: request.cols,
    maxLogEntries: request.maxLogEntries,
  })

export const createTerminalRuntimeService = (
  options: TerminalRuntimeServiceOptions = {},
): TerminalRuntimeService => {
  const override = terminalOverride()
  const hasRuntime = options.hasRuntime || override?.hasRuntime || hasTauriRuntime
  const invokeRuntime = options.invokeRuntime || override?.invokeRuntime || (invoke as RuntimeInvoker)

  return {
    hasRuntime,
    async createTerminalTab(request) {
      const projectPath = requiredProjectPath(request.projectPath)
      const ownedRequest = { ...request, projectPath }
      if (!hasRuntime()) return fallbackTerminalTab(ownedRequest)

      const response = await invokeRuntime<unknown>('create_terminal_session', {
        request: createSessionPayload(ownedRequest, projectPath),
      })
      const snapshot = validatedSnapshot(response, projectPath, null)

      return terminalTabFromRuntime(snapshot, ownedRequest)
    },
    async createTerminalTabWithCommand(request) {
      const projectPath = requiredProjectPath(request.projectPath)
      const ownedRequest = { ...request, projectPath }
      if (!hasRuntime()) {
        return {
          ...fallbackTerminalTab(ownedRequest),
          cmd: request.command,
        }
      }

      const response = await invokeRuntime<unknown>(
        'create_terminal_session_with_command',
        {
          request: {
            session: createSessionPayload(ownedRequest, projectPath),
            command: request.command,
          },
        },
      )
      const snapshot = validatedSnapshot(response, projectPath, null)

      return {
        ...terminalTabFromRuntime(snapshot, ownedRequest, [
          { kind: 'cmd', text: request.command },
        ]),
        cmd: request.command,
      }
    },
    async listSessions(projectPathValue) {
      const projectPath = requiredProjectPath(projectPathValue)
      if (!hasRuntime()) return []

      const response = await invokeRuntime<unknown>('list_terminal_sessions', { projectPath })
      if (!Array.isArray(response)) {
        throw new Error('terminal session list response must be an array')
      }

      return response.map((snapshot) => validatedSnapshot(snapshot, projectPath, null))
    },
    async renameSession(ownerValue, name) {
      const owner = requiredOwner(ownerValue)
      if (!hasRuntime()) return fallbackSnapshot(owner.projectPath, 'failed')

      const response = await invokeRuntime<unknown>('rename_terminal_session', {
        projectPath: owner.projectPath,
        sessionId: owner.terminalSessionId,
        name,
      })
      return validatedSnapshot(response, owner.projectPath, owner.terminalSessionId)
    },
    async closeSession(ownerValue) {
      if (ownerValue == null) return fallbackSnapshot(null, 'terminated')
      const owner = requiredOwner(ownerValue)
      if (!hasRuntime()) return fallbackSnapshot(owner.projectPath, 'terminated')

      const response = await invokeRuntime<unknown>('close_terminal_session', {
        projectPath: owner.projectPath,
        sessionId: owner.terminalSessionId,
      })
      return validatedSnapshot(response, owner.projectPath, owner.terminalSessionId)
    },
    async readLogs(ownerValue, limit = DEFAULT_LOG_LIMIT) {
      if (ownerValue == null) {
        return {
          projectPath: null,
          sessionId: null,
          status: 'failed',
          runtimeStatus: 'unavailable',
          logLineCount: 0,
          truncated: false,
          lines: [],
          updatedAt: Date.now(),
        }
      }
      const owner = requiredOwner(ownerValue)
      if (!hasRuntime()) {
        return {
          projectPath: owner.projectPath,
          sessionId: owner.terminalSessionId,
          status: 'failed',
          runtimeStatus: 'unavailable',
          logLineCount: 0,
          truncated: false,
          lines: [],
          updatedAt: Date.now(),
        }
      }

      const response = await invokeRuntime<unknown>('read_terminal_session_logs', {
        projectPath: owner.projectPath,
        sessionId: owner.terminalSessionId,
        limit,
      })
      const logs = validatedLogs(response, owner)

      return {
        projectPath: logs.projectPath,
        sessionId: logs.sessionId,
        status: terminalStatusFromRuntime({ status: logs.status, exitCode: null }),
        runtimeStatus: logs.status,
        logLineCount: logs.logLineCount,
        truncated: logs.truncated,
        lines: terminalLinesFromRuntime(logs.entries),
        updatedAt: logs.updatedAt,
      }
    },
    async executeCommand(ownerValue, command) {
      if (ownerValue == null) return fallbackSnapshot(null, 'failed')
      const owner = requiredOwner(ownerValue)
      if (!hasRuntime()) return fallbackSnapshot(owner.projectPath, 'failed')

      const response = await invokeRuntime<unknown>('execute_terminal_session_command', {
        projectPath: owner.projectPath,
        sessionId: owner.terminalSessionId,
        command,
      })
      return validatedSnapshot(response, owner.projectPath, owner.terminalSessionId)
    },
    async writeInput(ownerValue, data) {
      if (ownerValue == null) return
      const owner = requiredOwner(ownerValue)
      if (!hasRuntime()) return

      await invokeRuntime<void>('write_terminal_input', {
        projectPath: owner.projectPath,
        sessionId: owner.terminalSessionId,
        data,
      })
    },
    async readRawOutput(ownerValue, from) {
      if (ownerValue == null) {
        return {
          projectPath: null,
          sessionId: null,
          base: from,
          cursor: from,
          chunk: '',
          status: 'unavailable',
        }
      }
      const owner = requiredOwner(ownerValue)
      if (!hasRuntime()) {
        return {
          projectPath: owner.projectPath,
          sessionId: owner.terminalSessionId,
          base: from,
          cursor: from,
          chunk: '',
          status: 'unavailable',
        }
      }

      const response = await invokeRuntime<unknown>('read_raw_terminal_output', {
        projectPath: owner.projectPath,
        sessionId: owner.terminalSessionId,
        from,
      })
      return validatedRawOutput(response, owner)
    },
    async resizeSession(ownerValue, rows, cols) {
      if (ownerValue == null) return
      const owner = requiredOwner(ownerValue)
      if (!hasRuntime()) return
      if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows < 1 || cols < 1) return

      await invokeRuntime<void>('resize_terminal_session', {
        projectPath: owner.projectPath,
        sessionId: owner.terminalSessionId,
        rows: Math.floor(rows),
        cols: Math.floor(cols),
      })
    },
  }
}

export const terminalRuntimeService = createTerminalRuntimeService()
