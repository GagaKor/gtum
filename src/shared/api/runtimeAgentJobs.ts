import { invoke } from '@tauri-apps/api/core'

import {
  hasTauriRuntime,
  type RuntimeInvoker,
  type RuntimeProject,
} from './runtimeProjects'

export type AgentJobStatus = 'running' | 'exited' | 'cancelled' | 'failed'

export type AgentJobSnapshot = {
  jobId: number
  name: string
  command: string
  cwd: string
  runner: string
  runnerArgs: string[]
  processId?: number | null
  status: AgentJobStatus
  createdAt: number
  updatedAt: number
  exitCode?: number | null
  logLineCount: number
  maxLogEntries: number
  lastEvent?: string | null
}

export type AgentJobLogs = {
  jobId: number
  status: AgentJobStatus
  limit: number
  logLineCount: number
  truncated: boolean
  entries: string[]
  updatedAt: number
}

export type CreateAgentJobRequest = {
  projectPath: string
  command: string
  name?: string
  maxLogEntries?: number
}

export type AgentJobRuntimeServiceOptions = {
  hasRuntime?: () => boolean
  invokeRuntime?: RuntimeInvoker
}

export type AgentJobRuntimeService = {
  hasRuntime: () => boolean
  createJob(request: CreateAgentJobRequest): Promise<AgentJobSnapshot>
  readLogs(jobId: number, limit?: number): Promise<AgentJobLogs>
  cancelJob(jobId: number): Promise<AgentJobSnapshot>
  createProjectJob(
    project: Pick<RuntimeProject, 'path' | 'runtimeBacked'> | null | undefined,
    command: string,
    name?: string,
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
): AgentJobSnapshot => ({
  jobId: -1,
  name: 'unavailable agent job',
  command,
  cwd: '',
  runner: '',
  runnerArgs: [],
  processId: null,
  status: 'failed',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  exitCode: 1,
  logLineCount: 0,
  maxLogEntries: 0,
  lastEvent,
})

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

      return invokeRuntime<AgentJobSnapshot>('create_agent_job', { request })
    },
    async readLogs(jobId, limit = 100) {
      if (!hasRuntime()) {
        return {
          jobId,
          status: 'failed',
          limit,
          logLineCount: 0,
          truncated: false,
          entries: [],
          updatedAt: Date.now(),
        }
      }

      return invokeRuntime<AgentJobLogs>('read_agent_job_logs', { jobId, limit })
    },
    async cancelJob(jobId) {
      if (!hasRuntime()) return fallbackSnapshot('', 'desktop runtime is not connected')

      return invokeRuntime<AgentJobSnapshot>('cancel_agent_job', { jobId })
    },
    async createProjectJob(project, command, name) {
      if (!project?.runtimeBacked || !project.path) {
        return fallbackSnapshot(command, 'open a real project before running agent jobs')
      }

      if (!hasRuntime()) return fallbackSnapshot(command)

      return invokeRuntime<AgentJobSnapshot>('create_agent_job', {
        request: {
          projectPath: project.path,
          command,
          name,
        },
      })
    },
  }
}

export const agentJobRuntimeService = createAgentJobRuntimeService()
