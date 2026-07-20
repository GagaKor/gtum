import { invoke } from '@tauri-apps/api/core'

import type { AgentAccountLease } from '../../entities/agent/model/types'
import {
  EXACT_AGENT_ACCOUNT_LEASE_REQUIRED_ERROR,
  normalizeRuntimeAgentLease,
} from './runtimeAgentAuth'
import {
  hasTauriRuntime,
  type RuntimeInvoker,
  type RuntimeProject,
} from './runtimeProjects'

export type AgentJobStatus =
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export type AgentJobLogStream = 'command' | 'stdout' | 'stderr' | 'system'

export type AgentJobLogEntry = {
  sequence: number
  stream: AgentJobLogStream
  text: string
  recordedAt: number
}

export type AgentJobSnapshot = {
  jobId: number
  sessionId: string | null
  name: string
  command: string
  cwd: string
  runner: string
  runnerArgs: string[]
  processId: number | null
  status: AgentJobStatus
  createdAt: number
  updatedAt: number
  finishedAt: number | null
  cancellationRequestedAt: number | null
  exitCode: number | null
  logsComplete: boolean
  logCaptureError: string | null
  processError: string | null
  persistenceError: string | null
  logLineCount: number
  maxLogEntries: number
  lastEvent: string | null
}

export type AgentJobLogs = {
  jobId: number
  status: AgentJobStatus
  limit: number
  logLineCount: number
  truncated: boolean
  entries: AgentJobLogEntry[]
  updatedAt: number
  finishedAt: number | null
  cancellationRequestedAt: number | null
  exitCode: number | null
  logsComplete: boolean
  logCaptureError: string | null
  processError: string | null
  persistenceError: string | null
  lastEvent: string | null
}

export type CreateAgentJobRequest = {
  projectPath: string
  command: string
  name?: string
  maxLogEntries?: number
  sessionId?: string
}

export type AgentJobRuntimeServiceOptions = {
  hasRuntime?: () => boolean
  invokeRuntime?: RuntimeInvoker
}

export type AgentJobRuntimeService = {
  hasRuntime: () => boolean
  createJob(request: CreateAgentJobRequest): Promise<AgentJobSnapshot>
  createProjectJob(
    project: Pick<RuntimeProject, 'path' | 'runtimeBacked'> | null | undefined,
    command: string,
    name?: string,
    sessionId?: string | null,
  ): Promise<AgentJobSnapshot>
  createAuthorizedProjectJob(
    project: Pick<RuntimeProject, 'path' | 'runtimeBacked'> | null | undefined,
    lease: AgentAccountLease,
    command: string,
    name: string | undefined,
    sessionId: string,
  ): Promise<AgentJobSnapshot>
  listProjectJobs(
    project: Pick<RuntimeProject, 'path' | 'runtimeBacked'> | null | undefined,
    limit?: number,
    sessionId?: string | null,
  ): Promise<AgentJobSnapshot[]>
  readProjectJobLogs(
    project: Pick<RuntimeProject, 'path' | 'runtimeBacked'> | null | undefined,
    jobId: number,
    limit?: number,
  ): Promise<AgentJobLogs>
  cancelProjectJob(
    project: Pick<RuntimeProject, 'path' | 'runtimeBacked'> | null | undefined,
    jobId: number,
  ): Promise<AgentJobSnapshot>
}

type RuntimeAgentJobOverride = {
  hasRuntime?: () => boolean
  invokeRuntime?: RuntimeInvoker
}

const agentJobOverride = (): RuntimeAgentJobOverride | null => {
  if (typeof window === 'undefined') return null

  return (
    (window as Window & { __GTUM_AGENT_JOB_RUNTIME__?: RuntimeAgentJobOverride })
      .__GTUM_AGENT_JOB_RUNTIME__ ?? null
  )
}

const fallbackSnapshot = (
  command: string,
  lastEvent = 'desktop runtime is not connected',
  jobId = -1,
  sessionId: string | null = null,
): AgentJobSnapshot => ({
  jobId,
  sessionId,
  name: 'unavailable agent job',
  command,
  cwd: '',
  runner: '',
  runnerArgs: [],
  processId: null,
  status: 'failed',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  finishedAt: Date.now(),
  cancellationRequestedAt: null,
  exitCode: 1,
  logsComplete: true,
  logCaptureError: null,
  processError: null,
  persistenceError: null,
  logLineCount: 0,
  maxLogEntries: 0,
  lastEvent,
})

