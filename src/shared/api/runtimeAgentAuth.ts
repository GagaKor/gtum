import { invoke } from '@tauri-apps/api/core'

import type {
  AgentAccountLease,
  AgentAccountOwner,
  AgentProviderId,
  AgentRuntimeProviderId,
} from '../../entities/agent/model/types'
import {
  hasTauriRuntime,
  type RuntimeInvoker,
} from './runtimeProjects'

export const CODEX_REQUIRED_SCOPES = ['project:read', 'terminal:read'] as const

export type RuntimeAgentConnectionStatus =
  | 'disconnected'
  | 'pending'
  | 'connected'
  | 'error'

export type RuntimeAgentConnectionKind = 'mock' | 'prototype' | 'real'
export type RuntimeAgentProviderAvailability = 'available' | 'deferred'
export type RuntimeAgentCredentialSource =
  | 'claude_cli_session'
  | 'anthropic_api_key'
  | 'api_key_helper'

export type RuntimeAgentConnectionSnapshot = {
  provider: AgentProviderId
  displayName: string
  availability: RuntimeAgentProviderAvailability
  status: RuntimeAgentConnectionStatus
  connectionKind: RuntimeAgentConnectionKind
  accountLabel?: string | null
  accountEmail?: string | null
  credentialSource?: RuntimeAgentCredentialSource | null
  requiredScopes: string[]
  expiresAt?: number | null
  callbackUrl?: string | null
  authUrl?: string | null
  activeLoginId?: string | null
  activeLoginState?: string | null
  connectedAt?: number | null
  lastLoginAttemptAt?: number | null
  updatedAt: number
  lastError?: string | null
}

export type RuntimeAgentPendingLoginSnapshot = {
  loginId: string
  provider: AgentProviderId
  state: string
  callbackUrl: string
  authUrl?: string | null
  scopes: string[]
  createdAt: number
  expiresAt: number
  consumedAt?: number | null
  lastError?: string | null
}

export type RuntimeAgentAuthSnapshot = {
  storagePath?: string | null
  supportedProviders: AgentProviderId[]
  connections: RuntimeAgentConnectionSnapshot[]
  pendingLogins: RuntimeAgentPendingLoginSnapshot[]
  lastSyncedAt: number
}

export type RuntimeAgentProfileKind =
  | { kind: 'ambient' }
  | { kind: 'codex_home' }
  | { kind: 'claude_config_dir' }

export type RuntimeAgentProfileConnection = {
  status: RuntimeAgentConnectionStatus
  requiresValidation: boolean
  credentialSource: RuntimeAgentCredentialSource | null
  connectedAt: number | null
  updatedAt: number
  lastError: string | null
}

export type RuntimeAgentProfile = AgentAccountOwner & {
  alias: string
  profileKind: RuntimeAgentProfileKind
  isDefault: boolean
  incarnation: string
  metadataRevision: string
  credentialRevision: string
  connection: RuntimeAgentProfileConnection
}

export type RuntimeAgentProfileTombstone = AgentAccountOwner & {
  incarnation: string
  credentialRevision: string
  forgottenAt: number
}

export type RuntimeAgentProfileSnapshot = {
  registryVersion: 2
  profiles: RuntimeAgentProfile[]
  tombstones: RuntimeAgentProfileTombstone[]
}

export type RuntimeAgentProfileSetupEnvironment = {
  name: string
  value: string
}

export type RuntimeAgentProfileSetupGuidance = AgentAccountOwner & {
  supported: boolean
  program: string | null
  environment: RuntimeAgentProfileSetupEnvironment[]
  arguments: string[]
  renderedCommand: string | null
  warning: string
  unsupportedReason: string | null
}

export type RuntimeAgentProfileLease = AgentAccountLease

export type RuntimeAgentProfileLeaseAuthorization = RuntimeAgentProfileLease & {
  authorized: boolean
}

export type CreateRuntimeAgentProfileRequest = {
  provider: AgentRuntimeProviderId
  alias: string
}

export type RenameRuntimeAgentProfileRequest = AgentAccountOwner & {
  alias: string
}

export type TargetRuntimeAgentProfileRequest = AgentAccountOwner

export type CheckRuntimeAgentProfileRequest = AgentAccountOwner & {
  requestedScopes?: readonly string[]
}

export type RuntimeAgentProfileSetupGuidanceRequest = AgentAccountOwner & {
  shell: 'zsh' | 'bash' | 'power_shell'
}

export type AgentProviderViewState = {
  id: AgentProviderId
  label: string
  abbr: string
  state: RuntimeAgentConnectionStatus
  scope: string[]
  expiresInDays: number | null
  accountLabel?: string | null
  credentialSource?: RuntimeAgentCredentialSource | null
  connectionKind?: RuntimeAgentConnectionKind
  availability: RuntimeAgentProviderAvailability
  lastError?: string | null
}

export type AgentAuthRuntimeServiceOptions = {
  hasRuntime?: () => boolean
  invokeRuntime?: RuntimeInvoker
}

