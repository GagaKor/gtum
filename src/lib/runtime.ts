import { invoke } from '@tauri-apps/api/core'

export type RuntimeInfo = {
  app_name: string
  platform: string
  mode: string
}

export type ProjectMetadata = {
  name: string
  path: string
  exists: boolean
  isDirectory: boolean
}

export type FileTreeNode = {
  name: string
  path: string
  kind: 'file' | 'directory'
  children: FileTreeNode[]
  truncated: boolean
}

export type GitOverview = {
  isRepository: boolean
  branch: string | null
  branchType: string | null
  isDirty: boolean
  changedFilesCount: number
}

export type ProjectOverview = {
  metadata: ProjectMetadata
  tree: FileTreeNode
  git: GitOverview
}

export type TerminalSessionStatus = 'running' | 'exited' | 'terminated' | 'failed'

export type CreateTerminalSessionRequest = {
  name?: string
  cwd?: string
  shell?: string
  rows?: number
  cols?: number
  maxLogEntries?: number
}

export type TerminalSessionSnapshot = {
  sessionId: number
  name: string
  cwd: string | null
  shell: string
  shellArgs: string[]
  processId: number | null
  status: TerminalSessionStatus
  createdAt: number
  updatedAt: number
  exitCode: number | null
  logLineCount: number
  maxLogEntries: number
  lastEvent: string | null
}

export type TerminalSessionLogs = {
  sessionId: number
  status: TerminalSessionStatus
  limit: number
  logLineCount: number
  truncated: boolean
  entries: string[]
  updatedAt: number
}

const mockTree: FileTreeNode = {
  name: 'demo-project',
  path: '/mock/demo-project',
  kind: 'directory',
  truncated: false,
  children: [
    {
      name: 'src',
      path: '/mock/demo-project/src',
      kind: 'directory',
      truncated: false,
      children: [
        {
          name: 'App.tsx',
          path: '/mock/demo-project/src/App.tsx',
          kind: 'file',
          truncated: false,
          children: [],
        },
      ],
    },
    {
      name: 'package.json',
      path: '/mock/demo-project/package.json',
      kind: 'file',
      truncated: false,
      children: [],
    },
  ],
}

const isMockRuntime = () => {
  if (typeof window === 'undefined') {
    return false
  }

  return new URLSearchParams(window.location.search).get('e2eMock') === '1'
}

let nextMockTerminalId = 2
let mockTerminalSessions: TerminalSessionSnapshot[] = [
  {
    sessionId: 1,
    name: 'workspace',
    cwd: '/mock/demo-project',
    shell: 'bash',
    shellArgs: ['-i'],
    processId: 1001,
    status: 'running',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    exitCode: null,
    logLineCount: 4,
    maxLogEntries: 400,
    lastEvent: 'session created',
  },
]

const mockTerminalLogs: Record<number, string[]> = {
  1: [
    '$ sprint-2:start',
    '[gtum] terminal ready',
    '$ npm run test:watch',
    'PASS src/app-shell.spec.ts',
  ],
}

const refreshMockSession = (sessionId: number) => {
  const lines = mockTerminalLogs[sessionId] || []
  mockTerminalSessions = mockTerminalSessions.map((session) =>
    session.sessionId === sessionId
      ? {
          ...session,
          logLineCount: lines.length,
          updatedAt: Date.now(),
        }
      : session,
  )
}

export const usesMockRuntime = isMockRuntime

export const getRuntimeInfo = async () => {
  if (isMockRuntime()) {
    return {
      app_name: 'gtum',
      platform: 'mock-web',
      mode: 'e2e',
    } satisfies RuntimeInfo
  }

  return invoke<RuntimeInfo>('get_runtime_info')
}

export const readProjectOverview = async (path: string) => {
  if (isMockRuntime()) {
    return {
      metadata: {
        name: path.split('/').filter(Boolean).at(-1) || 'demo-project',
        path: path || '/mock/demo-project',
        exists: true,
        isDirectory: true,
      },
      tree: {
        ...mockTree,
        name: path.split('/').filter(Boolean).at(-1) || mockTree.name,
        path: path || mockTree.path,
      },
      git: {
        isRepository: true,
        branch: 'feature/mock-project-open',
        branchType: 'feature',
        isDirty: true,
        changedFilesCount: 3,
      },
    } satisfies ProjectOverview
  }

  return invoke<ProjectOverview>('read_project_overview', { path })
}

export const createTerminalSession = async (request: CreateTerminalSessionRequest) => {
  if (isMockRuntime()) {
    const now = Date.now()
    const sessionId = nextMockTerminalId++
    const session: TerminalSessionSnapshot = {
      sessionId,
      name: request.name || `tab-${sessionId}`,
      cwd: request.cwd || '/mock/demo-project',
      shell: 'bash',
      shellArgs: ['-i'],
      processId: 1000 + sessionId,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      exitCode: null,
      logLineCount: 2,
      maxLogEntries: request.maxLogEntries || 400,
      lastEvent: 'session created',
    }

    mockTerminalSessions = [...mockTerminalSessions, session]
    mockTerminalLogs[sessionId] = [`$ cd ${session.cwd}`, '[gtum] terminal ready']
    return session
  }

  return invoke<TerminalSessionSnapshot>('create_terminal_session', { request })
}

export const listTerminalSessions = async () => {
  if (isMockRuntime()) {
    return mockTerminalSessions
  }

  return invoke<TerminalSessionSnapshot[]>('list_terminal_sessions')
}

export const renameTerminalSession = async (sessionId: number, name: string) => {
  if (isMockRuntime()) {
    mockTerminalSessions = mockTerminalSessions.map((session) =>
      session.sessionId === sessionId
        ? {
            ...session,
            name,
            updatedAt: Date.now(),
            lastEvent: 'session renamed',
          }
        : session,
    )

    return mockTerminalSessions.find((session) => session.sessionId === sessionId)!
  }

  return invoke<TerminalSessionSnapshot>('rename_terminal_session', { sessionId, name })
}

export const closeTerminalSession = async (sessionId: number) => {
  if (isMockRuntime()) {
    const session = mockTerminalSessions.find((entry) => entry.sessionId === sessionId) ?? null
    mockTerminalSessions = mockTerminalSessions.filter((entry) => entry.sessionId !== sessionId)
    delete mockTerminalLogs[sessionId]
    return session
  }

  return invoke<TerminalSessionSnapshot>('close_terminal_session', { sessionId })
}

export const readTerminalSessionLogs = async (sessionId: number, limit = 120) => {
  if (isMockRuntime()) {
    const entries = (mockTerminalLogs[sessionId] || []).slice(-limit)
    return {
      sessionId,
      status:
        mockTerminalSessions.find((entry) => entry.sessionId === sessionId)?.status || 'terminated',
      limit,
      logLineCount: entries.length,
      truncated: false,
      entries,
      updatedAt: Date.now(),
    } satisfies TerminalSessionLogs
  }

  return invoke<TerminalSessionLogs>('read_terminal_session_logs', { sessionId, limit })
}

export const appendMockTerminalLine = async (sessionId: number, input: string) => {
  if (!isMockRuntime()) {
    return
  }

  const lines = [...(mockTerminalLogs[sessionId] || []), input, '[mock] output received']
  mockTerminalLogs[sessionId] = lines
  refreshMockSession(sessionId)
}
