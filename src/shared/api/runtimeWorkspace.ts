import { invoke } from '@tauri-apps/api/core'

import {
  hasTauriRuntime,
  type RuntimeAvailability,
  type RuntimeInvoker,
} from './runtimeProjects'

export type RuntimeWorkspaceSnapshot = {
  recentProjects: string[]
  lastOpenedProjectPath?: string | null
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
  lastOpenedProjectPath?: string | null
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

const omitUndefined = (values: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))

const saveSnapshotPayload = (
  request: SaveWorkspaceRuntimeSnapshotRequest,
): Record<string, unknown> =>
  omitUndefined({
    recentProjects: [...request.recentProjects],
    lastOpenedProjectPath: request.lastOpenedProjectPath,
  })

export const createWorkspaceRuntimeService = (
  options: WorkspaceRuntimeServiceOptions = {},
): WorkspaceRuntimeService => {
  const override = workspaceOverride()
  const hasRuntime = options.hasRuntime || override?.hasRuntime || hasTauriRuntime
  const invokeRuntime = options.invokeRuntime || override?.invokeRuntime || (invoke as RuntimeInvoker)

  const readRuntimeSnapshot = async (): Promise<RuntimeWorkspaceRuntimeSnapshot | null> => {
    if (!hasRuntime()) return null

    return invokeRuntime<RuntimeWorkspaceRuntimeSnapshot>('read_workspace_runtime_snapshot')
  }

  return {
    hasRuntime,
    readRuntimeSnapshot,
    readSnapshot: readRuntimeSnapshot,
    async saveSnapshot(request) {
      if (!hasRuntime()) return null

      return invokeRuntime<RuntimeWorkspaceSnapshot>('save_workspace_runtime_snapshot', {
        request: saveSnapshotPayload(request),
      })
    },
    async rememberProject(path) {
      if (!hasRuntime()) return null

      return invokeRuntime<RuntimeWorkspaceSnapshot>('remember_workspace_project', {
        request: { path },
      })
    },
  }
}
