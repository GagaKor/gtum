import { expect, test } from '@playwright/test'

import {
  createWorkspaceRuntimeService,
  type RuntimeWorkspaceRuntimeSnapshot,
  type RuntimeWorkspaceSnapshot,
} from '../../src/shared/api/runtimeWorkspace'

const runtimeSnapshot: RuntimeWorkspaceRuntimeSnapshot = {
  storagePath: '/Users/kwon/Library/Application Support/gtum/workspace-state.json',
  snapshot: {
    recentProjects: ['/workspace/gtum'],
    lastOpenedProjectPath: '/workspace/gtum',
    executionMode: 'balanced',
    updatedAt: 100,
    storageVersion: 1,
  },
  restoredAt: 120,
}

const savedSnapshot: RuntimeWorkspaceSnapshot = {
  recentProjects: ['/workspace/gtum', '/workspace/other'],
  lastOpenedProjectPath: '/workspace/gtum',
  executionMode: 'fast',
  updatedAt: 130,
  storageVersion: 1,
}

const rememberedSnapshot: RuntimeWorkspaceSnapshot = {
  recentProjects: ['/workspace/gtum'],
  lastOpenedProjectPath: '/workspace/gtum',
  executionMode: 'balanced',
  updatedAt: 140,
  storageVersion: 1,
}

const deepModeSnapshot: RuntimeWorkspaceSnapshot = {
  recentProjects: ['/workspace/gtum'],
  lastOpenedProjectPath: '/workspace/gtum',
  executionMode: 'deep',
  updatedAt: 150,
  storageVersion: 1,
}

test('reads and writes workspace snapshots through Tauri workspace commands', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const service = createWorkspaceRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })

      if (command === 'read_workspace_runtime_snapshot') return runtimeSnapshot
      if (command === 'save_workspace_runtime_snapshot') return savedSnapshot
      if (command === 'remember_workspace_project') return rememberedSnapshot
      if (command === 'set_workspace_execution_mode') return deepModeSnapshot

      throw new Error(`unexpected workspace command: ${command}`)
    },
  })

  const restored = await service.readSnapshot()
  const saved = await service.saveSnapshot({
    recentProjects: ['/workspace/gtum', '/workspace/other'],
    lastOpenedProjectPath: '/workspace/gtum',
    executionMode: 'fast',
  })
  const remembered = await service.rememberProject('/workspace/gtum')
  const mode = await service.setExecutionMode('deep')

  expect(invoked).toEqual([
    {
      command: 'read_workspace_runtime_snapshot',
      args: undefined,
    },
    {
      command: 'save_workspace_runtime_snapshot',
      args: {
        request: {
          recentProjects: ['/workspace/gtum', '/workspace/other'],
          lastOpenedProjectPath: '/workspace/gtum',
          executionMode: 'fast',
        },
      },
    },
    {
      command: 'remember_workspace_project',
      args: {
        request: {
          path: '/workspace/gtum',
        },
      },
    },
    {
      command: 'set_workspace_execution_mode',
      args: {
        request: {
          executionMode: 'deep',
        },
      },
    },
  ])
  expect(restored).toEqual(runtimeSnapshot)
  expect(saved).toEqual(savedSnapshot)
  expect(remembered).toEqual(rememberedSnapshot)
  expect(mode).toEqual(deepModeSnapshot)
})

test('keeps browser preview workspace persistence local when desktop runtime is unavailable', async () => {
  let invokedRuntime = false
  const service = createWorkspaceRuntimeService({
    hasRuntime: () => false,
    invokeRuntime: async () => {
      invokedRuntime = true
      throw new Error('runtime should not be invoked in browser fallback')
    },
  })

  const restored = await service.readSnapshot()
  const saved = await service.saveSnapshot({
    recentProjects: ['/workspace/gtum'],
    lastOpenedProjectPath: '/workspace/gtum',
    executionMode: 'fast',
  })
  const remembered = await service.rememberProject('/workspace/gtum')
  const mode = await service.setExecutionMode('deep')

  expect(invokedRuntime).toBe(false)
  expect(restored).toBeNull()
  expect(saved).toBeNull()
  expect(remembered).toBeNull()
  expect(mode).toBeNull()
})
