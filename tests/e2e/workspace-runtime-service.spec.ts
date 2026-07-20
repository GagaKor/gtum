import { expect, test } from '@playwright/test'

import {
  createWorkspaceRuntimeService,
  normalizeRuntimeWorkspaceSnapshot,
  type RuntimeWorkspaceRuntimeSnapshot,
  type RuntimeWorkspaceSnapshot,
  type SaveWorkspaceRuntimeSnapshotRequest,
} from '../../src/shared/api/runtimeWorkspace'

const projectA = '/workspace/gtum'
const projectB = '/workspace/other'

const v2Snapshot: RuntimeWorkspaceSnapshot = {
  recentProjects: [projectA, projectB],
  openProjectPaths: [projectA, projectB],
  activeProjectPath: projectA,
  lastOpenedProjectPath: projectA,
  updatedAt: 130,
  storageVersion: 2,
}

const runtimeSnapshot: RuntimeWorkspaceRuntimeSnapshot = {
  storagePath: '/Users/kwon/Library/Application Support/gtum/workspace-state.json',
  snapshot: v2Snapshot,
  restoredAt: 140,
}

test('uses exact v2 workspace command envelopes and omits undefined save keys', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const service = createWorkspaceRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })
      return command === 'read_workspace_runtime_snapshot'
        ? runtimeSnapshot
        : v2Snapshot
    },
  })
  const saveRequest: SaveWorkspaceRuntimeSnapshotRequest = {
    recentProjects: [projectA, projectB],
    openProjectPaths: [projectA, projectB],
    activeProjectPath: projectA,
    lastOpenedProjectPath: undefined,
    updatedAt: undefined,
    storageVersion: 2,
  }

  const restored = await service.readSnapshot()
  const saved = await service.saveSnapshot(saveRequest)
  const remembered = await service.rememberProject(projectA)
  const opened = await service.openProject(projectB)
  const activated = await service.activateProject(projectA)
  const closed = await service.closeProject(projectB)

  expect(invoked).toEqual([
    { command: 'read_workspace_runtime_snapshot', args: undefined },
    {
      command: 'save_workspace_runtime_snapshot',
      args: {
        request: {
          recentProjects: [projectA, projectB],
          openProjectPaths: [projectA, projectB],
          activeProjectPath: projectA,
          storageVersion: 2,
        },
      },
    },
    {
      command: 'remember_workspace_project',
      args: { request: { path: projectA } },
    },
    {
      command: 'open_workspace_project',
      args: { request: { path: projectB } },
    },
    {
      command: 'activate_workspace_project',
      args: { request: { path: projectA } },
    },
    {
      command: 'close_workspace_project',
      args: { request: { path: projectB } },
    },
  ])
  expect(restored).toEqual(runtimeSnapshot)
  expect([saved, remembered, opened, activated, closed]).toEqual([
    v2Snapshot,
    v2Snapshot,
    v2Snapshot,
    v2Snapshot,
    v2Snapshot,
  ])
})

test('normalizes legacy v1 read, save, and remember responses into v2 state', async () => {
  const legacySnapshot = {
    recentProjects: [projectB, projectA],
    lastOpenedProjectPath: projectA,
    updatedAt: 90,
    storageVersion: 1,
  }
  const normalizedLegacy: RuntimeWorkspaceSnapshot = {
    recentProjects: [projectB, projectA],
    openProjectPaths: [projectA],
    activeProjectPath: projectA,
    lastOpenedProjectPath: projectA,
    updatedAt: 90,
    storageVersion: 2,
  }
  const service = createWorkspaceRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async (command) =>
      command === 'read_workspace_runtime_snapshot'
        ? { storagePath: '/tmp/workspace.json', snapshot: legacySnapshot, restoredAt: 95 }
        : legacySnapshot,
  })

  expect(normalizeRuntimeWorkspaceSnapshot(legacySnapshot)).toEqual(normalizedLegacy)
  expect(
    normalizeRuntimeWorkspaceSnapshot({
      ...legacySnapshot,
      recentProjects: [],
      lastOpenedProjectPath: null,
    }),
  ).toEqual({
    ...normalizedLegacy,
    recentProjects: [],
    openProjectPaths: [],
    activeProjectPath: null,
    lastOpenedProjectPath: null,
  })

  const restored = await service.readSnapshot()
  const saved = await service.saveSnapshot({
    recentProjects: [projectA],
    openProjectPaths: [projectA],
    activeProjectPath: projectA,
  })
  const remembered = await service.rememberProject(projectA)

  expect(restored).toEqual({
    storagePath: '/tmp/workspace.json',
    snapshot: normalizedLegacy,
    restoredAt: 95,
  })
  expect(saved).toEqual(normalizedLegacy)
  expect(remembered).toEqual(normalizedLegacy)
})

