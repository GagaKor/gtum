import { invoke } from '@tauri-apps/api/core'

import {
  hasTauriRuntime,
  type RuntimeAvailability,
  type RuntimeInvoker,
} from './runtimeProjects'

export type RuntimeWorkspaceSnapshot = {
  recentProjects: string[]
  openProjectPaths: string[]
  activeProjectPath: string | null
  lastOpenedProjectPath: string | null
  updatedAt: number
  storageVersion: number
}

export type RuntimeWorkspaceRuntimeSnapshot = {
  storagePath?: string | null
  snapshot: RuntimeWorkspaceSnapshot
  restoredAt: number
}

export type SaveWorkspaceRuntimeSnapshotRequest = {
  recentProjects: string[]
  openProjectPaths: string[]
  activeProjectPath: string | null
  lastOpenedProjectPath?: string | null
  updatedAt?: number
  storageVersion?: number
}

export type WorkspaceRuntimeServiceOptions = {
  hasRuntime?: RuntimeAvailability
  invokeRuntime?: RuntimeInvoker
}

export type WorkspaceRuntimeService = {
  hasRuntime: RuntimeAvailability
  readRuntimeSnapshot(): Promise<RuntimeWorkspaceRuntimeSnapshot | null>
  readSnapshot(): Promise<RuntimeWorkspaceRuntimeSnapshot | null>
  saveSnapshot(
    request: SaveWorkspaceRuntimeSnapshotRequest,
  ): Promise<RuntimeWorkspaceSnapshot | null>
  rememberProject(path: string): Promise<RuntimeWorkspaceSnapshot | null>
  openProject(path: string): Promise<RuntimeWorkspaceSnapshot | null>
  activateProject(path: string): Promise<RuntimeWorkspaceSnapshot | null>
  closeProject(path: string): Promise<RuntimeWorkspaceSnapshot | null>
}

type RuntimeWorkspaceOverride = {
  hasRuntime?: RuntimeAvailability
  invokeRuntime?: RuntimeInvoker
}

const workspaceOverride = (): RuntimeWorkspaceOverride | null => {
  if (typeof window === 'undefined') return null

  return (
    (window as Window & { __GTUM_WORKSPACE_RUNTIME__?: RuntimeWorkspaceOverride })
      .__GTUM_WORKSPACE_RUNTIME__ ?? null
  )
}

const invalidSnapshot = (reason: string): never => {
  throw new Error(`Invalid workspace snapshot: ${reason}`)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requiredNumber = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return invalidSnapshot(`${field} must be a finite number`)
  }
  return value
}

const normalizePath = (value: unknown, field: string): string | null => {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return invalidSnapshot(`${field} must be a string or null`)

  const normalized = value.trim()
  return normalized || null
}

const normalizePathList = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value)) return invalidSnapshot(`${field} must be an array`)

  const normalized: string[] = []
  for (const entry of value) {
    const path = normalizePath(entry, field)
    if (!path) return invalidSnapshot(`${field} cannot contain a blank path`)
    if (normalized.includes(path)) {
      return invalidSnapshot(`${field} cannot contain duplicate paths`)
    }
    normalized.push(path)
  }
  return normalized
}