export type AgentAuthRuntimeService = {
  hasRuntime: () => boolean
  readProfileSnapshot(): Promise<RuntimeAgentProfileSnapshot | null>
  createProfile(request: CreateRuntimeAgentProfileRequest): Promise<RuntimeAgentProfile>
  renameProfile(request: RenameRuntimeAgentProfileRequest): Promise<RuntimeAgentProfile>
  setDefaultProfile(request: TargetRuntimeAgentProfileRequest): Promise<RuntimeAgentProfile>
  checkProfile(request: CheckRuntimeAgentProfileRequest): Promise<RuntimeAgentProfile>
  disconnectProfile(request: TargetRuntimeAgentProfileRequest): Promise<RuntimeAgentProfile>
  forgetProfile(request: TargetRuntimeAgentProfileRequest): Promise<RuntimeAgentProfileTombstone>
  readProfileSetupGuidance(
    request: RuntimeAgentProfileSetupGuidanceRequest,
  ): Promise<RuntimeAgentProfileSetupGuidance>
  authorizeProfileLease(
    request: RuntimeAgentProfileLease,
  ): Promise<RuntimeAgentProfileLeaseAuthorization>
  listConnections(): Promise<RuntimeAgentConnectionSnapshot[]>
  beginLogin(
    provider: AgentProviderId,
    requestedScopes?: readonly string[],
  ): Promise<RuntimeAgentConnectionSnapshot>
  disconnect(provider: AgentProviderId): Promise<RuntimeAgentConnectionSnapshot>
  readRuntimeSnapshot(): Promise<RuntimeAgentAuthSnapshot | null>
}

type RuntimeAgentAuthOverride = {
  hasRuntime?: () => boolean
  invokeRuntime?: RuntimeInvoker
}

const providerAbbr = (provider: AgentProviderId): string =>
  provider === 'codex' ? 'Cx' : 'Cl'

const authOverride = (): RuntimeAgentAuthOverride | null => {
  if (typeof window === 'undefined') return null

  return (
    (window as Window & { __GTUM_AGENT_AUTH_RUNTIME__?: RuntimeAgentAuthOverride })
      .__GTUM_AGENT_AUTH_RUNTIME__ ?? null
  )
}

const omitUndefined = (values: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))

const MAX_U64 = 18_446_744_073_709_551_615n
const PROFILE_ALIAS_MAX_BYTES = 64
const PROFILE_ACCOUNT_ID_MAX_BYTES = 64
const RUNTIME_UNAVAILABLE_ERROR = 'Desktop runtime is not connected.'
export const EXACT_AGENT_ACCOUNT_LEASE_REQUIRED_ERROR =
  'An exact Agent account lease is required. Refresh accounts and retry.'

const asObject = (value: unknown, field: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`)
  }

  return value as Record<string, unknown>
}

const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).byteLength

const containsControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
  })

const normalizeRuntimeProvider = (
  value: unknown,
  field: string,
): AgentRuntimeProviderId => {
  if (value === 'codex' || value === 'claude') return value

  throw new Error(`${field} must be exactly "codex" or "claude".`)
}

const generatedAccountCounter = (suffix: string): bigint | null => {
  if (!/^[0-9a-z]+$/.test(suffix) || suffix.startsWith('0')) return null

  let value = 0n
  for (const character of suffix) {
    const code = character.charCodeAt(0)
    const digit = code >= 48 && code <= 57 ? code - 48 : code - 87
    value = value * 36n + BigInt(digit)
    if (value > MAX_U64) return null
  }

  return value > 0n ? value : null
}

const isCanonicalRuntimeAccountId = (
  provider: AgentRuntimeProviderId,
  accountId: string,
): boolean => {
  if (accountId.length > PROFILE_ACCOUNT_ID_MAX_BYTES) return false
  if (accountId === `${provider}-default`) return true

  const prefix = `${provider}-profile-`
  return accountId.startsWith(prefix) && generatedAccountCounter(accountId.slice(prefix.length)) != null
}

const isReservedRuntimeAccount = (owner: AgentAccountOwner): boolean =>
  owner.accountId === `${owner.provider}-default`

export const normalizeRuntimeAgentOwner = (
  ownerValue: { provider: unknown; accountId: unknown },
  field = 'Agent account owner',
): AgentAccountOwner => {
  const provider = normalizeRuntimeProvider(ownerValue.provider, `${field} provider`)
  if (typeof ownerValue.accountId !== 'string') {
    throw new Error(`${field} account ID must be a string.`)
  }

  const accountId = ownerValue.accountId
  if (!isCanonicalRuntimeAccountId(provider, accountId)) {
    throw new Error(
      `${field} account ID "${accountId}" is not canonical for provider "${provider}".`,
    )
  }

  return { provider, accountId }
}

const normalizeProfileAlias = (value: unknown, field: string): string => {
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`)

  const alias = value.trim()
  if (
    alias.length === 0 ||
    utf8ByteLength(alias) > PROFILE_ALIAS_MAX_BYTES ||
    containsControlCharacter(alias)
  ) {
    throw new Error(
      `${field} must be 1-${PROFILE_ALIAS_MAX_BYTES} UTF-8 bytes after trimming and contain no control characters.`,
    )
  }

  return alias
}

