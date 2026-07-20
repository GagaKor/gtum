export type AgentContextOwner = {
  projectPath: string
  sessionId: string
}

export const AGENT_SESSION_DIRECTORY_V1_STORAGE_KEY = 'gtum.agent-session-directory.v1'
export const AGENT_SESSION_DIRECTORY_V2_STORAGE_KEY = 'gtum.agent-session-directory.v2'

export type AgentSessionProviderId = 'codex' | 'claude'

export type AgentSessionProfile = {
  provider: AgentSessionProviderId
  accountId: string
  isDefault: boolean
  profileKind: { kind: 'ambient' | 'codex_home' | 'claude_config_dir' }
}

export type AgentSessionProfileSnapshot = {
  profiles: readonly AgentSessionProfile[]
  tombstones: readonly { provider: AgentSessionProviderId; accountId: string }[]
}

export type AgentSessionSelectedAccountIds = Partial<Record<AgentSessionProviderId, string>>
export type AgentSessionAccountValues<T> = Partial<
  Record<AgentSessionProviderId, Record<string, T>>
>
export type AgentSessionStringPreferences = AgentSessionAccountValues<string>
export type AgentSessionFastPreferences = AgentSessionAccountValues<boolean>

export type PersistedAgentSessionV2 = {
  id: string
  title: string
  createdAt?: string
  updatedAt?: string
  providerId: AgentSessionProviderId
  selectedAccountIds: AgentSessionSelectedAccountIds
  selectedModels: AgentSessionStringPreferences
  selectedReasoningLevels: AgentSessionStringPreferences
  fastModes: AgentSessionFastPreferences
}

export type PersistedAgentWorkspaceV2 = {
  workspaceTitle: string
  activeSessionId: string
  sessions: PersistedAgentSessionV2[]
}

export type PersistedAgentSessionDirectoryV2 = Record<string, PersistedAgentWorkspaceV2>

export type AgentSessionDirectoryHydrationV2 = {
  directory: PersistedAgentSessionDirectoryV2
  source: 'absent' | 'v1' | 'v2' | 'unavailable'
  observedWorkspaceKeys: readonly string[] | null
}

export type AgentSessionDirectoryStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const sessionProviders = ['codex', 'claude'] as const
const maxU64 = 18_446_744_073_709_551_615n
const maxAccountIdBytes = 64
const maxModelIdLength = 128
const maxReasoningLevelBytes = 16

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null && !Array.isArray(value)

export const agentSessionAccountValue = <T>(
  values: AgentSessionAccountValues<T> | null | undefined,
  provider: AgentSessionProviderId,
  accountId: string | null | undefined,
): T | null => {
  if (!accountId) return null
  const providerValues = values?.[provider]
  if (!isRecord(providerValues)) return null
  return Object.prototype.hasOwnProperty.call(providerValues, accountId)
    ? providerValues[accountId] as T
    : null
}

export const withAgentSessionAccountValue = <T>(
  values: AgentSessionAccountValues<T> | null | undefined,
  provider: AgentSessionProviderId,
  accountId: string | null | undefined,
  value: T,
): AgentSessionAccountValues<T> => {
  if (!accountId) return values ?? {}
  const providerValues = values?.[provider]
  const safeProviderValues = isRecord(providerValues)
    ? providerValues as Record<string, T>
    : {}
  return {
    ...(values ?? {}),
    [provider]: {
      ...safeProviderValues,
      [accountId]: value,
    },
  }
}

export const withoutAgentSessionAccountValue = <T>(
  values: AgentSessionAccountValues<T> | null | undefined,
  provider: AgentSessionProviderId,
  accountId: string | null | undefined,
): AgentSessionAccountValues<T> => {
  if (!accountId) return values ?? {}
  const providerValues = values?.[provider]
  if (!isRecord(providerValues)) return values ?? {}

  const nextProviderValues = { ...providerValues }
  delete nextProviderValues[accountId]
  const nextValues: Record<string, unknown> = { ...(values ?? {}) }
  if (Object.keys(nextProviderValues).length > 0) {
    nextValues[provider] = nextProviderValues
  } else {
    delete nextValues[provider]
  }
  return nextValues as AgentSessionAccountValues<T>
}

const utf8Length = (value: string): number => new TextEncoder().encode(value).byteLength