export const normalizeRuntimeWorkspaceSnapshot = (
  value: unknown,
): RuntimeWorkspaceSnapshot => {
  if (!isRecord(value)) return invalidSnapshot('payload must be an object')

  const storageVersion = requiredNumber(value.storageVersion, 'storageVersion')
  const recentProjects = normalizePathList(value.recentProjects, 'recentProjects')
  const updatedAt = requiredNumber(value.updatedAt, 'updatedAt')

  if (storageVersion < 2) {
    const activeProjectPath = normalizePath(
      value.lastOpenedProjectPath,
      'lastOpenedProjectPath',
    )
    return {
      recentProjects,
      openProjectPaths: activeProjectPath ? [activeProjectPath] : [],
      activeProjectPath,
      lastOpenedProjectPath: activeProjectPath,
      updatedAt,
      storageVersion: 2,
    }
  }

  if (storageVersion !== 2) {
    return invalidSnapshot(`unsupported storageVersion ${storageVersion}`)
  }
  if (!Object.hasOwn(value, 'openProjectPaths') || !Object.hasOwn(value, 'activeProjectPath')) {
    return invalidSnapshot('v2 fields openProjectPaths and activeProjectPath are required')
  }

  const openProjectPaths = normalizePathList(value.openProjectPaths, 'openProjectPaths')
  const activeProjectPath = normalizePath(value.activeProjectPath, 'activeProjectPath')
  if (openProjectPaths.length === 0 && activeProjectPath) {
    return invalidSnapshot('active project cannot exist when no projects are open')
  }
  if (openProjectPaths.length > 0 && !activeProjectPath) {
    return invalidSnapshot('active project is required when projects are open')
  }
  if (activeProjectPath && !openProjectPaths.includes(activeProjectPath)) {
    return invalidSnapshot('active project must be a member of openProjectPaths')
  }

  return {
    recentProjects,
    openProjectPaths,
    activeProjectPath,
    lastOpenedProjectPath: activeProjectPath,
    updatedAt,
    storageVersion: 2,
  }
}

const normalizeRuntimeSnapshot = (value: unknown): RuntimeWorkspaceRuntimeSnapshot => {
  if (!isRecord(value)) return invalidSnapshot('runtime payload must be an object')

  const storagePath = value.storagePath
  if (storagePath !== undefined && storagePath !== null && typeof storagePath !== 'string') {
    return invalidSnapshot('storagePath must be a string or null')
  }

  return {
    ...(storagePath === undefined ? {} : { storagePath }),
    snapshot: normalizeRuntimeWorkspaceSnapshot(value.snapshot),
    restoredAt: requiredNumber(value.restoredAt, 'restoredAt'),
  }
}

const omitUndefined = (values: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))

const saveSnapshotPayload = (
  request: SaveWorkspaceRuntimeSnapshotRequest,
): Record<string, unknown> =>
  omitUndefined({
    recentProjects: [...request.recentProjects],
    openProjectPaths: [...request.openProjectPaths],
    activeProjectPath: request.activeProjectPath,
    lastOpenedProjectPath: request.lastOpenedProjectPath,
    updatedAt: request.updatedAt,
    storageVersion: request.storageVersion ?? 2,
  })

export const createWorkspaceRuntimeService = (
  options: WorkspaceRuntimeServiceOptions = {},
): WorkspaceRuntimeService => {
  const override = workspaceOverride()
  const hasRuntime = options.hasRuntime || override?.hasRuntime || hasTauriRuntime
  const invokeRuntime = options.invokeRuntime || override?.invokeRuntime || (invoke as RuntimeInvoker)

  const readRuntimeSnapshot = async (): Promise<RuntimeWorkspaceRuntimeSnapshot | null> => {
    if (!hasRuntime()) return null

    const response = await invokeRuntime<unknown>('read_workspace_runtime_snapshot')
    return normalizeRuntimeSnapshot(response)
  }

  const invokeProjectTransition = async (
    command: string,
    path: string,
  ): Promise<RuntimeWorkspaceSnapshot | null> => {
    if (!hasRuntime()) return null

    const response = await invokeRuntime<unknown>(command, { request: { path } })
    return normalizeRuntimeWorkspaceSnapshot(response)
  }

  return {
    hasRuntime,
    readRuntimeSnapshot,
    readSnapshot: readRuntimeSnapshot,
    async saveSnapshot(request) {
      if (!hasRuntime()) return null

      const response = await invokeRuntime<unknown>('save_workspace_runtime_snapshot', {
        request: saveSnapshotPayload(request),
      })
      return normalizeRuntimeWorkspaceSnapshot(response)
    },
    rememberProject: (path) => invokeProjectTransition('remember_workspace_project', path),
    openProject: (path) => invokeProjectTransition('open_workspace_project', path),
    activateProject: (path) => invokeProjectTransition('activate_workspace_project', path),
    closeProject: (path) => invokeProjectTransition('close_workspace_project', path),
  }
}
