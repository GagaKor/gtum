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

test('restores each project exact workbench layout, dirty buffer, tab ids, and selected file', async ({ page }) => {
  await page.addInitScript(({ projectA, projectB }) => {
    type TestWindow = Window & {
      __activeProjectPath: string
      __folderPickerCalls: number
      __GTUM_PROJECT_FOLDER_PICKER__: unknown
      __GTUM_WORKSPACE_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
      __GTUM_TERMINAL_RUNTIME__: unknown
    }
    const bridgeWindow = window as TestWindow
    const snapshot = (activeProjectPath: string) => ({
      recentProjects: [projectA, projectB],
      openProjectPaths: [projectA, projectB],
      activeProjectPath,
      lastOpenedProjectPath: activeProjectPath,
      updatedAt: 300,
      storageVersion: 2,
    })
    const terminalSnapshot = (projectPath: string, sessionId: number) => ({
      projectPath,
      sessionId,
      name: `${projectPath.endsWith('project-a') ? 'A' : 'B'} terminal`,
      cwd: projectPath,
      shell: '/bin/zsh',
      shellArgs: ['-i'],
      processId: sessionId * 10,
      status: 'running',
      createdAt: 100,
      updatedAt: 110,
      exitCode: null,
      logLineCount: 1,
      maxLogEntries: 400,
      lastEvent: 'running',
    })

    bridgeWindow.__activeProjectPath = projectA
    bridgeWindow.__folderPickerCalls = 0
    bridgeWindow.__GTUM_PROJECT_FOLDER_PICKER__ = {
      pick: async () => {
        bridgeWindow.__folderPickerCalls += 1
        throw new Error('project-row selection must not open the folder picker')
      },
    }
    bridgeWindow.__GTUM_WORKSPACE_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        if (command === 'read_workspace_runtime_snapshot') {
          return { snapshot: snapshot(projectA), restoredAt: 310 }
        }
        if (command === 'activate_workspace_project') {
          const path = String((args?.request as { path?: string } | undefined)?.path)
          bridgeWindow.__activeProjectPath = path
          return snapshot(path)
        }
        throw new Error(`Unexpected workspace command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        if (command === 'read_project_overview') {
          const path = String(args?.path)
          const suffix = path === projectA ? 'a' : 'b'
          return {
            metadata: { name: `project-${suffix}`, path },
            tree: {
              name: `project-${suffix}`,
              path,
              kind: 'directory',
              children: [{ name: 'shared.ts', path: 'src/shared.ts', kind: 'file' }],
            },
            git: { isRepository: true, branch: `feature/${suffix}`, changedFilesCount: 1 },
          }
        }
        if (command === 'read_project_file') {
          const path = String(args?.projectPath)
          const owner = path === projectA ? 'A' : 'B'
          return {
            projectPath: path,
            filePath: 'src/shared.ts',
            displayPath: 'src/shared.ts',
            content: `const owner = '${owner}'`,
            contentHash: `hash-${owner.toLowerCase()}`,
            isText: true,
            truncated: false,
          }
        }
        throw new Error(`Unexpected project command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_TERMINAL_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        if (command === 'create_terminal_session') {
          const path = String((args?.request as { projectPath?: string } | undefined)?.projectPath)
          return terminalSnapshot(path, path === projectA ? 77 : 88)
        }
        const path = String(args?.projectPath)
        const sessionId = Number(args?.sessionId)
        if (command === 'read_raw_terminal_output') {
          const from = Number(args?.from) || 0
          const chunk = from === 0 ? `terminal ${sessionId}` : ''
          return { projectPath: path, sessionId, base: 0, cursor: from + chunk.length, chunk, status: 'running' }
        }
        if (command === 'read_terminal_session_logs') {
          return {
            projectPath: path,
            sessionId,
            status: 'running',
            limit: 400,
            logLineCount: 1,
            truncated: false,
            entries: [`terminal ${sessionId}`],
            updatedAt: 120,
          }
        }
        if (command === 'resize_terminal_session' || command === 'write_terminal_input') return undefined
        if (command === 'close_terminal_session') return { ...terminalSnapshot(path, sessionId), status: 'terminated' }
        throw new Error(`Unexpected terminal command: ${command}`)
      },
    }
  }, { projectA, projectB })

  await page.setViewportSize({ width: 1320, height: 760 })
  await page.goto('/')
  const rowA = page.locator(`[data-project-path="${projectA}"]`)
  const rowB = page.locator(`[data-project-path="${projectB}"]`)
  await expect(rowA).toHaveAttribute('data-project-state', 'ready')

  const fileA = page.locator('.tree-row.file').filter({ hasText: 'shared.ts' })
  await fileA.click()
  await expect(fileA).toHaveClass(/selected/)
  await page.locator('.editor-textarea').fill("const owner = 'A dirty'")
  const editorTabId = await page.locator('.gt.active').getAttribute('data-tab-id')
  expect(editorTabId).toBeTruthy()

  await page.locator(`.gt[data-tab-id="${editorTabId}"]`).click({ button: 'right' })
  await page.getByRole('button', { name: 'Split Right' }).click()
  await page.locator('.group.active .gt-add').click()
  await expect(page.locator('.term-xterm')).toContainText('terminal 77')
  const terminalTabId = await page.locator('.group.active .gt.active').getAttribute('data-tab-id')
  expect(terminalTabId).toBeTruthy()

  const divider = page.locator('.split-divider.vert')
  const dividerBox = await divider.boundingBox()
  expect(dividerBox).not.toBeNull()
  await page.mouse.move(dividerBox!.x + dividerBox!.width / 2, dividerBox!.y + 20)
  await page.mouse.down()
  await page.mouse.move(dividerBox!.x + 95, dividerBox!.y + 20)
  await page.mouse.up()
  const projectASizes = await page.locator('.split-cell').evaluateAll((cells) =>
    cells.map((cell) => (cell as HTMLElement).style.flexBasis),
  )
  expect(projectASizes).not.toEqual(['50%', '50%'])

  await rowB.click()
  await expect(rowB).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.gt')).toHaveCount(0)
  const fileB = page.locator('.tree-row.file').filter({ hasText: 'shared.ts' })
  await fileB.click()
  await expect(fileB).toHaveClass(/selected/)
  await expect(page.locator('.editor-textarea')).toHaveValue("const owner = 'B'")
  const projectBTabId = await page.locator('.gt.active').getAttribute('data-tab-id')
  expect(projectBTabId).toBe(editorTabId)

  await rowA.click()
  await expect(rowA).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.tree-row.file').filter({ hasText: 'shared.ts' })).toHaveClass(/selected/)
  const restoredTabIds = await page.locator('.gt').evaluateAll((tabs) =>
    tabs.map((tab) => tab.getAttribute('data-tab-id')),
  )
  expect(restoredTabIds).toEqual([editorTabId, terminalTabId])
  await expect(page.locator('.split-cell')).toHaveCount(2)
  await expect.poll(() => page.locator('.split-cell').evaluateAll((cells) =>
    cells.map((cell) => (cell as HTMLElement).style.flexBasis),
  )).toEqual(projectASizes)
  await page.locator(`.gt[data-tab-id="${editorTabId}"]`).click()
  await expect(page.locator('.editor-textarea')).toHaveValue("const owner = 'A dirty'")
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled()
  expect(await page.evaluate(() => (window as Window & { __folderPickerCalls?: number }).__folderPickerCalls)).toBe(0)
})

