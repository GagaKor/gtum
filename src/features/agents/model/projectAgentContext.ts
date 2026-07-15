export type AgentContextOwner = {
  projectPath: string
  sessionId: string
}

export type AgentRequestPhase = 'idle' | 'running' | 'stopped'

export type AgentRequestState = {
  generation: number
  phase: AgentRequestPhase
  turnId: string | null
  activity: string[]
}

export type AgentRequestToken = AgentContextOwner & {
  contextKey: string
  generation: number
}

export type ProjectCloseToken = {
  projectPath: string
  generation: number
}

export type AgentContextCoordinator = {
  beginRequest(owner: AgentContextOwner): AgentRequestToken
  tryBeginRequest(owner: AgentContextOwner): AgentRequestToken | null
  finishRequest(token: AgentRequestToken): boolean
  stopRequest(owner: AgentContextOwner): number
  isRequestCurrent(token: AgentRequestToken): boolean
  hasRequestInFlight(owner: AgentContextOwner): boolean
  beginPermission(owner: AgentContextOwner, suggestionId: string): boolean
  finishPermission(owner: AgentContextOwner, suggestionId: string): void
  hasPermissionInFlight(owner: AgentContextOwner): boolean
  noteJobCreate(owner: AgentContextOwner): number | null
  jobCreateGeneration(owner: AgentContextOwner): number
  tryBeginProjectClose(projectPath: string): ProjectCloseToken | null
  finishProjectClose(token: ProjectCloseToken): boolean
  isProjectClosing(projectPath: string): boolean
  clearContext(owner: AgentContextOwner): void
}

const nonBlank = (value: string, label: string): string => {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw new Error(`${label} must not be blank.`)
  return normalized
}

export const projectAgentContextKey = (owner: AgentContextOwner): string => {
  const projectPath = nonBlank(owner.projectPath, 'Agent project path')
  const sessionId = nonBlank(owner.sessionId, 'Agent session id')
  return `${projectPath}\u0000${sessionId}`
}

const permissionKey = (owner: AgentContextOwner, suggestionId: string): string =>
  `${projectAgentContextKey(owner)}\u0000${nonBlank(suggestionId, 'Suggestion id')}`

export const createAgentRequestState = (): AgentRequestState => ({
  generation: 0,
  phase: 'idle',
  turnId: null,
  activity: [],
})

export const beginAgentRequest = (
  current: AgentRequestState,
  generation: number,
  turnId: string,
  activity: string[],
): AgentRequestState => ({
  ...current,
  generation,
  phase: 'running',
  turnId: nonBlank(turnId, 'Agent turn id'),
  activity: [...activity],
})

export const updateAgentRequestActivity = (
  current: AgentRequestState,
  generation: number,
  activity: string[],
): AgentRequestState =>
  current.phase === 'running' && current.generation === generation
    ? { ...current, activity: [...activity] }
    : current

export const completeAgentRequest = (
  current: AgentRequestState,
  generation: number,
): AgentRequestState =>
  current.phase === 'running' && current.generation === generation
    ? {
        generation,
        phase: 'idle',
        turnId: null,
        activity: [],
      }
    : current

export const stopAgentRequest = (
  current: AgentRequestState,
  generation: number,
): AgentRequestState =>
  current.phase === 'running'
    ? {
        ...current,
        generation,
        phase: 'stopped',
        activity: [],
      }
    : current