const normalizeCanonicalDecimal = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${field} must be a positive canonical decimal string.`)
  }

  if (BigInt(value) > MAX_U64) {
    throw new Error(`${field} exceeds the unsigned 64-bit range.`)
  }
  return value
}

export const normalizeRuntimeAgentLease = (
  leaseValue: {
    provider: unknown
    accountId: unknown
    incarnation: unknown
    credentialRevision: unknown
  },
  field = 'Agent account lease',
): AgentAccountLease => {
  const owner = normalizeRuntimeAgentOwner(leaseValue, field)
  return {
    ...owner,
    incarnation: normalizeCanonicalDecimal(
      leaseValue.incarnation,
      `${field} incarnation`,
    ),
    credentialRevision: normalizeCanonicalDecimal(
      leaseValue.credentialRevision,
      `${field} credentialRevision`,
    ),
  }
}

const normalizeTimestamp = (value: unknown, field: string): number => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value

  throw new Error(`${field} must be a non-negative safe integer timestamp.`)
}

const normalizeNullableTimestamp = (value: unknown, field: string): number | null =>
  value === null ? null : normalizeTimestamp(value, field)

const normalizeNullableString = (value: unknown, field: string): string | null => {
  if (value === null || typeof value === 'string') return value

  throw new Error(`${field} must be a string or null.`)
}

const normalizeProfileKind = (
  value: unknown,
  owner: AgentAccountOwner,
  field: string,
): RuntimeAgentProfileKind => {
  const kind = asObject(value, field).kind
  const expectedKind = isReservedRuntimeAccount(owner)
    ? 'ambient'
    : owner.provider === 'codex'
      ? 'codex_home'
      : 'claude_config_dir'
  if (kind !== expectedKind) {
    throw new Error(
      `${field} does not match account "${owner.accountId}" and provider "${owner.provider}".`,
    )
  }

  return { kind: expectedKind }
}

const normalizeProfileConnection = (
  value: unknown,
  owner: AgentAccountOwner,
  field: string,
): RuntimeAgentProfileConnection => {
  const connection = asObject(value, field)
  const status = connection.status
  if (
    status !== 'disconnected' &&
    status !== 'pending' &&
    status !== 'connected' &&
    status !== 'error'
  ) {
    throw new Error(`${field}.status is invalid.`)
  }

  const credentialSource = connection.credentialSource
  if (status !== 'connected') {
    if (credentialSource !== null) {
      throw new Error(`${field}.credentialSource must be null when status is "${status}".`)
    }
  } else if (owner.provider === 'codex') {
    if (credentialSource !== null) {
      throw new Error(`${field}.credentialSource must be null for Codex profiles.`)
    }
  } else if (
    credentialSource !== 'claude_cli_session' &&
    credentialSource !== 'anthropic_api_key' &&
    credentialSource !== 'api_key_helper'
  ) {
    throw new Error(
      `${field}.credentialSource must be a recognized source for connected Claude profiles.`,
    )
  }

  return {
    status,
    requiresValidation:
      typeof connection.requiresValidation === 'boolean'
        ? connection.requiresValidation
        : (() => {
            throw new Error(`${field}.requiresValidation must be a boolean.`)
          })(),
    credentialSource,
    connectedAt: normalizeNullableTimestamp(connection.connectedAt, `${field}.connectedAt`),
    updatedAt: normalizeTimestamp(connection.updatedAt, `${field}.updatedAt`),
    lastError: normalizeNullableString(connection.lastError, `${field}.lastError`),
  }
}

const normalizeProfile = (value: unknown, field: string): RuntimeAgentProfile => {
  const profile = asObject(value, field)
  const owner = normalizeRuntimeAgentOwner(
    { provider: profile.provider, accountId: profile.accountId },
    field,
  )
  const alias = normalizeProfileAlias(profile.alias, `${field}.alias`)
  if (profile.alias !== alias) {
    throw new Error(`${field}.alias must already be stored in canonical form.`)
  }
  if (typeof profile.isDefault !== 'boolean') {
    throw new Error(`${field}.isDefault must be a boolean.`)
  }

  return {
    ...owner,
    alias,
    profileKind: normalizeProfileKind(profile.profileKind, owner, `${field}.profileKind`),
    isDefault: profile.isDefault,
    incarnation: normalizeCanonicalDecimal(profile.incarnation, `${field}.incarnation`),
    metadataRevision: normalizeCanonicalDecimal(
      profile.metadataRevision,
      `${field}.metadataRevision`,
    ),
    credentialRevision: normalizeCanonicalDecimal(
      profile.credentialRevision,
      `${field}.credentialRevision`,
    ),
    connection: normalizeProfileConnection(
      profile.connection,
      owner,
      `${field}.connection`,
    ),
  }
}

const normalizeProfileTombstone = (
  value: unknown,
  field: string,
): RuntimeAgentProfileTombstone => {
  const tombstone = asObject(value, field)
  const owner = normalizeRuntimeAgentOwner(
    { provider: tombstone.provider, accountId: tombstone.accountId },
    field,
  )
  if (isReservedRuntimeAccount(owner)) {
    throw new Error(`${field} cannot tombstone a reserved default account.`)
  }

  return {
    ...owner,
    incarnation: normalizeCanonicalDecimal(tombstone.incarnation, `${field}.incarnation`),
    credentialRevision: normalizeCanonicalDecimal(
      tombstone.credentialRevision,
      `${field}.credentialRevision`,
    ),
    forgottenAt: normalizeTimestamp(tombstone.forgottenAt, `${field}.forgottenAt`),
  }
}

const normalizeProfileSnapshot = (value: unknown): RuntimeAgentProfileSnapshot => {
  const snapshot = asObject(value, 'Agent profile snapshot')
  if (snapshot.registryVersion !== 2) {
    throw new Error('Agent profile snapshot registryVersion must be exactly 2.')
  }
  if (!Array.isArray(snapshot.profiles) || !Array.isArray(snapshot.tombstones)) {
    throw new Error('Agent profile snapshot profiles and tombstones must be arrays.')
  }

  const profiles = snapshot.profiles.map((profile, index) =>
    normalizeProfile(profile, `Agent profile snapshot profiles[${index}]`),
  )
  const tombstones = snapshot.tombstones.map((tombstone, index) =>
    normalizeProfileTombstone(tombstone, `Agent profile snapshot tombstones[${index}]`),
  )
  const owners = new Set<string>()
  const incarnations = new Set<string>()
  for (const entry of [...profiles, ...tombstones]) {
    const ownerKey = `${entry.provider}:${entry.accountId}`
    if (owners.has(ownerKey)) {
      throw new Error(`Agent profile snapshot contains duplicate owner "${ownerKey}".`)
    }
    if (incarnations.has(entry.incarnation)) {
      throw new Error(
        `Agent profile snapshot contains duplicate incarnation "${entry.incarnation}".`,
      )
    }
    owners.add(ownerKey)
    incarnations.add(entry.incarnation)
  }

  for (const provider of ['codex', 'claude'] as const) {
    const providerProfiles = profiles.filter((profile) => profile.provider === provider)
    const providerEntryCount =
      providerProfiles.length +
      tombstones.filter((tombstone) => tombstone.provider === provider).length
    if (providerEntryCount > 16) {
      throw new Error(
        `Agent profile snapshot exceeds the 16-entry capacity for provider "${provider}".`,
      )
    }
    if (providerProfiles.filter((profile) => profile.isDefault).length !== 1) {
      throw new Error(
        `Agent profile snapshot must contain exactly one default profile for provider "${provider}".`,
      )
    }
    const reservedProfiles = providerProfiles.filter(
      (profile) => profile.accountId === `${provider}-default`,
    )
    if (
      reservedProfiles.length !== 1 ||
      reservedProfiles[0]?.profileKind.kind !== 'ambient' ||
      providerProfiles.filter((profile) => profile.profileKind.kind === 'ambient').length !== 1
    ) {
      throw new Error(
        `Agent profile snapshot must contain exactly one reserved ambient profile for provider "${provider}".`,
      )
    }
  }

  return { registryVersion: 2, profiles, tombstones }
}

const assertProfileOwner = (
  profile: AgentAccountOwner,
  expected: AgentAccountOwner,
  field: string,
): void => {
  if (profile.provider === expected.provider && profile.accountId === expected.accountId) return

  throw new Error(
    `${field} owner mismatch: expected ${expected.provider}/${expected.accountId} but received ${profile.provider}/${profile.accountId}.`,
  )
}

const normalizeOwnedProfile = (
  value: unknown,
  expectedOwner: AgentAccountOwner,
  field: string,
): RuntimeAgentProfile => {
  const rawProfile = asObject(value, field)
  const owner = normalizeRuntimeAgentOwner(
    { provider: rawProfile.provider, accountId: rawProfile.accountId },
    field,
  )
  assertProfileOwner(owner, expectedOwner, field)
  return normalizeProfile(rawProfile, field)
}

const normalizeOwnedProfileTombstone = (
  value: unknown,
  expectedOwner: AgentAccountOwner,
  field: string,
): RuntimeAgentProfileTombstone => {
  const rawTombstone = asObject(value, field)
  const owner = normalizeRuntimeAgentOwner(
    { provider: rawTombstone.provider, accountId: rawTombstone.accountId },
    field,
  )
  assertProfileOwner(owner, expectedOwner, field)
  return normalizeProfileTombstone(rawTombstone, field)
}

const normalizeProfileSetupGuidance = (
  value: unknown,
  expectedOwner: AgentAccountOwner,
): RuntimeAgentProfileSetupGuidance => {
  const guidance = asObject(value, 'Agent profile setup guidance')
  const owner = normalizeRuntimeAgentOwner(
    { provider: guidance.provider, accountId: guidance.accountId },
    'Agent profile setup guidance',
  )
  assertProfileOwner(owner, expectedOwner, 'Agent profile setup guidance')
  if (typeof guidance.supported !== 'boolean') {
    throw new Error('Agent profile setup guidance supported must be a boolean.')
  }
  if (!Array.isArray(guidance.environment) || !Array.isArray(guidance.arguments)) {
    throw new Error('Agent profile setup guidance environment and arguments must be arrays.')
  }

  const environment = guidance.environment.map((entry, index) => {
    const item = asObject(entry, `Agent profile setup guidance environment[${index}]`)
    if (typeof item.name !== 'string' || typeof item.value !== 'string') {
      throw new Error(
        `Agent profile setup guidance environment[${index}] name and value must be strings.`,
      )
    }
    return { name: item.name, value: item.value }
  })
  const arguments_ = guidance.arguments.map((argument, index) => {
    if (typeof argument !== 'string') {
      throw new Error(`Agent profile setup guidance arguments[${index}] must be a string.`)
    }
    return argument
  })
  if (typeof guidance.warning !== 'string') {
    throw new Error('Agent profile setup guidance warning must be a string.')
  }

  return {
    ...owner,
    supported: guidance.supported,
    program: normalizeNullableString(guidance.program, 'Agent profile setup guidance program'),
    environment,
    arguments: arguments_,
    renderedCommand: normalizeNullableString(
      guidance.renderedCommand,
      'Agent profile setup guidance renderedCommand',
    ),
    warning: guidance.warning,
    unsupportedReason: normalizeNullableString(
      guidance.unsupportedReason,
      'Agent profile setup guidance unsupportedReason',
    ),
  }
}

const normalizeProfileLeaseAuthorization = (
  value: unknown,
  expectedLease: RuntimeAgentProfileLease,
): RuntimeAgentProfileLeaseAuthorization => {
  const authorization = asObject(value, 'Agent profile lease authorization')
  const owner = normalizeRuntimeAgentOwner(
    { provider: authorization.provider, accountId: authorization.accountId },
    'Agent profile lease authorization',
  )
  assertProfileOwner(owner, expectedLease, 'Agent profile lease authorization')
  const incarnation = normalizeCanonicalDecimal(
    authorization.incarnation,
    'Agent profile lease authorization incarnation',
  )
  const credentialRevision = normalizeCanonicalDecimal(
    authorization.credentialRevision,
    'Agent profile lease authorization credentialRevision',
  )
  if (
    incarnation !== expectedLease.incarnation ||
    credentialRevision !== expectedLease.credentialRevision
  ) {
    throw new Error(
      `Agent profile lease authorization revision mismatch: expected ${expectedLease.incarnation}/${expectedLease.credentialRevision} but received ${incarnation}/${credentialRevision}.`,
    )
  }
  if (typeof authorization.authorized !== 'boolean') {
    throw new Error('Agent profile lease authorization authorized must be a boolean.')
  }

  return { ...owner, incarnation, credentialRevision, authorized: authorization.authorized }
}

const normalizeRequestedScopes = (value?: readonly string[]): string[] | undefined => {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('Profile requestedScopes must be an array.')

  return value.map((scope, index) => {
    if (typeof scope !== 'string' || scope.trim().length === 0) {
      throw new Error(`Profile requestedScopes[${index}] must be a non-empty string.`)
    }
    return scope.trim()
  })
}

const requireRuntime = (hasRuntime: () => boolean): void => {
  if (!hasRuntime()) throw new Error(RUNTIME_UNAVAILABLE_ERROR)
}

const expiresInDays = (expiresAt?: number | null): number | null => {
  if (expiresAt == null) return null

  const diff = expiresAt - Date.now()
  if (diff <= 0) return 0

  return Math.ceil(diff / 86_400_000)
}

const hasOwnField = (value: Record<string, unknown>, field: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, field)

const normalizeLegacyString = (value: unknown, field: string): string => {
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`)
  return value
}