test('rejects invalid v2 active project membership instead of guessing', async () => {
  const invalidSnapshots = [
    {
      ...v2Snapshot,
      openProjectPaths: [projectA],
      activeProjectPath: projectB,
      lastOpenedProjectPath: projectB,
    },
    {
      ...v2Snapshot,
      openProjectPaths: [projectA],
      activeProjectPath: null,
      lastOpenedProjectPath: null,
    },
    {
      ...v2Snapshot,
      openProjectPaths: [],
      activeProjectPath: projectA,
      lastOpenedProjectPath: projectA,
    },
  ]

  for (const snapshot of invalidSnapshots) {
    expect(() => normalizeRuntimeWorkspaceSnapshot(snapshot)).toThrow(
      /workspace snapshot.*active project/i,
    )
  }

  const service = createWorkspaceRuntimeService({
    hasRuntime: () => true,
    invokeRuntime: async () => invalidSnapshots[0],
  })
  await expect(service.openProject(projectA)).rejects.toThrow(
    /workspace snapshot.*active project/i,
  )
})

test('requires an explicit nullable activeProjectPath in v2 payloads', () => {
  const missingActive = { ...v2Snapshot } as Record<string, unknown>
  delete missingActive.activeProjectPath
  const invalidSnapshots = [
    {
      ...v2Snapshot,
      recentProjects: [],
      openProjectPaths: [],
      activeProjectPath: undefined,
      lastOpenedProjectPath: null,
    },
    missingActive,
    { ...v2Snapshot, activeProjectPath: 42 },
  ]

  for (const snapshot of invalidSnapshots) {
    expect(() => normalizeRuntimeWorkspaceSnapshot(snapshot)).toThrow(/activeProjectPath/)
  }
})

test('requires an explicit matching nullable lastOpenedProjectPath in v2 payloads', () => {
  const missingAlias = { ...v2Snapshot } as Record<string, unknown>
  delete missingAlias.lastOpenedProjectPath
  const invalidSnapshots = [
    missingAlias,
    { ...v2Snapshot, lastOpenedProjectPath: undefined },
    { ...v2Snapshot, lastOpenedProjectPath: 42 },
    { ...v2Snapshot, lastOpenedProjectPath: projectB },
  ]

  for (const snapshot of invalidSnapshots) {
    expect(() => normalizeRuntimeWorkspaceSnapshot(snapshot)).toThrow(
      /lastOpenedProjectPath/,
    )
  }
})

test('enforces Rust-compatible timestamp and storage-version number domains', () => {
  for (const updatedAt of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => normalizeRuntimeWorkspaceSnapshot({ ...v2Snapshot, updatedAt })).toThrow(
      /updatedAt/,
    )
  }

  for (const storageVersion of [-1, 1.5, 3, 4_294_967_296, Number.NaN]) {
    expect(() =>
      normalizeRuntimeWorkspaceSnapshot({ ...v2Snapshot, storageVersion }),
    ).toThrow(/storageVersion/)
  }

  expect(
    normalizeRuntimeWorkspaceSnapshot({
      recentProjects: [],
      lastOpenedProjectPath: null,
      updatedAt: Number.MAX_SAFE_INTEGER,
      storageVersion: 0,
    }),
  ).toMatchObject({ updatedAt: Number.MAX_SAFE_INTEGER, storageVersion: 2 })
})

test('returns null for every workspace method when desktop runtime is unavailable', async () => {
  let invokedRuntime = false
  const service = createWorkspaceRuntimeService({
    hasRuntime: () => false,
    invokeRuntime: async () => {
      invokedRuntime = true
      throw new Error('runtime should not be invoked in browser fallback')
    },
  })

  const results = await Promise.all([
    service.readSnapshot(),
    service.saveSnapshot({
      recentProjects: [projectA],
      openProjectPaths: [projectA],
      activeProjectPath: projectA,
    }),
    service.rememberProject(projectA),
    service.openProject(projectA),
    service.activateProject(projectA),
    service.closeProject(projectA),
  ])

  expect(invokedRuntime).toBe(false)
  expect(results).toEqual([null, null, null, null, null, null])
})
