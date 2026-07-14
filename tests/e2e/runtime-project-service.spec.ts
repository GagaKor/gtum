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
  let fallbackProjectPath: string | undefined
  const staleFallbackOwner = (projectPath?: string): string => {
    fallbackProjectPath = projectPath
    return '/stale-fallback-owner'
  }

  const fixtureSnapshot = (
    filePath: string,
    fallbackName?: string,
    projectPath?: string,
  ): ProjectFileSnapshot => ({
    id: 'ed-fallback',
    type: 'editor',
    title: fallbackName ?? 'fixture.tsx',
    projectPath: staleFallbackOwner(projectPath),
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
  expect(fallbackProjectPath).toBe('/fixture')
  expect(snapshot.projectPath).toBe('/fixture')
  expect(invokedRuntime).toBe(false)
})

test('maps the canonical runtime project owner onto a read file snapshot', async () => {
  const service = createProjectRuntimeService({
    fallbackProject,
    hasRuntime: () => true,
    invokeRuntime: async () => ({
      projectPath: '/canonical/fixture',
      filePath: '/canonical/fixture/src/main.tsx',
      displayPath: 'src/main.tsx',
      content: 'runtime content',
      contentHash: 'runtime-hash',
      isText: true,
      truncated: false,
    }),
  })

  const snapshot = await service.readProjectFile(
    { path: '/fixture-link', runtimeBacked: true },
    'src/main.tsx',
  )

  expect(snapshot.projectPath).toBe('/canonical/fixture')
})

test('rejects saving an A-owned file through project B before runtime invocation', async () => {
  let invokeCount = 0
  const service = createProjectRuntimeService({
    fallbackProject,
    hasRuntime: () => true,
    invokeRuntime: async () => {
      invokeCount += 1
      throw new Error('runtime must not be invoked')
    },
  })

  await expect(
    service.saveProjectFile(
      { path: '/projects/B', runtimeBacked: true },
      {
        projectPath: '/projects/A',
        path: '/projects/A/src/main.tsx',
        content: 'saved content',
        contentHash: 'before-save',
      },
    ),
  ).rejects.toThrow(/project owner/i)

  expect(invokeCount).toBe(0)
})

test('rejects a save with a missing file owner before runtime invocation', async () => {
  let invokeCount = 0
  const service = createProjectRuntimeService({
    fallbackProject,
    hasRuntime: () => true,
    invokeRuntime: async () => {
      invokeCount += 1
      throw new Error('runtime must not be invoked')
    },
  })
  const ownerlessFile = {
    path: '/projects/A/src/main.tsx',
    content: 'saved content',
    contentHash: 'before-save',
  } as unknown as Pick<
    ProjectFileSnapshot,
    'projectPath' | 'path' | 'content' | 'contentHash'
  >

  await expect(
    service.saveProjectFile(
      { path: '/projects/A', runtimeBacked: true },
      ownerlessFile,
    ),
  ).rejects.toThrow(/file project owner.*missing/i)

  expect(invokeCount).toBe(0)
})

test('saves runtime-backed files with the immutable file owner and content hash guard', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const service = createProjectRuntimeService({
    fallbackProject,
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })

      return {
        projectPath: '/fixture',
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
      projectPath: '/fixture/',
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
          projectPath: '/fixture/',
          filePath: '/fixture/src/main.tsx',
          content: 'saved content',
          expectedContentHash: 'before-save',
        },
      },
    },
  ])
  expect(snapshot.content).toBe('saved content')
  expect(snapshot.projectPath).toBe('/fixture')
  expect(snapshot.contentHash).toBe('after-save')
  expect(snapshot.dirty).toBe(false)
})

test('matches Windows project owners across slash and path-case differences', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const service = createProjectRuntimeService({
    fallbackProject,
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })
      return {
        projectPath: 'c:/WORK/REPO',
        filePath: 'c:/WORK/REPO/main.ts',
        content: 'saved content',
        contentHash: 'after-save',
        isText: true,
        truncated: false,
      }
    },
  })

  const snapshot = await service.saveProjectFile(
    { path: 'c:/work/repo', runtimeBacked: true },
    {
      projectPath: 'C:\\Work\\Repo\\',
      path: 'C:\\Work\\Repo\\main.ts',
      content: 'saved content',
      contentHash: null,
    },
  )

  expect(invoked[0].args).toEqual({
    request: {
      projectPath: 'C:\\Work\\Repo\\',
      filePath: 'C:\\Work\\Repo\\main.ts',
      content: 'saved content',
      expectedContentHash: undefined,
    },
  })
  expect(snapshot.projectPath).toBe('c:/WORK/REPO')
})

