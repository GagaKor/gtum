import type {
  AgentJobRuntimeService,
  AgentJobSnapshot,
} from '../../../shared/api/runtimeAgentJobs'

const MAX_PROJECT_JOBS = 100
const terminalStatuses = new Set(['completed', 'failed', 'cancelled', 'interrupted'])

export const normalizeProjectAgentFleetPollInterval = (
  value: number,
  fallback = 1_000,
): number => Number.isFinite(value)
  ? Math.max(1, value)
  : Math.max(1, fallback)

export type ProjectAgentFleetEntry = {
  projectPath: string
  jobs: AgentJobSnapshot[]
  listError: string | null
}

export type ProjectAgentFleetState = {
  projectsByPath: Record<string, ProjectAgentFleetEntry>
}

export const createProjectAgentFleetState = (): ProjectAgentFleetState => ({
  projectsByPath: {},
})

const shouldApplySnapshot = (
  current: AgentJobSnapshot,
  incoming: AgentJobSnapshot,
): boolean => {
  if (incoming.updatedAt < current.updatedAt) return false
  if (terminalStatuses.has(current.status) && incoming.status !== current.status) {
    return false
  }
  if (current.status === 'cancelling' && incoming.status === 'running') return false
  return true
}

export const mergeProjectAgentFleetJobs = (
  current: ProjectAgentFleetState,
  projectPath: string,
  incoming: AgentJobSnapshot[],
  limit = MAX_PROJECT_JOBS,
): ProjectAgentFleetState => {
  const normalizedPath = String(projectPath ?? '').trim()
  if (!normalizedPath) return current

  const existing = current.projectsByPath[normalizedPath]
  const jobsById = new Map(
    (existing?.jobs ?? []).map((snapshot) => [snapshot.jobId, snapshot]),
  )
  for (const snapshot of incoming) {
    const previous = jobsById.get(snapshot.jobId)
    if (!previous || shouldApplySnapshot(previous, snapshot)) {
      jobsById.set(snapshot.jobId, { ...previous, ...snapshot })
    }
  }

  const boundedLimit = Math.min(MAX_PROJECT_JOBS, Math.max(1, limit))
  const sorted = [...jobsById.values()]
    .sort((left, right) => (
      right.updatedAt - left.updatedAt || right.jobId - left.jobId
    ))
  const active = sorted
    .filter((snapshot) =>
      snapshot.status === 'running' || snapshot.status === 'cancelling')
    .slice(0, boundedLimit)
  const activeIds = new Set(active.map((snapshot) => snapshot.jobId))
  const jobs = [...active, ...sorted
    .filter((snapshot) => !activeIds.has(snapshot.jobId))
    .slice(0, Math.max(0, boundedLimit - active.length))]
    .sort((left, right) => (
      right.updatedAt - left.updatedAt || right.jobId - left.jobId
    ))

  return {
    projectsByPath: {
      ...current.projectsByPath,
      [normalizedPath]: {
        projectPath: normalizedPath,
        jobs,
        listError: existing?.listError ?? null,
      },
    },
  }
}

export const pruneProjectAgentFleet = (
  current: ProjectAgentFleetState,
  openProjectPaths: ReadonlySet<string>,
): ProjectAgentFleetState => {
  const projectsByPath = Object.fromEntries(
    Object.entries(current.projectsByPath).filter(([projectPath]) =>
      openProjectPaths.has(projectPath)),
  )
  if (Object.keys(projectsByPath).length === Object.keys(current.projectsByPath).length) {
    return current
  }
  return { projectsByPath }
}

export type ProjectAgentLocalSignal = {
  runningRequest?: boolean
  jobCreateInFlight?: boolean
  pendingPermissionCount?: number
  failedRequestCount?: number
  completedRequestCount?: number
}

export type ProjectAgentSummaryState =
  | 'working'
  | 'review'
  | 'attention'
  | 'done'
  | 'waiting'

export type ProjectAgentSummary = {
  state: ProjectAgentSummaryState
  label: string
  workingCount: number
  reviewCount: number
  attentionCount: number
  doneCount: number
  jobCount: number
}

type ProjectAgentSummaryInput = {
  jobs: AgentJobSnapshot[]
  localSignals: ProjectAgentLocalSignal[]
  listError?: string | null
  detailErrorCount?: number
}

const nonNegativeCount = (value: number | undefined): number =>
  Number.isFinite(value) ? Math.max(0, Number(value)) : 0