const normalizeLegacyStringArray = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`)

  return value.map((item, index) =>
    normalizeLegacyString(item, `${field}[${index}]`),
  )
}

const normalizeLegacyTimestamp = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer timestamp.`)
  }
  return value
}

const normalizeOptionalLegacyString = (
  value: Record<string, unknown>,
  key: string,
  field: string,
): string | null | undefined => {
  if (!hasOwnField(value, key)) return undefined
  const fieldValue = value[key]
  if (fieldValue === null || typeof fieldValue === 'string') return fieldValue
  throw new Error(`${field} must be a string or null.`)
}

const normalizeOptionalLegacyTimestamp = (
  value: Record<string, unknown>,
  key: string,
  field: string,
): number | null | undefined => {
  if (!hasOwnField(value, key)) return undefined
  const fieldValue = value[key]
  if (fieldValue === null) return null
  return normalizeLegacyTimestamp(fieldValue, field)
}

const normalizeConnectionStatus = (
  value: unknown,
  field: string,
): RuntimeAgentConnectionStatus => {
  if (
    value === 'disconnected' ||
    value === 'pending' ||
    value === 'connected' ||
    value === 'error'
  ) {
    return value
  }
  throw new Error(`${field} is invalid.`)
}

const normalizeConnectionKind = (
  value: unknown,
  field: string,
): RuntimeAgentConnectionKind => {
  if (value === 'mock' || value === 'prototype' || value === 'real') return value
  throw new Error(`${field} is invalid.`)
}

