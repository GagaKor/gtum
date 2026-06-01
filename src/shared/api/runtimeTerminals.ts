import { invoke } from '@tauri-apps/api/core'

import {
  basenameOfPath,
  hasTauriRuntime,
  type RuntimeInvoker,
} from './runtimeProjects'

export type RuntimeTerminalStatus = 'running' | 'exited' | 'terminated' | 'failed'

export type RuntimeTerminalSnapshot = {
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
  sessionId: number | null
  status: TerminalTabStatus
  runtimeStatus: RuntimeTerminalStatus | 'unavailable'
  logLineCount: number
  truncated: boolean
  lines: TerminalLine[]
  updatedAt: number
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
  listSessions(): Promise<RuntimeTerminalSnapshot[]>
  renameSession(sessionId: number, name: string): Promise<RuntimeTerminalSnapshot>
  closeSession(sessionId: number | null): Promise<RuntimeTerminalSnapshot>
  readLogs(sessionId: number | null, limit?: number): Promise<TerminalLogsView>
  executeCommand(sessionId: number | null, command: string): Promise<RuntimeTerminalSnapshot>
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
  entries.map((entry) => ({ kind: 'log', text: entry }))

export const terminalTabFromRuntime = (
  snapshot: RuntimeTerminalSnapshot,
  request: CreateTerminalTabRequest,
  lines: TerminalLine[] = [],
): RuntimeTerminalTab => ({
  id: `t-runtime-${snapshot.sessionId ?? 'local'}`,
  type: 'terminal',
  title: request.title || snapshot.name || 'terminal',
  shell: basenameOfPath(snapshot.shell || request.shell || 'shell'),
  cwd: displayCwdForProject(request.projectPath, snapshot.cwd),
  status: terminalStatusFromRuntime(snapshot),
  cmd: null,
  lines,
  terminalSessionId: snapshot.sessionId,
  runtimeBacked: snapshot.sessionId != null,
  runtimeStatus: snapshot.status,
  lastLogLineCount: snapshot.logLineCount,
  runtimeUpdatedAt: snapshot.updatedAt,
})

const fallbackSnapshot = (
  status: RuntimeTerminalStatus = 'failed',
  lastEvent = 'desktop runtime is not connected',
): RuntimeTerminalSnapshot => ({
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
  terminalTabFromRuntime(fallbackSnapshot(), request, [
    {
      kind: 'log',
      text: 'desktop runtime is not connected; terminal preview is local only.',
      color: 'warn',
    },
  ])

const createSessionPayload = (request: CreateTerminalTabRequest): Record<string, unknown> =>
  omitUndefined({
    name: request.title,
    cwd: resolveRuntimeCwd(request.projectPath, request.cwd),
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
      if (!hasRuntime()) return fallbackTerminalTab(request)

      const snapshot = await invokeRuntime<RuntimeTerminalSnapshot>('create_terminal_session', {
        request: createSessionPayload(request),
      })

      return terminalTabFromRuntime(snapshot, request)
    },
    async createTerminalTabWithCommand(request) {
      if (!hasRuntime()) {
        return {
          ...fallbackTerminalTab(request),
          cmd: request.command,
        }
      }

      const snapshot = await invokeRuntime<RuntimeTerminalSnapshot>(
        'create_terminal_session_with_command',
        {
          request: {
            session: createSessionPayload(request),
            command: request.command,
          },
        },
      )

      return {
        ...terminalTabFromRuntime(snapshot, request, [{ kind: 'cmd', text: request.command }]),
        cmd: request.command,
      }
    },
    async listSessions() {
      if (!hasRuntime()) return []

      return invokeRuntime<RuntimeTerminalSnapshot[]>('list_terminal_sessions')
    },
    async renameSession(sessionId, name) {
      if (!hasRuntime()) return fallbackSnapshot('failed')

      return invokeRuntime<RuntimeTerminalSnapshot>('rename_terminal_session', { sessionId, name })
    },
    async closeSession(sessionId) {
      if (!hasRuntime() || sessionId == null) return fallbackSnapshot('terminated')

      return invokeRuntime<RuntimeTerminalSnapshot>('close_terminal_session', { sessionId })
    },
    async readLogs(sessionId, limit = DEFAULT_LOG_LIMIT) {
      if (!hasRuntime() || sessionId == null) {
        return {
          sessionId: null,
          status: 'failed',
          runtimeStatus: 'unavailable',
          logLineCount: 0,
          truncated: false,
          lines: [],
          updatedAt: Date.now(),
        }
      }

      const logs = await invokeRuntime<RuntimeTerminalLogs>('read_terminal_session_logs', {
        sessionId,
        limit,
      })

      return {
        sessionId: logs.sessionId,
        status: terminalStatusFromRuntime({ status: logs.status, exitCode: null }),
        runtimeStatus: logs.status,
        logLineCount: logs.logLineCount,
        truncated: logs.truncated,
        lines: terminalLinesFromRuntime(logs.entries),
        updatedAt: logs.updatedAt,
      }
    },
    async executeCommand(sessionId, command) {
      if (!hasRuntime() || sessionId == null) return fallbackSnapshot('failed')

      return invokeRuntime<RuntimeTerminalSnapshot>('execute_terminal_session_command', {
        sessionId,
        command,
      })
    },
  }
}

export const terminalRuntimeService = createTerminalRuntimeService()