const fallbackLogs = (
  jobId: number,
  limit: number,
  lastEvent: string,
): AgentJobLogs => ({
  jobId,
  status: 'failed',
  limit,
  logLineCount: 0,
  truncated: false,
  entries: [],
  updatedAt: Date.now(),
  finishedAt: Date.now(),
  cancellationRequestedAt: null,
  exitCode: 1,
  logsComplete: true,
  logCaptureError: null,
  processError: null,
  persistenceError: null,
  lastEvent,
})

const isRuntimeProject = (
  project: Pick<RuntimeProject, 'path' | 'runtimeBacked'> | null | undefined,
): project is Pick<RuntimeProject, 'path' | 'runtimeBacked'> =>
  Boolean(project?.runtimeBacked && project.path)

const agentJobStatuses = new Set<AgentJobStatus>([
  'running',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
])
const agentJobLogStreams = new Set<AgentJobLogStream>([
  'command',
  'stdout',
  'stderr',
  'system',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const isNullableNumber = (value: unknown): value is number | null =>
  value === null || isFiniteNumber(value)
const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string'

const isAgentJobSnapshot = (value: unknown): value is AgentJobSnapshot => {
  if (!isRecord(value)) return false

  return (
    isFiniteNumber(value.jobId) &&
    isNullableString(value.sessionId) &&
    typeof value.name === 'string' &&
    typeof value.command === 'string' &&
    typeof value.cwd === 'string' &&
    typeof value.runner === 'string' &&
    Array.isArray(value.runnerArgs) &&
    value.runnerArgs.every((argument) => typeof argument === 'string') &&
    isNullableNumber(value.processId) &&
    typeof value.status === 'string' &&
    agentJobStatuses.has(value.status as AgentJobStatus) &&
    isFiniteNumber(value.createdAt) &&
    isFiniteNumber(value.updatedAt) &&
    isNullableNumber(value.finishedAt) &&
    isNullableNumber(value.cancellationRequestedAt) &&
    isNullableNumber(value.exitCode) &&
    typeof value.logsComplete === 'boolean' &&
    isNullableString(value.logCaptureError) &&
    isNullableString(value.processError) &&
    isNullableString(value.persistenceError) &&
    isFiniteNumber(value.logLineCount) &&
    isFiniteNumber(value.maxLogEntries) &&
    isNullableString(value.lastEvent)
  )
}

const isAgentJobLogEntry = (value: unknown): value is AgentJobLogEntry => {
  if (!isRecord(value)) return false

  return (
    isFiniteNumber(value.sequence) &&
    typeof value.stream === 'string' &&
    agentJobLogStreams.has(value.stream as AgentJobLogStream) &&
    typeof value.text === 'string' &&
    isFiniteNumber(value.recordedAt)
  )
}

const isAgentJobLogs = (value: unknown): value is AgentJobLogs => {
  if (!isRecord(value)) return false

  return (
    isFiniteNumber(value.jobId) &&
    typeof value.status === 'string' &&
    agentJobStatuses.has(value.status as AgentJobStatus) &&
    isFiniteNumber(value.limit) &&
    isFiniteNumber(value.logLineCount) &&
    typeof value.truncated === 'boolean' &&
    Array.isArray(value.entries) &&
    value.entries.every(isAgentJobLogEntry) &&
    isFiniteNumber(value.updatedAt) &&
    isNullableNumber(value.finishedAt) &&
    isNullableNumber(value.cancellationRequestedAt) &&
    isNullableNumber(value.exitCode) &&
    typeof value.logsComplete === 'boolean' &&
    isNullableString(value.logCaptureError) &&
    isNullableString(value.processError) &&
    isNullableString(value.persistenceError) &&
    isNullableString(value.lastEvent)
  )
}

const requireAgentJobSnapshot = (value: unknown): AgentJobSnapshot => {
  if (!isAgentJobSnapshot(value)) throw new Error('Invalid agent job snapshot from runtime')
  return value
}

const requireAuthorizedAgentJobSnapshot = (
  value: unknown,
  sessionId: string,
): AgentJobSnapshot => {
  const snapshot = requireAgentJobSnapshot(value)
  if (snapshot.sessionId !== sessionId) {
    throw new Error('Authorized agent job snapshot session owner mismatch')
  }
  return snapshot
}

const normalizeAuthorizedAgentSessionId = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) {
    throw new Error('Authorized agent job sessionId must be a canonical non-empty string')
  }
  return value
}