const normalizeProviderAvailability = (
  value: unknown,
  field: string,
): RuntimeAgentProviderAvailability => {
  if (value === 'available' || value === 'deferred') return value
  throw new Error(`${field} is invalid.`)
}

const normalizeOptionalCredentialSource = (
  value: Record<string, unknown>,
  field: string,
): RuntimeAgentCredentialSource | null | undefined => {
  if (!hasOwnField(value, 'credentialSource')) return undefined
  const credentialSource = value.credentialSource
  if (
    credentialSource === null ||
    credentialSource === 'claude_cli_session' ||
    credentialSource === 'anthropic_api_key' ||
    credentialSource === 'api_key_helper'
  ) {
    return credentialSource
  }
  throw new Error(`${field} is invalid.`)
}

const normalizeConnection = (
  value: unknown,
  field = 'Agent connection',
  expectedProvider?: AgentRuntimeProviderId,
): RuntimeAgentConnectionSnapshot => {
  const connection = asObject(value, field)
  const provider = normalizeRuntimeProvider(connection.provider, `${field} provider`)
  if (expectedProvider !== undefined && provider !== expectedProvider) {
    throw new Error(
      `Agent connection owner mismatch at ${field}: expected ${expectedProvider} but received ${provider}.`,
    )
  }

  const accountLabel = normalizeOptionalLegacyString(
    connection,
    'accountLabel',
    `${field}.accountLabel`,
  )
  const accountEmail = normalizeOptionalLegacyString(
    connection,
    'accountEmail',
    `${field}.accountEmail`,
  )
  const credentialSource = normalizeOptionalCredentialSource(
    connection,
    `${field}.credentialSource`,
  )
  const expiresAt = normalizeOptionalLegacyTimestamp(
    connection,
    'expiresAt',
    `${field}.expiresAt`,
  )
  const callbackUrl = normalizeOptionalLegacyString(
    connection,
    'callbackUrl',
    `${field}.callbackUrl`,
  )
  const authUrl = normalizeOptionalLegacyString(
    connection,
    'authUrl',
    `${field}.authUrl`,
  )
  const activeLoginId = normalizeOptionalLegacyString(
    connection,
    'activeLoginId',
    `${field}.activeLoginId`,
  )
  const activeLoginState = normalizeOptionalLegacyString(
    connection,
    'activeLoginState',
    `${field}.activeLoginState`,
  )
  const connectedAt = normalizeOptionalLegacyTimestamp(
    connection,
    'connectedAt',
    `${field}.connectedAt`,
  )
  const lastLoginAttemptAt = normalizeOptionalLegacyTimestamp(
    connection,
    'lastLoginAttemptAt',
    `${field}.lastLoginAttemptAt`,
  )
  const lastError = normalizeOptionalLegacyString(
    connection,
    'lastError',
    `${field}.lastError`,
  )
  const normalized: RuntimeAgentConnectionSnapshot = {
    provider,
    displayName: normalizeLegacyString(connection.displayName, `${field}.displayName`),
    availability:
      connection.availability == null
        ? 'available'
        : normalizeProviderAvailability(connection.availability, `${field}.availability`),
    status: normalizeConnectionStatus(connection.status, `${field}.status`),
    connectionKind: normalizeConnectionKind(
      connection.connectionKind,
      `${field}.connectionKind`,
    ),
    requiredScopes: normalizeLegacyStringArray(
      connection.requiredScopes,
      `${field}.requiredScopes`,
    ),
    updatedAt: normalizeLegacyTimestamp(connection.updatedAt, `${field}.updatedAt`),
  }

  if (accountLabel !== undefined) normalized.accountLabel = accountLabel
  if (accountEmail !== undefined) normalized.accountEmail = accountEmail
  if (credentialSource !== undefined) normalized.credentialSource = credentialSource
  if (expiresAt !== undefined) normalized.expiresAt = expiresAt
  if (callbackUrl !== undefined) normalized.callbackUrl = callbackUrl
  if (authUrl !== undefined) normalized.authUrl = authUrl
  if (activeLoginId !== undefined) normalized.activeLoginId = activeLoginId
  if (activeLoginState !== undefined) normalized.activeLoginState = activeLoginState
  if (connectedAt !== undefined) normalized.connectedAt = connectedAt
  if (lastLoginAttemptAt !== undefined) {
    normalized.lastLoginAttemptAt = lastLoginAttemptAt
  }
  if (lastError !== undefined) normalized.lastError = lastError

  return normalized
}