export const createAgentContextCoordinator = (): AgentContextCoordinator => {
  const requestGenerations = new Map<string, number>()
  const requestLeases = new Set<string>()
  const permissionKeys = new Set<string>()
  const jobCreateGenerations = new Map<string, number>()
  const projectCloseGenerations = new Map<string, number>()
  const projectCloseLeases = new Map<string, number>()

  const ownerPrefix = (projectPath: string): string =>
    `${nonBlank(projectPath, 'Agent project path')}\u0000`
  const hasProjectWork = (projectPath: string): boolean => {
    const prefix = ownerPrefix(projectPath)
    return [...requestLeases].some((key) => key.startsWith(prefix)) ||
      [...permissionKeys].some((key) => key.startsWith(prefix))
  }
  const isProjectClosing = (projectPath: string): boolean =>
    projectCloseLeases.has(nonBlank(projectPath, 'Agent project path'))

  const requestGeneration = (owner: AgentContextOwner): number =>
    requestGenerations.get(projectAgentContextKey(owner)) ?? 0

  const beginRequest = (owner: AgentContextOwner): AgentRequestToken => {
    if (isProjectClosing(owner.projectPath)) {
      throw new Error(`Agent project is closing: ${owner.projectPath}`)
    }
    const contextKey = projectAgentContextKey(owner)
    const generation = requestGeneration(owner) + 1
    requestGenerations.set(contextKey, generation)
    requestLeases.add(contextKey)
    return {
      projectPath: owner.projectPath,
      sessionId: owner.sessionId,
      contextKey,
      generation,
    }
  }

  return {
    beginRequest,
    tryBeginRequest(owner) {
      const contextKey = projectAgentContextKey(owner)
      if (requestLeases.has(contextKey) || isProjectClosing(owner.projectPath)) return null
      return beginRequest(owner)
    },
    finishRequest(token) {
      if (
        !requestLeases.has(token.contextKey) ||
        requestGeneration(token) !== token.generation
      ) return false
      requestLeases.delete(token.contextKey)
      return true
    },
    stopRequest(owner) {
      const contextKey = projectAgentContextKey(owner)
      const generation = requestGeneration(owner) + 1
      requestGenerations.set(contextKey, generation)
      requestLeases.delete(contextKey)
      return generation
    },
    isRequestCurrent(token) {
      return requestGeneration(token) === token.generation
    },
    hasRequestInFlight(owner) {
      return requestLeases.has(projectAgentContextKey(owner))
    },
    beginPermission(owner, suggestionId) {
      if (isProjectClosing(owner.projectPath)) return false
      const key = permissionKey(owner, suggestionId)
      if (permissionKeys.has(key)) return false
      permissionKeys.add(key)
      return true
    },
    finishPermission(owner, suggestionId) {
      permissionKeys.delete(permissionKey(owner, suggestionId))
    },
    hasPermissionInFlight(owner) {
      const prefix = `${projectAgentContextKey(owner)}\u0000`
      return [...permissionKeys].some((key) => key.startsWith(prefix))
    },
    noteJobCreate(owner) {
      if (isProjectClosing(owner.projectPath)) return null
      const key = projectAgentContextKey(owner)
      const generation = (jobCreateGenerations.get(key) ?? 0) + 1
      jobCreateGenerations.set(key, generation)
      return generation
    },
    jobCreateGeneration(owner) {
      return jobCreateGenerations.get(projectAgentContextKey(owner)) ?? 0
    },
    tryBeginProjectClose(projectPathValue) {
      const projectPath = nonBlank(projectPathValue, 'Agent project path')
      if (projectCloseLeases.has(projectPath) || hasProjectWork(projectPath)) return null
      const generation = (projectCloseGenerations.get(projectPath) ?? 0) + 1
      projectCloseGenerations.set(projectPath, generation)
      projectCloseLeases.set(projectPath, generation)
      return { projectPath, generation }
    },
    finishProjectClose(token) {
      if (projectCloseLeases.get(token.projectPath) !== token.generation) return false
      projectCloseLeases.delete(token.projectPath)
      return true
    },
    isProjectClosing,
    clearContext(owner) {
      const contextKey = projectAgentContextKey(owner)
      const prefix = `${contextKey}\u0000`
      requestGenerations.delete(contextKey)
      requestLeases.delete(contextKey)
      jobCreateGenerations.delete(contextKey)
      for (const key of permissionKeys) {
        if (key.startsWith(prefix)) permissionKeys.delete(key)
      }
    },
  }
}