const requireAgentJobList = (value: unknown): AgentJobSnapshot[] => {
  if (!Array.isArray(value) || !value.every(isAgentJobSnapshot)) {
    throw new Error('Invalid agent job list from runtime')
  }
  return value
}

const requireAgentJobLogs = (value: unknown): AgentJobLogs => {
  if (!isAgentJobLogs(value)) throw new Error('Invalid agent job logs from runtime')
  return value
}

export const createAgentJobRuntimeService = (
  options: AgentJobRuntimeServiceOptions = {},
): AgentJobRuntimeService => {
  const override = agentJobOverride()
  const hasRuntime = options.hasRuntime || override?.hasRuntime || hasTauriRuntime
  const invokeRuntime = options.invokeRuntime || override?.invokeRuntime || (invoke as RuntimeInvoker)

  return {
    hasRuntime,
    async createJob(request) {
      if (!hasRuntime()) return fallbackSnapshot(request.command)
      throw new Error(EXACT_AGENT_ACCOUNT_LEASE_REQUIRED_ERROR)
    },
    async createProjectJob(project, command, _name, sessionId) {
      if (!isRuntimeProject(project)) {
        return fallbackSnapshot(
          command,
          'open a real project before running agent jobs',
          -1,
          sessionId ?? null,
        )
      }

      if (!hasRuntime()) {
        return fallbackSnapshot(
          command,
          'desktop runtime is not connected',
          -1,
          sessionId ?? null,
        )
      }
      throw new Error(EXACT_AGENT_ACCOUNT_LEASE_REQUIRED_ERROR)
    },
    async createAuthorizedProjectJob(project, leaseValue, command, name, sessionIdValue) {
      const lease = normalizeRuntimeAgentLease(leaseValue, 'Authorized agent job lease')
      const sessionId = normalizeAuthorizedAgentSessionId(sessionIdValue)
      if (!isRuntimeProject(project)) {
        return fallbackSnapshot(
          command,
          'open a real project before running agent jobs',
          -1,
          sessionId,
        )
      }

      if (!hasRuntime()) {
        return fallbackSnapshot(
          command,
          'desktop runtime is not connected',
          -1,
          sessionId,
        )
      }

      return requireAuthorizedAgentJobSnapshot(
        await invokeRuntime<unknown>('create_authorized_agent_job', {
          request: {
            ...lease,
            projectPath: project.path,
            command,
            name,
            sessionId,
          },
        }),
        sessionId,
      )
    },
    async listProjectJobs(project, limit = 25, sessionId) {
      if (!isRuntimeProject(project) || !hasRuntime()) return []

      return requireAgentJobList(
        await invokeRuntime<unknown>('list_agent_jobs', {
          projectPath: project.path,
          sessionId: sessionId || undefined,
          limit,
        }),
      )
    },
    async readProjectJobLogs(project, jobId, limit = 100) {
      if (!isRuntimeProject(project)) {
        return fallbackLogs(
          jobId,
          limit,
          'open a real project before reading agent job logs',
        )
      }

      if (!hasRuntime()) {
        return fallbackLogs(jobId, limit, 'desktop runtime is not connected')
      }

      return requireAgentJobLogs(
        await invokeRuntime<unknown>('read_agent_job_logs', {
          projectPath: project.path,
          jobId,
          limit,
        }),
      )
    },
    async cancelProjectJob(project, jobId) {
      if (!isRuntimeProject(project)) {
        return fallbackSnapshot(
          '',
          'open a real project before cancelling agent jobs',
          jobId,
        )
      }

      if (!hasRuntime()) {
        return fallbackSnapshot('', 'desktop runtime is not connected', jobId)
      }

      return requireAgentJobSnapshot(
        await invokeRuntime<unknown>('cancel_agent_job', {
          projectPath: project.path,
          jobId,
        }),
      )
    },
  }
}

export const agentJobRuntimeService = createAgentJobRuntimeService()