export const summarizeProjectAgentActivity = ({
  jobs,
  localSignals,
  listError = null,
  detailErrorCount = 0,
}: ProjectAgentSummaryInput): ProjectAgentSummary => {
  const workingJobs = jobs.filter((snapshot) =>
    snapshot.status === 'running' || snapshot.status === 'cancelling').length
  const attentionJobs = jobs.filter((snapshot) =>
    snapshot.status === 'failed' ||
    snapshot.status === 'interrupted' ||
    Boolean(
      snapshot.logCaptureError ||
      snapshot.processError ||
      snapshot.persistenceError,
    )).length
  const doneJobs = jobs.filter((snapshot) =>
    snapshot.status === 'completed' || snapshot.status === 'cancelled').length

  const workingCount = workingJobs + localSignals.reduce(
    (count, signal) => count + Number(Boolean(signal.runningRequest)) +
      Number(Boolean(signal.jobCreateInFlight)),
    0,
  )
  const reviewCount = localSignals.reduce(
    (count, signal) => count + nonNegativeCount(signal.pendingPermissionCount),
    0,
  )
  const attentionCount = attentionJobs + nonNegativeCount(detailErrorCount) +
    Number(Boolean(listError)) + localSignals.reduce(
      (count, signal) => count + nonNegativeCount(signal.failedRequestCount),
      0,
    )
  const doneCount = doneJobs + localSignals.reduce(
    (count, signal) => count + nonNegativeCount(signal.completedRequestCount),
    0,
  )
  const state: ProjectAgentSummaryState = reviewCount > 0
    ? 'review'
    : attentionCount > 0
      ? 'attention'
      : workingCount > 0
        ? 'working'
        : doneCount > 0
          ? 'done'
          : 'waiting'
  const labels: Record<ProjectAgentSummaryState, string> = {
    attention: 'Needs attention',
    review: 'Review',
    working: 'Working',
    done: 'Done',
    waiting: 'Waiting',
  }

  return {
    state,
    label: labels[state],
    workingCount,
    reviewCount,
    attentionCount,
    doneCount,
    jobCount: jobs.length,
  }
}

type FleetProject = {
  path: string
  runtimeBacked: boolean
}

export type ProjectAgentFleetPollerOptions = {
  getProjects(): FleetProject[]
  listProjectJobs: AgentJobRuntimeService['listProjectJobs']
  onSnapshot(projectPath: string, snapshots: AgentJobSnapshot[]): void
  onError?(projectPath: string, error: unknown): void
  pollIntervalMs: number
  listLimit?: number
}

export type ProjectAgentFleetPoller = {
  start(): void
  wake(): void
  stop(): void
}

export const createProjectAgentFleetPoller = ({
  getProjects,
  listProjectJobs,
  onSnapshot,
  onError,
  pollIntervalMs,
  listLimit = MAX_PROJECT_JOBS,
}: ProjectAgentFleetPollerOptions): ProjectAgentFleetPoller => {
  const effectiveInterval = normalizeProjectAgentFleetPollInterval(pollIntervalMs)
  const effectiveLimit = Number.isFinite(listLimit)
    ? Math.min(MAX_PROJECT_JOBS, Math.max(1, listLimit))
    : MAX_PROJECT_JOBS
  let stopped = true
  let running = false
  let wakeRequested = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let nextProjectGeneration = 0
  const projectGenerations = new Map<string, number>()
  const inFlightByPath = new Map<string, Promise<void>>()

  const currentProjects = (): FleetProject[] => {
    const projects = new Map<string, FleetProject>()
    for (const project of getProjects()) {
      if (!project.runtimeBacked || !project.path || projects.has(project.path)) continue
      projects.set(project.path, project)
    }
    for (const projectPath of projectGenerations.keys()) {
      if (projects.has(projectPath)) continue
      projectGenerations.delete(projectPath)
    }
    for (const projectPath of projects.keys()) {
      if (projectGenerations.has(projectPath)) continue
      nextProjectGeneration += 1
      projectGenerations.set(projectPath, nextProjectGeneration)
    }
    return [...projects.values()]
  }

  const isCurrent = (projectPath: string, generation: number): boolean => {
    currentProjects()
    return projectGenerations.get(projectPath) === generation
  }

  const pollProject = (project: FleetProject): Promise<void> => {
    const existing = inFlightByPath.get(project.path)
    if (existing) return existing
    const generation = projectGenerations.get(project.path)
    if (generation == null) return Promise.resolve()

    const request = (async () => {
      try {
        const snapshots = await listProjectJobs(project, effectiveLimit)
        if (!stopped && isCurrent(project.path, generation)) {
          onSnapshot(project.path, snapshots)
        }
      } catch (error) {
        if (!stopped && isCurrent(project.path, generation)) {
          onError?.(project.path, error)
        }
      }
    })().finally(() => {
      if (inFlightByPath.get(project.path) === request) {
        inFlightByPath.delete(project.path)
      }
    })
    inFlightByPath.set(project.path, request)
    return request
  }

  const waitForCycle = async (requests: Promise<void>[]): Promise<void> => {
    if (requests.length === 0) return
    let timeout: ReturnType<typeof setTimeout> | null = null
    await Promise.race([
      Promise.allSettled(requests),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, Math.max(1, effectiveInterval))
      }),
    ])
    if (timeout !== null) clearTimeout(timeout)
  }

  const run = async (): Promise<void> => {
    if (stopped || running) return
    running = true
    try {
      await waitForCycle(currentProjects().map(pollProject))
    } finally {
      running = false
      if (!stopped && currentProjects().length > 0) {
        const delay = wakeRequested ? 0 : effectiveInterval
        wakeRequested = false
        timer = setTimeout(() => void run(), delay)
      }
    }
  }

  return {
    start() {
      if (!stopped) return
      stopped = false
      void run()
    },
    wake() {
      if (stopped) return
      currentProjects()
      if (running) {
        wakeRequested = true
        return
      }
      if (timer !== null) clearTimeout(timer)
      timer = null
      void run()
    },
    stop() {
      stopped = true
      wakeRequested = false
      if (timer !== null) clearTimeout(timer)
      timer = null
      projectGenerations.clear()
      inFlightByPath.clear()
    },
  }
}
