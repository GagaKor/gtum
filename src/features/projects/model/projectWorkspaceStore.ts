import type { RuntimeProject } from '../../../shared/api/runtimeProjects'
export type JsonSafePrimitive = string | number | boolean | null
export type JsonSafeValue =
  | JsonSafePrimitive
  | readonly JsonSafeValue[]
  | { readonly [key: string]: JsonSafeValue }
export type DeepReadonly<T> = T extends JsonSafePrimitive
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> } : T
export type ProjectWorkspaceHydration = 'idle' | 'loading' | 'ready' | 'missing' | 'error'
export type ProjectWorkbench<W extends JsonSafeValue> = DeepReadonly<W>
export type ProjectWorkspaceEntry<W extends JsonSafeValue> = {
  readonly path: string
  readonly project: DeepReadonly<RuntimeProject> | null
  readonly workbench: ProjectWorkbench<W>
  readonly hydration: ProjectWorkspaceHydration
  readonly closeBlockedReason?: string | null
}
export type ProjectWorkspaceStore<W extends JsonSafeValue> = {
  readonly openOrder: readonly string[]
  readonly activePath: string | null
  readonly entriesByPath: Readonly<Record<string, ProjectWorkspaceEntry<W>>>
}
type ProjectWorkbenchInput<W extends JsonSafeValue> =
  | { readonly workbench?: never; readonly createWorkbench?: never }
  | { readonly workbench: ProjectWorkbench<W>; readonly createWorkbench?: never }
  | { readonly workbench?: never; readonly createWorkbench: () => ProjectWorkbench<W> }
export type OpenProjectWorkspaceInput<W extends JsonSafeValue> = {
  readonly path: string
  readonly project?: DeepReadonly<RuntimeProject> | null
} & ProjectWorkbenchInput<W>
export type ProjectWorkspaceCloseStatus =
  | { readonly blocked: true; readonly reason: string }
  | { readonly blocked: false; readonly reason: null }
export type CloseProjectWorkspaceResult<W extends JsonSafeValue> =
  | { readonly state: ProjectWorkspaceStore<W>; readonly blocked: true; readonly reason: string }
  | { readonly state: ProjectWorkspaceStore<W>; readonly blocked: false; readonly reason: null }
