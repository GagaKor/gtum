import { useCallback, useEffect, useRef, useState } from 'react'

import {
  agentJobRuntimeService,
  type AgentJobLogEntry,
  type AgentJobRuntimeService,
  type AgentJobSnapshot,
} from '../../../shared/api/runtimeAgentJobs'
import type { RuntimeProject } from '../../../shared/api/runtimeProjects'

const DEFAULT_POLL_INTERVAL_MS = 1_000
const DEFAULT_LOG_LIMIT = 100
const DEFAULT_LIST_LIMIT = 25
const MAX_VISIBLE_JOB_LIMIT = 100

const activeStatuses = new Set(['running', 'cancelling'])
const terminalStatuses = new Set([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
])

export type AgentJobContext = {
  projectPath: string
  sessionId: string | null
}

export type AgentJobView = {
  snapshot: AgentJobSnapshot
  entries: AgentJobLogEntry[]
  projectPath: string
  sessionId: string | null
  logsHydrated: boolean
  logError: string | null
  actionError: string | null
  cancelPending: boolean
}

export type UseAgentJobLifecycleOptions = {
  project: RuntimeProject | null | undefined
  sessionId: string | null
  service?: AgentJobRuntimeService
  pollIntervalMs?: number
  listLimit?: number
  logLimit?: number
}

export type UseAgentJobLifecycleResult = {
  jobs: AgentJobView[]
  hydrateProject(project: RuntimeProject): Promise<void>
  registerJobs(snapshots: AgentJobSnapshot[], context: AgentJobContext): void
  cancelJob(jobId: number): Promise<void>
}

type ActiveContext = {
  key: string
  generation: number
  project: RuntimeProject
  sessionId: string | null
}

const contextKeyOf = (
  project: RuntimeProject | null | undefined,
  sessionId: string | null,
): string =>
  project?.runtimeBacked && project.path && sessionId
    ? `${project.path}\u0000${sessionId}`
    : ''

const pollIntervalOverride = (): number | undefined => {
  if (typeof window === 'undefined') return undefined

  const value = (
    window as Window & { __GTUM_AGENT_JOB_POLL_INTERVAL_MS__?: unknown }
  ).__GTUM_AGENT_JOB_POLL_INTERVAL_MS__

  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const mergeEntries = (
  current: AgentJobLogEntry[],
  incoming: AgentJobLogEntry[],
  limit: number,
): AgentJobLogEntry[] => {
  const entries = new Map<number, AgentJobLogEntry>()
  for (const entry of current) entries.set(entry.sequence, entry)
  for (const entry of incoming) entries.set(entry.sequence, entry)

  return [...entries.values()]
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-limit)
}

const sortViews = (views: AgentJobView[]): AgentJobView[] =>
  [...views].sort(
    (left, right) =>
      right.snapshot.updatedAt - left.snapshot.updatedAt ||
      right.snapshot.jobId - left.snapshot.jobId,
  )

const boundViews = (views: AgentJobView[], historyLimit: number): AgentJobView[] => {
  const sorted = sortViews(views)
  const visibleLimit = Math.min(
    MAX_VISIBLE_JOB_LIMIT,
    Math.max(1, historyLimit),
  )
  const active = sorted
    .filter((view) => activeStatuses.has(view.snapshot.status))
    .slice(0, MAX_VISIBLE_JOB_LIMIT)
  const activeIds = new Set(active.map((view) => view.snapshot.jobId))
  const terminalSlots = Math.max(0, visibleLimit - active.length)
  const terminal = sorted
    .filter((view) => !activeIds.has(view.snapshot.jobId))
    .slice(0, terminalSlots)

  return sortViews([...active, ...terminal])
}

const shouldApplySnapshotMetadata = (
  current: AgentJobSnapshot,
  incoming: Pick<AgentJobSnapshot, 'status' | 'updatedAt'>,
): boolean => {
  if (incoming.updatedAt < current.updatedAt) return false
  if (terminalStatuses.has(current.status) && incoming.status !== current.status) {
    return false
  }
  if (current.status === 'cancelling' && incoming.status === 'running') return false

  return true
}

const mergeSnapshots = (
  current: AgentJobView[],
  snapshots: AgentJobSnapshot[],
  context: AgentJobContext,
  limit: number,
): AgentJobView[] => {
  const views = new Map(current.map((view) => [view.snapshot.jobId, view]))

  for (const snapshot of snapshots) {
    if (snapshot.sessionId !== context.sessionId) continue
    const previous = views.get(snapshot.jobId)
    views.set(snapshot.jobId, {
      snapshot:
        previous && !shouldApplySnapshotMetadata(previous.snapshot, snapshot)
          ? previous.snapshot
          : { ...previous?.snapshot, ...snapshot },
      entries: previous?.entries ?? [],
      projectPath: context.projectPath,
      sessionId: snapshot.sessionId,
      logsHydrated: previous?.logsHydrated ?? false,
      logError: previous?.logError ?? null,
      actionError: previous?.actionError ?? null,
      cancelPending: previous?.cancelPending ?? false,
    })
  }

  return boundViews([...views.values()], limit)
}