const normalizePendingLogin = (
  value: unknown,
  field: string,
): RuntimeAgentPendingLoginSnapshot => {
  const pendingLogin = asObject(value, field)
  const authUrl = normalizeOptionalLegacyString(
    pendingLogin,
    'authUrl',
    `${field}.authUrl`,
  )
  const consumedAt = normalizeOptionalLegacyTimestamp(
    pendingLogin,
    'consumedAt',
    `${field}.consumedAt`,
  )
  const lastError = normalizeOptionalLegacyString(
    pendingLogin,
    'lastError',
    `${field}.lastError`,
  )
  const normalized: RuntimeAgentPendingLoginSnapshot = {
    loginId: normalizeLegacyString(pendingLogin.loginId, `${field}.loginId`),
    provider: normalizeRuntimeProvider(pendingLogin.provider, `${field} provider`),
    state: normalizeLegacyString(pendingLogin.state, `${field}.state`),
    callbackUrl: normalizeLegacyString(pendingLogin.callbackUrl, `${field}.callbackUrl`),
    scopes: normalizeLegacyStringArray(pendingLogin.scopes, `${field}.scopes`),
    createdAt: normalizeLegacyTimestamp(pendingLogin.createdAt, `${field}.createdAt`),
    expiresAt: normalizeLegacyTimestamp(pendingLogin.expiresAt, `${field}.expiresAt`),
  }

  if (authUrl !== undefined) normalized.authUrl = authUrl
  if (consumedAt !== undefined) normalized.consumedAt = consumedAt
  if (lastError !== undefined) normalized.lastError = lastError
  return normalized
}