const own = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key)
const plain = (value: unknown): value is Record<PropertyKey, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
function fail(message: string): never {
  throw new Error(message)
}
function assertJsonSafe(
  value: unknown, label = 'Value',
  stack: WeakSet<object> = new WeakSet<object>(),
): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${label} must be JSON-safe: numbers must be finite`)
    return
  }
  if (typeof value !== 'object') {
    fail(`${label} must be JSON-safe: ${typeof value} values are not supported`)
  }
  if (stack.has(value)) fail(`${label} must be JSON-safe: a reference cycle was found`)
  stack.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        fail(`${label} must be JSON-safe: only plain arrays are supported`)
      }
      for (let index = 0; index < value.length; index += 1) {
        if (!own(value, index)) fail(`${label} must be JSON-safe: array index ${index} is missing`)
        assertJsonSafe(value[index], `${label}[${index}]`, stack)
      }
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key === 'symbol') fail(`${label} must be JSON-safe: symbol keys are unsupported`)
        const index = Number(key)
        if (
          key !== 'length' &&
          (!Number.isInteger(index) || index < 0 || String(index) !== key || index >= value.length)
        ) {
          fail(`${label} must be JSON-safe: array property "${key}" is not an index`)
        }
      }
      return
    }
    if (!plain(value)) fail(`${label} must be JSON-safe: only plain objects are supported`)
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol') fail(`${label} must be JSON-safe: symbol keys are unsupported`)
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
        fail(`${label} must be JSON-safe: property "${key}" must be enumerable data`)
      }
      assertJsonSafe(descriptor.value, `${label}.${key}`, stack)
    }
  } finally {
    stack.delete(value)
  }
}
function assertStoredPath(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string') fail(`${label} must be a string`)
  if (!value.trim()) fail(`${label} must not be blank`)
  if (value.trim() !== value) fail(`${label} must be trimmed`)
}
const normalizePath = (value: unknown): string => {
  if (typeof value !== 'string') fail('Project path must be a string')
  const path = value.trim()
  if (!path) fail('Project path must not be blank')
  return path
}
const validHydration = (value: unknown): value is ProjectWorkspaceHydration =>
  value === 'idle' ||
  value === 'loading' ||
  value === 'ready' ||
  value === 'missing' ||
  value === 'error'
const assertProjectTreeNode = (value: unknown): void => {
  if (!plain(value)) fail('Project tree node must be a plain object')
  for (const field of ['name', 'type'] as const) {
    if (!own(value, field) || typeof value[field] !== 'string') {
      fail(`Project tree node ${field} must be a string`)
    }
  }
  for (const field of ['open', 'changed', 'selected', 'truncated'] as const) {
    if (own(value, field) && typeof value[field] !== 'boolean') {
      fail(`Project tree node ${field} must be a boolean`)
    }
  }
  if (own(value, 'runtimePath') && typeof value.runtimePath !== 'string') {
    fail('Project tree node runtimePath must be a string')
  }
  if (own(value, 'children')) {
    if (!Array.isArray(value.children)) fail('Project tree node children must be an array')
    for (const child of value.children) assertProjectTreeNode(child)
  }
}
const assertMetadata = (value: unknown, entryPath?: string): void => {
  if (value !== null && !plain(value)) {
    fail('Project metadata must be JSON-safe RuntimeProject metadata or null')
  }
  if (value === null) return
  for (const field of ['id', 'name', 'path', 'branch', 'branchType'] as const) {
    if (!own(value, field) || typeof value[field] !== 'string') {
      fail(`Project metadata ${field} must be a string`)
    }
  }
  for (const field of ['ahead', 'behind', 'changedFiles'] as const) {
    if (!own(value, field) || typeof value[field] !== 'number' || !Number.isFinite(value[field])) {
      fail(`Project metadata ${field} must be a finite number`)
    }
  }
  if (!own(value, 'fileTree') || !Array.isArray(value.fileTree)) {
    fail('Project metadata fileTree must be an array')
  }
  if (!own(value, 'runtimeBacked') || typeof value.runtimeBacked !== 'boolean') {
    fail('Project metadata runtimeBacked must be a boolean')
  }
  assertJsonSafe(value, 'Project metadata')
  for (const node of value.fileTree) assertProjectTreeNode(node)
  if (entryPath !== undefined && value.path !== entryPath) {
    fail(`Project metadata path must match entry path "${entryPath}"`)
  }
  if (entryPath !== undefined && value.id !== entryPath) {
    fail(`Project metadata id must match entry path "${entryPath}"`)
  }
}
export function assertProjectWorkspaceStore(state: unknown): asserts state is ProjectWorkspaceStore<JsonSafeValue> {
  if (!plain(state)) fail('Project workspace state must be a plain object')
  if (!own(state, 'openOrder') || !Array.isArray(state.openOrder)) {
    fail('Project workspace openOrder must be an array')
  }
  if (!own(state, 'entriesByPath') || !plain(state.entriesByPath)) {
    fail('Project workspace entriesByPath must be a plain object')
  }
  if (!own(state, 'activePath')) fail('Project workspace activePath is missing')

  const openPaths = new Set<string>()
  for (const rawPath of state.openOrder) {
    assertStoredPath(rawPath, 'Project workspace open path')
    if (openPaths.has(rawPath)) fail(`Project workspace contains duplicate path "${rawPath}"`)
    openPaths.add(rawPath)
    if (!own(state.entriesByPath, rawPath)) fail(`Open path "${rawPath}" is missing its own entry`)

    const entry = state.entriesByPath[rawPath]
    if (!plain(entry)) fail(`Project workspace entry for "${rawPath}" must be a plain object`)
    if (!own(entry, 'path') || entry.path !== rawPath) {
      fail(`Project workspace entry path must match its key "${rawPath}"`)
    }
    if (!own(entry, 'project')) fail(`Project metadata for "${rawPath}" is missing`)
    assertMetadata(entry.project, rawPath)
    if (!own(entry, 'workbench')) fail(`Project workbench for "${rawPath}" is missing`)
    assertJsonSafe(entry.workbench, `Project workbench for "${rawPath}"`)
    if (!own(entry, 'hydration') || !validHydration(entry.hydration)) {
      fail(`Project workspace hydration is invalid for "${rawPath}"`)
    }
    if (
      own(entry, 'closeBlockedReason') &&
      entry.closeBlockedReason !== null &&
      typeof entry.closeBlockedReason !== 'string'
    ) {
      fail(`Project workspace close-block reason is invalid for "${rawPath}"`)
    }
  }
  for (const key of Object.keys(state.entriesByPath)) {
    if (!openPaths.has(key)) fail(`Project workspace entry "${key}" is orphaned from openOrder`)
  }
  if (openPaths.size > 0 && state.activePath === null) {
    fail('Project workspace active path is required when projects are open')
  }
  if (state.activePath !== null) {
    assertStoredPath(state.activePath, 'Project workspace activePath')
    if (!openPaths.has(state.activePath)) {
      fail('Project workspace active path must reference an open project')
    }
  }
  assertJsonSafe(state, 'Project workspace state')
}

function assertProjectWorkspaceShell(
  state: unknown,
): asserts state is ProjectWorkspaceStore<JsonSafeValue> {
  // Workbench edits are a hot path. Validate registry membership without
  // walking unchanged project metadata or another project's workbench.
  if (!plain(state)) fail('Project workspace state must be a plain object')
  if (!own(state, 'openOrder') || !Array.isArray(state.openOrder)) {
    fail('Project workspace openOrder must be an array')
  }
  if (!own(state, 'entriesByPath') || !plain(state.entriesByPath)) {
    fail('Project workspace entriesByPath must be a plain object')
  }
  if (!own(state, 'activePath')) fail('Project workspace activePath is missing')

  const openPaths = new Set<string>()
  for (const rawPath of state.openOrder) {
    assertStoredPath(rawPath, 'Project workspace open path')
    if (openPaths.has(rawPath)) fail(`Project workspace contains duplicate path "${rawPath}"`)
    openPaths.add(rawPath)
    if (!own(state.entriesByPath, rawPath)) fail(`Open path "${rawPath}" is missing its own entry`)
  }
  for (const key of Object.keys(state.entriesByPath)) {
    if (!openPaths.has(key)) fail(`Project workspace entry "${key}" is orphaned from openOrder`)
  }
  if (openPaths.size > 0 && state.activePath === null) {
    fail('Project workspace active path is required when projects are open')
  }
  if (state.activePath !== null) {
    assertStoredPath(state.activePath, 'Project workspace activePath')
    if (!openPaths.has(state.activePath)) {
      fail('Project workspace active path must reference an open project')
    }
  }
}

function assertProjectWorkspaceEntryShell(
  entry: unknown,
  path: string,
): asserts entry is ProjectWorkspaceEntry<JsonSafeValue> {
  if (!plain(entry)) fail(`Project workspace entry for "${path}" must be a plain object`)
  if (!own(entry, 'path') || entry.path !== path) {
    fail(`Project workspace entry path must match its key "${path}"`)
  }
  if (!own(entry, 'project')) fail(`Project metadata for "${path}" is missing`)
  if (!own(entry, 'workbench')) fail(`Project workbench for "${path}" is missing`)
  if (!own(entry, 'hydration') || !validHydration(entry.hydration)) {
    fail(`Project workspace hydration is invalid for "${path}"`)
  }
  if (
    own(entry, 'closeBlockedReason') &&
    entry.closeBlockedReason !== null &&
    typeof entry.closeBlockedReason !== 'string'
  ) {
    fail(`Project workspace close-block reason is invalid for "${path}"`)
  }
}
const validated = <W extends JsonSafeValue>(state: ProjectWorkspaceStore<W>) => {
  assertProjectWorkspaceStore(state)
  return state
}
const selected = <W extends JsonSafeValue>(state: ProjectWorkspaceStore<W>, value: unknown) => {
  const path = normalizePath(value)
  const entry = own(state.entriesByPath, path) ? state.entriesByPath[path] : undefined
  if (!entry || !state.openOrder.includes(path)) fail(`Project workspace is not open: ${path}`)
  return { path, entry }
}
const replaceEntry = <W extends JsonSafeValue>(
  state: ProjectWorkspaceStore<W>,
  path: string,
  entry: ProjectWorkspaceEntry<W>,
) => validated({ ...state, entriesByPath: { ...state.entriesByPath, [path]: entry } })
export const createProjectWorkspaceStore = <W extends JsonSafeValue = JsonSafeValue>() =>
  validated<W>({ openOrder: [], activePath: null, entriesByPath: {} })
export const openProjectWorkspace = <W extends JsonSafeValue>(
  state: ProjectWorkspaceStore<W>,
  input: OpenProjectWorkspaceInput<W>,
): ProjectWorkspaceStore<W> => {
  assertProjectWorkspaceStore(state)
  if (!plain(input)) fail('Open project workspace input must be a plain object')
  const path = normalizePath(input.path)
  const hasProject = own(input, 'project')
  const hasWorkbench = own(input, 'workbench')
  const hasInitializer = own(input, 'createWorkbench')
  if (hasWorkbench && hasInitializer) fail('Cannot provide both workbench inputs')
  if (hasProject) assertMetadata(input.project, path)
  if (hasWorkbench) assertJsonSafe(input.workbench, 'Open project workbench')
  if (hasInitializer && typeof input.createWorkbench !== 'function') {
    fail('Project workbench initializer must be a function')
  }
  const existing = own(state.entriesByPath, path) ? state.entriesByPath[path] : undefined
  if (existing) {
    const metadataChanged = hasProject && !Object.is(existing.project, input.project)
    if (!metadataChanged && state.activePath === path) return state
    return validated({
      ...state,
      activePath: path,
      entriesByPath: metadataChanged
        ? { ...state.entriesByPath, [path]: { ...existing, project: input.project ?? null } }
        : state.entriesByPath,
    })
  }
  const workbench = hasWorkbench
    ? input.workbench
    : typeof input.createWorkbench === 'function'
      ? input.createWorkbench()
      : fail('A workbench or createWorkbench initializer is required for a new project')
  assertJsonSafe(workbench, 'Project workbench')
  return validated({
    openOrder: [...state.openOrder, path],
    activePath: path,
    entriesByPath: {
      ...state.entriesByPath,
      [path]: {
        path,
        project: input.project ?? null,
        workbench: workbench as ProjectWorkbench<W>,
        hydration: 'idle',
        closeBlockedReason: null,
      },
    },
  })
}
export const activateProjectWorkspace = <W extends JsonSafeValue>(
  state: ProjectWorkspaceStore<W>,
  path: string,
) => {
  assertProjectWorkspaceStore(state)
  const target = selected(state, path)
  return state.activePath === target.path ? state : validated({ ...state, activePath: target.path })
}
export const updateProjectWorkbench = <W extends JsonSafeValue>(
  state: ProjectWorkspaceStore<W>,
  path: string,
  update: (current: ProjectWorkbench<W>) => ProjectWorkbench<W>,
) => {
  assertProjectWorkspaceShell(state)
  const target = selected(state, path)
  assertProjectWorkspaceEntryShell(target.entry, target.path)
  if (typeof update !== 'function') fail('Project workbench updater must be a function')
  const workbench = update(target.entry.workbench)
  assertJsonSafe(workbench, `Updated project workbench for "${target.path}"`)
  return Object.is(workbench, target.entry.workbench)
    ? state
    : {
        ...state,
        entriesByPath: {
          ...state.entriesByPath,
          [target.path]: { ...target.entry, workbench },
        },
      }
}
export const setProjectWorkbench = <W extends JsonSafeValue>(
  state: ProjectWorkspaceStore<W>,
  path: string,
  workbench: ProjectWorkbench<W>,
) => updateProjectWorkbench(state, path, () => workbench)

export const setProjectWorkspaceHydration = <W extends JsonSafeValue>(
  state: ProjectWorkspaceStore<W>,
  path: string,
  hydration: ProjectWorkspaceHydration,
) => {
  assertProjectWorkspaceStore(state)
  if (!validHydration(hydration)) fail('Project workspace hydration is invalid')
  const target = selected(state, path)
  return target.entry.hydration === hydration
    ? state
    : replaceEntry(state, target.path, { ...target.entry, hydration })
}
export const setProjectWorkspaceMetadata = <W extends JsonSafeValue>(
  state: ProjectWorkspaceStore<W>,
  path: string,
  project: DeepReadonly<RuntimeProject> | null,
) => {
  assertProjectWorkspaceStore(state)
  const target = selected(state, path)
  assertMetadata(project, target.path)
  return Object.is(target.entry.project, project)
    ? state
    : replaceEntry(state, target.path, { ...target.entry, project })
}
export const setProjectWorkspaceCloseBlockedReason = <W extends JsonSafeValue>(
  state: ProjectWorkspaceStore<W>,
  path: string,
  closeBlockedReason: string | null,
) => {
  assertProjectWorkspaceStore(state)
  if (closeBlockedReason !== null && typeof closeBlockedReason !== 'string') {
    fail('Project workspace close-block reason must be a string or null')
  }
  const target = selected(state, path)
  return target.entry.closeBlockedReason === closeBlockedReason
    ? state
    : replaceEntry(state, target.path, { ...target.entry, closeBlockedReason })
}
const closeStatus = <W extends JsonSafeValue>(entry: ProjectWorkspaceEntry<W>): ProjectWorkspaceCloseStatus =>
  entry.closeBlockedReason !== null && entry.closeBlockedReason !== undefined
    ? { blocked: true, reason: entry.closeBlockedReason }
    : { blocked: false, reason: null }
export const selectProjectWorkspaceCloseStatus = <W extends JsonSafeValue>(
  state: ProjectWorkspaceStore<W>,
  path: string,
) => {
  assertProjectWorkspaceStore(state)
  return closeStatus(selected(state, path).entry)
}
export const closeProjectWorkspace = <W extends JsonSafeValue>(
  state: ProjectWorkspaceStore<W>,
  path: string,
): CloseProjectWorkspaceResult<W> => {
  assertProjectWorkspaceStore(state)
  const target = selected(state, path)
  const status = closeStatus(target.entry)
  if (status.blocked) return { state, ...status }
  const index = state.openOrder.indexOf(target.path)
  const openOrder = state.openOrder.filter((openPath) => openPath !== target.path)
  const entriesByPath: Record<string, ProjectWorkspaceEntry<W>> = { ...state.entriesByPath }
  delete entriesByPath[target.path]
  const activePath =
    state.activePath === target.path
      ? (openOrder[index] ?? openOrder[index - 1] ?? null)
      : state.activePath
  return {
    state: validated({ openOrder, activePath, entriesByPath }),
    blocked: false,
    reason: null,
  }
}
export const closeProjectWorkspaceState = <W extends JsonSafeValue>(
  state: ProjectWorkspaceStore<W>,
  path: string,
) => closeProjectWorkspace(state, path).state
export const selectProjectWorkspaceEntry = <W extends JsonSafeValue>(
  state: ProjectWorkspaceStore<W>,
  value: string,
) => {
  const path = normalizePath(value)
  return state.openOrder.includes(path) && own(state.entriesByPath, path)
    ? state.entriesByPath[path]
    : undefined
}
export const selectProjectWorkbench = <W extends JsonSafeValue>(
  state: ProjectWorkspaceStore<W>,
  path: string,
) => selectProjectWorkspaceEntry(state, path)?.workbench
export const selectActiveProjectWorkbench = <W extends JsonSafeValue>(
  state: ProjectWorkspaceStore<W>,
) => (state.activePath === null ? null : (state.entriesByPath[state.activePath]?.workbench ?? null))
