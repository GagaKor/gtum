import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  agentJobRuntimeService,
  type AgentJobRuntimeService,
  type AgentJobSnapshot,
} from '../../../shared/api/runtimeAgentJobs'
import type { RuntimeProject } from '../../../shared/api/runtimeProjects'
import {
  createProjectAgentFleetPoller,
  createProjectAgentFleetState,
  mergeProjectAgentFleetJobs,
  normalizeProjectAgentFleetPollInterval,
  pruneProjectAgentFleet,
  type ProjectAgentFleetPoller,
  type ProjectAgentFleetState,
} from './projectAgentFleet'

const DEFAULT_FLEET_POLL_INTERVAL_MS = 5_000
const MAX_PROJECT_JOB_SNAPSHOTS = 100

type FleetProject = Pick<RuntimeProject, 'path' | 'runtimeBacked'>

export type UseProjectAgentFleetOptions = {
  projects: FleetProject[]
  service?: AgentJobRuntimeService
  pollIntervalMs?: number
  listLimit?: number
}

export type ProjectAgentFleetOwner = {
  projectPath: string
  sessionId?: string | null
}

export type UseProjectAgentFleetResult = {
  fleet: ProjectAgentFleetState
  registerJobs(
    snapshots: AgentJobSnapshot[],
    owner: ProjectAgentFleetOwner,
  ): void
}

const pollIntervalOverride = (): number | undefined => {
  if (typeof window === 'undefined') return undefined
  const value = (
    window as Window & { __GTUM_AGENT_FLEET_POLL_INTERVAL_MS__?: unknown }
  ).__GTUM_AGENT_FLEET_POLL_INTERVAL_MS__

  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? value
    : undefined
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export function useProjectAgentFleet({
  projects,
  service = agentJobRuntimeService,
  pollIntervalMs,
  listLimit = MAX_PROJECT_JOB_SNAPSHOTS,
}: UseProjectAgentFleetOptions): UseProjectAgentFleetResult {
  const openPathsKey = [...new Set(projects
    .filter((project) => project.runtimeBacked && project.path)
    .map((project) => project.path))]
    .sort()
    .join('\u0000')
  const normalizedProjects = useMemo<FleetProject[]>(() =>
    openPathsKey
      ? openPathsKey.split('\u0000').map((path) => ({ path, runtimeBacked: true }))
      : [],
  [openPathsKey])
  const projectsRef = useRef(normalizedProjects)
  const openPathsRef = useRef(new Set(normalizedProjects.map((project) => project.path)))

  const pollerRef = useRef<ProjectAgentFleetPoller | null>(null)
  const [fleet, setFleetState] = useState(createProjectAgentFleetState)
  const commitFleet = useCallback((
    update: (current: ProjectAgentFleetState) => ProjectAgentFleetState,
  ) => {
    setFleetState((current) => update(current))
  }, [])

  useEffect(() => {
    const openPaths = new Set(normalizedProjects.map((project) => project.path))
    projectsRef.current = normalizedProjects
    openPathsRef.current = openPaths
    const pruneTimer = setTimeout(() => {
      commitFleet((current) => pruneProjectAgentFleet(current, openPaths))
    }, 0)
    pollerRef.current?.wake()
    return () => clearTimeout(pruneTimer)
  }, [commitFleet, normalizedProjects])

  const effectiveInterval = normalizeProjectAgentFleetPollInterval(
    pollIntervalMs ?? pollIntervalOverride() ?? DEFAULT_FLEET_POLL_INTERVAL_MS,
    DEFAULT_FLEET_POLL_INTERVAL_MS,
  )
  const effectiveListLimit = Number.isFinite(listLimit)
    ? Math.min(MAX_PROJECT_JOB_SNAPSHOTS, Math.max(1, listLimit))
    : MAX_PROJECT_JOB_SNAPSHOTS

  useEffect(() => {
    const poller = createProjectAgentFleetPoller({
      getProjects: () => projectsRef.current,
      listProjectJobs: (project, limit) =>
        service.listProjectJobs(project, limit),
      onSnapshot: (projectPath, snapshots) => {
        if (!openPathsRef.current.has(projectPath)) return
        commitFleet((current) => {
          const merged = mergeProjectAgentFleetJobs(
            current,
            projectPath,
            snapshots,
            effectiveListLimit,
          )
          const entry = merged.projectsByPath[projectPath]
          if (!entry?.listError) return merged
          return {
            projectsByPath: {
              ...merged.projectsByPath,
              [projectPath]: { ...entry, listError: null },
            },
          }
        })
      },
      onError: (projectPath, error) => {
        if (!openPathsRef.current.has(projectPath)) return
        commitFleet((current) => {
          const existing = current.projectsByPath[projectPath]
          return {
            projectsByPath: {
              ...current.projectsByPath,
              [projectPath]: {
                projectPath,
                jobs: existing?.jobs ?? [],
                listError: errorMessage(error),
              },
            },
          }
        })
      },
      pollIntervalMs: effectiveInterval,
      listLimit: effectiveListLimit,
    })
    pollerRef.current = poller
    poller.start()

    return () => {
      poller.stop()
      if (pollerRef.current === poller) pollerRef.current = null
    }
  }, [commitFleet, effectiveInterval, effectiveListLimit, service])

  const registerJobs = useCallback((
    snapshots: AgentJobSnapshot[],
    owner: ProjectAgentFleetOwner,
  ) => {
    if (!openPathsRef.current.has(owner.projectPath)) return
    const ownedSnapshots = owner.sessionId == null
      ? snapshots
      : snapshots.filter((snapshot) => snapshot.sessionId === owner.sessionId)
    if (ownedSnapshots.length === 0) return
    commitFleet((current) => mergeProjectAgentFleetJobs(
      current,
      owner.projectPath,
      ownedSnapshots,
      effectiveListLimit,
    ))
  }, [commitFleet, effectiveListLimit])

  return { fleet, registerJobs }
}