test('keeps an inactive project PTY alive and replays the same session from zero on return', async ({ page }) => {
  await page.addInitScript(({ projectA, projectB }) => {
    type RawCall = { activePath: string; projectPath: string; sessionId: number; from: number }
    type TestWindow = Window & {
      __activeProjectPath: string
      __rawCalls: RawCall[]
      __terminalCalls: RuntimeCall[]
      __aDelayedReadPending: boolean
      __resolveDelayedARead?: () => void
      __GTUM_WORKSPACE_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
      __GTUM_TERMINAL_RUNTIME__: unknown
    }
    const bridgeWindow = window as TestWindow
    const snapshot = (activeProjectPath: string) => ({
      recentProjects: [projectA, projectB],
      openProjectPaths: [projectA, projectB],
      activeProjectPath,
      lastOpenedProjectPath: activeProjectPath,
      updatedAt: 320,
      storageVersion: 2,
    })
    const terminalSnapshot = {
      projectPath: projectA,
      sessionId: 77,
      name: 'A terminal',
      cwd: projectA,
      shell: '/bin/zsh',
      shellArgs: ['-i'],
      processId: 770,
      status: 'running',
      createdAt: 100,
      updatedAt: 120,
      exitCode: null,
      logLineCount: 1,
      maxLogEntries: 400,
      lastEvent: 'running',
    }
    let delayedOutputReady = false
    let firstChunkDelivered = false

    bridgeWindow.__activeProjectPath = projectA
    bridgeWindow.__rawCalls = []
    bridgeWindow.__terminalCalls = []
    bridgeWindow.__aDelayedReadPending = false
    bridgeWindow.__GTUM_WORKSPACE_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        if (command === 'read_workspace_runtime_snapshot') return { snapshot: snapshot(projectA), restoredAt: 330 }
        if (command === 'activate_workspace_project') {
          const path = String((args?.request as { path?: string } | undefined)?.path)
          bridgeWindow.__activeProjectPath = path
          return snapshot(path)
        }
        throw new Error(`Unexpected workspace command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        if (command !== 'read_project_overview') throw new Error(`Unexpected project command: ${command}`)
        const path = String(args?.path)
        return {
          metadata: { name: path === projectA ? 'project-a' : 'project-b', path },
          tree: { name: 'root', path, kind: 'directory', children: [] },
          git: { isRepository: true, branch: 'dev', changedFilesCount: 0 },
        }
      },
    }
    bridgeWindow.__GTUM_TERMINAL_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__terminalCalls.push({ command, args })
        if (command === 'create_terminal_session') return terminalSnapshot
        const projectPath = String(args?.projectPath)
        const sessionId = Number(args?.sessionId)
        if (command === 'read_raw_terminal_output') {
          const from = Number(args?.from) || 0
          bridgeWindow.__rawCalls.push({
            activePath: bridgeWindow.__activeProjectPath,
            projectPath,
            sessionId,
            from,
          })
          if (from === 0 && !firstChunkDelivered) {
            firstChunkDelivered = true
            return { projectPath, sessionId, base: 0, cursor: 8, chunk: 'A START\n', status: 'running' }
          }
          if (from === 8 && !delayedOutputReady) {
            bridgeWindow.__aDelayedReadPending = true
            return new Promise((resolve) => {
              bridgeWindow.__resolveDelayedARead = () => {
                delayedOutputReady = true
                resolve({ projectPath, sessionId, base: 0, cursor: 18, chunk: 'A DELAYED\n', status: 'running' })
              }
            })
          }
          const chunk = from === 0 && delayedOutputReady ? 'A START\nA DELAYED\n' : ''
          return { projectPath, sessionId, base: 0, cursor: from + chunk.length, chunk, status: 'running' }
        }
        if (command === 'read_terminal_session_logs') {
          return {
            projectPath,
            sessionId,
            status: 'running',
            limit: 400,
            logLineCount: delayedOutputReady ? 2 : 1,
            truncated: false,
            entries: delayedOutputReady ? ['A START', 'A DELAYED'] : ['A START'],
            updatedAt: delayedOutputReady ? 200 : 120,
          }
        }
        if (command === 'resize_terminal_session' || command === 'write_terminal_input') return undefined
        if (command === 'close_terminal_session') return { ...terminalSnapshot, status: 'terminated' }
        throw new Error(`Unexpected terminal command: ${command}`)
      },
    }
  }, { projectA, projectB })

  await page.goto('/')
  const rowA = page.locator(`[data-project-path="${projectA}"]`)
  const rowB = page.locator(`[data-project-path="${projectB}"]`)
  await expect(rowA).toHaveAttribute('data-project-state', 'ready')
  await page.locator('.gt-add').first().click()
  await expect(page.locator('.term-xterm')).toContainText('A START')
  const terminalTabId = await page.locator('.gt.active').getAttribute('data-tab-id')
  expect(terminalTabId).toBeTruthy()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __aDelayedReadPending?: boolean }
  ).__aDelayedReadPending)).toBe(true)

  await rowB.click()
  await expect(rowB).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.term-xterm')).toHaveCount(0)
  await page.evaluate(() => {
    const resolve = (window as Window & { __resolveDelayedARead?: () => void }).__resolveDelayedARead
    if (!resolve) throw new Error('A raw read was not pending')
    resolve()
  })

  await rowA.click()
  await expect(page.locator(`.gt[data-tab-id="${terminalTabId}"]`)).toHaveClass(/active/)
  await expect(page.locator('.term-xterm')).toContainText('A DELAYED')
  const calls = await page.evaluate(() => {
    const testWindow = window as Window & {
      __rawCalls?: Array<{ activePath: string; projectPath: string; sessionId: number; from: number }>
      __terminalCalls?: RuntimeCall[]
    }
    return { raw: testWindow.__rawCalls ?? [], terminal: testWindow.__terminalCalls ?? [] }
  })
  expect(calls.terminal.filter((call) => call.command === 'create_terminal_session')).toHaveLength(1)
  expect(calls.terminal.filter((call) => call.command === 'close_terminal_session')).toEqual([])
  expect(calls.raw.filter((call) =>
    call.activePath === projectA && call.projectPath === projectA && call.sessionId === 77 && call.from === 0
  ).length).toBeGreaterThanOrEqual(2)
})

test('does not overlap raw terminal pumps or summary polls while a read is pending', async ({ page }) => {
  await page.addInitScript(({ projectA }) => {
    type TestWindow = Window & {
      __rawReadCount: number
      __summaryReadCount: number
      __GTUM_WORKSPACE_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
      __GTUM_TERMINAL_RUNTIME__: unknown
    }
    const bridgeWindow = window as TestWindow
    const snapshot = {
      recentProjects: [projectA],
      openProjectPaths: [projectA],
      activeProjectPath: projectA,
      lastOpenedProjectPath: projectA,
      updatedAt: 340,
      storageVersion: 2,
    }
    bridgeWindow.__rawReadCount = 0
    bridgeWindow.__summaryReadCount = 0
    bridgeWindow.__GTUM_WORKSPACE_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string) => {
        if (command === 'read_workspace_runtime_snapshot') return { snapshot, restoredAt: 350 }
        throw new Error(`Unexpected workspace command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        if (command !== 'read_project_overview') throw new Error(`Unexpected project command: ${command}`)
        const path = String(args?.path)
        return {
          metadata: { name: 'project-a', path },
          tree: { name: 'root', path, kind: 'directory', children: [] },
          git: { isRepository: true, branch: 'dev', changedFilesCount: 0 },
        }
      },
    }
    bridgeWindow.__GTUM_TERMINAL_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        if (command === 'create_terminal_session') {
          return {
            projectPath: projectA,
            sessionId: 77,
            name: 'A terminal',
            cwd: projectA,
            shell: '/bin/zsh',
            shellArgs: ['-i'],
            processId: 770,
            status: 'running',
            createdAt: 100,
            updatedAt: 120,
            exitCode: null,
            logLineCount: 0,
            maxLogEntries: 400,
            lastEvent: 'running',
          }
        }
        if (command === 'read_raw_terminal_output') {
          bridgeWindow.__rawReadCount += 1
          return new Promise<never>(() => undefined)
        }
        if (command === 'read_terminal_session_logs') {
          bridgeWindow.__summaryReadCount += 1
          return new Promise<never>(() => undefined)
        }
        if (command === 'resize_terminal_session' || command === 'write_terminal_input') return undefined
        if (command === 'close_terminal_session') {
          return {
            projectPath: projectA,
            sessionId: Number(args?.sessionId),
            status: 'terminated',
          }
        }
        throw new Error(`Unexpected terminal command: ${command}`)
      },
    }
  }, { projectA })

  await page.goto('/')
  await expect(page.locator(`[data-project-path="${projectA}"]`)).toHaveAttribute('data-project-state', 'ready')
  await page.locator('.gt-add').first().click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __rawReadCount?: number }
  ).__rawReadCount ?? 0)).toBe(1)
  await page.waitForTimeout(240)
  expect(await page.evaluate(() => (window as Window & { __rawReadCount?: number }).__rawReadCount)).toBe(1)

  await expect.poll(() => page.evaluate(() => (
    window as Window & { __summaryReadCount?: number }
  ).__summaryReadCount ?? 0), { timeout: 2_500 }).toBe(1)
  await page.waitForTimeout(1_100)
  const counts = await page.evaluate(() => ({
    raw: (window as Window & { __rawReadCount?: number }).__rawReadCount ?? 0,
    summary: (window as Window & { __summaryReadCount?: number }).__summaryReadCount ?? 0,
  }))
  expect(counts).toEqual({ raw: 1, summary: 1 })
})