const normalizeRuntimeSnapshot = (value: unknown): RuntimeAgentAuthSnapshot => {
  const snapshot = asObject(value, 'Runtime auth snapshot')
  if (!Array.isArray(snapshot.supportedProviders)) {
    throw new Error('Runtime auth snapshot supportedProviders must be an array.')
  }
  if (!Array.isArray(snapshot.connections)) {
    throw new Error('Runtime auth snapshot connections must be an array.')
  }
  if (!Array.isArray(snapshot.pendingLogins)) {
    throw new Error('Runtime auth snapshot pendingLogins must be an array.')
  }

  const supportedProviders = snapshot.supportedProviders.map((provider, index) =>
    normalizeRuntimeProvider(
      provider,
      `Runtime auth snapshot supportedProviders[${index}]`,
    ),
  )
  const supportedProviderSet = new Set<AgentRuntimeProviderId>(supportedProviders)
  const connections = snapshot.connections.map((connection, index) => {
    const normalized = normalizeConnection(
      connection,
      `Runtime auth snapshot connections[${index}]`,
    )
    if (!supportedProviderSet.has(normalized.provider as AgentRuntimeProviderId)) {
      throw new Error(
        `Runtime auth snapshot connections[${index}] owner is not a supported provider.`,
      )
    }
    return normalized
  })
  const pendingLogins = snapshot.pendingLogins.map((pendingLogin, index) => {
    const normalized = normalizePendingLogin(
      pendingLogin,
      `Runtime auth snapshot pendingLogins[${index}]`,
    )
    if (!supportedProviderSet.has(normalized.provider as AgentRuntimeProviderId)) {
      throw new Error(
        `Runtime auth snapshot pendingLogins[${index}] owner is not a supported provider.`,
      )
    }
    return normalized
  })
  const storagePath = normalizeOptionalLegacyString(
    snapshot,
    'storagePath',
    'Runtime auth snapshot.storagePath',
  )
  const normalized: RuntimeAgentAuthSnapshot = {
    supportedProviders,
    connections,
    pendingLogins,
    lastSyncedAt: normalizeLegacyTimestamp(
      snapshot.lastSyncedAt,
      'Runtime auth snapshot.lastSyncedAt',
    ),
  }
  if (storagePath !== undefined) normalized.storagePath = storagePath
  return normalized
}

export const providerViewStateFromConnection = (
  connection: RuntimeAgentConnectionSnapshot,
): AgentProviderViewState => {
  const normalized = normalizeConnection(connection)

  return {
    id: normalized.provider,
    label: normalized.displayName,
    abbr: providerAbbr(normalized.provider),
    state: normalized.status,
    scope: normalized.requiredScopes,
    expiresInDays: expiresInDays(normalized.expiresAt),
    accountLabel: normalized.accountLabel ?? null,
    credentialSource: normalized.credentialSource ?? null,
    connectionKind: normalized.connectionKind,
    availability: normalized.availability,
    lastError: normalized.lastError ?? null,
  }
}