const isCanonicalAccountId = (
  provider: AgentSessionProviderId,
  accountId: string,
): boolean => {
  if (utf8Length(accountId) > maxAccountIdBytes) return false
  if (accountId === `${provider}-default`) return true

  const prefix = `${provider}-profile-`
  if (!accountId.startsWith(prefix)) return false
  const suffix = accountId.slice(prefix.length)
  if (!/^[1-9a-z][0-9a-z]*$/.test(suffix)) return false

  let counter = 0n
  for (const character of suffix) {
    const code = character.charCodeAt(0)
    const digit = code >= 48 && code <= 57 ? code - 48 : code - 87
    counter = counter * 36n + BigInt(digit)
    if (counter > maxU64) return false
  }
  return counter > 0n
}

const sanitizeV2Provider = (value: unknown): AgentSessionProviderId | null =>
  value === 'codex' || value === 'claude' ? value : null

const migrateV1Provider = (value: unknown): AgentSessionProviderId | null =>
  value === undefined ? 'codex' : sanitizeV2Provider(value)

const sanitizeModelId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized && normalized.length <= maxModelIdLength ? normalized : null
}

const sanitizeReasoningLevel = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized && utf8Length(normalized) <= maxReasoningLevelBytes ? normalized : null
}

const sanitizeSelectedAccountIds = (value: unknown): AgentSessionSelectedAccountIds => {
  if (!isRecord(value)) return {}

  return Object.fromEntries(sessionProviders.flatMap((provider) => {
    const accountId = value[provider]
    return typeof accountId === 'string' && isCanonicalAccountId(provider, accountId)
      ? [[provider, accountId]]
      : []
  }))
}

const sanitizeNestedStringPreferences = (
  value: unknown,
  sanitizeValue: (value: unknown) => string | null,
): AgentSessionStringPreferences => {
  if (!isRecord(value)) return {}

  return Object.fromEntries(sessionProviders.flatMap((provider) => {
    const providerPreferences = value[provider]
    if (!isRecord(providerPreferences)) return []
    const sanitized = Object.fromEntries(Object.entries(providerPreferences).flatMap(
      ([accountId, preference]) => {
        const normalized = sanitizeValue(preference)
        return isCanonicalAccountId(provider, accountId) && normalized
          ? [[accountId, normalized]]
          : []
      },
    ))
    return Object.keys(sanitized).length > 0 ? [[provider, sanitized]] : []
  }))
}

const sanitizeNestedFastPreferences = (value: unknown): AgentSessionFastPreferences => {
  if (!isRecord(value)) return {}

  return Object.fromEntries(sessionProviders.flatMap((provider) => {
    const providerPreferences = value[provider]
    if (!isRecord(providerPreferences)) return []
    const sanitized = Object.fromEntries(Object.entries(providerPreferences).flatMap(
      ([accountId, preference]) =>
        isCanonicalAccountId(provider, accountId) && typeof preference === 'boolean'
          ? [[accountId, preference]]
          : [],
    ))
    return Object.keys(sanitized).length > 0 ? [[provider, sanitized]] : []
  }))
}

const sanitizeSessionMetadata = (
  value: unknown,
  sanitizeProvider: (value: unknown) => AgentSessionProviderId | null,
): Pick<PersistedAgentSessionV2, 'id' | 'title' | 'createdAt' | 'updatedAt' | 'providerId'> | null => {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const title = typeof value.title === 'string' ? value.title.trim() : ''
  const providerId = sanitizeProvider(value.providerId)
  if (!id || !title || !providerId) return null

  return {
    id,
    title,
    ...(typeof value.createdAt === 'string' ? { createdAt: value.createdAt } : {}),
    ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
    providerId,
  }
}

const sanitizeV2Session = (value: unknown): PersistedAgentSessionV2 | null => {
  const metadata = sanitizeSessionMetadata(value, sanitizeV2Provider)
  if (!metadata || !isRecord(value)) return null

  return {
    ...metadata,
    selectedAccountIds: sanitizeSelectedAccountIds(value.selectedAccountIds),
    selectedModels: sanitizeNestedStringPreferences(value.selectedModels, sanitizeModelId),
    selectedReasoningLevels: sanitizeNestedStringPreferences(
      value.selectedReasoningLevels,
      sanitizeReasoningLevel,
    ),
    fastModes: sanitizeNestedFastPreferences(value.fastModes),
  }
}