test('rejects a mixed-owner patch before runtime invocation', async () => {
  let invokeCount = 0
  const service = createProjectRuntimeService({
    fallbackProject,
    hasRuntime: () => true,
    invokeRuntime: async () => {
      invokeCount += 1
      throw new Error('runtime must not be invoked')
    },
  })

  await expect(
    service.applyProjectPatch(
      { path: '/projects/A', runtimeBacked: true },
      [
        {
          projectPath: '/projects/A',
          path: '/projects/A/one.ts',
          content: 'one',
          contentHash: null,
        },
        {
          projectPath: '/projects/B',
          path: '/projects/B/two.ts',
          content: 'two',
          contentHash: null,
        },
      ],
    ),
  ).rejects.toThrow(/project owner/i)

  expect(invokeCount).toBe(0)
})

test('rejects a patch edit with a blank owner before runtime invocation', async () => {
  let invokeCount = 0
  const service = createProjectRuntimeService({
    fallbackProject,
    hasRuntime: () => true,
    invokeRuntime: async () => {
      invokeCount += 1
      throw new Error('runtime must not be invoked')
    },
  })

  await expect(
    service.applyProjectPatch(
      { path: '/projects/A', runtimeBacked: true },
      [
        {
          projectPath: '   ',
          path: '/projects/A/main.ts',
          content: 'patch me',
          contentHash: null,
        },
      ],
    ),
  ).rejects.toThrow(/patch project owner.*missing/i)

  expect(invokeCount).toBe(0)
})

test('rejects an empty patch because it has no immutable common owner', async () => {
  let invokeCount = 0
  const service = createProjectRuntimeService({
    fallbackProject,
    hasRuntime: () => true,
    invokeRuntime: async () => {
      invokeCount += 1
      throw new Error('runtime must not be invoked')
    },
  })

  await expect(
    service.applyProjectPatch(
      { path: '/projects/A', runtimeBacked: true },
      [],
    ),
  ).rejects.toThrow(/at least one project-owned file edit/i)

  expect(invokeCount).toBe(0)
})

test('applies agent patch edits through the immutable common owner', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = []
  const service = createProjectRuntimeService({
    fallbackProject,
    hasRuntime: () => true,
    invokeRuntime: async (command, args) => {
      invoked.push({ command, args })

      return {
        appliedFiles: [
          {
            projectPath: '/fixture',
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
        projectPath: '/fixture',
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
  expect(snapshots[0].projectPath).toBe('/fixture')
  expect(snapshots[0].content).toBe('patched content')
  expect(snapshots[0].contentHash).toBe('after-patch')
})

test('rejects a save response owned by another project', async () => {
  const service = createProjectRuntimeService({
    fallbackProject,
    hasRuntime: () => true,
    invokeRuntime: async () => ({
      projectPath: '/projects/B',
      filePath: '/projects/B/main.ts',
      content: 'wrong owner',
      contentHash: 'after-save',
      isText: true,
      truncated: false,
    }),
  })

  await expect(
    service.saveProjectFile(
      { path: '/projects/A', runtimeBacked: true },
      {
        projectPath: '/projects/A',
        path: '/projects/A/main.ts',
        content: 'save me',
        contentHash: null,
      },
    ),
  ).rejects.toThrow(/runtime.*project owner/i)
})

test('rejects a patch response owned by another project', async () => {
  const service = createProjectRuntimeService({
    fallbackProject,
    hasRuntime: () => true,
    invokeRuntime: async () => ({
      appliedFiles: [
        {
          projectPath: '/projects/B',
          filePath: '/projects/B/main.ts',
          content: 'wrong owner',
          contentHash: 'after-patch',
          isText: true,
          truncated: false,
        },
      ],
    }),
  })

  await expect(
    service.applyProjectPatch(
      { path: '/projects/A', runtimeBacked: true },
      [
        {
          projectPath: '/projects/A',
          path: '/projects/A/main.ts',
          content: 'patch me',
          contentHash: null,
        },
      ],
    ),
  ).rejects.toThrow(/runtime.*project owner/i)
})