export const createAgentAuthRuntimeService = (
  options: AgentAuthRuntimeServiceOptions = {},
): AgentAuthRuntimeService => {
  const override = authOverride()
  const hasRuntime = options.hasRuntime || override?.hasRuntime || hasTauriRuntime
  const invokeRuntime = options.invokeRuntime || override?.invokeRuntime || (invoke as RuntimeInvoker)

  return {
    hasRuntime,
    async readProfileSnapshot() {
      if (!hasRuntime()) return null

      const snapshot = await invokeRuntime<unknown>('read_agent_profile_snapshot')
      return normalizeProfileSnapshot(snapshot)
    },
    async createProfile(request) {
      const provider = normalizeRuntimeProvider(request.provider, 'Create profile provider')
      const alias = normalizeProfileAlias(request.alias, 'Create profile alias')
      requireRuntime(hasRuntime)

      const profile = normalizeProfile(
        await invokeRuntime<unknown>('create_agent_profile', {
          request: { provider, alias },
        }),
        'Create profile response',
      )
      if (profile.provider !== provider || isReservedRuntimeAccount(profile)) {
        throw new Error(
          `Create profile response owner mismatch: expected a generated ${provider} account but received ${profile.provider}/${profile.accountId}.`,
        )
      }
      if (profile.alias !== alias) {
        throw new Error(
          `Create profile response alias mismatch: expected "${alias}" but received "${profile.alias}".`,
        )
      }
      return profile
    },
    async renameProfile(request) {
      const owner = normalizeRuntimeAgentOwner(request, 'Rename profile request')
      const alias = normalizeProfileAlias(request.alias, 'Rename profile alias')
      requireRuntime(hasRuntime)

      const profile = normalizeOwnedProfile(
        await invokeRuntime<unknown>('rename_agent_profile', {
          request: { ...owner, alias },
        }),
        owner,
        'Rename profile response',
      )
      if (profile.alias !== alias) {
        throw new Error(
          `Rename profile response alias mismatch: expected "${alias}" but received "${profile.alias}".`,
        )
      }
      return profile
    },
    async setDefaultProfile(request) {
      const owner = normalizeRuntimeAgentOwner(request, 'Set default profile request')
      requireRuntime(hasRuntime)

      const profile = normalizeOwnedProfile(
        await invokeRuntime<unknown>('set_default_agent_profile', { request: owner }),
        owner,
        'Set default profile response',
      )
      if (!profile.isDefault) {
        throw new Error('Set default profile response did not mark the requested profile default.')
      }
      return profile
    },
    async checkProfile(request) {
      const owner = normalizeRuntimeAgentOwner(request, 'Check profile request')
      const requestedScopes = normalizeRequestedScopes(request.requestedScopes)
      requireRuntime(hasRuntime)

      const profile = normalizeOwnedProfile(
        await invokeRuntime<unknown>('check_agent_profile', {
          request: omitUndefined({ ...owner, requestedScopes }),
        }),
        owner,
        'Check profile response',
      )
      return profile
    },
    async disconnectProfile(request) {
      const owner = normalizeRuntimeAgentOwner(request, 'Disconnect profile request')
      requireRuntime(hasRuntime)

      const profile = normalizeOwnedProfile(
        await invokeRuntime<unknown>('disconnect_agent_profile', { request: owner }),
        owner,
        'Disconnect profile response',
      )
      return profile
    },
    async forgetProfile(request) {
      const owner = normalizeRuntimeAgentOwner(request, 'Forget profile request')
      requireRuntime(hasRuntime)

      const tombstone = normalizeOwnedProfileTombstone(
        await invokeRuntime<unknown>('forget_agent_profile', { request: owner }),
        owner,
        'Forget profile response',
      )
      return tombstone
    },
    async readProfileSetupGuidance(request) {
      const owner = normalizeRuntimeAgentOwner(request, 'Profile setup guidance request')
      if (request.shell !== 'zsh' && request.shell !== 'bash' && request.shell !== 'power_shell') {
        throw new Error('Profile setup guidance shell is invalid.')
      }
      requireRuntime(hasRuntime)

      return normalizeProfileSetupGuidance(
        await invokeRuntime<unknown>('read_agent_profile_setup_guidance', {
          request: { ...owner, shell: request.shell },
        }),
        owner,
      )
    },
    async authorizeProfileLease(request) {
      const owner = normalizeRuntimeAgentOwner(request, 'Agent profile lease request')
      const incarnation = normalizeCanonicalDecimal(
        request.incarnation,
        'Agent profile lease incarnation',
      )
      const credentialRevision = normalizeCanonicalDecimal(
        request.credentialRevision,
        'Agent profile lease credentialRevision',
      )
      const lease = { ...owner, incarnation, credentialRevision }
      requireRuntime(hasRuntime)

      return normalizeProfileLeaseAuthorization(
        await invokeRuntime<unknown>('authorize_agent_profile_lease', { request: lease }),
        lease,
      )
    },
    async listConnections() {
      if (!hasRuntime()) return []

      const connections = await invokeRuntime<unknown>('list_agent_connections')
      if (!Array.isArray(connections)) {
        throw new Error('Agent connections must be an array.')
      }
      return connections.map((connection, index) =>
        normalizeConnection(connection, `Agent connections[${index}]`),
      )
    },
    async beginLogin(provider, requestedScopes) {
      void provider
      void requestedScopes
      throw new Error(EXACT_AGENT_ACCOUNT_LEASE_REQUIRED_ERROR)
    },
    async disconnect(provider) {
      void provider
      throw new Error(EXACT_AGENT_ACCOUNT_LEASE_REQUIRED_ERROR)
    },
    async readRuntimeSnapshot() {
      if (!hasRuntime()) return null

      const snapshot = await invokeRuntime<unknown>('agent_auth_runtime_snapshot')
      return normalizeRuntimeSnapshot(snapshot)
    },
  }
}

export const agentAuthRuntimeService = createAgentAuthRuntimeService()