const sanitizeDirectory = (
  value: unknown,
  sanitizeSession: (value: unknown) => PersistedAgentSessionV2 | null,
): PersistedAgentSessionDirectoryV2 => {
  if (!isRecord(value)) return {}

  return Object.fromEntries(Object.entries(value).flatMap(([workspaceKey, workspaceValue]) => {
    if (!workspaceKey.trim() || !isRecord(workspaceValue) || !Array.isArray(workspaceValue.sessions)) {
      return []
    }
    const seenSessionIds = new Set<string>()
    const sessions = workspaceValue.sessions.flatMap((sessionValue) => {
      const session = sanitizeSession(sessionValue)
      if (!session || seenSessionIds.has(session.id)) return []
      seenSessionIds.add(session.id)
      return [session]
    })
    if (sessions.length === 0) return []
    const requestedActiveSessionId = typeof workspaceValue.activeSessionId === 'string'
      ? workspaceValue.activeSessionId
      : ''
    const activeSessionId = sessions.some((session) => session.id === requestedActiveSessionId)
      ? requestedActiveSessionId
      : sessions[0].id

    return [[workspaceKey, {
      workspaceTitle: typeof workspaceValue.workspaceTitle === 'string'
        ? workspaceValue.workspaceTitle
        : workspaceKey,
      activeSessionId,
      sessions,
    }]]
  }))
}

const reservedAmbientAccountId = (
  snapshot: AgentSessionProfileSnapshot | null,
  provider: AgentSessionProviderId,
): string | null => {
  if (!snapshot || !Array.isArray(snapshot.profiles)) return null
  const accountId = `${provider}-default`
  const matches = snapshot.profiles.filter((profile) =>
    profile.provider === provider &&
    profile.accountId === accountId &&
    profile.profileKind?.kind === 'ambient')
  return matches.length === 1 ? accountId : null
}

const migrateFlatStringPreferences = (
  value: unknown,
  snapshot: AgentSessionProfileSnapshot | null,
  sanitizeValue: (value: unknown) => string | null,
): AgentSessionStringPreferences => {
  if (!isRecord(value)) return {}

  return Object.fromEntries(sessionProviders.flatMap((provider) => {
    const accountId = reservedAmbientAccountId(snapshot, provider)
    const preference = sanitizeValue(value[provider])
    return accountId && preference ? [[provider, { [accountId]: preference }]] : []
  }))
}

const migrateFlatFastPreferences = (
  value: unknown,
  snapshot: AgentSessionProfileSnapshot | null,
): AgentSessionFastPreferences => {
  if (!isRecord(value)) return {}

  return Object.fromEntries(sessionProviders.flatMap((provider) => {
    const accountId = reservedAmbientAccountId(snapshot, provider)
    const preference = value[provider]
    return accountId && typeof preference === 'boolean'
      ? [[provider, { [accountId]: preference }]]
      : []
  }))
}

const migrateV1Session = (
  value: unknown,
  snapshot: AgentSessionProfileSnapshot | null,
): PersistedAgentSessionV2 | null => {
  const metadata = sanitizeSessionMetadata(value, migrateV1Provider)
  if (!metadata || !isRecord(value)) return null
  const activeAccountId = reservedAmbientAccountId(snapshot, metadata.providerId)

  return {
    ...metadata,
    selectedAccountIds: activeAccountId
      ? { [metadata.providerId]: activeAccountId }
      : {},
    selectedModels: migrateFlatStringPreferences(value.selectedModels, snapshot, sanitizeModelId),
    selectedReasoningLevels: migrateFlatStringPreferences(
      value.selectedReasoningLevels,
      snapshot,
      sanitizeReasoningLevel,
    ),
    fastModes: migrateFlatFastPreferences(value.fastModes, snapshot),
  }
}

const parseStoredValue = (raw: string | null): { present: boolean; value: unknown } => {
  if (raw == null) return { present: false, value: null }
  try {
    const value: unknown = JSON.parse(raw)
    return { present: true, value }
  } catch {
    return { present: true, value: null }
  }
}

export const persistAgentSessionDirectoryV2 = (
  storage: AgentSessionDirectoryStorage,
  directory: PersistedAgentSessionDirectoryV2,
): boolean => {
  const sanitized = sanitizeDirectory(directory, sanitizeV2Session)
  try {
    storage.setItem(AGENT_SESSION_DIRECTORY_V2_STORAGE_KEY, JSON.stringify(sanitized))
  } catch {
    return false
  }

  try {
    storage.removeItem(AGENT_SESSION_DIRECTORY_V1_STORAGE_KEY)
  } catch {
    // A valid v2 value is already authoritative. A later startup retries legacy cleanup.
  }
  return true
}

