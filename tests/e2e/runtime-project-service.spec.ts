import { expect, test } from '@playwright/test'

import {
  createProjectRuntimeService,
  type ProjectFileSnapshot,
  type RuntimeProject,
} from '../../src/shared/api/runtimeProjects'

const fallbackProject: RuntimeProject = {
  id: 'fixture',
  name: 'fixture',
  path: '/fixture',
  branch: 'main',
  branchType: 'local',
  ahead: 0,
  behind: 0,
  changedFiles: 0,
  fileTree: [],
  runtimeBacked: false,
}

test('uses an injected fallback file reader when desktop runtime is unavailable', async () => {
  let invokedRuntime = false

  const fixtureSnapshot = (filePath: string, fallbackName?: string): ProjectFileSnapshot => ({
    id: 'ed-fallback',
    type: 'editor',
    title: fallbackName ?? 'fixture.tsx',
    path: filePath,
    displayPath: filePath,
    lang: 'tsx',
    content: 'injected fallback content',
    contentHash: null,
    isText: true,
    truncated: false,
    dirty: false,
    status: 'idle',
    cwd: '.',
    cmd: null,
    shell: null,
    lines: [],
  })

  const service = createProjectRuntimeService({
    fallbackProject,
    fallbackFileReader: fixtureSnapshot,
    hasRuntime: () => false,
    invokeRuntime: async () => {
      invokedRuntime = true
      throw new Error('runtime should not be invoked in browser fallback')
    },
  })

  const snapshot = await service.readProjectFile(
    fallbackProject,
    'src/main.tsx',
    'main.tsx',
  )

  expect(snapshot.content).toBe('injected fallback content')
  expect(snapshot.title).toBe('main.tsx')
  expect(invokedRuntime).toBe(false)
})

test('saves runtime-backed files with the current content hash guard', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const service = createProjectRuntimeService({
    fallbackProject,
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })

      return {
        filePath: '/fixture/src/main.tsx',
        displayPath: 'src/main.tsx',
        content: 'saved content',
        contentHash: 'after-save',
        isText: true,
        truncated: false,
      }
    },
  })

  const snapshot = await service.saveProjectFile(
    { path: '/fixture', runtimeBacked: true },
    {
      path: '/fixture/src/main.tsx',
      content: 'saved content',
      contentHash: 'before-save',
    },
  )

  expect(invoked).toEqual([
    {
      command: 'write_project_file',
      args: {
        request: {
          projectPath: '/fixture',
          filePath: '/fixture/src/main.tsx',
          content: 'saved content',
          expectedContentHash: 'before-save',
        },
      },
    },
  ])
  expect(snapshot.content).toBe('saved content')
  expect(snapshot.contentHash).toBe('after-save')
  expect(snapshot.dirty).toBe(false)
})

test('applies agent patch edits through the runtime patch command', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const service = createProjectRuntimeService({
    fallbackProject,
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })

      return {
        appliedFiles: [
          {
            filePath: '/fixture/src/main.tsx',
            displayPath: 'src/main.tsx',
            content: 'patched content',
            contentHash: 'after-patch',
            isText: true,
            truncated: false,
          },
        ],
      }
    },
  })

  const snapshots = await service.applyProjectPatch(
    { path: '/fixture', runtimeBacked: true },
    [
      {
        path: '/fixture/src/main.tsx',
        content: 'patched content',
        contentHash: 'before-patch',
      },
    ],
  )

  expect(invoked).toEqual([
    {
      command: 'apply_project_patch',
      args: {
        request: {
          projectPath: '/fixture',
          edits: [
            {
              filePath: '/fixture/src/main.tsx',
              content: 'patched content',
              expectedContentHash: 'before-patch',
            },
          ],
        },
      },
    },
  ])
  expect(snapshots).toHaveLength(1)
  expect(snapshots[0].content).toBe('patched content')
  expect(snapshots[0].contentHash).toBe('after-patch')
})
