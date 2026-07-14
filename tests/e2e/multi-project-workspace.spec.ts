import { expect, test } from '@playwright/test'

type RuntimeCall = {
  command: string
  args?: Record<string, unknown>
}

const projectA = '/workspace/project-a'
const projectB = '/workspace/project-b'
const projectC = '/workspace/project-c'

test('restores every open project row while hydrating only the active project until selection', async ({ page }) => {
  await page.addInitScript(({ projectA, projectB }) => {
    const bridgeWindow = window as Window & {
      __workspaceCalls: RuntimeCall[]
      __projectCalls: RuntimeCall[]
      __folderPickerCalls: number
      __GTUM_WORKSPACE_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
      __GTUM_PROJECT_FOLDER_PICKER__: unknown
    }
    const snapshot = (activeProjectPath: string) => ({
      recentProjects: [projectB, projectA],
      openProjectPaths: [projectA, projectB],
      activeProjectPath,
      lastOpenedProjectPath: activeProjectPath,
      updatedAt: 200,
      storageVersion: 2,
    })

    bridgeWindow.__workspaceCalls = []
    bridgeWindow.__projectCalls = []
    bridgeWindow.__folderPickerCalls = 0
    bridgeWindow.__GTUM_PROJECT_FOLDER_PICKER__ = {
      pick: async () => {
        bridgeWindow.__folderPickerCalls += 1
        return projectB
      },
    }
    bridgeWindow.__GTUM_WORKSPACE_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__workspaceCalls.push({ command, args })
        if (command === 'read_workspace_runtime_snapshot') {
          return {
            storagePath: '/tmp/workspace-state.json',
            snapshot: snapshot(projectB),
            restoredAt: 210,
          }
        }
        if (command === 'activate_workspace_project') {
          const request = args?.request as { path: string }
          return snapshot(request.path)
        }
        throw new Error(`Unexpected workspace command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__projectCalls.push({ command, args })
        const path = String(args?.path)
        const suffix = path === projectA ? 'a' : 'b'
        return {
          metadata: { name: `project-${suffix}`, path },
          tree: {
            name: `project-${suffix}`,
            path,
            kind: 'directory',
            children: [{ name: `${suffix}.ts`, path: `src/${suffix}.ts`, kind: 'file' }],
          },
          git: {
            isRepository: true,
            branch: `feature/${suffix}`,
            branchType: 'feature',
            changedFilesCount: suffix === 'a' ? 1 : 2,
          },
        }
      },
    }
  }, { projectA, projectB })

  await page.goto('/')

  const switcher = page.locator('.project-switcher')
  const rowA = switcher.locator('[data-project-path="/workspace/project-a"]')
  const rowB = switcher.locator('[data-project-path="/workspace/project-b"]')
  await expect(rowA).toBeVisible()
  await expect(rowA).toContainText('project-a')
  await expect(rowB).toBeVisible()
  await expect(rowB).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.titlebar')).toContainText('project-b')
  await expect(page.locator('.tree-row.file')).toContainText('b.ts')

  await expect.poll(() => page.evaluate(() => (
    window as Window & { __projectCalls?: RuntimeCall[] }
  ).__projectCalls ?? [])).toEqual([
    { command: 'read_project_overview', args: { path: projectB } },
  ])

  await rowA.click()

  await expect(rowA).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.titlebar')).toContainText('project-a')
  await expect(page.locator('.tree-row.file')).toContainText('a.ts')
  const calls = await page.evaluate(() => ({
    workspace: (window as Window & { __workspaceCalls?: RuntimeCall[] }).__workspaceCalls ?? [],
    project: (window as Window & { __projectCalls?: RuntimeCall[] }).__projectCalls ?? [],
    picker: (window as Window & { __folderPickerCalls?: number }).__folderPickerCalls ?? 0,
  }))
  expect(calls.workspace).toContainEqual({
    command: 'activate_workspace_project',
    args: { request: { path: projectA } },
  })
  expect(calls.project).toContainEqual({
    command: 'read_project_overview',
    args: { path: projectA },
  })
  expect(calls.picker).toBe(0)
})

test('ignores a delayed initial restore after a newer open transition completes', async ({ page }) => {
  await page.addInitScript(({ projectA, projectC }) => {
    const bridgeWindow = window as Window & {
      __initialReadPending: boolean
      __persistedActive: string
      __resolveInitialSnapshot?: () => void
      __GTUM_PROJECT_FOLDER_PICKER__: unknown
      __GTUM_WORKSPACE_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
    }
    const snapshot = (path: string) => ({
      recentProjects: [path],
      openProjectPaths: [path],
      activeProjectPath: path,
      lastOpenedProjectPath: path,
      updatedAt: 220,
      storageVersion: 2,
    })

    bridgeWindow.__initialReadPending = false
    bridgeWindow.__persistedActive = projectA
    bridgeWindow.__GTUM_PROJECT_FOLDER_PICKER__ = { pick: async () => projectC }
    bridgeWindow.__GTUM_WORKSPACE_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        if (command === 'read_workspace_runtime_snapshot') {
          bridgeWindow.__initialReadPending = true
          return new Promise((resolve) => {
            bridgeWindow.__resolveInitialSnapshot = () => resolve({
              snapshot: snapshot(projectA),
              restoredAt: 230,
            })
          })
        }
        const path = (args?.request as { path: string }).path
        bridgeWindow.__persistedActive = path
        return snapshot(path)
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (_command: string, args?: Record<string, unknown>) => {
        const path = String(args?.path)
        return {
          metadata: { name: path === projectC ? 'project-c' : 'project-a', path },
          tree: { name: 'root', path, kind: 'directory', children: [] },
          git: { isRepository: true, branch: 'dev', changedFilesCount: 0 },
        }
      },
    }
  }, { projectA, projectC })

  await page.goto('/')
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __initialReadPending?: boolean }
  ).__initialReadPending ?? false)).toBe(true)
  await page.getByText('Open project folder').click()
  await expect(page.locator('.titlebar')).toContainText('project-c')

  await page.evaluate(() => {
    const resolveInitial = (window as Window & {
      __resolveInitialSnapshot?: () => void
    }).__resolveInitialSnapshot
    if (!resolveInitial) throw new Error('Initial workspace snapshot was not pending')
    resolveInitial()
  })

  await expect(page.locator('.titlebar')).toContainText('project-c')
  await expect(page.locator('[data-project-path="/workspace/project-c"]')).toBeVisible()
  await expect(page.locator('[data-project-path="/workspace/project-a"]')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __persistedActive?: string }
  ).__persistedActive)).toBe(projectC)
})

test('applies a delayed initial restore when the intervening open attempt fails', async ({ page }) => {
  await page.addInitScript(({ projectA, projectC }) => {
    const bridgeWindow = window as Window & {
      __initialReadPending: boolean
      __openFailed: boolean
      __resolveInitialSnapshot?: () => void
      __GTUM_PROJECT_FOLDER_PICKER__: unknown
      __GTUM_WORKSPACE_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
    }
    const snapshot = {
      recentProjects: [projectA],
      openProjectPaths: [projectA],
      activeProjectPath: projectA,
      lastOpenedProjectPath: projectA,
      updatedAt: 232,
      storageVersion: 2,
    }

    bridgeWindow.__initialReadPending = false
    bridgeWindow.__openFailed = false
    bridgeWindow.__GTUM_PROJECT_FOLDER_PICKER__ = { pick: async () => projectC }
    bridgeWindow.__GTUM_WORKSPACE_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string) => {
        if (command === 'read_workspace_runtime_snapshot') {
          bridgeWindow.__initialReadPending = true
          return new Promise((resolve) => {
            bridgeWindow.__resolveInitialSnapshot = () => resolve({
              snapshot,
              restoredAt: 233,
            })
          })
        }
        bridgeWindow.__openFailed = true
        throw new Error('open project C failed')
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async () => ({
        metadata: { name: 'project-a-restored', path: projectA },
        tree: { name: 'root', path: projectA, kind: 'directory', children: [] },
        git: { isRepository: true, branch: 'restore-a', changedFilesCount: 0 },
      }),
    }
  }, { projectA, projectC })

  await page.goto('/')
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __initialReadPending?: boolean }
  ).__initialReadPending ?? false)).toBe(true)
  await page.getByText('Open project folder').click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __openFailed?: boolean }
  ).__openFailed ?? false)).toBe(true)

  await page.evaluate(() => {
    const resolveInitial = (window as Window & {
      __resolveInitialSnapshot?: () => void
    }).__resolveInitialSnapshot
    if (!resolveInitial) throw new Error('Initial workspace snapshot was not pending')
    resolveInitial()
  })

  const rowA = page.locator(`[data-project-path="${projectA}"]`)
  await expect(rowA).toHaveAttribute('data-project-state', 'ready')
  await expect(page.locator('.titlebar')).toContainText('project-a-restored')
  await expect(page.locator(`[data-project-path="${projectC}"]`)).toHaveCount(0)
})

test('serializes project mutations so the latest activation is persisted last', async ({ page }) => {
  await page.addInitScript(({ projectA, projectB }) => {
    const bridgeWindow = window as Window & {
      __mutationStarts: string[]
      __mutationCommits: string[]
      __persistedActive: string
      __resolveActivationA?: () => void
      __GTUM_WORKSPACE_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
    }
    const snapshot = (activeProjectPath: string) => ({
      recentProjects: [projectA, projectB],
      openProjectPaths: [projectA, projectB],
      activeProjectPath,
      lastOpenedProjectPath: activeProjectPath,
      updatedAt: 240,
      storageVersion: 2,
    })

    bridgeWindow.__mutationStarts = []
    bridgeWindow.__mutationCommits = []
    bridgeWindow.__persistedActive = projectB
    bridgeWindow.__GTUM_WORKSPACE_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        if (command === 'read_workspace_runtime_snapshot') {
          return { snapshot: snapshot(projectB), restoredAt: 250 }
        }
        const path = (args?.request as { path: string }).path
        bridgeWindow.__mutationStarts.push(path)
        if (path === projectA) {
          await new Promise<void>((resolve) => {
            bridgeWindow.__resolveActivationA = resolve
          })
        }
        bridgeWindow.__persistedActive = path
        bridgeWindow.__mutationCommits.push(path)
        return snapshot(path)
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (_command: string, args?: Record<string, unknown>) => {
        const path = String(args?.path)
        return {
          metadata: { name: path === projectA ? 'project-a' : 'project-b', path },
          tree: { name: 'root', path, kind: 'directory', children: [] },
          git: { isRepository: true, branch: 'dev', changedFilesCount: 0 },
        }
      },
    }
  }, { projectA, projectB })

  await page.goto('/')
  const rowA = page.locator(`[data-project-path="${projectA}"]`)
  const rowB = page.locator(`[data-project-path="${projectB}"]`)
  await expect(page.locator('.titlebar')).toContainText('project-b')

  await rowA.click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __mutationStarts?: string[] }
  ).__mutationStarts ?? [])).toEqual([projectA])
  await rowB.click()

  expect(await page.evaluate(() => (
    window as Window & { __mutationStarts?: string[] }
  ).__mutationStarts ?? [])).toEqual([projectA])

  await page.evaluate(() => {
    const resolveA = (window as Window & { __resolveActivationA?: () => void }).__resolveActivationA
    if (!resolveA) throw new Error('Activation A was not pending')
    resolveA()
  })

  await expect.poll(() => page.evaluate(() => (
    window as Window & { __mutationCommits?: string[] }
  ).__mutationCommits ?? [])).toEqual([projectA, projectB])
  await expect(rowB).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.titlebar')).toContainText('project-b')
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __persistedActive?: string }
  ).__persistedActive)).toBe(projectB)
})

test('reconciles a stale successful mutation when the latest queued activation fails', async ({ page }) => {
  await page.addInitScript(({ projectA, projectB }) => {
    const bridgeWindow = window as Window & {
      __mutationStarts: string[]
      __mutationCommits: string[]
      __persistedActive: string
      __failNextB: boolean
      __resolveActivationA?: () => void
      __GTUM_WORKSPACE_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
    }
    const snapshot = (activeProjectPath: string) => ({
      recentProjects: [projectA, projectB],
      openProjectPaths: [projectA, projectB],
      activeProjectPath,
      lastOpenedProjectPath: activeProjectPath,
      updatedAt: 252,
      storageVersion: 2,
    })

    bridgeWindow.__mutationStarts = []
    bridgeWindow.__mutationCommits = []
    bridgeWindow.__persistedActive = projectB
    bridgeWindow.__failNextB = true
    bridgeWindow.__GTUM_WORKSPACE_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        if (command === 'read_workspace_runtime_snapshot') {
          return { snapshot: snapshot(projectB), restoredAt: 253 }
        }
        const path = (args?.request as { path: string }).path
        bridgeWindow.__mutationStarts.push(path)
        if (path === projectA) {
          await new Promise<void>((resolve) => {
            bridgeWindow.__resolveActivationA = resolve
          })
        }
        if (path === projectB && bridgeWindow.__failNextB) {
          bridgeWindow.__failNextB = false
          throw new Error('latest activation B failed')
        }
        bridgeWindow.__persistedActive = path
        bridgeWindow.__mutationCommits.push(path)
        return snapshot(path)
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (_command: string, args?: Record<string, unknown>) => {
        const path = String(args?.path)
        return {
          metadata: { name: path === projectA ? 'project-a' : 'project-b', path },
          tree: { name: 'root', path, kind: 'directory', children: [] },
          git: { isRepository: true, branch: 'dev', changedFilesCount: 0 },
        }
      },
    }
  }, { projectA, projectB })

  await page.goto('/')
  const rowA = page.locator(`[data-project-path="${projectA}"]`)
  const rowB = page.locator(`[data-project-path="${projectB}"]`)
  await expect(page.locator('.titlebar')).toContainText('project-b')

  await rowA.click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __mutationStarts?: string[] }
  ).__mutationStarts ?? [])).toEqual([projectA])
  await rowB.click()
  await page.evaluate(() => {
    const resolveA = (window as Window & { __resolveActivationA?: () => void }).__resolveActivationA
    if (!resolveA) throw new Error('Activation A was not pending')
    resolveA()
  })

  await expect(rowB).toContainText('latest activation B failed')
  await expect(rowA).toHaveAttribute('aria-pressed', 'true')
  await expect(rowA).toHaveAttribute('data-project-state', 'ready')
  await expect(page.locator('.titlebar')).toContainText('project-a')
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __persistedActive?: string }
  ).__persistedActive)).toBe(projectA)

  await rowB.click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __mutationStarts?: string[] }
  ).__mutationStarts ?? [])).toEqual([projectA, projectB, projectB])
  await expect(rowB).toHaveAttribute('aria-pressed', 'true')
  await expect(rowB).not.toContainText('latest activation B failed')
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __persistedActive?: string }
  ).__persistedActive)).toBe(projectB)
})

test('suppresses stale open success after hydration finishes behind a newer activation', async ({ page }) => {
  await page.addInitScript(({ projectB, projectC }) => {
    const bridgeWindow = window as Window & {
      __projectCHydrationPending: boolean
      __resolveProjectCHydration?: () => void
      __GTUM_PROJECT_FOLDER_PICKER__: unknown
      __GTUM_WORKSPACE_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
    }
    let openPaths = [projectB]
    const snapshot = (activeProjectPath: string) => ({
      recentProjects: [...openPaths],
      openProjectPaths: [...openPaths],
      activeProjectPath,
      lastOpenedProjectPath: activeProjectPath,
      updatedAt: 254,
      storageVersion: 2,
    })

    bridgeWindow.__projectCHydrationPending = false
    bridgeWindow.__GTUM_PROJECT_FOLDER_PICKER__ = { pick: async () => projectC }
    bridgeWindow.__GTUM_WORKSPACE_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        if (command === 'read_workspace_runtime_snapshot') {
          return { snapshot: snapshot(projectB), restoredAt: 255 }
        }
        const path = (args?.request as { path: string }).path
        if (command === 'open_workspace_project') openPaths = [projectB, projectC]
        return snapshot(path)
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (_command: string, args?: Record<string, unknown>) => {
        const path = String(args?.path)
        if (path === projectC) {
          bridgeWindow.__projectCHydrationPending = true
          await new Promise<void>((resolve) => {
            bridgeWindow.__resolveProjectCHydration = resolve
          })
        }
        return {
          metadata: { name: path === projectC ? 'project-c' : 'project-b', path },
          tree: { name: 'root', path, kind: 'directory', children: [] },
          git: { isRepository: true, branch: 'dev', changedFilesCount: 0 },
        }
      },
    }
  }, { projectB, projectC })

  await page.goto('/')
  const openAction = page.locator('.project-item.action')
  const rowB = page.locator(`[data-project-path="${projectB}"]`)
  await expect(page.locator('.titlebar')).toContainText('project-b')

  await openAction.click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __projectCHydrationPending?: boolean }
  ).__projectCHydrationPending ?? false)).toBe(true)
  await rowB.click()
  await expect(rowB).toHaveAttribute('aria-pressed', 'true')

  await page.evaluate(() => {
    const resolveHydration = (window as Window & {
      __resolveProjectCHydration?: () => void
    }).__resolveProjectCHydration
    if (!resolveHydration) throw new Error('Project C hydration was not pending')
    resolveHydration()
  })

  await expect(page.locator(`[data-project-path="${projectC}"]`)).toHaveAttribute(
    'data-project-state',
    'ready',
  )
  await expect(openAction).toBeEnabled()
  await expect(page.locator('.gtum-window')).toHaveAttribute('data-command-history-count', '0')
  await expect(page.locator('.titlebar')).toContainText('project-b')
})

test('suppresses a stale open failure after a newer activation is requested', async ({ page }) => {
  await page.addInitScript(({ projectB, projectC }) => {
    const bridgeWindow = window as Window & {
      __workspaceCalls: string[]
      __openPending: boolean
      __rejectOpen?: () => void
      __GTUM_PROJECT_FOLDER_PICKER__: unknown
      __GTUM_WORKSPACE_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
    }
    const snapshot = {
      recentProjects: [projectB],
      openProjectPaths: [projectB],
      activeProjectPath: projectB,
      lastOpenedProjectPath: projectB,
      updatedAt: 256,
      storageVersion: 2,
    }

    bridgeWindow.__workspaceCalls = []
    bridgeWindow.__openPending = false
    bridgeWindow.__GTUM_PROJECT_FOLDER_PICKER__ = { pick: async () => projectC }
    bridgeWindow.__GTUM_WORKSPACE_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string) => {
        bridgeWindow.__workspaceCalls.push(command)
        if (command === 'read_workspace_runtime_snapshot') {
          return { snapshot, restoredAt: 257 }
        }
        if (command === 'open_workspace_project') {
          bridgeWindow.__openPending = true
          return new Promise((_, reject) => {
            bridgeWindow.__rejectOpen = () => reject(new Error('stale open C failed'))
          })
        }
        return snapshot
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async () => ({
        metadata: { name: 'project-b', path: projectB },
        tree: { name: 'root', path: projectB, kind: 'directory', children: [] },
        git: { isRepository: true, branch: 'dev', changedFilesCount: 0 },
      }),
    }
  }, { projectB, projectC })

  await page.goto('/')
  const openAction = page.locator('.project-item.action')
  const rowB = page.locator(`[data-project-path="${projectB}"]`)
  await expect(page.locator('.titlebar')).toContainText('project-b')

  await openAction.click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __openPending?: boolean }
  ).__openPending ?? false)).toBe(true)
  await rowB.click()
  await page.evaluate(() => {
    const rejectOpen = (window as Window & { __rejectOpen?: () => void }).__rejectOpen
    if (!rejectOpen) throw new Error('Open C was not pending')
    rejectOpen()
  })

  await expect.poll(() => page.evaluate(() => (
    window as Window & { __workspaceCalls?: string[] }
  ).__workspaceCalls ?? [])).toEqual([
    'read_workspace_runtime_snapshot',
    'open_workspace_project',
    'activate_workspace_project',
  ])
  await expect(openAction).toBeEnabled()
  await expect(page.locator('.gtum-window')).toHaveAttribute('data-project-error', 'false')
  await expect(page.locator('.msg.assistant').filter({
    hasText: 'Could not open the project',
  })).toHaveCount(0)
  await expect(page.locator('.gtum-window')).toHaveAttribute('data-command-history-count', '0')
  await expect(rowB).toHaveAttribute('aria-pressed', 'true')
})

test('keeps late project metadata attached to its owner after another project becomes active', async ({ page }) => {
  await page.addInitScript(({ projectA, projectB }) => {
    const bridgeWindow = window as Window & {
      __resolveProjectA?: () => void
      __GTUM_WORKSPACE_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
    }
    const snapshot = (activeProjectPath: string) => ({
      recentProjects: [projectA, projectB],
      openProjectPaths: [projectA, projectB],
      activeProjectPath,
      lastOpenedProjectPath: activeProjectPath,
      updatedAt: 200,
      storageVersion: 2,
    })
    bridgeWindow.__GTUM_WORKSPACE_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        if (command === 'read_workspace_runtime_snapshot') {
          return { snapshot: snapshot(projectB), restoredAt: 210 }
        }
        const request = args?.request as { path: string }
        return snapshot(request.path)
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (_command: string, args?: Record<string, unknown>) => {
        const path = String(args?.path)
        if (path === projectA) {
          await new Promise<void>((resolve) => {
            bridgeWindow.__resolveProjectA = resolve
          })
        }
        const suffix = path === projectA ? 'a-loaded' : 'b-loaded'
        return {
          metadata: { name: suffix, path },
          tree: { name: suffix, path, kind: 'directory', children: [] },
          git: { isRepository: true, branch: suffix, changedFilesCount: 0 },
        }
      },
    }
  }, { projectA, projectB })

  await page.goto('/')
  const switcher = page.locator('.project-switcher')
  const rowA = switcher.locator('[data-project-path="/workspace/project-a"]')
  const rowB = switcher.locator('[data-project-path="/workspace/project-b"]')
  await expect(page.locator('.titlebar')).toContainText('b-loaded')

  await rowA.click()
  await expect(rowA).toHaveAttribute('data-project-state', 'loading')
  await expect.poll(() => page.evaluate(() => (
    window as Window & {
      __GTUM_BACKEND_BRIDGE__?: { projectPath: string; runtimeBacked: boolean }
    }
  ).__GTUM_BACKEND_BRIDGE__)).toEqual({
    desktop: true,
    projectPath: projectA,
    runtimeBacked: true,
  })
  await rowB.click()
  await expect(rowB).toHaveAttribute('aria-pressed', 'true')

  await page.evaluate(() => {
    const resolveProjectA = (window as Window & { __resolveProjectA?: () => void }).__resolveProjectA
    if (!resolveProjectA) throw new Error('Project A hydration was not pending')
    resolveProjectA()
  })

  await expect(rowA).toContainText('a-loaded')
  await expect(page.locator('.titlebar')).toContainText('b-loaded')
  await expect(rowB).toHaveAttribute('aria-pressed', 'true')
})

test('shows a missing-project error without blocking switches to another open project', async ({ page }) => {
  await page.addInitScript(({ projectA, projectB }) => {
    const snapshot = (activeProjectPath: string) => ({
      recentProjects: [projectA, projectB],
      openProjectPaths: [projectA, projectB],
      activeProjectPath,
      lastOpenedProjectPath: activeProjectPath,
      updatedAt: 200,
      storageVersion: 2,
    })
    const bridgeWindow = window as Window & {
      __GTUM_WORKSPACE_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
    }
    bridgeWindow.__GTUM_WORKSPACE_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        if (command === 'read_workspace_runtime_snapshot') {
          return { snapshot: snapshot(projectB), restoredAt: 210 }
        }
        return snapshot((args?.request as { path: string }).path)
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (_command: string, args?: Record<string, unknown>) => {
        const path = String(args?.path)
        if (path === projectA) throw new Error('Project folder does not exist')
        return {
          metadata: { name: 'project-b', path },
          tree: { name: 'project-b', path, kind: 'directory', children: [] },
          git: { isRepository: true, branch: 'dev', changedFilesCount: 0 },
        }
      },
    }
  }, { projectA, projectB })

  await page.goto('/')
  const switcher = page.locator('.project-switcher')
  const rowA = switcher.locator('[data-project-path="/workspace/project-a"]')
  const rowB = switcher.locator('[data-project-path="/workspace/project-b"]')
  await expect(page.locator('.titlebar')).toContainText('project-b')

  await rowA.click()
  await expect(rowA).toHaveAttribute('data-project-state', 'missing')
  await expect(rowA).toContainText('Project folder does not exist')
  await expect.poll(() => page.evaluate(() => (
    window as Window & {
      __GTUM_BACKEND_BRIDGE__?: { projectPath: string; runtimeBacked: boolean }
    }
  ).__GTUM_BACKEND_BRIDGE__)).toEqual({
    desktop: true,
    projectPath: projectA,
    runtimeBacked: false,
  })

  await rowB.click()
  await expect(rowB).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.titlebar')).toContainText('project-b')
})

test('clears a project activation error after a later activation succeeds', async ({ page }) => {
  await page.addInitScript(({ projectA, projectB }) => {
    const bridgeWindow = window as Window & {
      __failNextActivationA: boolean
      __GTUM_WORKSPACE_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
    }
    const snapshot = (activeProjectPath: string) => ({
      recentProjects: [projectA, projectB],
      openProjectPaths: [projectA, projectB],
      activeProjectPath,
      lastOpenedProjectPath: activeProjectPath,
      updatedAt: 260,
      storageVersion: 2,
    })

    bridgeWindow.__failNextActivationA = false
    bridgeWindow.__GTUM_WORKSPACE_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        if (command === 'read_workspace_runtime_snapshot') {
          return { snapshot: snapshot(projectB), restoredAt: 270 }
        }
        const path = (args?.request as { path: string }).path
        if (path === projectA && bridgeWindow.__failNextActivationA) {
          bridgeWindow.__failNextActivationA = false
          throw new Error('temporary activation failure')
        }
        return snapshot(path)
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (_command: string, args?: Record<string, unknown>) => {
        const path = String(args?.path)
        return {
          metadata: { name: path === projectA ? 'project-a' : 'project-b', path },
          tree: { name: 'root', path, kind: 'directory', children: [] },
          git: { isRepository: true, branch: 'dev', changedFilesCount: 0 },
        }
      },
    }
  }, { projectA, projectB })

  await page.goto('/')
  const rowA = page.locator(`[data-project-path="${projectA}"]`)
  const rowB = page.locator(`[data-project-path="${projectB}"]`)
  await expect(page.locator('.titlebar')).toContainText('project-b')
  await rowA.click()
  await expect(page.locator('.titlebar')).toContainText('project-a')
  await rowB.click()
  await expect(page.locator('.titlebar')).toContainText('project-b')

  await page.evaluate(() => {
    (window as Window & { __failNextActivationA: boolean }).__failNextActivationA = true
  })
  await rowA.click()
  await expect(rowA).toContainText('temporary activation failure')
  await expect(rowB).toHaveAttribute('aria-pressed', 'true')

  await rowA.click()
  await expect(rowA).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.titlebar')).toContainText('project-a')
  await expect(rowA).not.toContainText('temporary activation failure')
  await expect(rowA).toContainText('dev')
})

test('shows then clears an existing project row error across open retries', async ({ page }) => {
  await page.addInitScript(({ projectA }) => {
    const bridgeWindow = window as Window & {
      __failNextOpen: boolean
      __GTUM_PROJECT_FOLDER_PICKER__: unknown
      __GTUM_WORKSPACE_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
    }
    const snapshot = {
      recentProjects: [projectA],
      openProjectPaths: [projectA],
      activeProjectPath: projectA,
      lastOpenedProjectPath: projectA,
      updatedAt: 280,
      storageVersion: 2,
    }

    bridgeWindow.__failNextOpen = true
    bridgeWindow.__GTUM_PROJECT_FOLDER_PICKER__ = { pick: async () => projectA }
    bridgeWindow.__GTUM_WORKSPACE_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string) => {
        if (command === 'read_workspace_runtime_snapshot') {
          return { snapshot, restoredAt: 290 }
        }
        if (bridgeWindow.__failNextOpen) {
          bridgeWindow.__failNextOpen = false
          throw new Error('temporary open failure')
        }
        return snapshot
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async () => ({
        metadata: { name: 'project-a', path: projectA },
        tree: { name: 'root', path: projectA, kind: 'directory', children: [] },
        git: { isRepository: true, branch: 'dev', changedFilesCount: 0 },
      }),
    }
  }, { projectA })

  await page.goto('/')
  const rowA = page.locator(`[data-project-path="${projectA}"]`)
  await expect(page.locator('.titlebar')).toContainText('project-a')

  await page.getByText('Open project folder').click()
  await expect(rowA).toContainText('temporary open failure')

  await page.getByText('Open project folder').click()
  await expect(rowA).not.toContainText('temporary open failure')
  await expect(rowA).toContainText('dev')
})

test('opens a picked folder through the workspace registry and uses its canonical active path', async ({ page }) => {
  await page.addInitScript(() => {
    const pickedPath = '/workspace/project-link'
    const canonicalPath = '/canonical/project-c'
    const bridgeWindow = window as Window & {
      __workspaceCalls: RuntimeCall[]
      __projectCalls: RuntimeCall[]
      __GTUM_PROJECT_FOLDER_PICKER__: unknown
      __GTUM_WORKSPACE_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
    }
    bridgeWindow.__workspaceCalls = []
    bridgeWindow.__projectCalls = []
    bridgeWindow.__GTUM_PROJECT_FOLDER_PICKER__ = { pick: async () => pickedPath }
    bridgeWindow.__GTUM_WORKSPACE_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__workspaceCalls.push({ command, args })
        if (command === 'read_workspace_runtime_snapshot') {
          return {
            snapshot: {
              recentProjects: [],
              openProjectPaths: [],
              activeProjectPath: null,
              lastOpenedProjectPath: null,
              updatedAt: 200,
              storageVersion: 2,
            },
            restoredAt: 210,
          }
        }
        return {
          recentProjects: [canonicalPath],
          openProjectPaths: [canonicalPath],
          activeProjectPath: canonicalPath,
          lastOpenedProjectPath: canonicalPath,
          updatedAt: 220,
          storageVersion: 2,
        }
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__projectCalls.push({ command, args })
        return {
          metadata: { name: 'project-c', path: canonicalPath },
          tree: { name: 'project-c', path: canonicalPath, kind: 'directory', children: [] },
          git: { isRepository: true, branch: 'dev', changedFilesCount: 0 },
        }
      },
    }
  })

  await page.goto('/')
  await page.getByText('Open project folder').click()

  await expect(page.locator('.titlebar')).toContainText('project-c')
  const calls = await page.evaluate(() => ({
    workspace: (window as Window & { __workspaceCalls?: RuntimeCall[] }).__workspaceCalls ?? [],
    project: (window as Window & { __projectCalls?: RuntimeCall[] }).__projectCalls ?? [],
  }))
  expect(calls.workspace).toContainEqual({
    command: 'open_workspace_project',
    args: { request: { path: '/workspace/project-link' } },
  })
  expect(calls.workspace.map((call) => call.command)).not.toContain('remember_workspace_project')
  expect(calls.project).toContainEqual({
    command: 'read_project_overview',
    args: { path: '/canonical/project-c' },
  })
})