export const hydrateAgentSessionDirectoryStateV2 = (
  storage: AgentSessionDirectoryStorage,
  snapshot: AgentSessionProfileSnapshot | null,
): AgentSessionDirectoryHydrationV2 => {
  let storedV2: { present: boolean; value: unknown }
  try {
    storedV2 = parseStoredValue(storage.getItem(AGENT_SESSION_DIRECTORY_V2_STORAGE_KEY))
  } catch {
    return { directory: {}, source: 'unavailable', observedWorkspaceKeys: null }
  }
  if (storedV2.present) {
    const directory = isRecord(storedV2.value)
      ? sanitizeDirectory(storedV2.value, sanitizeV2Session)
      : {}
    if (isRecord(storedV2.value)) {
      try {
        storage.removeItem(AGENT_SESSION_DIRECTORY_V1_STORAGE_KEY)
      } catch {
        // Existing valid v2 remains authoritative even if legacy cleanup is unavailable.
      }
    }
    return {
      directory,
      source: 'v2',
      observedWorkspaceKeys: isRecord(storedV2.value)
        ? Object.keys(storedV2.value)
        : null,
    }
  }

  let storedV1: { present: boolean; value: unknown }
  try {
    storedV1 = parseStoredValue(storage.getItem(AGENT_SESSION_DIRECTORY_V1_STORAGE_KEY))
  } catch {
    return { directory: {}, source: 'unavailable', observedWorkspaceKeys: null }
  }
  if (!storedV1.present) {
    return { directory: {}, source: 'absent', observedWorkspaceKeys: [] }
  }
  if (!isRecord(storedV1.value)) {
    return { directory: {}, source: 'v1', observedWorkspaceKeys: null }
  }

  const migrated = sanitizeDirectory(
    storedV1.value,
    (session) => migrateV1Session(session, snapshot),
  )
  persistAgentSessionDirectoryV2(storage, migrated)
  return {
    directory: migrated,
    source: 'v1',
    observedWorkspaceKeys: Object.keys(storedV1.value),
  }
}

export const hydrateAgentSessionDirectoryV2 = (
  storage: AgentSessionDirectoryStorage,
  snapshot: AgentSessionProfileSnapshot | null,
): PersistedAgentSessionDirectoryV2 =>
  hydrateAgentSessionDirectoryStateV2(storage, snapshot).directory

export const canAssignDefaultToHydratedWorkspace = (
  hydration: AgentSessionDirectoryHydrationV2 | null,
  workspaceKey: string,
): boolean => {
  if (!hydration) return false
  if (hydration.source === 'absent') return true
  return hydration.observedWorkspaceKeys != null &&
    !hydration.observedWorkspaceKeys.includes(workspaceKey)
}

