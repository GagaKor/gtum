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