test('applies a late A save only to A when B owns the same deterministic editor tab id', async ({ page }) => {
  await page.addInitScript(({ projectA, projectB }) => {
    type TestWindow = Window & {
      __projectCalls: RuntimeCall[]
      __resolveProjectASave?: () => void
      __GTUM_WORKSPACE_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
    }
    const bridgeWindow = window as TestWindow
    const snapshot = (activeProjectPath: string) => ({
      recentProjects: [projectA, projectB],
      openProjectPaths: [projectA, projectB],
      activeProjectPath,
      lastOpenedProjectPath: activeProjectPath,
      updatedAt: 360,
      storageVersion: 2,
    })
    bridgeWindow.__projectCalls = []
    bridgeWindow.__GTUM_WORKSPACE_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        if (command === 'read_workspace_runtime_snapshot') return { snapshot: snapshot(projectA), restoredAt: 370 }
        if (command === 'activate_workspace_project') {
          const path = String((args?.request as { path?: string } | undefined)?.path)
          return snapshot(path)
        }
        throw new Error(`Unexpected workspace command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__projectCalls.push({ command, args })
        if (command === 'read_project_overview') {
          const path = String(args?.path)
          return {
            metadata: { name: path === projectA ? 'project-a' : 'project-b', path },
            tree: {
              name: 'root',
              path,
              kind: 'directory',
              children: [{ name: 'shared.ts', path: 'src/shared.ts', kind: 'file' }],
            },
            git: { isRepository: true, branch: 'dev', changedFilesCount: 1 },
          }
        }
        if (command === 'read_project_file') {
          const path = String(args?.projectPath)
          const owner = path === projectA ? 'A' : 'B'
          return {
            projectPath: path,
            filePath: 'src/shared.ts',
            displayPath: 'src/shared.ts',
            content: `const owner = '${owner}'`,
            contentHash: `hash-${owner.toLowerCase()}`,
            isText: true,
            truncated: false,
          }
        }
        if (command === 'write_project_file') {
          const request = args?.request as { projectPath?: string; content?: string }
          if (request.projectPath !== projectA) throw new Error('Only the A save should be pending')
          return new Promise((resolve) => {
            bridgeWindow.__resolveProjectASave = () => resolve({
              projectPath: projectA,
              filePath: 'src/shared.ts',
              displayPath: 'src/shared.ts',
              content: request.content,
              contentHash: 'hash-a-saved',
              isText: true,
              truncated: false,
            })
          })
        }
        throw new Error(`Unexpected project command: ${command}`)
      },
    }
  }, { projectA, projectB })

  await page.goto('/')
  const rowA = page.locator(`[data-project-path="${projectA}"]`)
  const rowB = page.locator(`[data-project-path="${projectB}"]`)
  await expect(rowA).toHaveAttribute('data-project-state', 'ready')
  await page.locator('.tree-row.file').filter({ hasText: 'shared.ts' }).click()
  const editorTabIdA = await page.locator('.gt.active').getAttribute('data-tab-id')
  await page.locator('.editor-textarea').fill("const owner = 'A changed'")
  await page.getByRole('button', { name: 'Save' }).click()
  await expect.poll(() => page.evaluate(() => Boolean(
    (window as Window & { __resolveProjectASave?: () => void }).__resolveProjectASave,
  ))).toBe(true)

  await rowB.click()
  await page.locator('.tree-row.file').filter({ hasText: 'shared.ts' }).click()
  const editorTabIdB = await page.locator('.gt.active').getAttribute('data-tab-id')
  expect(editorTabIdB).toBe(editorTabIdA)
  await expect(page.locator('.editor-textarea')).toHaveValue("const owner = 'B'")

  await page.evaluate(() => {
    const resolve = (window as Window & { __resolveProjectASave?: () => void }).__resolveProjectASave
    if (!resolve) throw new Error('A save was not pending')
    resolve()
  })
  await expect(page.locator('.editor-textarea')).toHaveValue("const owner = 'B'")
  await rowA.click()
  await expect(page.locator('.editor-textarea')).toHaveValue("const owner = 'A changed'")
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()

  const writeCall = await page.evaluate(() => (
    window as Window & { __projectCalls?: RuntimeCall[] }
  ).__projectCalls?.find((call) => call.command === 'write_project_file'))
  expect(writeCall?.args).toEqual({
    request: {
      projectPath: projectA,
      filePath: 'src/shared.ts',
      content: "const owner = 'A changed'",
      expectedContentHash: 'hash-a',
    },
  })
})

test('sends a B Agent request with null context while A editor and terminal tabs are hidden', async ({ page }) => {
  await page.addInitScript(({ projectA, projectB }) => {
    type TestWindow = Window & {
      __agentCalls: RuntimeCall[]
      __GTUM_AGENT_PROGRESS_STAGE_DELAY_MS__: number
      __GTUM_WORKSPACE_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
      __GTUM_TERMINAL_RUNTIME__: unknown
      __GTUM_AGENT_AUTH_RUNTIME__: unknown
      __GTUM_AGENT_RUNTIME__: unknown
    }
    const bridgeWindow = window as TestWindow
    const snapshot = (activeProjectPath: string) => ({
      recentProjects: [projectA, projectB],
      openProjectPaths: [projectA, projectB],
      activeProjectPath,
      lastOpenedProjectPath: activeProjectPath,
      updatedAt: 380,
      storageVersion: 2,
    })
    bridgeWindow.__agentCalls = []
    bridgeWindow.__GTUM_AGENT_PROGRESS_STAGE_DELAY_MS__ = 1
    bridgeWindow.__GTUM_AGENT_AUTH_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string) => {
        if (command === 'list_agent_connections') {
          return [{
            provider: 'codex',
            displayName: 'Codex',
            status: 'connected',
            connectionKind: 'real',
            accountLabel: 'Codex ChatGPT Session',
            accountEmail: null,
            requiredScopes: ['project:read', 'terminal:read'],
            expiresAt: null,
            callbackUrl: null,
            authUrl: null,
            activeLoginId: null,
            activeLoginState: null,
            connectedAt: 100,
            lastLoginAttemptAt: 95,
            updatedAt: 120,
            lastError: null,
          }]
        }
        throw new Error(`Unexpected agent auth command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_WORKSPACE_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        if (command === 'read_workspace_runtime_snapshot') return { snapshot: snapshot(projectA), restoredAt: 390 }
        if (command === 'activate_workspace_project') {
          return snapshot(String((args?.request as { path?: string } | undefined)?.path))
        }
        throw new Error(`Unexpected workspace command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        if (command === 'read_project_overview') {
          const path = String(args?.path)
          return {
            metadata: { name: path === projectA ? 'project-a' : 'project-b', path },
            tree: {
              name: 'root',
              path,
              kind: 'directory',
              children: [{ name: 'shared.ts', path: 'src/shared.ts', kind: 'file' }],
            },
            git: { isRepository: true, branch: 'dev', changedFilesCount: 0 },
          }
        }
        if (command === 'read_project_file') {
          const path = String(args?.projectPath)
          return {
            projectPath: path,
            filePath: 'src/shared.ts',
            displayPath: 'src/shared.ts',
            content: 'A SECRET FILE CONTEXT',
            contentHash: 'hash-a',
            isText: true,
            truncated: false,
          }
        }
        throw new Error(`Unexpected project command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_TERMINAL_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        if (command === 'create_terminal_session') {
          return {
            projectPath: projectA,
            sessionId: 77,
            name: 'A terminal',
            cwd: projectA,
            shell: '/bin/zsh',
            shellArgs: ['-i'],
            processId: 770,
            status: 'running',
            createdAt: 100,
            updatedAt: 120,
            exitCode: null,
            logLineCount: 1,
            maxLogEntries: 400,
            lastEvent: 'running',
          }
        }
        const projectPath = String(args?.projectPath)
        const sessionId = Number(args?.sessionId)
        if (command === 'read_raw_terminal_output') {
          const from = Number(args?.from) || 0
          const chunk = from === 0 ? 'A SECRET TERMINAL CONTEXT' : ''
          return { projectPath, sessionId, base: 0, cursor: from + chunk.length, chunk, status: 'running' }
        }
        if (command === 'read_terminal_session_logs') {
          return {
            projectPath,
            sessionId,
            status: 'running',
            limit: 400,
            logLineCount: 1,
            truncated: false,
            entries: ['A SECRET TERMINAL CONTEXT'],
            updatedAt: 120,
          }
        }
        if (command === 'resize_terminal_session' || command === 'write_terminal_input') return undefined
        if (command === 'close_terminal_session') return { projectPath, sessionId, status: 'terminated' }
        throw new Error(`Unexpected terminal command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_AGENT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__agentCalls.push({ command, args })
        if (command === 'read_agent_provider_capabilities') {
          return {
            provider: 'codex',
            supportsModelSelection: false,
            currentModel: null,
            availableModels: [],
            reasoningLevels: [],
            defaultReasoningLevel: null,
            supportsFastMode: false,
            attachments: [],
          }
        }
        if (command === 'request_agent_suggestions') {
          return [{
            id: 'b-reply',
            provider: 'codex',
            summary: 'B has no attached workbench context',
            command: '',
            preferredTarget: 'new_tab',
            confidence: 'high',
            error: null,
          }]
        }
        throw new Error(`Unexpected agent command: ${command}`)
      },
    }
  }, { projectA, projectB })

  await page.goto('/')
  const rowA = page.locator(`[data-project-path="${projectA}"]`)
  const rowB = page.locator(`[data-project-path="${projectB}"]`)
  await expect(rowA).toHaveAttribute('data-project-state', 'ready')
  await page.locator('.tree-row.file').filter({ hasText: 'shared.ts' }).click()
  await page.locator('.gt-add').first().click()
  await expect(page.locator('.term-xterm')).toContainText('A SECRET TERMINAL CONTEXT')

  await rowB.click()
  await expect(page.locator('.gt')).toHaveCount(0)
  await page.getByPlaceholder('Ask Codex').fill('inspect project B')
  await page.locator('.composer-input .send').click()
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __agentCalls?: RuntimeCall[] }
  ).__agentCalls?.filter((call) => call.command === 'request_agent_suggestions').length ?? 0)).toBe(1)

  const request = await page.evaluate(() => (
    window as Window & { __agentCalls?: RuntimeCall[] }
  ).__agentCalls?.find((call) => call.command === 'request_agent_suggestions')?.args?.request)
  expect(request).toMatchObject({
    projectName: 'project-b',
    projectPath: projectB,
    activeTabId: null,
    activeTabTitle: null,
    activeFilePath: null,
    activeFileSnippet: null,
    lastNLogLines: [],
    userTask: 'inspect project B',
  })
})

test('resizes only the addressed nested split when sibling shapes are identical', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.gtum-window')).toBeVisible()

  const sizes = await page.evaluate(() => {
    type LayoutNode = {
      id?: string
      type: 'group' | 'split'
      groupId?: string
      direction?: 'horizontal' | 'vertical'
      sizes?: number[]
      children?: LayoutNode[]
    }
    type TestWindow = Window & {
      resizeSplit: (
        state: { layoutTree: LayoutNode; groups: Record<string, unknown>; activeGroupId: string },
        splitId: string,
        nextSizes: number[],
      ) => { layoutTree: LayoutNode }
    }
    const leafPair = (prefix: string): LayoutNode[] => [
      { type: 'group', groupId: `${prefix}-one` },
      { type: 'group', groupId: `${prefix}-two` },
    ]
    const state = {
      layoutTree: {
        id: 'split-root',
        type: 'split' as const,
        direction: 'horizontal' as const,
        sizes: [50, 50],
        children: [
          {
            id: 'split-left',
            type: 'split' as const,
            direction: 'vertical' as const,
            sizes: [40, 60],
            children: leafPair('left'),
          },
          {
            id: 'split-right',
            type: 'split' as const,
            direction: 'vertical' as const,
            sizes: [35, 65],
            children: leafPair('right'),
          },
        ],
      },
      groups: {},
      activeGroupId: 'left-one',
    }

    const next = (window as TestWindow).resizeSplit(state, 'split-left', [25, 75])
    const root = next.layoutTree
    return {
      root: root.sizes,
      left: root.children?.[0]?.sizes,
      right: root.children?.[1]?.sizes,
    }
  })

  expect(sizes).toEqual({
    root: [50, 50],
    left: [25, 75],
    right: [35, 65],
  })
})
