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

test('uses the injected design fixture reader when desktop runtime is unavailable', async () => {
  let invokedRuntime = false

  const fixtureSnapshot = (filePath: string, fallbackName?: string): ProjectFileSnapshot => ({
    id: 'ed-fixture',
    type: 'editor',
    title: fallbackName ?? 'fixture.tsx',
    path: filePath,
    displayPath: filePath,
    lang: 'tsx',
    content: 'design fixture content',
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
    'apps/web/src/OnboardingFunnel.tsx',
    'OnboardingFunnel.tsx',
  )

  expect(snapshot.content).toBe('design fixture content')
  expect(snapshot.title).toBe('OnboardingFunnel.tsx')
  expect(invokedRuntime).toBe(false)
})