export const useAgentJobLifecycle = ({
  project,
  sessionId,
  service = agentJobRuntimeService,
  pollIntervalMs,
  listLimit = DEFAULT_LIST_LIMIT,
  logLimit = DEFAULT_LOG_LIMIT,
}: UseAgentJobLifecycleOptions): UseAgentJobLifecycleResult => {
  const contextKey = contextKeyOf(project, sessionId)
  const renderedContextKeyRef = useRef(contextKey)
  renderedContextKeyRef.current = contextKey

  const generationRef = useRef(0)
  const hydrationRequestRef = useRef(0)
  const activeContextRef = useRef<ActiveContext | null>(null)
  const inFlightReadsRef = useRef(new Map<string, Promise<void>>())
  const inFlightCancelsRef = useRef(new Set<string>())
  const jobsRef = useRef<AgentJobView[]>([])
  const [jobs, setJobsState] = useState<AgentJobView[]>([])

  const setJobs = useCallback(
    (updater: (current: AgentJobView[]) => AgentJobView[]) => {
      setJobsState((current) => {
        const next = updater(current)
        jobsRef.current = next
        return next
      })
    },
    [],
  )

  const hydrateProject = useCallback(
    async (targetProject: RuntimeProject) => {
      const context = activeContextRef.current
      if (
        !context ||
        context.key !== contextKeyOf(targetProject, sessionId) ||
        renderedContextKeyRef.current !== context.key
      ) {
        return
      }

      const generation = context.generation
      hydrationRequestRef.current += 1
      const hydrationRequest = hydrationRequestRef.current
      try {
        const result = await service.listProjectJobs(
          targetProject,
          MAX_VISIBLE_JOB_LIMIT,
          sessionId,
        )
        if (
          activeContextRef.current?.generation !== generation ||
          hydrationRequestRef.current !== hydrationRequest ||
          renderedContextKeyRef.current !== context.key
        ) {
          return
        }

        const snapshots = Array.isArray(result) ? result : []
        setJobs((current) =>
          mergeSnapshots(current, snapshots, {
            projectPath: targetProject.path,
            sessionId,
          }, listLimit),
        )
      } catch {
        // Project history hydration is best-effort. Per-job read failures remain
        // visible on their rows without inventing a process failure.
      }
    },
    [listLimit, service, sessionId, setJobs],
  )

  useEffect(() => {
    generationRef.current += 1
    hydrationRequestRef.current += 1
    const generation = generationRef.current
    inFlightReadsRef.current.clear()
    inFlightCancelsRef.current.clear()
    jobsRef.current = []
    setJobsState([])

    if (!project?.runtimeBacked || !project.path || !contextKey) {
      activeContextRef.current = null
      return undefined
    }

    activeContextRef.current = {
      key: contextKey,
      generation,
      project,
      sessionId,
    }
    void hydrateProject(project)

    return () => {
      if (activeContextRef.current?.generation === generation) {
        activeContextRef.current = null
      }
    }
  }, [contextKey, hydrateProject, project, sessionId])

  const registerJobs = useCallback(
    (snapshots: AgentJobSnapshot[], context: AgentJobContext) => {
      const activeContext = activeContextRef.current
      const requestedKey = `${context.projectPath}\u0000${context.sessionId ?? ''}`
      if (
        !activeContext ||
        activeContext.key !== requestedKey ||
        renderedContextKeyRef.current !== requestedKey
      ) {
        return
      }

      setJobs((current) =>
        mergeSnapshots(current, snapshots, context, listLimit),
      )
    },
    [listLimit, setJobs],
  )

  const readJob = useCallback(
    (jobId: number, generation: number, key: string): Promise<void> => {
      const readKey = `${generation}:${jobId}`
      const existing = inFlightReadsRef.current.get(readKey)
      if (existing) return existing

      const context = activeContextRef.current
      if (
        !context ||
        context.generation !== generation ||
        context.key !== key ||
        renderedContextKeyRef.current !== key
      ) {
        return Promise.resolve()
      }

      const request = (async () => {
        try {
          const logs = await service.readProjectJobLogs(
            context.project,
            jobId,
            logLimit,
          )
          if (
            activeContextRef.current?.generation !== generation ||
            renderedContextKeyRef.current !== key
          ) {
            return
          }

          setJobs((current) =>
            sortViews(
              current.map((view) => {
                if (view.snapshot.jobId !== jobId) return view

                const applyMetadata = shouldApplySnapshotMetadata(view.snapshot, logs)

                return {
                  ...view,
                  snapshot: applyMetadata
                    ? {
                        ...view.snapshot,
                        status: logs.status,
                        updatedAt: logs.updatedAt,
                        finishedAt: logs.finishedAt,
                        cancellationRequestedAt: logs.cancellationRequestedAt,
                        exitCode: logs.exitCode,
                        logsComplete: logs.logsComplete,
                        logCaptureError: logs.logCaptureError,
                        processError: logs.processError,
                        persistenceError: logs.persistenceError,
                        logLineCount: logs.logLineCount,
                        lastEvent: logs.lastEvent,
                        processId: activeStatuses.has(logs.status)
                          ? view.snapshot.processId
                          : null,
                      }
                    : view.snapshot,
                  entries: mergeEntries(view.entries, logs.entries, logLimit),
                  logsHydrated: true,
                  logError: null,
                }
              }),
            ),
          )
        } catch (error) {
          if (
            activeContextRef.current?.generation !== generation ||
            renderedContextKeyRef.current !== key
          ) {
            return
          }

          setJobs((current) =>
            current.map((view) =>
              view.snapshot.jobId === jobId
                ? {
                    ...view,
                    logsHydrated: true,
                    logError: errorMessage(error),
                  }
                : view,
            ),
          )
        }
      })().finally(() => {
        if (inFlightReadsRef.current.get(readKey) === request) {
          inFlightReadsRef.current.delete(readKey)
        }
      })

      inFlightReadsRef.current.set(readKey, request)
      return request
    },
    [logLimit, service, setJobs],
  )

  const effectivePollInterval =
    pollIntervalMs ?? pollIntervalOverride() ?? DEFAULT_POLL_INTERVAL_MS

  useEffect(() => {
    const context = activeContextRef.current
    if (!context || context.key !== contextKey) return undefined

    const pending = jobs.filter(
      (view) =>
        activeStatuses.has(view.snapshot.status) ||
        !view.logsHydrated ||
        !view.snapshot.logsComplete,
    )
    if (pending.length === 0) return undefined

    const timer = window.setTimeout(() => {
      for (const view of pending) {
        void readJob(view.snapshot.jobId, context.generation, context.key)
      }
    }, effectivePollInterval)

    return () => window.clearTimeout(timer)
  }, [contextKey, effectivePollInterval, jobs, readJob])

  const cancelJob = useCallback(
    async (jobId: number) => {
      const context = activeContextRef.current
      const view = jobsRef.current.find(
        (candidate) => candidate.snapshot.jobId === jobId,
      )
      if (
        !context ||
        !view ||
        view.snapshot.status !== 'running' ||
        inFlightCancelsRef.current.has(`${context.generation}:${jobId}`)
      ) {
        return
      }

      const { generation, key, project: activeProject } = context
      const cancelKey = `${generation}:${jobId}`
      inFlightCancelsRef.current.add(cancelKey)
      setJobs((current) =>
        current.map((candidate) =>
          candidate.snapshot.jobId === jobId
            ? {
                ...candidate,
                cancelPending: true,
                actionError: null,
              }
            : candidate,
        ),
      )

      try {
        const snapshot = await service.cancelProjectJob(activeProject, jobId)
        if (
          activeContextRef.current?.generation !== generation ||
          renderedContextKeyRef.current !== key
        ) {
          return
        }

        setJobs((current) =>
          boundViews(
            current.map((candidate) =>
              candidate.snapshot.jobId === jobId
                ? {
                    ...candidate,
                    snapshot: shouldApplySnapshotMetadata(candidate.snapshot, snapshot)
                      ? { ...candidate.snapshot, ...snapshot }
                      : candidate.snapshot,
                    cancelPending: false,
                  }
                : candidate,
            ),
            listLimit,
          ),
        )
      } catch (error) {
        if (
          activeContextRef.current?.generation !== generation ||
          renderedContextKeyRef.current !== key
        ) {
          return
        }

        setJobs((current) =>
          current.map((candidate) =>
            candidate.snapshot.jobId === jobId
              ? {
                  ...candidate,
                  cancelPending: false,
                  actionError: errorMessage(error),
                }
              : candidate,
          ),
        )
      } finally {
        inFlightCancelsRef.current.delete(cancelKey)
      }
    },
    [listLimit, service, setJobs],
  )

  const visibleJobs = jobs.filter(
    (view) =>
      `${view.projectPath}\u0000${view.sessionId ?? ''}` === contextKey,
  )

  return { jobs: visibleJobs, hydrateProject, registerJobs, cancelJob }
}