export const newAgentSessionAccountSelection = (
  provider: AgentSessionProviderId,
  snapshot: AgentSessionProfileSnapshot | null,
): AgentSessionSelectedAccountIds => {
  if (!snapshot || !Array.isArray(snapshot.profiles)) return {}
  const defaults = snapshot.profiles.filter((profile) =>
    profile.provider === provider &&
    profile.isDefault === true &&
    isCanonicalAccountId(provider, profile.accountId))
  return defaults.length === 1 ? { [provider]: defaults[0].accountId } : {}
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

export type AgentAccountOwner = {
  provider: AgentSessionProviderId
  accountId: string
}

export type AgentProfileLease = AgentAccountOwner & {
  incarnation: string
  credentialRevision: string
}

export type AgentLeaseGenerationToken = {
  ownerKey: string
  leaseKey: string
  generation: number
}

export type AgentLeaseGenerationCoordinator = {
  begin(lease: AgentProfileLease): AgentLeaseGenerationToken
  isCurrent(token: AgentLeaseGenerationToken): boolean
  invalidateOwner(owner: AgentAccountOwner): void
  reconcile(leases: readonly AgentProfileLease[]): void
  slotCount(): number
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

export const agentAccountOwnerKey = (owner: AgentAccountOwner): string => {
  const provider = nonBlank(owner.provider, 'Agent provider')
  const accountId = nonBlank(owner.accountId, 'Agent account id')
  return `${provider}\u0000${accountId}`
}

export const agentProfileLeaseKey = (lease: AgentProfileLease): string => {
  const incarnation = nonBlank(lease.incarnation, 'Agent profile incarnation')
  const credentialRevision = nonBlank(
    lease.credentialRevision,
    'Agent profile credential revision',
  )
  return `${agentAccountOwnerKey(lease)}\u0000${incarnation}\u0000${credentialRevision}`
}

export const createAgentLeaseGenerationCoordinator = (
  maxSlots = 64,
): AgentLeaseGenerationCoordinator => {
  if (!Number.isInteger(maxSlots) || maxSlots < 1) {
    throw new Error('Agent lease generation slot limit must be a positive integer.')
  }

  const generations = new Map<string, number>()
  const leaseOwners = new Map<string, string>()
  const currentLeaseByOwner = new Map<string, string>()
  let nextGeneration = 0

  const removeLease = (leaseKey: string) => {
    const ownerKey = leaseOwners.get(leaseKey)
    generations.delete(leaseKey)
    leaseOwners.delete(leaseKey)
    if (ownerKey && currentLeaseByOwner.get(ownerKey) === leaseKey) {
      currentLeaseByOwner.delete(ownerKey)
    }
  }
  const invalidateOwnerKey = (ownerKey: string) => {
    const leaseKey = currentLeaseByOwner.get(ownerKey)
    if (leaseKey) removeLease(leaseKey)
  }
  const prune = () => {
    while (generations.size > maxSlots) {
      const oldestLeaseKey = generations.keys().next().value
      if (typeof oldestLeaseKey !== 'string') break
      removeLease(oldestLeaseKey)
    }
  }

  return {
    begin(lease) {
      const ownerKey = agentAccountOwnerKey(lease)
      const leaseKey = agentProfileLeaseKey(lease)
      const previousLeaseKey = currentLeaseByOwner.get(ownerKey)
      if (previousLeaseKey && previousLeaseKey !== leaseKey) {
        removeLease(previousLeaseKey)
      }
      nextGeneration += 1
      generations.delete(leaseKey)
      generations.set(leaseKey, nextGeneration)
      leaseOwners.set(leaseKey, ownerKey)
      currentLeaseByOwner.set(ownerKey, leaseKey)
      prune()
      return { ownerKey, leaseKey, generation: nextGeneration }
    },
    isCurrent(token) {
      return generations.get(token.leaseKey) === token.generation &&
        currentLeaseByOwner.get(token.ownerKey) === token.leaseKey
    },
    invalidateOwner(owner) {
      invalidateOwnerKey(agentAccountOwnerKey(owner))
    },
    reconcile(leases) {
      const validLeaseByOwner = new Map<string, string>()
      const ambiguousOwners = new Set<string>()
      for (const lease of leases) {
        const ownerKey = agentAccountOwnerKey(lease)
        const leaseKey = agentProfileLeaseKey(lease)
        const previousLeaseKey = validLeaseByOwner.get(ownerKey)
        if (previousLeaseKey && previousLeaseKey !== leaseKey) {
          ambiguousOwners.add(ownerKey)
        } else {
          validLeaseByOwner.set(ownerKey, leaseKey)
        }
      }
      for (const ownerKey of ambiguousOwners) validLeaseByOwner.delete(ownerKey)

      for (const [ownerKey, currentLeaseKey] of [...currentLeaseByOwner]) {
        if (validLeaseByOwner.get(ownerKey) !== currentLeaseKey) {
          invalidateOwnerKey(ownerKey)
        }
      }
      prune()
    },
    slotCount() {
      return generations.size
    },
  }
}

export const cloneAndDeepFreezeAgentTurn = <T>(value: T): Readonly<T> => {
  const clones = new WeakMap<object, object>()
  const clone = (candidate: unknown): unknown => {
    if (candidate == null || typeof candidate !== 'object') return candidate
    const existing = clones.get(candidate)
    if (existing) return existing

    if (Array.isArray(candidate)) {
      const result: unknown[] = []
      clones.set(candidate, result)
      for (const entry of candidate) result.push(clone(entry))
      return Object.freeze(result)
    }

    const result: Record<string, unknown> = {}
    clones.set(candidate, result)
    for (const [key, entry] of Object.entries(candidate)) {
      result[key] = clone(entry)
    }
    return Object.freeze(result)
  }

  return clone(value) as Readonly<T>
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
