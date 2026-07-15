import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const nonSelectableCodexCapabilities = {
  provider: 'codex',
  supportsModelSelection: false,
  currentModel: null,
  availableModels: [],
  reasoningLevels: [],
  defaultReasoningLevel: null,
  supportsFastMode: false,
  attachments: [],
}

const installConnectedCodexAuth = async (page: Page) => {
  await page.addInitScript(() => {
    const bridgeWindow = window as Window & {
      __GTUM_AGENT_AUTH_RUNTIME__: unknown
    }
    const codexConnected = {
      provider: 'codex',
      displayName: 'Codex',
      availability: 'available',
      status: 'connected',
      connectionKind: 'real',
      accountLabel: 'Codex CLI',
      accountEmail: null,
      requiredScopes: ['project:read', 'terminal:read'],
      expiresAt: null,
      callbackUrl: null,
      authUrl: null,
      activeLoginId: null,
      activeLoginState: null,
      connectedAt: 1,
      lastLoginAttemptAt: 1,
      updatedAt: 1,
      lastError: null,
    }

    bridgeWindow.__GTUM_AGENT_AUTH_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async () => [codexConnected],
    }
  })
}

function tauriLaunchWindowSize() {
  const configPath = resolve(repoRoot, 'src-tauri/tauri.conf.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    app: { windows: Array<{ width: number; height: number }> }
  }

  return config.app.windows[0]
}

function tauriDefaultPermissions(): string[] {
  const configPath = resolve(repoRoot, 'src-tauri/capabilities/default.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    permissions: string[]
  }

  return config.permissions
}

test('renders the clean uploaded design prototype shell', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('.gtum-window')).toBeVisible()
  await expect(page.locator('.titlebar')).toBeVisible()
  await expect(page.locator('.sidebar')).toBeVisible()
  await expect(page.locator('.center')).toBeVisible()
  await expect(page.locator('.agent')).toBeVisible()
  await expect(page.locator('.statusbar')).toBeVisible()
  await expect(page.locator('.activity-rail')).toHaveCount(0)
})

test('keeps uploaded design proportions after frontend reset', async ({ page }) => {
  await page.goto('/')

  const shell = await page.locator('.gtum-window').boundingBox()
  const titlebar = await page.locator('.titlebar').boundingBox()
  const sidebar = await page.locator('.sidebar').boundingBox()
  const agent = await page.locator('.agent').boundingBox()
  const scale = await page.evaluate(() => {
    const scaler = document.querySelector<HTMLElement>('.gtum-scaler')
    const value = scaler ? window.getComputedStyle(scaler).getPropertyValue('--scale') : '1'

    return Number.parseFloat(value) || 1
  })

  expect(shell).not.toBeNull()
  expect(titlebar).not.toBeNull()
  expect(sidebar).not.toBeNull()
  expect(agent).not.toBeNull()
  expect(shell!.width / scale).toBeLessThanOrEqual(1320)
  expect(shell!.height / scale).toBeLessThanOrEqual(824)
  expect(titlebar!.height / scale).toBeLessThanOrEqual(42)
  expect(sidebar!.width / scale).toBeLessThanOrEqual(276)
  expect(agent!.width / scale).toBeGreaterThanOrEqual(360)
})

test('fits the Tauri launch window without shell letterboxing', async ({ page }) => {
  const launchWindow = tauriLaunchWindowSize()

  await page.setViewportSize({
    width: launchWindow.width,
    height: launchWindow.height,
  })
  await page.goto('/')

  const stage = await page.locator('.gtum-stage').boundingBox()
  const shell = await page.locator('.gtum-window').boundingBox()
  const scale = await page.evaluate(() => {
    const scaler = document.querySelector<HTMLElement>('.gtum-scaler')
    const value = scaler ? window.getComputedStyle(scaler).getPropertyValue('--scale') : '1'

    return Number.parseFloat(value) || 1
  })

  expect(stage).not.toBeNull()
  expect(shell).not.toBeNull()
  expect(scale).toBeCloseTo(1, 2)
  expect(Math.round(shell!.width)).toBe(launchWindow.width)
  expect(Math.round(shell!.height)).toBe(launchWindow.height)
  expect(Math.round(shell!.x - stage!.x)).toBe(0)
  expect(Math.round(shell!.y - stage!.y)).toBe(0)
})

test('fills larger resized desktop windows without fixed-canvas letterboxing', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/')

  const stage = await page.locator('.gtum-stage').boundingBox()
  const shell = await page.locator('.gtum-window').boundingBox()

  expect(stage).not.toBeNull()
  expect(shell).not.toBeNull()
  expect(Math.round(shell!.width)).toBe(Math.round(stage!.width))
  expect(Math.round(shell!.height)).toBe(Math.round(stage!.height))
  expect(Math.round(shell!.x - stage!.x)).toBe(0)
  expect(Math.round(shell!.y - stage!.y)).toBe(0)
})

test('preserves titlebar and statusbar shell contracts', async ({ page }) => {
  await page.goto('/')

  const titlebar = page.locator('.titlebar')
  const statusbar = page.locator('.statusbar')

  await expect(titlebar).toHaveCount(1)
  await expect(statusbar).toHaveCount(1)
  await expect(titlebar).toHaveAttribute('data-comment-anchor', 'titlebar')
  await expect(statusbar).toHaveAttribute('data-comment-anchor', 'statusbar')

  await expect(titlebar).toContainText('gtum')
  await expect(titlebar).toContainText('Open a project')
  await expect(titlebar).toContainText('no-project')
  await expect(titlebar).toContainText('[--]')
  await expect(titlebar).toContainText('Live / 0 active agent')

  await expect(statusbar).toContainText('Ready')
  await expect(statusbar).toContainText('no-project')
  await expect(statusbar).toContainText('0 changes')
  await expect(statusbar).toContainText('up 0 / down 0')
  await expect(statusbar).toContainText('0 tabs / 1 groups')
  await expect(statusbar).toContainText('Cmd+K')

  await titlebar.locator('.pill.icon-only').click()
  await expect(page.locator('.settings-modal')).toBeVisible()
})

test('closes a no-project fallback terminal without leaving a tab or page error', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/')
  await page.locator('.gt-add').first().click()

  const fallbackTab = page.locator('.gt').first()
  await expect(fallbackTab).toHaveCount(1)
  await expect(fallbackTab.locator('.lamp')).toHaveClass(/failed/)
  await fallbackTab.locator('.x-btn').click()

  await expect(page.locator('.gt')).toHaveCount(0)
  expect(pageErrors).toEqual([])
})

test('exposes actual agent controls without fixed models or legacy execution modes', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('.agent')).not.toContainText('GPT-5')
  await expect(page.locator('.agent')).not.toContainText('Balanced')
  await expect(page.locator('.agent')).not.toContainText('Deep')
  await expect(page.locator('.agent-model-row')).toHaveCount(0)
  await expect(page.locator('.context-summary')).toHaveCount(0)
  await expect(page.locator('.agent-session-strip')).toBeVisible()
  await expect(page.locator('.composer-reasoning-chip')).toHaveCount(0)
  await expect(page.locator('.fast-toggle')).toHaveCount(0)
  await expect(page.locator('.composer-scope-chip')).toHaveCount(0)
  await expect(page.locator('.composer-quick')).toHaveCount(0)
  await expect(page.locator('.agent')).not.toContainText('Explain current state')
  await expect(page.locator('.agent')).not.toContainText('Suggest a fix')
  await expect(page.locator('.agent')).not.toContainText('Rerun tests')
  await expect(page.locator('.statusbar')).not.toContainText('Mode:')

  await page.locator('.titlebar .pill.icon-only').click()
  const settings = page.locator('.settings-modal')
  await expect(settings).toBeVisible()
  await expect(settings).not.toContainText('Models')
  await expect(settings).not.toContainText('Pick the default model per provider.')
  await expect(settings).not.toContainText('Default mode')
  await expect(settings).not.toContainText('GPT-5')
  await expect(settings).not.toContainText('Balanced')
  await expect(settings).not.toContainText('Deep')
})

test('uses runtime provider capabilities for the composer model picker', async ({ page }) => {
  await installConnectedCodexAuth(page)
  await page.addInitScript(() => {
    const bridgeWindow = window as Window & {
      __agentCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __projectCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __GTUM_AGENT_ATTACHMENT_PICKER__: unknown
      __GTUM_AGENT_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
    }

    bridgeWindow.__agentCalls = []
    bridgeWindow.__projectCalls = []
    bridgeWindow.__GTUM_AGENT_ATTACHMENT_PICKER__ = {
      pick: async () => [
        {
          kind: 'image',
          path: '/tmp/screenshot.png',
          label: 'screenshot.png',
        },
      ],
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__projectCalls.push({ command, args })

        return {
          metadata: {
            name: 'aurora-monorepo',
            path: '~/code/aurora-monorepo',
          },
          tree: {
            name: 'aurora-monorepo',
            path: '~/code/aurora-monorepo',
            kind: 'directory',
            children: [],
          },
          git: {
            isRepository: true,
            branch: 'feature/onboarding-funnel',
            branchType: 'feature',
            changedFilesCount: 7,
          },
        }
      },
    }
    bridgeWindow.__GTUM_AGENT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__agentCalls.push({ command, args })

        if (command === 'read_agent_provider_capabilities') {
          return {
            provider: 'codex',
            supportsModelSelection: true,
            currentModel: {
              providerId: 'codex',
              modelId: 'gpt-5.5',
              label: 'GPT-5.5',
            },
            availableModels: [
              {
                providerId: 'codex',
                modelId: 'gpt-5.5',
                label: 'GPT-5.5',
              },
              {
                providerId: 'codex',
                modelId: 'gpt-5-codex',
                label: 'GPT-5 Codex',
              },
            ],
            reasoningLevels: [
              {
                level: 'low',
                label: 'Low',
                description: 'Fast responses with lighter reasoning',
              },
              {
                level: 'medium',
                label: 'Medium',
                description: 'Balances speed and reasoning depth',
              },
              {
                level: 'high',
                label: 'High',
                description: 'Greater reasoning depth',
              },
              {
                level: 'xhigh',
                label: 'XHigh',
                description: 'Extra high reasoning depth',
              },
            ],
            defaultReasoningLevel: 'xhigh',
            supportsFastMode: true,
            attachments: [
              {
                kind: 'image',
                label: 'Image',
                enabled: true,
                invocationFlag: '--image',
              },
            ],
          }
        }

        if (command === 'request_agent_suggestions') {
          return [
            {
              id: 'codex-runtime-model',
              provider: 'codex',
              summary: 'Run selected model smoke',
              command: 'pnpm test:model-picker',
              preferredTarget: 'new_tab',
              confidence: 'high',
              error: null,
            },
          ]
        }

        return {
          provider: 'codex',
          setupState: 'ready',
          connectionPath: 'Codex CLI ChatGPT session',
          summary: 'Codex is ready',
          guidance: 'Ready',
          baseUrl: null,
          model: 'GPT-5.5',
          requirements: [],
        }
      },
    }
  })

  await page.goto('/')

  await expect(page.locator('.composer-model-chip'))
    .toHaveAttribute('aria-label', 'Codex model: GPT-5.5')
  await page.getByText('Open project folder').click()
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __GTUM_BACKEND_BRIDGE__?: { runtimeBacked: boolean }
            }
          ).__GTUM_BACKEND_BRIDGE__?.runtimeBacked ?? false,
      ),
    )
    .toBe(true)

  await expect(page.locator('.composer-tool')).toHaveAttribute('title', /Image/)
  await page.locator('.composer-tool').click()
  await expect(page.locator('.composer-attachment-chip')).toContainText('screenshot.png')
  await page.locator('.composer-model-chip').click()
  await page.locator('.composer-model-option').filter({ hasText: 'GPT-5 Codex' }).click()
  await expect(page.locator('.composer-model-chip'))
    .toHaveAttribute('aria-label', 'Codex model: GPT-5 Codex')
  await expect(page.locator('.composer-reasoning-chip'))
    .toHaveAttribute('aria-label', 'Reasoning level: XHigh')
  await page.locator('.composer-reasoning-chip').click()
  const reasoningMenu = page.getByRole('listbox', { name: 'Reasoning levels' })
  await expect(reasoningMenu.locator('[role="option"][aria-selected="true"]')).toHaveText('XHigh')
  await reasoningMenu.getByRole('option', { name: 'XHigh', exact: true }).click()
  await page.locator('.fast-toggle').click()
  const fastMenu = page.getByRole('listbox', { name: 'Fast mode' })
  await expect(fastMenu.locator('[role="option"][aria-selected="true"]')).toHaveText('Disabled')
  await fastMenu.getByRole('option', { name: 'Enabled', exact: true }).click()
  await expect(page.locator('.fast-toggle')).toHaveAttribute('aria-label', 'Fast mode: Enabled')

  await page.getByPlaceholder('Ask Codex').fill('test prompt')
  await page.locator('.composer-input .send').click()

  await expect(page.locator('.agent-turn').last()).toContainText('Run selected model smoke')
  await expect(page.locator('.agent-log-item.suggestion')).toHaveCount(0)

  const requestCall = await page.evaluate(
    () =>
      (
        window as Window & {
          __agentCalls?: Array<{ command: string; args?: { request?: Record<string, unknown> } }>
        }
      ).__agentCalls?.find((call) => call.command === 'request_agent_suggestions') ?? null,
  )

  expect(requestCall?.args?.request?.model).toBe('gpt-5-codex')
  expect(requestCall?.args?.request?.reasoningLevel).toBe('xhigh')
  expect(requestCall?.args?.request?.fastMode).toBe(true)
  expect(requestCall?.args?.request?.attachments).toEqual([
    {
      kind: 'image',
      path: '/tmp/screenshot.png',
      label: 'screenshot.png',
    },
  ])
})

test('shows project workspaces in the sidebar and switches agent sessions from the tree', async ({ page }) => {
  await page.addInitScript(() => {
    const bridgeWindow = window as Window & {
      __GTUM_PROJECT_RUNTIME__: unknown
    }

    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async () => ({
        metadata: {
          name: 'aurora-monorepo',
          path: '~/code/aurora-monorepo',
        },
        tree: {
          name: 'aurora-monorepo',
          path: '~/code/aurora-monorepo',
          kind: 'directory',
          children: [],
        },
        git: {
          isRepository: true,
          branch: 'feature/onboarding-funnel',
          branchType: 'feature',
          changedFilesCount: 7,
        },
      }),
    }
  })

  await page.goto('/')
  await page.getByText('Open project folder').click()
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __GTUM_BACKEND_BRIDGE__?: { runtimeBacked: boolean }
            }
          ).__GTUM_BACKEND_BRIDGE__?.runtimeBacked ?? false,
      ),
    )
    .toBe(true)

  const projectGroup = page.locator('.project-group').filter({ hasText: 'aurora-monorepo' })
  await expect(projectGroup).toBeVisible()
  await expect(projectGroup.locator('.ws-item')).toHaveCount(1)
  await expect(projectGroup.locator('.ws-item.active')).toContainText('feature/onboarding-funnel')
  await expect(projectGroup.locator('.ws-item.active')).toContainText('Waiting')

  await projectGroup.locator('.project-workspace-new').click()
  await expect(projectGroup.locator('.ws-item')).toHaveCount(2)
  await projectGroup.locator('.ws-item').nth(1).click()
  await expect(projectGroup.locator('.ws-item').nth(1)).toHaveClass(/active/)
  await expect(page.locator('.agent-session-tab.active')).toContainText(/ridge|harbor|orbit|signal/)
})

test('lets users stop a running agent request from the composer', async ({ page }) => {
  await installConnectedCodexAuth(page)
  await page.addInitScript((codexCapabilities) => {
    const bridgeWindow = window as Window & {
      __GTUM_AGENT_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
    }

    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async () => ({
        metadata: {
          name: 'aurora-monorepo',
          path: '~/code/aurora-monorepo',
        },
        tree: {
          name: 'aurora-monorepo',
          path: '~/code/aurora-monorepo',
          kind: 'directory',
          children: [],
        },
        git: {
          isRepository: true,
          branch: 'feature/onboarding-funnel',
          branchType: 'feature',
          changedFilesCount: 7,
        },
      }),
    }
    bridgeWindow.__GTUM_AGENT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string) => {
        if (command === 'read_agent_provider_capabilities') {
          return codexCapabilities
        }

        if (command === 'request_agent_suggestions') {
          await new Promise((resolve) => window.setTimeout(resolve, 5000))
          return [
            {
              id: 'late-suggestion',
              provider: 'codex',
              summary: 'This should not appear after stop',
              command: 'pnpm test:late',
              preferredTarget: 'new_tab',
              confidence: 'high',
              error: null,
            },
          ]
        }

        return {
          provider: 'codex',
          setupState: 'ready',
          connectionPath: 'Codex CLI ChatGPT session',
          summary: 'Codex is ready',
          guidance: 'Ready',
          baseUrl: null,
          model: 'Codex CLI default',
          requirements: [],
        }
      },
    }
  }, nonSelectableCodexCapabilities)

  await page.goto('/')
  await page.getByText('Open project folder').click()
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __GTUM_BACKEND_BRIDGE__?: { runtimeBacked: boolean }
            }
          ).__GTUM_BACKEND_BRIDGE__?.runtimeBacked ?? false,
      ),
    )
    .toBe(true)

  await page.getByPlaceholder('Ask Codex').fill('long running request')
  await page.locator('.composer-input .send').click()
  await expect(page.locator('.composer-input .send')).toHaveClass(/stopping/)
  await expect(page.locator('.composer-input .send')).toHaveAttribute('title', /Stop/)

  await page.locator('.composer-input .send').click()
  await expect(page.locator('.composer-input .send')).not.toHaveClass(/stopping/)
  await expect(page.locator('.agent-turn').last()).toContainText('Stopped by user')
  await expect(page.locator('.composer-approval')).toHaveCount(0)
})

test('opens inline reference suggestions for file, PR, and slash-command triggers', async ({ page }) => {
  await page.goto('/')

  const composer = page.getByPlaceholder('Ask Codex')

  await composer.fill('@')
  await expect(page.locator('.composer-reference-menu')).toContainText('Files and folders')
  await expect(page.locator('.composer-reference-menu')).toContainText('@ src/')

  await composer.fill('#')
  await expect(page.locator('.composer-reference-menu')).toContainText('PRs and issues')
  await expect(page.locator('.composer-reference-menu')).toContainText('# Pull request')

  await composer.fill('/')
  await expect(page.locator('.composer-reference-menu')).toContainText('Slash commands')
  await expect(page.locator('.composer-reference-menu')).toContainText('/review')
})

test('preserves prototype interactions without legacy frontend state', async ({ page }) => {
  await page.goto('/')

  const projectsSection = page.locator('.sb-section').filter({ hasText: 'Projects' })
  const filesSection = page.locator('.sb-section').filter({ hasText: 'Files' })

  await expect(projectsSection.getByText('aurora-monorepo')).toHaveCount(0)
  await expect(filesSection.getByText('OnboardingFunnel.tsx')).toHaveCount(0)
  await expect(filesSection.getByText('Open a real project folder in the desktop app.')).toBeVisible()

  await projectsSection.locator('.sb-section-h').click()
  await expect(projectsSection.getByText('Open project folder')).toBeHidden()
  await expect(filesSection.getByText('Open a real project folder in the desktop app.')).toBeVisible()
})

test('exposes backend bridge state while keeping browser fallback stable', async ({ page }) => {
  await page.goto('/')

  await page.waitForFunction(() =>
    Boolean((window as Window & { __GTUM_BACKEND_BRIDGE__?: unknown }).__GTUM_BACKEND_BRIDGE__),
  )

  const bridge = await page.evaluate(() =>
    (window as Window & {
      __GTUM_BACKEND_BRIDGE__: { desktop: boolean; projectPath: string; runtimeBacked: boolean }
    }).__GTUM_BACKEND_BRIDGE__,
  )

  expect(bridge.desktop).toBe(false)
  expect(bridge.runtimeBacked).toBe(false)
  expect(bridge.projectPath).toBe('')

  await page.locator('.project-item.action').click()
  await expect(page.locator('.titlebar').getByText('Open a project')).toBeVisible()
  await expect(page.locator('.msg.assistant').last()).toContainText(
    'Opening a real project folder is available in the installed desktop app.',
  )
})

test('does not create canned agent replies when desktop runtime is unavailable', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('.sugg')).toHaveCount(0)
  const initialSuggestionCount = 0

  await page.getByPlaceholder('Ask Codex').fill('test prompt')
  await page.locator('.composer-input .send').click()

  await expect(page.locator('.msg.assistant').last()).toContainText('Codex')
  await expect(page.locator('.msg.assistant').last()).not.toContainText('useFunnelState')
  await expect(page.locator('.msg.assistant').last()).not.toContainText('pnpm test:funnel')
  await expect(page.locator('.sugg')).toHaveCount(initialSuggestionCount)
})

test('restores the last runtime project from workspace persistence', async ({ page }) => {
  await page.addInitScript(() => {
    const bridgeWindow = window as Window & {
      __workspaceCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __projectCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __GTUM_WORKSPACE_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
    }

    bridgeWindow.__workspaceCalls = []
    bridgeWindow.__projectCalls = []
    bridgeWindow.__GTUM_WORKSPACE_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__workspaceCalls.push({ command, args })

        return {
          storagePath: '/tmp/gtum-workspace-state.json',
          snapshot: {
            recentProjects: ['/workspace/restored'],
            lastOpenedProjectPath: '/workspace/restored',
            updatedAt: 100,
            storageVersion: 1,
          },
          restoredAt: 120,
        }
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__projectCalls.push({ command, args })

        return {
          metadata: {
            name: 'restored-workspace',
            path: '/workspace/restored',
          },
          tree: {
            name: 'restored-workspace',
            path: '/workspace/restored',
            kind: 'directory',
            children: [],
          },
          git: {
            isRepository: true,
            branch: 'feature/runtime-restore',
            branchType: 'feature',
            changedFilesCount: 2,
          },
        }
      },
    }
  })

  await page.goto('/')

  await expect(page.locator('.titlebar')).toContainText('restored-workspace')

  const calls = await page.evaluate(
    () => {
      const bridgeWindow = window as Window & {
        __workspaceCalls?: Array<{ command: string }>
        __projectCalls?: Array<{ command: string; args?: Record<string, unknown> }>
      }

      return {
        workspaceCalls: bridgeWindow.__workspaceCalls ?? [],
        projectCalls: bridgeWindow.__projectCalls ?? [],
      }
    },
  )

  expect(calls.workspaceCalls.map((call) => call.command)).toContain(
    'read_workspace_runtime_snapshot',
  )
  expect(calls.projectCalls).toEqual([
    {
      command: 'read_project_overview',
      args: {
        path: '/workspace/restored',
      },
    },
  ])
})

test('opens runtime projects through the workspace registry without hidden execution mode', async ({ page }) => {
  await page.addInitScript(() => {
    const bridgeWindow = window as Window & {
      __workspaceCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __projectCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __GTUM_WORKSPACE_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
      __GTUM_PROJECT_FOLDER_PICKER__: unknown
    }

    bridgeWindow.__workspaceCalls = []
    bridgeWindow.__projectCalls = []
    bridgeWindow.__GTUM_PROJECT_FOLDER_PICKER__ = {
      pick: async () => '/workspace/gtum',
    }
    bridgeWindow.__GTUM_WORKSPACE_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__workspaceCalls.push({ command, args })

        if (command === 'read_workspace_runtime_snapshot') {
          return {
            storagePath: '/tmp/gtum-workspace-state.json',
            snapshot: {
              recentProjects: [],
              lastOpenedProjectPath: null,
              updatedAt: 100,
              storageVersion: 1,
            },
            restoredAt: 120,
          }
        }

        return {
          recentProjects: ['/workspace/gtum'],
          lastOpenedProjectPath: '/workspace/gtum',
          updatedAt: 140,
          storageVersion: 1,
        }
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__projectCalls.push({ command, args })

        return {
          metadata: {
            name: 'gtum-runtime',
            path: '/workspace/gtum',
          },
          tree: {
            name: 'gtum-runtime',
            path: '/workspace/gtum',
            kind: 'directory',
            children: [],
          },
          git: {
            isRepository: true,
            branch: 'dev',
            branchType: 'local',
            changedFilesCount: 1,
          },
        }
      },
    }
  })

  await page.goto('/')
  await page.getByText('Open project folder').click()

  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __workspaceCalls?: Array<{ command: string }>
            }
          ).__workspaceCalls?.map((call) => call.command) ?? [],
      ),
    )
    .toEqual(
      expect.arrayContaining([
        'open_workspace_project',
      ]),
    )

  const calls = await page.evaluate(
    () =>
      (
        window as Window & {
          __workspaceCalls?: Array<{ command: string; args?: Record<string, unknown> }>
        }
      ).__workspaceCalls ?? [],
  )
  const openCall = calls.find((call) => call.command === 'open_workspace_project')

  expect(openCall?.args).toEqual({
    request: {
      path: '/workspace/gtum',
    },
  })
  expect(calls.map((call) => call.command)).not.toContain('set_workspace_execution_mode')
})

test('saves through the editor tab owner and ignores a late response for a reused foreign tab id', async ({ page }) => {
  await page.addInitScript(() => {
    const bridgeWindow = window as Window & {
      __projectCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __resolveProjectSave?: () => void
      __GTUM_PROJECT_RUNTIME__: unknown
    }
    let overviewCount = 0

    bridgeWindow.__projectCalls = []
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__projectCalls.push({ command, args })

        if (command === 'read_project_overview') {
          overviewCount += 1
          const owner = overviewCount === 1 ? 'project-a' : 'project-b'
          const projectPath = `/workspace/${owner}`
          return {
            metadata: {
              name: owner,
              path: projectPath,
            },
            tree: {
              name: owner,
              path: projectPath,
              kind: 'directory',
              children: [
                {
                  name: 'shared.ts',
                  path: 'src/shared.ts',
                  kind: 'file',
                },
              ],
            },
            git: {
              isRepository: true,
              branch: 'dev',
              branchType: 'local',
              changedFilesCount: 1,
            },
          }
        }

        if (command === 'read_project_file') {
          const projectPath = String(args?.projectPath)
          const owner = projectPath.endsWith('project-a') ? 'A' : 'B'
          return {
            projectPath,
            filePath: 'src/shared.ts',
            displayPath: 'src/shared.ts',
            content: `const owner = '${owner}'`,
            contentHash: `hash-${owner.toLowerCase()}`,
            isText: true,
            truncated: false,
          }
        }

        if (command === 'write_project_file') {
          return new Promise((resolve) => {
            bridgeWindow.__resolveProjectSave = () => resolve({
              projectPath: '/workspace/project-a',
              filePath: 'src/shared.ts',
              displayPath: 'src/shared.ts',
              content: "const owner = 'A changed'",
              contentHash: 'hash-a-saved',
              isText: true,
              truncated: false,
            })
          })
        }

        throw new Error(`Unexpected project command: ${command}`)
      },
    }
  })

  await page.goto('/')
  await page.getByText('Open project folder').click()
  await page.locator('.tree-row.file').filter({ hasText: 'shared.ts' }).click()
  await expect(page.locator('.editor-textarea')).toHaveValue("const owner = 'A'")
  await page.locator('.editor-textarea').fill("const owner = 'A changed'")

  // Start A's save, then switch projects while the owner-scoped response is
  // still pending.
  await page.getByRole('button', { name: 'Save' }).click()

  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __projectCalls?: Array<{ command: string }>
            }
          ).__projectCalls?.filter((call) => call.command === 'write_project_file').length ?? 0,
      ),
    )
    .toBe(1)

  await page.getByText('Open project folder').click()
  await expect(page.locator('.project-group')).toContainText('project-b')

  // B gets an independent workbench even though its same relative file reuses
  // the deterministic editor id. A's late response must not overwrite it.
  await page.locator('.tree-row.file').filter({ hasText: 'shared.ts' }).click()
  await expect(page.locator('.editor-textarea')).toHaveValue("const owner = 'B'")

  await page.evaluate(async () => {
    const bridgeWindow = window as Window & { __resolveProjectSave?: () => void }
    bridgeWindow.__resolveProjectSave?.()
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
  })

  await expect(page.locator('.editor-textarea')).toHaveValue("const owner = 'B'")
  const writeCall = await page.evaluate(
    () =>
      (
        window as Window & {
          __projectCalls?: Array<{
            command: string
            args?: { request?: Record<string, unknown> }
          }>
        }
      ).__projectCalls?.find((call) => call.command === 'write_project_file') ?? null,
  )
  expect(writeCall?.args).toEqual({
    request: {
      projectPath: '/workspace/project-a',
      filePath: 'src/shared.ts',
      content: "const owner = 'A changed'",
      expectedContentHash: 'hash-a',
    },
  })
})

test('routes terminal tab lifecycle through the runtime PTY bridge', async ({ page }) => {
  await page.addInitScript(() => {
    const rawOutput =
      '\u001b[31mRED\u001b[0m \u001b]633;Conductor;ProgramStart\u0007plain\r\n'
    const snapshot = {
      projectPath: '/workspace/project',
      sessionId: 77,
      name: 'New tab',
      cwd: '/workspace/project',
      shell: '/bin/zsh',
      shellArgs: ['-i'],
      processId: 1234,
      status: 'running',
      createdAt: 100,
      updatedAt: 100,
      exitCode: null,
      logLineCount: 1,
      maxLogEntries: 400,
      lastEvent: 'session created',
    }
    const bridgeWindow = window as Window & {
      __projectCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __terminalCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __GTUM_PROJECT_RUNTIME__: unknown
      __GTUM_TERMINAL_RUNTIME__: unknown
    }

    bridgeWindow.__projectCalls = []
    bridgeWindow.__terminalCalls = []
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__projectCalls.push({ command, args })

        return {
          metadata: {
            name: 'pty-project',
            path: '/workspace/project',
          },
          tree: {
            name: 'pty-project',
            path: '/workspace/project',
            kind: 'directory',
            children: [],
          },
          git: {
            isRepository: true,
            branch: 'dev',
            branchType: 'local',
            changedFilesCount: 0,
          },
        }
      },
    }
    bridgeWindow.__GTUM_TERMINAL_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__terminalCalls.push({ command, args })

        if (command === 'read_terminal_session_logs') {
          return {
            projectPath: '/workspace/project',
            sessionId: 77,
            status: 'running',
            limit: 100,
            logLineCount: 1,
            truncated: false,
            entries: ['runtime ready'],
            updatedAt: 120,
          }
        }

        if (command === 'read_raw_terminal_output') {
          const from = typeof args?.from === 'number' ? args.from : 0
          return {
            projectPath: '/workspace/project',
            sessionId: 77,
            base: 0,
            cursor: rawOutput.length,
            chunk: from === 0 ? rawOutput : '',
            status: 'running',
          }
        }

        if (command === 'close_terminal_session') {
          return { ...snapshot, status: 'terminated', updatedAt: 130 }
        }

        return snapshot
      },
    }
  })

  await page.goto('/')
  await page.getByText('Open project folder').click()
  await expect(page.locator('.titlebar')).toContainText('pty-project')
  await page.locator('.gt-add').first().click()

  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __terminalCalls?: Array<{ command: string }>
            }
          ).__terminalCalls?.map((call) => call.command) ?? [],
      ),
    )
    .toContain('create_terminal_session')

  // The runtime-backed terminal renders a real xterm terminal, not the old
  // .term-line list or the standalone command input form.
  await expect(page.locator('.term-xterm')).toBeVisible()
  await expect(page.locator('.term-xterm .xterm')).toHaveCount(1)
  await expect(page.locator('.terminal-input-form')).toHaveCount(0)

  await page.keyboard.type('x')

  // The xterm effect pumps raw PTY output on an interval.
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __terminalCalls?: Array<{ command: string }>
            }
          ).__terminalCalls?.map((call) => call.command) ?? [],
      ),
    )
    .toContain('read_raw_terminal_output')

  await expect(page.locator('.term-xterm .xterm-rows')).toContainText('RED plain')
  await expect(page.locator('.term-xterm .xterm-rows')).not.toContainText('[31m')
  await expect(page.locator('.term-xterm .xterm-rows')).not.toContainText('Conductor;ProgramStart')
  await expect(page.locator('.term-xterm .xterm-rows')).not.toContainText('\ufffd')

  const resizeCall = await page.evaluate(
    () =>
      (
        window as Window & {
          __terminalCalls?: Array<{ command: string; args?: Record<string, unknown> }>
        }
      ).__terminalCalls?.find((call) => call.command === 'resize_terminal_session'),
  )
  expect(Number(resizeCall?.args?.rows)).toBeGreaterThan(0)
  expect(Number(resizeCall?.args?.cols)).toBeGreaterThan(0)
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __terminalCalls?: Array<{ command: string }>
            }
          ).__terminalCalls?.map((call) => call.command) ?? [],
      ),
    )
    .toEqual(
      expect.arrayContaining([
        'resize_terminal_session',
        'write_terminal_input',
        'read_terminal_session_logs',
      ]),
    )

  await page.locator('.group.active .gt.active .x-btn').click()

  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __terminalCalls?: Array<{ command: string }>
            }
          ).__terminalCalls?.map((call) => call.command) ?? [],
      ),
    )
    .toContain('close_terminal_session')

  const calls = await page.evaluate(
    () =>
      (
        window as Window & {
          __terminalCalls?: Array<{ command: string; args?: Record<string, unknown> }>
        }
      ).__terminalCalls ?? [],
  )
  expect(calls.find((call) => call.command === 'create_terminal_session')?.args).toEqual({
    request: {
      projectPath: '/workspace/project',
      name: 'terminal',
      cwd: '/workspace/project',
    },
  })
  for (const command of [
    'resize_terminal_session',
    'write_terminal_input',
    'read_raw_terminal_output',
    'read_terminal_session_logs',
    'close_terminal_session',
  ]) {
    const ownedCalls = calls.filter((call) => call.command === command)
    expect(ownedCalls.length, `${command} must be invoked`).toBeGreaterThan(0)
    for (const call of ownedCalls) {
      expect(call.args).toMatchObject({
        projectPath: '/workspace/project',
        sessionId: 77,
      })
    }
  }
})

test('closes a late runtime session after its provisional tab was closed', async ({ page }) => {
  type TerminalCall = { command: string; args?: Record<string, unknown> }
  type TestWindow = Window & {
    __terminalCalls: TerminalCall[]
    __resolveFirstTerminal?: () => void
    __GTUM_PROJECT_RUNTIME__: unknown
    __GTUM_TERMINAL_RUNTIME__: unknown
  }

  await page.addInitScript(() => {
    const bridgeWindow = window as TestWindow
    let createCount = 0
    const snapshot = (sessionId: number, status = 'running') => ({
      projectPath: '/workspace/project-a',
      sessionId,
      name: sessionId === 77 ? 'late terminal' : 'replacement terminal',
      cwd: '/workspace/project-a',
      shell: '/bin/zsh',
      shellArgs: ['-i'],
      processId: sessionId * 100,
      status,
      createdAt: 100,
      updatedAt: status === 'running' ? 120 : 180,
      exitCode: null,
      logLineCount: 1,
      maxLogEntries: 400,
      lastEvent: status,
    })

    bridgeWindow.__terminalCalls = []
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async () => ({
        metadata: { name: 'project-a', path: '/workspace/project-a' },
        tree: {
          name: 'project-a',
          path: '/workspace/project-a',
          kind: 'directory',
          children: [],
        },
        git: {
          isRepository: true,
          branch: 'dev',
          branchType: 'local',
          changedFilesCount: 0,
        },
      }),
    }
    bridgeWindow.__GTUM_TERMINAL_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__terminalCalls.push({ command, args })

        if (command === 'create_terminal_session') {
          createCount += 1
          if (createCount === 1) {
            return new Promise((resolve) => {
              bridgeWindow.__resolveFirstTerminal = () => resolve(snapshot(77))
            })
          }
          return snapshot(88)
        }

        const sessionId = Number(args?.sessionId)
        if (command === 'read_raw_terminal_output') {
          const from = Number(args?.from) || 0
          const chunk = from === 0 ? `replacement session ${sessionId}` : ''
          return {
            projectPath: '/workspace/project-a',
            sessionId,
            base: 0,
            cursor: from + chunk.length,
            chunk,
            status: 'running',
          }
        }
        if (command === 'read_terminal_session_logs') {
          return {
            projectPath: '/workspace/project-a',
            sessionId,
            status: 'running',
            limit: 400,
            logLineCount: 1,
            truncated: false,
            entries: [`replacement session ${sessionId}`],
            updatedAt: 140,
          }
        }
        if (command === 'close_terminal_session') {
          return snapshot(sessionId, 'terminated')
        }
        return undefined
      },
    }
  })

  const terminalCalls = () => page.evaluate(
    () => (window as TestWindow).__terminalCalls,
  )

  await page.goto('/')
  await page.getByText('Open project folder').click()
  await page.locator('.gt-add').first().click()
  await expect
    .poll(() => page.evaluate(
      () => Boolean((window as TestWindow).__resolveFirstTerminal),
    ))
    .toBe(true)

  const provisionalTabId = await page.locator('.group.active .gt.active').getAttribute('data-tab-id')
  expect(provisionalTabId).toBeTruthy()
  await page.locator(`.gt[data-tab-id="${provisionalTabId}"] .x-btn`).click()
  await expect(page.locator(`.gt[data-tab-id="${provisionalTabId}"]`)).toHaveCount(0)

  // A replacement tab must remain untouched when the first create resolves.
  await page.locator('.gt-add').first().click()
  await expect(page.locator('.term-xterm')).toContainText('replacement session 88')
  const replacementTabId = await page.locator('.group.active .gt.active').getAttribute('data-tab-id')
  expect(replacementTabId).toBeTruthy()
  expect(replacementTabId).not.toBe(provisionalTabId)
  expect((await terminalCalls()).filter((call) => call.command === 'close_terminal_session')).toEqual([])

  await page.evaluate(() => {
    ;(window as TestWindow).__resolveFirstTerminal?.()
  })

  await expect
    .poll(async () =>
      (await terminalCalls()).filter((call) => call.command === 'close_terminal_session'),
    )
    .toEqual([
      {
        command: 'close_terminal_session',
        args: {
          projectPath: '/workspace/project-a',
          sessionId: 77,
        },
      },
    ])
  const replacementTab = page.locator(`.gt[data-tab-id="${replacementTabId}"]`)
  await expect(replacementTab).toHaveClass(/active/)
  await expect(replacementTab.locator('.lamp')).toHaveClass(/running/)
  await expect(page.locator('.term-xterm')).toContainText('replacement session 88')
})

test('keeps project A terminal alive and hidden after switching to project B', async ({ page }) => {
  type TerminalCall = {
    command: string
    args?: Record<string, unknown>
    afterProjectSwitch: boolean
  }
  type TestWindow = Window & {
    __projectBActive: boolean
    __terminalCalls: TerminalCall[]
    __resolveDelayedProjectALog?: () => void
    __GTUM_PROJECT_RUNTIME__: unknown
    __GTUM_TERMINAL_RUNTIME__: unknown
  }

  await page.addInitScript(() => {
    const bridgeWindow = window as TestWindow
    let delayedProjectALog = false
    let projectOverviewCount = 0

    const terminalSnapshot = (
      projectPath: string,
      sessionId: number,
      status = 'running',
    ) => ({
      projectPath,
      sessionId,
      name: projectPath.endsWith('project-a') ? 'A terminal' : 'B terminal',
      cwd: projectPath,
      shell: '/bin/zsh',
      shellArgs: ['-i'],
      processId: sessionId * 100,
      status,
      createdAt: 100,
      updatedAt: status === 'running' ? 120 : 180,
      exitCode: null,
      logLineCount: 1,
      maxLogEntries: 400,
      lastEvent: status,
    })

    bridgeWindow.__projectBActive = false
    bridgeWindow.__terminalCalls = []
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async () => {
        projectOverviewCount += 1
        const isProjectB = projectOverviewCount > 1
        const name = isProjectB ? 'project-b' : 'project-a'
        const projectPath = `/workspace/${name}`
        if (isProjectB) bridgeWindow.__projectBActive = true

        return {
          metadata: { name, path: projectPath },
          tree: {
            name,
            path: projectPath,
            kind: 'directory',
            children: [],
          },
          git: {
            isRepository: true,
            branch: 'dev',
            branchType: 'local',
            changedFilesCount: 0,
          },
        }
      },
    }
    bridgeWindow.__GTUM_TERMINAL_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__terminalCalls.push({
          command,
          args,
          afterProjectSwitch: bridgeWindow.__projectBActive,
        })

        if (command === 'create_terminal_session') {
          const request = args?.request as { projectPath?: string } | undefined
          const projectPath = String(request?.projectPath)
          const sessionId = projectPath.endsWith('project-a') ? 77 : 88
          return terminalSnapshot(projectPath, sessionId)
        }

        const projectPath = String(args?.projectPath)
        const sessionId = Number(args?.sessionId)
        if (command === 'read_terminal_session_logs') {
          if (projectPath.endsWith('project-a') && !delayedProjectALog) {
            delayedProjectALog = true
            return new Promise((resolve) => {
              bridgeWindow.__resolveDelayedProjectALog = () => resolve({
                projectPath: '/workspace/project-a',
                sessionId: 77,
                status: 'failed',
                limit: 400,
                logLineCount: 2,
                truncated: false,
                entries: ['A LATE FOREIGN LOG'],
                updatedAt: 900,
              })
            })
          }

          // Keep B's log reads pending so they cannot mask an incorrect late
          // A failure by immediately restoring B's status to running.
          if (projectPath.endsWith('project-b')) {
            return new Promise<never>(() => {
              // Deliberately unresolved for this ownership race test.
            })
          }

          return {
            projectPath,
            sessionId,
            status: 'running',
            limit: 400,
            logLineCount: 1,
            truncated: false,
            entries: ['A steady log'],
            updatedAt: 140,
          }
        }

        if (command === 'read_raw_terminal_output') {
          const from = Number(args?.from) || 0
          const chunk = from === 0 ? `PROJECT ${sessionId === 77 ? 'A' : 'B'} SESSION ${sessionId}` : ''
          return {
            projectPath,
            sessionId,
            base: 0,
            cursor: from + chunk.length,
            chunk,
            status: 'running',
          }
        }

        if (command === 'close_terminal_session') {
          return terminalSnapshot(projectPath, sessionId, 'terminated')
        }

        if (command === 'resize_terminal_session' || command === 'write_terminal_input') {
          return undefined
        }

        throw new Error(`Unexpected terminal command: ${command}`)
      },
    }
  })

  const terminalCalls = () => page.evaluate(
    () => (window as TestWindow).__terminalCalls,
  )

  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')
  await page.getByText('Open project folder').click()
  await expect(page.locator('.titlebar')).toContainText('project-a')
  await page.locator('.gt-add').first().click()
  await expect(page.locator('.term-xterm .xterm')).toHaveCount(1)

  const projectATabId = await page.locator('.group.active .gt.active').getAttribute('data-tab-id')
  expect(projectATabId).toBeTruthy()
  await expect
    .poll(async () =>
      page.evaluate(
        () => Boolean((window as TestWindow).__resolveDelayedProjectALog),
      ),
    )
    .toBe(true)

  // B owns an independent visible workbench; switching must unmount A's xterm
  // without closing its runtime session.
  await page.getByText('Open project folder').click()
  await expect(page.locator('.titlebar')).toContainText('project-b')
  await expect(page.locator(`.gt[data-tab-id="${projectATabId}"]`)).toHaveCount(0)
  await expect(page.locator('.term-xterm')).toHaveCount(0)
  const inactiveStartCallCount = (await terminalCalls()).length
  await page.setViewportSize({ width: 1210, height: 720 })

  const projectACommandsWhileInactive = [
    'resize_terminal_session',
    'write_terminal_input',
    'read_raw_terminal_output',
    'read_terminal_session_logs',
    'close_terminal_session',
  ]

  // Create and activate a real B-owned terminal without removing A.
  await page.locator('.gt-add').first().click()
  await expect(page.locator('.group.active .gt.active .ttl')).toHaveText('terminal')
  const projectBTabId = await page.locator('.group.active .gt.active').getAttribute('data-tab-id')
  expect(projectBTabId).toBeTruthy()
  expect(projectBTabId).not.toBe(projectATabId)
  await expect(page.locator('.term-xterm')).toContainText('PROJECT B SESSION 88')

  // Deliver A's pending failed-log response after B owns the visible terminal.
  await page.evaluate(async () => {
    ;(window as TestWindow).__resolveDelayedProjectALog?.()
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
  })

  const projectBTab = page.locator(`.gt[data-tab-id="${projectBTabId}"]`)
  await expect(projectBTab).toHaveClass(/active/)
  await expect(projectBTab.locator('.lamp')).toHaveClass(/running/)
  await expect(page.locator('.term-xterm')).toContainText('PROJECT B SESSION 88')
  await expect(page.locator('.term-xterm')).not.toContainText('A LATE FOREIGN LOG')

  const inactiveCalls = (await terminalCalls()).slice(inactiveStartCallCount)
  expect(inactiveCalls.filter((call) =>
    projectACommandsWhileInactive.includes(call.command) &&
    call.args?.projectPath === '/workspace/project-a' &&
    call.args?.sessionId === 77
  )).toEqual([])

  const callsBeforeReturn = await terminalCalls()
  expect(callsBeforeReturn.filter((call) => call.command === 'close_terminal_session')).toEqual([])
  expect(callsBeforeReturn.find((call) =>
    call.command === 'create_terminal_session' &&
    (call.args?.request as { projectPath?: string } | undefined)?.projectPath === '/workspace/project-a'
  )?.args).toMatchObject({ request: { projectPath: '/workspace/project-a' } })
  expect(callsBeforeReturn.find((call) =>
    call.command === 'create_terminal_session' &&
    (call.args?.request as { projectPath?: string } | undefined)?.projectPath === '/workspace/project-b'
  )?.args).toMatchObject({ request: { projectPath: '/workspace/project-b' } })

  // Returning to A remounts the same frontend tab and replays the same backend
  // session from cursor zero. Only an explicit close may terminate it.
  await page.locator('[data-project-path="/workspace/project-a"]').click()
  const restoredProjectATab = page.locator(`.gt[data-tab-id="${projectATabId}"]`)
  await expect(restoredProjectATab).toHaveClass(/active/)
  await expect(restoredProjectATab.locator('.lamp')).toHaveClass(/failed/)
  await expect(page.locator('.term-xterm')).toContainText('PROJECT A SESSION 77')
  expect((await terminalCalls()).filter((call) =>
    call.command === 'create_terminal_session' &&
    (call.args?.request as { projectPath?: string } | undefined)?.projectPath === '/workspace/project-a'
  )).toHaveLength(1)

  await restoredProjectATab.locator('.x-btn').click()
  await expect.poll(async () => (await terminalCalls()).filter((call) =>
    call.command === 'close_terminal_session' &&
    call.args?.projectPath === '/workspace/project-a' &&
    call.args?.sessionId === 77
  ).length).toBe(1)

  const calls = await terminalCalls()
  expect(calls.find((call) =>
    call.command === 'create_terminal_session' &&
    (call.args?.request as { projectPath?: string } | undefined)?.projectPath === '/workspace/project-a'
  )?.args).toMatchObject({ request: { projectPath: '/workspace/project-a' } })
  expect(calls.find((call) =>
    call.command === 'create_terminal_session' &&
    (call.args?.request as { projectPath?: string } | undefined)?.projectPath === '/workspace/project-b'
  )?.args).toMatchObject({ request: { projectPath: '/workspace/project-b' } })

  for (const call of calls.filter((entry) =>
    projectACommandsWhileInactive.includes(entry.command) ||
    entry.command === 'close_terminal_session'
  )) {
    if (call.args?.sessionId !== 77) continue
    expect(call.args).toMatchObject({
      projectPath: '/workspace/project-a',
      sessionId: 77,
    })
  }
})

test('routes agent requests through the Codex suggestion runtime bridge', async ({ page }) => {
  await installConnectedCodexAuth(page)
  await page.addInitScript((codexCapabilities) => {
    const bridgeWindow = window as Window & {
      __agentCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __projectCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __GTUM_AGENT_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
    }

    bridgeWindow.__agentCalls = []
    bridgeWindow.__projectCalls = []
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__projectCalls.push({ command, args })

        return {
          metadata: {
            name: 'aurora-monorepo',
            path: '~/code/aurora-monorepo',
          },
          tree: {
            name: 'aurora-monorepo',
            path: '~/code/aurora-monorepo',
            kind: 'directory',
            children: [],
          },
          git: {
            isRepository: true,
            branch: 'feature/onboarding-funnel',
            branchType: 'feature',
            changedFilesCount: 7,
          },
        }
      },
    }
    bridgeWindow.__GTUM_AGENT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__agentCalls.push({ command, args })

        if (command === 'read_agent_provider_capabilities') {
          return codexCapabilities
        }

        if (command === 'request_agent_suggestions') {
          return [
            {
              id: 'codex-runtime-1',
              provider: 'codex',
              summary: 'Run the failing funnel test',
              command: 'pnpm test:funnel --reporter=verbose',
              preferredTarget: 'current_tab',
              confidence: 'high',
              error: null,
            },
          ]
        }

        return {
          provider: 'codex',
          setupState: 'ready',
          connectionPath: 'Codex CLI ChatGPT session',
          summary: 'Codex is ready',
          guidance: 'Ready',
          baseUrl: null,
          model: 'Codex CLI default',
          requirements: [],
        }
      },
    }
  }, nonSelectableCodexCapabilities)

  await page.goto('/')
  await page.getByText('Open project folder').click()
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __GTUM_BACKEND_BRIDGE__?: { runtimeBacked: boolean }
            }
          ).__GTUM_BACKEND_BRIDGE__?.runtimeBacked ?? false,
      ),
    )
    .toBe(true)

  await page.getByPlaceholder('Ask Codex').fill('test prompt')
  await page.locator('.composer-input .send').click()

  const agentTurn = page.locator('.agent-turn').last()
  await expect(agentTurn).not.toContainText('Work completed')
  await expect(agentTurn.locator('.agent-turn-progress')).toHaveCount(0)
  await expect(agentTurn).toContainText(/Answered \d\d:\d\d \/ \d+s/)
  await expect(agentTurn).toContainText('Run the failing funnel test')
  await expect(agentTurn).toContainText('1 command')
  await expect(agentTurn).toContainText('Execution suggestion')
  await expect(agentTurn.locator('.agent-event-card.command')).toHaveCount(0)
  const permissionPanel = page.locator('.composer-approval')
  await expect(permissionPanel).toContainText('Permission request')
  await expect(permissionPanel).toContainText('Allow once')
  await expect(permissionPanel).not.toContainText('Always allow')
  await expect(permissionPanel).toContainText('Deny')
  await expect(agentTurn).not.toContainText('Review command')
  await expect(page.locator('.agent-log-item.suggestion')).toHaveCount(0)
  await expect(page.locator('.sugg')).toHaveCount(0)

  const calls = await page.evaluate(
    () =>
      (
        window as Window & {
          __agentCalls?: Array<{ command: string; args?: { request?: Record<string, unknown> } }>
        }
      ).__agentCalls ?? [],
  )
  const requestCall = calls.find((call) => call.command === 'request_agent_suggestions')

  expect(requestCall?.args?.request).toMatchObject({
    provider: 'codex',
    projectName: 'aurora-monorepo',
    projectPath: '~/code/aurora-monorepo',
    activeTabId: null,
    activeTabTitle: null,
    userTask: 'test prompt',
  })
  expect(requestCall?.args?.request).not.toHaveProperty('executionMode')
  expect(requestCall?.args?.request?.lastNLogLines ?? []).not.toContain(
    'Error: listen EADDRINUSE: address already in use :::3001',
  )
})

test('shows live Codex activity while waiting for runtime suggestions', async ({ page }) => {
  await installConnectedCodexAuth(page)
  await page.addInitScript((codexCapabilities) => {
    const bridgeWindow = window as Window & {
      __agentCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __projectCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __GTUM_AGENT_PROGRESS_STAGE_DELAY_MS__: number
      __resolveCodexRequest?: () => void
      __GTUM_AGENT_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
    }

    bridgeWindow.__agentCalls = []
    bridgeWindow.__projectCalls = []
    bridgeWindow.__GTUM_AGENT_PROGRESS_STAGE_DELAY_MS__ = 700
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__projectCalls.push({ command, args })

        return {
          metadata: {
            name: 'aurora-monorepo',
            path: '~/code/aurora-monorepo',
          },
          tree: {
            name: 'aurora-monorepo',
            path: '~/code/aurora-monorepo',
            kind: 'directory',
            children: [],
          },
          git: {
            isRepository: true,
            branch: 'feature/onboarding-funnel',
            branchType: 'feature',
            changedFilesCount: 7,
          },
        }
      },
    }
    bridgeWindow.__GTUM_AGENT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__agentCalls.push({ command, args })

        if (command === 'read_agent_provider_capabilities') {
          return codexCapabilities
        }

        if (command === 'request_agent_suggestions') {
          await new Promise<void>((resolve) => {
            bridgeWindow.__resolveCodexRequest = resolve
          })

          return [
            {
              id: 'codex-runtime-1',
              provider: 'codex',
              summary: 'Run focused tests',
              command: 'npm run test:e2e -- --grep agent',
              preferredTarget: 'new_tab',
              confidence: 'medium',
              error: null,
            },
          ]
        }

        return {
          provider: 'codex',
          setupState: 'ready',
          connectionPath: 'Codex CLI ChatGPT session',
          summary: 'Codex is ready',
          guidance: 'Ready',
          baseUrl: null,
          model: 'Codex CLI default',
          requirements: [],
        }
      },
    }
  }, nonSelectableCodexCapabilities)

  await page.goto('/')
  await page.getByText('Open project folder').click()
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __GTUM_BACKEND_BRIDGE__?: { runtimeBacked: boolean }
            }
          ).__GTUM_BACKEND_BRIDGE__?.runtimeBacked ?? false,
      ),
    )
    .toBe(true)

  await page.getByPlaceholder('Ask Codex').fill('test prompt')
  await page.locator('.composer-input .send').click()

  const liveTurn = page.locator('.agent-turn').last()
  const progress = liveTurn.locator('.agent-turn-progress')
  await expect(liveTurn).toContainText('Working')
  await expect(progress).toContainText(
    'Reading aurora-monorepo context',
  )
  await expect(progress).not.toContainText('Sending request to Codex CLI runtime')
  await expect(progress).not.toContainText('Waiting for Codex CLI response')

  await expect(progress).toContainText(
    'Sending request to Codex CLI runtime',
  )
  await expect(progress).not.toContainText('Waiting for Codex CLI response')

  await expect(progress).toContainText(
    'Waiting for Codex CLI response',
  )
  await expect(progress).not.toContainText('Preparing context')
  await expect(page.locator('.agent-activity')).toHaveCount(0)

  await page.evaluate(() => {
    ;(window as Window & { __resolveCodexRequest?: () => void }).__resolveCodexRequest?.()
  })

  await expect(liveTurn).not.toContainText('Work completed')
  await expect(liveTurn.locator('.agent-turn-progress')).toHaveCount(0)
  await expect(liveTurn).toContainText(/Answered \d\d:\d\d \/ \d+s/)
  await expect(liveTurn).toContainText('Run focused tests')
  await expect(page.locator('.sugg')).toHaveCount(0)
  await expect(page.locator('.agent-activity')).toHaveCount(0)
})

test('surfaces Codex runtime failures without canned replies or approval cards', async ({ page }) => {
  await installConnectedCodexAuth(page)
  await page.addInitScript((codexCapabilities) => {
    const bridgeWindow = window as Window & {
      __agentCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __projectCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __GTUM_AGENT_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
    }

    bridgeWindow.__agentCalls = []
    bridgeWindow.__projectCalls = []
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__projectCalls.push({ command, args })

        return {
          metadata: {
            name: 'aurora-monorepo',
            path: '~/code/aurora-monorepo',
          },
          tree: {
            name: 'aurora-monorepo',
            path: '~/code/aurora-monorepo',
            kind: 'directory',
            children: [],
          },
          git: {
            isRepository: true,
            branch: 'feature/onboarding-funnel',
            branchType: 'feature',
            changedFilesCount: 7,
          },
        }
      },
    }
    bridgeWindow.__GTUM_AGENT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__agentCalls.push({ command, args })

        if (command === 'read_agent_provider_capabilities') {
          return codexCapabilities
        }

        if (command === 'request_agent_suggestions') {
          throw new Error('Codex CLI exited with status 1.')
        }

        return {
          provider: 'codex',
          setupState: 'ready',
          connectionPath: 'Codex CLI ChatGPT session',
          summary: 'Codex is ready',
          guidance: 'Ready',
          baseUrl: null,
          model: 'Codex CLI default',
          requirements: [],
        }
      },
    }
  }, nonSelectableCodexCapabilities)

  await page.goto('/')
  await page.getByText('Open project folder').click()
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __GTUM_BACKEND_BRIDGE__?: { runtimeBacked: boolean }
            }
          ).__GTUM_BACKEND_BRIDGE__?.runtimeBacked ?? false,
      ),
    )
    .toBe(true)

  const initialSuggestionCount = await page.locator('.sugg').count()

  await page.getByPlaceholder('Ask Codex').fill('test prompt')
  await page.locator('.composer-input .send').click()

  await expect(page.locator('.msg.assistant').last()).toContainText(
    'Codex CLI exited with status 1.',
  )
  await expect(page.locator('.msg.assistant').last()).not.toContainText('useFunnelState')
  await expect(page.locator('.sugg')).toHaveCount(initialSuggestionCount)
})

test('renders Codex error-only suggestions as messages without approval', async ({ page }) => {
  await installConnectedCodexAuth(page)
  await page.addInitScript((codexCapabilities) => {
    const bridgeWindow = window as Window & {
      __agentCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __projectCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __GTUM_AGENT_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
    }

    bridgeWindow.__agentCalls = []
    bridgeWindow.__projectCalls = []
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__projectCalls.push({ command, args })

        return {
          metadata: {
            name: 'aurora-monorepo',
            path: '~/code/aurora-monorepo',
          },
          tree: {
            name: 'aurora-monorepo',
            path: '~/code/aurora-monorepo',
            kind: 'directory',
            children: [],
          },
          git: {
            isRepository: true,
            branch: 'feature/onboarding-funnel',
            branchType: 'feature',
            changedFilesCount: 7,
          },
        }
      },
    }
    bridgeWindow.__GTUM_AGENT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__agentCalls.push({ command, args })

        if (command === 'read_agent_provider_capabilities') {
          return codexCapabilities
        }

        if (command === 'request_agent_suggestions') {
          return [
            {
              id: 'codex-runtime-error',
              provider: 'codex',
              summary: 'No safe command',
              command: '',
              preferredTarget: 'new_tab',
              confidence: 'low',
              error: 'No safe read-only command is available.',
            },
          ]
        }

        return {
          provider: 'codex',
          setupState: 'ready',
          connectionPath: 'Codex CLI ChatGPT session',
          summary: 'Codex is ready',
          guidance: 'Ready',
          baseUrl: null,
          model: 'Codex CLI default',
          requirements: [],
        }
      },
    }
  }, nonSelectableCodexCapabilities)

  await page.goto('/')
  await page.getByText('Open project folder').click()
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __GTUM_BACKEND_BRIDGE__?: { runtimeBacked: boolean }
            }
          ).__GTUM_BACKEND_BRIDGE__?.runtimeBacked ?? false,
      ),
    )
    .toBe(true)

  const initialSuggestionCount = await page.locator('.sugg').count()

  await page.getByPlaceholder('Ask Codex').fill('Suggest a safe command')
  await page.locator('.composer-input .send').click()

  await expect(page.locator('.msg.assistant').last()).toContainText(
    'Codex could not produce a safe command: No safe read-only command is available.',
  )
  await expect(page.locator('.msg.assistant').last()).not.toContainText('Needs approval')
  await expect(page.locator('.sugg')).toHaveCount(initialSuggestionCount)
})

test('renders Codex reply-only responses without review cards', async ({ page }) => {
  await installConnectedCodexAuth(page)
  await page.addInitScript((codexCapabilities) => {
    const bridgeWindow = window as Window & {
      __agentCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __projectCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __GTUM_AGENT_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
    }

    bridgeWindow.__agentCalls = []
    bridgeWindow.__projectCalls = []
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__projectCalls.push({ command, args })

        return {
          metadata: {
            name: 'aurora-monorepo',
            path: '~/code/aurora-monorepo',
          },
          tree: {
            name: 'aurora-monorepo',
            path: '~/code/aurora-monorepo',
            kind: 'directory',
            children: [],
          },
          git: {
            isRepository: true,
            branch: 'feature/onboarding-funnel',
            branchType: 'feature',
            changedFilesCount: 7,
          },
        }
      },
    }
    bridgeWindow.__GTUM_AGENT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__agentCalls.push({ command, args })

        if (command === 'read_agent_provider_capabilities') {
          return codexCapabilities
        }

        if (command === 'request_agent_suggestions') {
          return [
            {
              id: 'codex-runtime-reply',
              provider: 'codex',
              summary: 'I checked the current context. No approval is needed for this answer.',
              command: '',
              preferredTarget: 'new_tab',
              confidence: 'high',
              error: null,
            },
          ]
        }

        return {
          provider: 'codex',
          setupState: 'ready',
          connectionPath: 'Codex CLI ChatGPT session',
          summary: 'Codex is ready',
          guidance: 'Ready',
          baseUrl: null,
          model: 'Codex CLI default',
          requirements: [],
        }
      },
    }
  }, nonSelectableCodexCapabilities)

  await page.goto('/')
  await page.getByText('Open project folder').click()
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __GTUM_BACKEND_BRIDGE__?: { runtimeBacked: boolean }
            }
          ).__GTUM_BACKEND_BRIDGE__?.runtimeBacked ?? false,
      ),
    )
    .toBe(true)

  await page.getByPlaceholder('Ask Codex').fill('explain current state')
  await page.locator('.composer-input .send').click()

  const reply = page.locator('.agent-turn').last()
  await expect(reply).toContainText('I checked the current context. No approval is needed for this answer.')
  await expect(reply).toContainText(/Answered \d\d:\d\d \/ \d+s/)
  await expect(reply).not.toContainText('Review command')
  await expect(reply).not.toContainText('Needs review')
  await expect(reply.locator('.agent-turn-result')).toHaveCount(0)
  await expect(page.locator('.composer-approval')).toHaveCount(0)
})

test('renders numbered Codex choices as selectable event cards', async ({ page }) => {
  await installConnectedCodexAuth(page)
  await page.addInitScript((codexCapabilities) => {
    const bridgeWindow = window as Window & {
      __agentCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __projectCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __GTUM_AGENT_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
    }

    bridgeWindow.__agentCalls = []
    bridgeWindow.__projectCalls = []
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__projectCalls.push({ command, args })

        return {
          metadata: {
            name: 'aurora-monorepo',
            path: '~/code/aurora-monorepo',
          },
          tree: {
            name: 'aurora-monorepo',
            path: '~/code/aurora-monorepo',
            kind: 'directory',
            children: [],
          },
          git: {
            isRepository: true,
            branch: 'feature/onboarding-funnel',
            branchType: 'feature',
            changedFilesCount: 7,
          },
        }
      },
    }
    bridgeWindow.__GTUM_AGENT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__agentCalls.push({ command, args })

        if (command === 'read_agent_provider_capabilities') {
          return codexCapabilities
        }

        if (command === 'request_agent_suggestions') {
          const request = args?.request as { userTask?: string } | undefined

          if (request?.userTask?.startsWith('2.')) {
            return [
              {
                id: 'codex-choice-followup',
                provider: 'codex',
                summary: '선택지 2로 계속 진행하겠습니다.',
                command: '',
                preferredTarget: 'new_tab',
                confidence: 'high',
                error: null,
              },
            ]
          }

          return [
            {
              id: 'codex-choice-reply',
              provider: 'codex',
              summary:
                '테스트 질문입니다. 어떤 방식으로 진행할까요? 1. 간단히 답변만 받기 2. 선택지에 따라 다음 질문 이어가기 3. 실제 작업 계획처럼 분기 테스트하기',
              command: '',
              preferredTarget: 'new_tab',
              confidence: 'high',
              error: null,
            },
          ]
        }

        return {
          provider: 'codex',
          setupState: 'ready',
          connectionPath: 'Codex CLI ChatGPT session',
          summary: 'Codex is ready',
          guidance: 'Ready',
          baseUrl: null,
          model: 'Codex CLI default',
          requirements: [],
        }
      },
    }
  }, nonSelectableCodexCapabilities)

  await page.goto('/')
  await page.getByText('Open project folder').click()
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __GTUM_BACKEND_BRIDGE__?: { runtimeBacked: boolean }
            }
          ).__GTUM_BACKEND_BRIDGE__?.runtimeBacked ?? false,
      ),
    )
    .toBe(true)

  await page.getByPlaceholder('Ask Codex').fill('테스트로 나에게 질문 선택지를 줘봐')
  await page.locator('.composer-input .send').click()

  const turn = page.locator('.agent-turn').last()
  const choiceCard = page.locator('.agent-event-card.choice').first()
  await expect(choiceCard).toBeVisible()
  await expect(choiceCard).toContainText('Decision needed')
  await expect(choiceCard).toContainText('Choose one option')
  await expect(choiceCard).toContainText('1')
  await expect(choiceCard).toContainText('간단히 답변만 받기')
  await expect(choiceCard).toContainText('2')
  await expect(choiceCard).toContainText('선택지에 따라 다음 질문 이어가기')
  await expect(choiceCard).toContainText('3')
  await expect(choiceCard).toContainText('실제 작업 계획처럼 분기 테스트하기')
  await expect(turn).not.toContainText('Review command')
  await expect(page.locator('.composer-approval')).toHaveCount(0)

  await choiceCard.getByRole('button', { name: /2 선택지에 따라 다음 질문 이어가기/ }).click()

  await expect(choiceCard).toContainText('Selected')
  await expect(page.locator('.msg.user').last()).toContainText('2. 선택지에 따라 다음 질문 이어가기')
  await expect(page.locator('.agent-turn').last()).toContainText('선택지 2로 계속 진행하겠습니다.')
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __agentCalls?: Array<{ command: string }>
            }
          ).__agentCalls?.filter((call) => call.command === 'request_agent_suggestions').length ?? 0,
      ),
    )
    .toBe(2)
})

test('requires a runtime-backed project before desktop Codex requests', async ({ page }) => {
  await installConnectedCodexAuth(page)
  await page.addInitScript((codexCapabilities) => {
    const bridgeWindow = window as Window & {
      __agentCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __GTUM_AGENT_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
    }

    bridgeWindow.__agentCalls = []
    bridgeWindow.__GTUM_AGENT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__agentCalls.push({ command, args })

        if (command === 'read_agent_provider_capabilities') {
          return codexCapabilities
        }

        return []
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async () => {
        throw new Error('project runtime should not be invoked before a real project is opened')
      },
    }
  }, nonSelectableCodexCapabilities)

  await page.goto('/')
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __GTUM_BACKEND_BRIDGE__?: {
                desktop: boolean
                projectPath: string
                runtimeBacked: boolean
              }
            }
          ).__GTUM_BACKEND_BRIDGE__,
      ),
    )
    .toMatchObject({
      desktop: true,
      runtimeBacked: false,
      projectPath: '',
    })

  const initialSuggestionCount = await page.locator('.sugg').count()

  await page.getByPlaceholder('Ask Codex').fill('test prompt')
  await page.locator('.composer-input .send').click()

  await expect(page.locator('.msg.assistant').last()).toContainText(
    'Open a real local folder as a project in the desktop app before running a Codex request.',
  )
  await expect(page.locator('.msg.assistant').last()).not.toContainText('useFunnelState')
  await expect(page.locator('.sugg')).toHaveCount(initialSuggestionCount)

  const calls = await page.evaluate(
    () =>
      (
        window as Window & {
          __agentCalls?: Array<{ command: string }>
        }
      ).__agentCalls ?? [],
  )

  expect(calls.map((call) => call.command)).not.toContain('request_agent_suggestions')
})

test('keeps a legacy session on Codex when Claude is connected globally', async ({ page }) => {
  await page.addInitScript(() => {
    const bridgeWindow = window as Window & {
      __authCalls: string[]
      __agentCalls: string[]
      __GTUM_AGENT_AUTH_RUNTIME__?: unknown
      __GTUM_AGENT_RUNTIME__?: unknown
    }

    bridgeWindow.__authCalls = []
    bridgeWindow.__agentCalls = []
    bridgeWindow.__GTUM_AGENT_AUTH_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string) => {
        bridgeWindow.__authCalls.push(command)
        const claudeConnection = {
          provider: 'claude',
          displayName: 'Claude',
          availability: 'available',
          status: 'connected',
          connectionKind: 'real',
          accountLabel: 'Claude CLI',
          accountEmail: null,
          requiredScopes: ['exec.suggest'],
          expiresAt: null,
          callbackUrl: null,
          authUrl: null,
          activeLoginId: null,
          activeLoginState: null,
          connectedAt: 100,
          lastLoginAttemptAt: 100,
          updatedAt: 100,
          lastError: null,
        }

        if (command === 'list_agent_connections') {
          return [claudeConnection]
        }

        if (command === 'agent_auth_runtime_snapshot') {
          return {
            storagePath: '/tmp/gtum-auth-state.json',
            supportedProviders: ['codex', 'claude'],
            connections: [claudeConnection],
            pendingLogins: [],
            lastSyncedAt: 100,
          }
        }

        return []
      },
    }
    bridgeWindow.__GTUM_AGENT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string) => {
        bridgeWindow.__agentCalls.push(command)
        if (command === 'request_agent_suggestions') {
          throw new Error('default Codex session should not issue a Claude request')
        }
        return {
          provider: 'codex',
          supportsModelSelection: false,
          currentModel: null,
          availableModels: [],
          reasoningLevels: [],
          supportsFastMode: false,
          attachments: [],
          supportsLocalCliSession: true,
          connectionLabel: 'Codex CLI',
        }
      },
    }
  })

  await page.goto('/')
  await expect(page.locator('.composer-provider-chip'))
    .toHaveAttribute('aria-label', 'Provider: Codex · Connect provider')
  await page.locator('.titlebar .pill.icon-only').click()
  await expect(page.locator('.settings-provider').filter({ hasText: 'Claude' })).toContainText(
    'Connected',
  )
  await page.locator('.settings-close').click()
  await page.getByPlaceholder('Ask Codex').fill('test prompt')
  await page.locator('.composer-input .send').click()

  await expect(page.locator('.msg.assistant').last()).toContainText(/connect|reconnect/i)
  await expect(page.locator('.msg.assistant').last()).toContainText('Codex')
  await expect(page.locator('.msg.assistant').last()).not.toContainText('useFunnelState')
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __authCalls: string[] }).__authCalls.filter(
          (command) => command === 'begin_agent_login',
        ),
    ),
  ).toEqual([])
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __agentCalls: string[] }).__agentCalls.filter(
          (command) => command === 'request_agent_suggestions',
        ),
    ),
  ).toEqual([])
})

test('keeps approved Codex command decisions in the agent panel without terminal execution', async ({ page }) => {
  await installConnectedCodexAuth(page)
  await page.addInitScript((codexCapabilities) => {
    const bridgeWindow = window as Window & {
      __agentCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __agentJobCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __projectCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __terminalCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __GTUM_AGENT_JOB_POLL_INTERVAL_MS__: number
      __GTUM_AGENT_JOB_RUNTIME__: unknown
      __GTUM_AGENT_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
      __GTUM_TERMINAL_RUNTIME__: unknown
    }

    bridgeWindow.__agentCalls = []
    bridgeWindow.__agentJobCalls = []
    bridgeWindow.__projectCalls = []
    bridgeWindow.__terminalCalls = []
    bridgeWindow.__GTUM_AGENT_JOB_POLL_INTERVAL_MS__ = 20
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__projectCalls.push({ command, args })

        return {
          metadata: {
            name: 'aurora-monorepo',
            path: '~/code/aurora-monorepo',
          },
          tree: {
            name: 'aurora-monorepo',
            path: '~/code/aurora-monorepo',
            kind: 'directory',
            children: [],
          },
          git: {
            isRepository: true,
            branch: 'feature/onboarding-funnel',
            branchType: 'feature',
            changedFilesCount: 7,
          },
        }
      },
    }
    bridgeWindow.__GTUM_AGENT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__agentCalls.push({ command, args })

        if (command === 'read_agent_provider_capabilities') {
          return codexCapabilities
        }

        return [
          {
            id: 'codex-runtime-current-tab',
            provider: 'codex',
            summary: 'Run the current tab test command',
            command: 'pnpm test:funnel --reporter=verbose',
            preferredTarget: 'current_tab',
            confidence: 'low',
            error: null,
          },
        ]
      },
    }
    bridgeWindow.__GTUM_AGENT_JOB_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__agentJobCalls.push({ command, args })

        if (command === 'list_agent_jobs') return []
        if (command === 'read_agent_job_logs') {
          return {
            jobId: 77,
            status: 'completed',
            limit: 100,
            logLineCount: 2,
            truncated: false,
            entries: [
              {
                sequence: 1,
                stream: 'command',
                text: 'pnpm test:funnel --reporter=verbose',
                recordedAt: 100,
              },
              { sequence: 2, stream: 'stdout', text: 'tests passed', recordedAt: 140 },
            ],
            updatedAt: 150,
            finishedAt: 150,
            cancellationRequestedAt: null,
            exitCode: 0,
            logsComplete: true,
            logCaptureError: null,
            processError: null,
            persistenceError: null,
            lastEvent: 'agent job completed',
          }
        }
        return {
          jobId: 77,
          sessionId: String(
            (args?.request as { sessionId?: string } | undefined)?.sessionId || '',
          ),
          name: 'agent-codex-runtime-current-tab-1',
          command: 'pnpm test:funnel --reporter=verbose',
          cwd: '~/code/aurora-monorepo',
          runner: 'pnpm',
          runnerArgs: ['test:funnel', '--reporter=verbose'],
          processId: 7700,
          status: 'running',
          createdAt: 100,
          updatedAt: 120,
          finishedAt: null,
          cancellationRequestedAt: null,
          exitCode: null,
          logsComplete: false,
          logCaptureError: null,
          processError: null,
          persistenceError: null,
          logLineCount: 1,
          maxLogEntries: 400,
          lastEvent: 'agent job created',
        }
      },
    }
    bridgeWindow.__GTUM_TERMINAL_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__terminalCalls.push({ command, args })

        if (command === 'create_terminal_session_with_command') {
          return {
            sessionId: 101,
            name: 'fix-1',
            cwd: '/workspace/gtum',
            shell: '/bin/zsh',
            shellArgs: ['-i'],
            processId: 9101,
            status: 'running',
            createdAt: 100,
            updatedAt: 120,
            exitCode: null,
            logLineCount: 1,
            maxLogEntries: 400,
            lastEvent: 'session created',
          }
        }

        if (command === 'read_terminal_session_logs') {
          return {
            sessionId: 101,
            status: 'running',
            limit: 400,
            logLineCount: 1,
            truncated: false,
            entries: ['pnpm test:funnel --reporter=verbose'],
            updatedAt: 130,
          }
        }

        return []
      },
    }
  }, nonSelectableCodexCapabilities)

  await page.setViewportSize({ width: 1280, height: 520 })
  await page.goto('/')
  await page.getByText('Open project folder').click()
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __GTUM_BACKEND_BRIDGE__?: { runtimeBacked: boolean }
            }
          ).__GTUM_BACKEND_BRIDGE__?.runtimeBacked ?? false,
      ),
    )
    .toBe(true)

  await page.getByPlaceholder('Ask Codex').fill('test prompt')
  await page.locator('.composer-input .send').click()
  await expect(page.locator('.ctx-attach')).toHaveCount(0)
  await expect(page.locator('.agent-turn').last()).toContainText(
    'Run the current tab test command',
  )
  await expect(page.locator('.agent-turn').last()).not.toContainText('I found a command you can review')
  await expect(page.locator('.agent-turn').last()).toContainText('Needs review')
  const activityRow = page.locator('.agent-turn').last().locator('.agent-command-activity')
  await expect(activityRow).toBeVisible()
  await expect(activityRow).toContainText('Execution suggestion')
  await expect(activityRow).toContainText('1 command')
  await expect(page.locator('.agent-turn').last().locator('.agent-event-card.command')).toHaveCount(0)

  const permissionPanel = page.locator('.composer-approval')
  await expect(permissionPanel).toBeVisible()
  await expect(permissionPanel).toContainText('Permission request')
  await expect(permissionPanel).toContainText('Terminal command needs review')
  await expect(permissionPanel).toContainText('Command preview')
  await expect(permissionPanel).toContainText('pnpm test:funnel --reporter=verbose')
  await expect(permissionPanel.getByRole('button', { name: 'Allow once' })).toBeVisible()
  await expect(permissionPanel.getByRole('button', { name: 'Always allow' })).toHaveCount(0)
  await expect(permissionPanel.getByRole('button', { name: 'Deny' })).toBeVisible()
  expect(
    await page.evaluate(() => ({
      approvalModal: 'ApprovalModal' in window,
      approvalToast: 'ApprovalToast' in window,
    })),
  ).toEqual({ approvalModal: false, approvalToast: false })
  await expect(page.locator('.agent-turn').last()).not.toContainText('Review command')
  await expect
    .poll(async () =>
      page.locator('.chat').evaluate((chat) =>
        Math.ceil(chat.scrollHeight - chat.scrollTop - chat.clientHeight),
      ),
    )
    .toBeLessThanOrEqual(2)
  await expect(page.locator('.agent-log-item.suggestion')).toHaveCount(0)
  await expect(page.locator('.sugg')).toHaveCount(0)
  await expect(page.locator('.composer-provider-chip'))
    .toHaveAttribute('aria-label', 'Provider: Codex · CLI session')
  await expect(page.locator('.composer-provider-chip')).toHaveText('Cx')
  await expect(page.locator('.composer-reasoning-chip')).toHaveCount(0)
  await expect(page.locator('.fast-toggle')).toHaveCount(0)
  await expect(page.locator('.composer-scope-chip')).toHaveCount(0)
  await expect(page.locator('.agent-model-row')).toHaveCount(0)
  await expect(page.locator('.context-summary')).toHaveCount(0)
  await expect(page.locator('.composer-foot .ctx-tag')).toHaveCount(0)

  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __terminalCalls?: Array<{ command: string }>
            }
          ).__terminalCalls?.map((call) => call.command) ?? [],
      ),
    )
    .toEqual([])

  await permissionPanel.getByRole('button', { name: 'Allow once' }).click()
  await expect(page.locator('.composer-approval')).toHaveCount(0)
  await expect(activityRow).toContainText('Allowed once')
  await expect(page.locator('.msg.assistant').last()).toContainText(
    'Decision kept in the agent panel.',
  )
  await expect(page.locator('.msg.assistant').last()).toContainText('agent job #77')
  await expect(page.locator('.msg.assistant').last()).not.toContainText(
    'Finished processing',
  )

  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __terminalCalls?: Array<{ command: string; args?: Record<string, unknown> }>
            }
          ).__terminalCalls ?? [],
      ),
    )
    .toEqual([])
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __agentJobCalls?: Array<{ command: string; args?: Record<string, unknown> }>
            }
          ).__agentJobCalls?.filter((call) => call.command === 'create_agent_job') ?? [],
      ),
    )
    .toEqual([
      {
        command: 'create_agent_job',
        args: {
          request: {
            projectPath: '~/code/aurora-monorepo',
            command: 'pnpm test:funnel --reporter=verbose',
            name: 'agent-codex-runtime-current-tab-1',
            sessionId: expect.any(String),
          },
        },
      },
    ])
})

test('blocks a disconnected Codex request before invoking the provider runtime', async ({ page }) => {
  await page.addInitScript(() => {
    const bridgeWindow = window as Window & {
      __authCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __agentCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __GTUM_AGENT_AUTH_RUNTIME__: unknown
      __GTUM_AGENT_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
    }
    const codexDisconnected = {
      provider: 'codex',
      displayName: 'Codex',
      availability: 'available',
      status: 'disconnected',
      connectionKind: 'real',
      accountLabel: null,
      accountEmail: null,
      requiredScopes: ['project:read', 'terminal:read'],
      expiresAt: null,
      callbackUrl: null,
      authUrl: null,
      activeLoginId: null,
      activeLoginState: null,
      connectedAt: null,
      lastLoginAttemptAt: null,
      updatedAt: 100,
      lastError: null,
    }

    bridgeWindow.__authCalls = []
    bridgeWindow.__agentCalls = []
    bridgeWindow.__GTUM_AGENT_AUTH_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__authCalls.push({ command, args })
        if (command === 'list_agent_connections') return [codexDisconnected]
        return codexDisconnected
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async () => ({
        metadata: { name: 'codex-gated', path: '/workspace/codex-gated' },
        tree: {
          name: 'codex-gated',
          path: '/workspace/codex-gated',
          kind: 'directory',
          children: [],
        },
        git: {
          isRepository: true,
          branch: 'dev',
          branchType: 'development',
          changedFilesCount: 0,
        },
      }),
    }
    bridgeWindow.__GTUM_AGENT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__agentCalls.push({ command, args })
        return []
      },
    }
  })

  await page.goto('/')
  await page.getByText('Open project folder').click()
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & { __authCalls: Array<{ command: string }> }
          ).__authCalls.map((call) => call.command),
      ),
    )
    .toContain('list_agent_connections')

  await page.getByPlaceholder('Ask Codex').fill('run a disconnected request')
  await page.locator('.composer-input .send').click()

  await expect(page.locator('.msg.assistant').last()).toContainText(/connect|reconnect/i)
  await expect(page.locator('.msg.assistant').last()).toContainText('Codex')
  expect(
    await page.evaluate(
      () =>
        (
          window as Window & { __agentCalls: Array<{ command: string }> }
        ).__agentCalls.filter((call) => call.command === 'request_agent_suggestions'),
    ),
  ).toEqual([])
})

test('connects an existing Claude CLI session without opening a login terminal', async ({ page }) => {
  await page.addInitScript(() => {
    const bridgeWindow = window as Window & {
      __authCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __terminalCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __GTUM_AGENT_AUTH_RUNTIME__: unknown
      __GTUM_TERMINAL_RUNTIME__: unknown
    }
    const claudeDisconnected = {
      provider: 'claude',
      displayName: 'Claude',
      availability: 'available',
      status: 'disconnected',
      connectionKind: 'real',
      accountLabel: null,
      accountEmail: null,
      credentialSource: null,
      requiredScopes: ['provider:request'],
      expiresAt: null,
      callbackUrl: null,
      authUrl: null,
      activeLoginId: null,
      activeLoginState: null,
      connectedAt: null,
      lastLoginAttemptAt: null,
      updatedAt: 100,
      lastError: null,
    }
    const codexDisconnected = {
      ...claudeDisconnected,
      provider: 'codex',
      displayName: 'Codex',
      credentialSource: null,
      requiredScopes: ['project:read', 'terminal:read'],
    }
    const claudeConnected = {
      ...claudeDisconnected,
      status: 'connected',
      credentialSource: 'claude_cli_session',
      requiredScopes: ['provider:request', 'credential:cli_session'],
      connectedAt: 125,
      lastLoginAttemptAt: 120,
      updatedAt: 130,
    }

    bridgeWindow.__authCalls = []
    bridgeWindow.__terminalCalls = []
    bridgeWindow.__GTUM_AGENT_AUTH_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__authCalls.push({ command, args })
        if (command === 'list_agent_connections') {
          return [claudeDisconnected, codexDisconnected]
        }
        if (command === 'begin_agent_login') return claudeConnected
        throw new Error(`Unexpected auth command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_TERMINAL_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__terminalCalls.push({ command, args })
        throw new Error(`Claude connect must not touch the center terminal: ${command}`)
      },
    }
  })

  await page.goto('/')
  await page.locator('.titlebar .pill.icon-only').click()
  const claude = page.locator('.settings-provider').filter({ hasText: 'Claude' })
  await expect(claude.getByRole('button', { name: 'Connect' })).toHaveCount(1)
  await claude.getByRole('button', { name: 'Connect' }).click()
  await expect(page.locator('.settings-overlay')).toHaveCount(0)
  await expect(page.locator('.msg.assistant').last()).toContainText(
    'Claude connected through the local Claude CLI session.',
  )

  await page.locator('.titlebar .pill.icon-only').click()
  const connectedClaude = page.locator('.settings-provider').filter({ hasText: 'Claude' })
  await expect(connectedClaude).toContainText('Connected')
  await expect(connectedClaude).toContainText('CLI session')
  await expect(connectedClaude).toContainText('credential:cli_session')
  await expect(connectedClaude).not.toContainText('credential:api_key')
  await expect(connectedClaude).not.toContainText('API credential')
  await expect(connectedClaude.getByRole('button', { name: 'Disconnect' })).toHaveCount(1)
  await expect(page.locator('.group-tabbar').getByText('Claude Login')).toHaveCount(0)

  expect(
    await page.evaluate(
      () =>
        (
          window as Window & { __authCalls: Array<{ command: string }> }
        ).__authCalls.filter((call) => call.command === 'begin_agent_login'),
    ),
  ).toEqual([{ command: 'begin_agent_login', args: expect.objectContaining({ provider: 'claude' }) }])
  expect(
    await page.evaluate(
      () =>
        (
          window as Window & { __terminalCalls: Array<{ command: string }> }
        ).__terminalCalls,
    ),
  ).toEqual([])
})

test('shows external Claude auth login guidance without opening a terminal', async ({ page }) => {
  await page.addInitScript(() => {
    const bridgeWindow = window as Window & {
      __authCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __terminalCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __GTUM_AGENT_AUTH_RUNTIME__: unknown
      __GTUM_TERMINAL_RUNTIME__: unknown
    }
    const claudeDisconnected = {
      provider: 'claude',
      displayName: 'Claude',
      availability: 'available',
      status: 'disconnected',
      connectionKind: 'real',
      accountLabel: null,
      accountEmail: null,
      credentialSource: null,
      requiredScopes: ['provider:request'],
      expiresAt: null,
      callbackUrl: null,
      authUrl: null,
      activeLoginId: null,
      activeLoginState: null,
      connectedAt: null,
      lastLoginAttemptAt: null,
      updatedAt: 100,
      lastError: null,
    }
    const claudeMissingLogin = {
      ...claudeDisconnected,
      status: 'error',
      lastLoginAttemptAt: 125,
      updatedAt: 130,
      lastError: null,
    }

    bridgeWindow.__authCalls = []
    bridgeWindow.__terminalCalls = []
    bridgeWindow.__GTUM_AGENT_AUTH_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__authCalls.push({ command, args })
        if (command === 'list_agent_connections') return [claudeDisconnected]
        if (command === 'begin_agent_login') return claudeMissingLogin
        throw new Error(`Unexpected auth command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_TERMINAL_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__terminalCalls.push({ command, args })
        throw new Error(`Claude setup must stay outside the center terminal: ${command}`)
      },
    }
  })

  await page.goto('/')
  await page.locator('.titlebar .pill.icon-only').click()
  const claude = page.locator('.settings-provider').filter({ hasText: 'Claude' })
  await claude.getByRole('button', { name: 'Connect' }).click()

  await expect(claude).toContainText(
    'Run claude auth login in your terminal, then reconnect Claude.',
  )
  await expect(page.locator('.msg.assistant').last()).toContainText(
    'Run claude auth login in your terminal, then reconnect Claude.',
  )
  await expect(page.locator('.group-tabbar').getByText('Claude Login')).toHaveCount(0)
  expect(await page.evaluate(() => (
    window as Window & { __terminalCalls: Array<{ command: string }> }
  ).__terminalCalls)).toEqual([])
})

for (const credentialSource of ['anthropic_api_key', 'api_key_helper'] as const) {
  test(`renders ${credentialSource} Claude snapshots as an API credential`, async ({ page }) => {
    await page.addInitScript((source) => {
      const claudeConnected = {
        provider: 'claude',
        displayName: 'Claude',
        availability: 'available',
        status: 'connected',
        connectionKind: 'real',
        accountLabel: null,
        accountEmail: null,
        credentialSource: source,
        requiredScopes: ['provider:request', 'credential:api_key'],
        expiresAt: null,
        callbackUrl: null,
        authUrl: null,
        activeLoginId: null,
        activeLoginState: null,
        connectedAt: 125,
        lastLoginAttemptAt: 120,
        updatedAt: 130,
        lastError: null,
      }
      ;(window as Window & { __GTUM_AGENT_AUTH_RUNTIME__: unknown })
        .__GTUM_AGENT_AUTH_RUNTIME__ = {
          hasRuntime: () => true,
          invokeRuntime: async () => [claudeConnected],
        }
    }, credentialSource)

    await page.goto('/')
    await page.locator('.titlebar .pill.icon-only').click()
    const claude = page.locator('.settings-provider').filter({ hasText: 'Claude' })
    await expect(claude).toContainText('Connected')
    await expect(claude).toContainText('API credential')
    await expect(claude).toContainText('credential:api_key')
    await expect(claude).not.toContainText('credential:cli_session')
    await expect(claude).not.toContainText('CLI session')
  })
}

test('shows truthful isolated execution settings without auto-approval controls', async ({ page }) => {
  await page.goto('/')
  await page.locator('.titlebar .pill.icon-only').click()
  await page.getByRole('button', { name: 'Execution' }).click()

  const settings = page.locator('.settings-modal')
  await expect(settings).toContainText('Every command requires review')
  await expect(settings).toContainText('isolated Agent job')
  await expect(settings).toContainText('center terminal is never touched')
  await expect(settings.locator('.policy-box')).toHaveCount(0)
  await expect(settings.locator('.audit-box')).toHaveCount(0)
  await expect(settings).not.toContainText('Auto-approve')
})

test('shows cancellable agent job output without mutating the center workbench', async ({ page }) => {
  await installConnectedCodexAuth(page)
  await page.addInitScript((codexCapabilities) => {
    const bridgeWindow = window as Window & {
      __agentJobCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __terminalCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __GTUM_AGENT_JOB_POLL_INTERVAL_MS__: number
      __GTUM_AGENT_JOB_RUNTIME__: unknown
      __GTUM_AGENT_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
      __GTUM_TERMINAL_RUNTIME__: unknown
    }
    const projectPath = '/workspace/aurora'
    let cancelled = false
    let sessionId = ''
    const snapshot = (status: string, logsComplete = false) => ({
      jobId: 88,
      sessionId,
      name: 'agent-cancellable',
      command: 'pnpm test:funnel',
      cwd: projectPath,
      runner: 'pnpm',
      runnerArgs: ['test:funnel'],
      processId: status === 'running' || status === 'cancelling' ? 8800 : null,
      status,
      createdAt: 100,
      updatedAt: status === 'running' ? 120 : 180,
      finishedAt: logsComplete ? 180 : null,
      cancellationRequestedAt: status === 'running' ? null : 150,
      exitCode: null,
      logsComplete,
      logCaptureError: null,
      processError: null,
      persistenceError: null,
      logLineCount: 2,
      maxLogEntries: 400,
      lastEvent: logsComplete ? 'agent job cancelled' : 'agent job output received',
    })

    bridgeWindow.__agentJobCalls = []
    bridgeWindow.__terminalCalls = []
    bridgeWindow.__GTUM_AGENT_JOB_POLL_INTERVAL_MS__ = 20
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async () => ({
        metadata: { name: 'aurora', path: projectPath },
        tree: { name: 'aurora', path: projectPath, kind: 'directory', children: [] },
        git: {
          isRepository: true,
          branch: 'feature/jobs',
          branchType: 'feature',
          changedFilesCount: 0,
        },
      }),
    }
    bridgeWindow.__GTUM_AGENT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string) => {
        if (command === 'read_agent_provider_capabilities') {
          return codexCapabilities
        }

        return [
          {
            id: 'cancellable-job',
            provider: 'codex',
            summary: 'Run a cancellable job',
            command: 'pnpm test:funnel',
            preferredTarget: 'current_tab',
            confidence: 'low',
            error: null,
          },
        ]
      },
    }
    bridgeWindow.__GTUM_AGENT_JOB_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__agentJobCalls.push({ command, args })
        if (command === 'list_agent_jobs') {
          sessionId = String(args?.sessionId || '')
          return []
        }
        if (command === 'create_agent_job') {
          sessionId = String(
            (args?.request as { sessionId?: string } | undefined)?.sessionId || sessionId,
          )
          return snapshot('running')
        }
        if (command === 'cancel_agent_job') {
          cancelled = true
          return snapshot('cancelling')
        }
        if (command === 'read_agent_job_logs') {
          const terminal = cancelled
          return {
            jobId: 88,
            status: terminal ? 'cancelled' : 'running',
            limit: 100,
            logLineCount: 2,
            truncated: false,
            entries: [
              { sequence: 1, stream: 'command', text: 'pnpm test:funnel', recordedAt: 100 },
              { sequence: 2, stream: 'stdout', text: 'running funnel tests', recordedAt: 120 },
            ],
            updatedAt: terminal ? 180 : 120,
            finishedAt: terminal ? 180 : null,
            cancellationRequestedAt: terminal ? 150 : null,
            exitCode: null,
            logsComplete: terminal,
            logCaptureError: null,
            processError: null,
            persistenceError: null,
            lastEvent: terminal ? 'agent job cancelled' : 'agent job output received',
          }
        }
        throw new Error(`unexpected agent job command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_TERMINAL_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__terminalCalls.push({ command, args })
        throw new Error('agent jobs must not invoke the terminal runtime')
      },
    }
  }, nonSelectableCodexCapabilities)

  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')
  await page.getByText('Open project folder').click()
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __GTUM_BACKEND_BRIDGE__?: { projectPath: string }
            }
          ).__GTUM_BACKEND_BRIDGE__?.projectPath ?? '',
      ),
    )
    .toBe('/workspace/aurora')
  const centerBefore = await page.locator('.center').evaluate((element) => element.innerHTML)

  await page.getByPlaceholder('Ask Codex').fill('run cancellable test')
  await page.locator('.composer-input .send').click()
  await page.locator('.composer-approval').getByRole('button', { name: 'Allow once' }).click()

  const job = page.locator('.agent-job-row').filter({ hasText: 'agent-cancellable' })
  await expect(job).toBeVisible()
  await expect(job).toHaveAttribute('data-status', 'running')
  await expect(job).toContainText('pnpm test:funnel')
  await expect(job).toContainText('running funnel tests')
  await expect(job.getByRole('button', { name: 'Cancel' })).toBeVisible()

  await job.getByRole('button', { name: 'Cancel' }).click()
  await expect(job).toHaveAttribute('data-status', 'cancelled')
  await expect(job).toContainText('running funnel tests')
  await expect(job.getByRole('button', { name: 'Cancel' })).toHaveCount(0)
  expect(await page.locator('.center').evaluate((element) => element.innerHTML)).toBe(centerBefore)
  expect(
    await page.evaluate(
      () =>
        (
          window as Window & {
            __terminalCalls: Array<{ command: string; args?: Record<string, unknown> }>
          }
        ).__terminalCalls,
    ),
  ).toEqual([])
  const cancelCall = await page.evaluate(
    () =>
      (
        window as Window & {
          __agentJobCalls: Array<{ command: string; args?: Record<string, unknown> }>
        }
      ).__agentJobCalls.find((call) => call.command === 'cancel_agent_job'),
  )
  expect(cancelCall?.args).toEqual({
    projectPath: '/workspace/aurora',
    jobId: 88,
  })
})

test('does not regress an agent job when a pre-cancel log read resolves late', async ({ page }) => {
  await page.addInitScript(() => {
    type Resolver = (value: unknown) => void
    const bridgeWindow = window as Window & {
      __agentJobCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __terminalCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __staleReadStarted: boolean
      __resolveStaleRead: () => void
      __resolveFinalRead: () => void
      __GTUM_AGENT_JOB_POLL_INTERVAL_MS__: number
      __GTUM_AGENT_JOB_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
      __GTUM_TERMINAL_RUNTIME__: unknown
    }
    const projectPath = '/workspace/cancel-race'
    let sessionId = ''
    let staleResolver: Resolver = () => undefined
    let finalResolver: Resolver = () => undefined
    let readCount = 0
    const snapshot = (status: string, updatedAt: number, logsComplete: boolean) => ({
      jobId: 89,
      sessionId,
      name: 'cancel-race',
      command: 'npm run slow-test',
      cwd: projectPath,
      runner: 'npm',
      runnerArgs: ['run', 'slow-test'],
      processId: status === 'running' || status === 'cancelling' ? 8900 : null,
      status,
      createdAt: 100,
      updatedAt,
      finishedAt: status === 'cancelled' ? updatedAt : null,
      cancellationRequestedAt: status === 'running' ? null : 200,
      exitCode: null,
      logsComplete,
      logCaptureError: null,
      processError: null,
      persistenceError: null,
      logLineCount: logsComplete ? 2 : 1,
      maxLogEntries: 400,
      lastEvent: status === 'running' ? 'agent job output received' : `agent job ${status}`,
    })
    const logs = (status: string, updatedAt: number, logsComplete: boolean, text: string) => ({
      jobId: 89,
      status,
      limit: 100,
      logLineCount: logsComplete ? 2 : 1,
      truncated: false,
      entries: [
        { sequence: 1, stream: 'stdout', text, recordedAt: updatedAt },
        ...(logsComplete
          ? [{ sequence: 2, stream: 'system', text: 'cancel complete', recordedAt: updatedAt }]
          : []),
      ],
      updatedAt,
      finishedAt: status === 'cancelled' ? updatedAt : null,
      cancellationRequestedAt: status === 'running' ? null : 200,
      exitCode: null,
      logsComplete,
      logCaptureError: null,
      processError: null,
      persistenceError: null,
      lastEvent: `agent job ${status}`,
    })

    bridgeWindow.__agentJobCalls = []
    bridgeWindow.__terminalCalls = []
    bridgeWindow.__staleReadStarted = false
    bridgeWindow.__GTUM_AGENT_JOB_POLL_INTERVAL_MS__ = 20
    bridgeWindow.__resolveStaleRead = () =>
      staleResolver(logs('running', 150, false, 'late output from before cancel'))
    bridgeWindow.__resolveFinalRead = () =>
      finalResolver(logs('cancelled', 250, true, 'late output from before cancel'))
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async () => ({
        metadata: { name: 'cancel-race', path: projectPath },
        tree: { name: 'cancel-race', path: projectPath, kind: 'directory', children: [] },
        git: {
          isRepository: true,
          branch: 'dev',
          branchType: 'development',
          changedFilesCount: 0,
        },
      }),
    }
    bridgeWindow.__GTUM_AGENT_JOB_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__agentJobCalls.push({ command, args })
        if (command === 'list_agent_jobs') {
          sessionId = String(args?.sessionId || '')
          return [snapshot('running', 100, false)]
        }
        if (command === 'cancel_agent_job') return snapshot('cancelling', 200, false)
        if (command === 'read_agent_job_logs') {
          readCount += 1
          if (readCount === 1) {
            bridgeWindow.__staleReadStarted = true
            return new Promise((resolve) => {
              staleResolver = resolve
            })
          }
          return new Promise((resolve) => {
            finalResolver = resolve
          })
        }
        throw new Error(`unexpected agent job command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_TERMINAL_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__terminalCalls.push({ command, args })
        throw new Error('cancel races must not touch the center terminal')
      },
    }
  })

  await page.goto('/')
  await page.getByText('Open project folder').click()
  const job = page.locator('.agent-job-row[data-job-id="89"]')
  await expect(job).toHaveAttribute('data-status', 'running')
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { __staleReadStarted: boolean }).__staleReadStarted,
      ),
    )
    .toBe(true)
  const centerBefore = await page.locator('.center').evaluate((element) => element.innerHTML)

  await job.getByRole('button', { name: 'Cancel' }).click()
  await expect(job).toHaveAttribute('data-status', 'cancelling')
  await page.evaluate(() =>
    (window as Window & { __resolveStaleRead: () => void }).__resolveStaleRead(),
  )
  await expect(job).toContainText('late output from before cancel')
  await expect(job).toHaveAttribute('data-status', 'cancelling')
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & { __agentJobCalls: Array<{ command: string }> }
          ).__agentJobCalls.filter((call) => call.command === 'read_agent_job_logs').length,
      ),
    )
    .toBe(2)
  await page.evaluate(() =>
    (window as Window & { __resolveFinalRead: () => void }).__resolveFinalRead(),
  )
  await expect(job).toHaveAttribute('data-status', 'cancelled')
  await expect(job).toContainText('cancel complete')
  expect(await page.locator('.center').evaluate((element) => element.innerHTML)).toBe(centerBefore)
  expect(
    await page.evaluate(
      () =>
        (
          window as Window & { __terminalCalls: Array<{ command: string }> }
        ).__terminalCalls,
    ),
  ).toEqual([])
})

test('keeps agent job history and stale reads scoped to the starting session', async ({ page }) => {
  await page.addInitScript(() => {
    type Resolver = (value: unknown) => void
    const bridgeWindow = window as Window & {
      __resolveSessionARead: () => void
      __GTUM_AGENT_JOB_POLL_INTERVAL_MS__: number
      __GTUM_AGENT_JOB_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
    }
    const projectPath = '/workspace/session-jobs'
    let listCount = 0
    let sessionARead: Resolver = () => undefined
    const snapshot = (jobId: number, sessionId: string, name: string, status: string) => ({
      jobId,
      sessionId,
      name,
      command: `echo ${name}`,
      cwd: projectPath,
      runner: 'echo',
      runnerArgs: [name],
      processId: status === 'running' ? jobId * 10 : null,
      status,
      createdAt: jobId,
      updatedAt: jobId + 1,
      finishedAt: status === 'running' ? null : jobId + 1,
      cancellationRequestedAt: null,
      exitCode: null,
      logsComplete: status !== 'running',
      logCaptureError: null,
      processError: null,
      persistenceError: null,
      logLineCount: 1,
      maxLogEntries: 400,
      lastEvent: status === 'running' ? 'agent job output received' : 'agent job interrupted',
    })
    const logs = (jobId: number, status: string, text: string) => ({
      jobId,
      status,
      limit: 100,
      logLineCount: 1,
      truncated: false,
      entries: [{ sequence: 1, stream: 'system', text, recordedAt: jobId + 2 }],
      updatedAt: jobId + 2,
      finishedAt: status === 'running' ? null : jobId + 2,
      cancellationRequestedAt: null,
      exitCode: null,
      logsComplete: status !== 'running',
      logCaptureError: null,
      processError: null,
      persistenceError: null,
      lastEvent: status === 'running' ? 'agent job output received' : 'agent job interrupted',
    })

    bridgeWindow.__GTUM_AGENT_JOB_POLL_INTERVAL_MS__ = 20
    bridgeWindow.__resolveSessionARead = () =>
      sessionARead(logs(101, 'running', 'must not cross sessions'))
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async () => ({
        metadata: { name: 'session-jobs', path: projectPath },
        tree: { name: 'session-jobs', path: projectPath, kind: 'directory', children: [] },
        git: {
          isRepository: true,
          branch: 'dev',
          branchType: 'development',
          changedFilesCount: 0,
        },
      }),
    }
    bridgeWindow.__GTUM_AGENT_JOB_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        if (command === 'list_agent_jobs') {
          if (args?.sessionId == null) return []
          listCount += 1
          const sessionId = String(args.sessionId)
          return listCount === 1
            ? [snapshot(101, sessionId, 'session-a-job', 'running')]
            : [snapshot(102, sessionId, 'session-b-job', 'interrupted')]
        }
        if (command === 'read_agent_job_logs' && args?.jobId === 101) {
          return new Promise((resolve) => {
            sessionARead = resolve
          })
        }
        if (command === 'read_agent_job_logs' && args?.jobId === 102) {
          return logs(102, 'interrupted', 'session B restored history')
        }
        throw new Error(`unexpected agent job command: ${command}`)
      },
    }
  })

  await page.goto('/')
  await page.getByText('Open project folder').click()
  await expect(page.locator('.agent-job-row[data-job-id="101"]')).toBeVisible()
  const centerBefore = await page.locator('.center').evaluate((element) => element.innerHTML)

  await page.locator('.agent-session-new').click()
  await expect(page.locator('.agent-job-row[data-job-id="101"]')).toHaveCount(0)
  const sessionBJob = page.locator('.agent-job-row[data-job-id="102"]')
  await expect(sessionBJob).toHaveAttribute('data-status', 'interrupted')
  await expect(sessionBJob).toContainText('session B restored history')

  await page.evaluate(() =>
    (window as Window & { __resolveSessionARead: () => void }).__resolveSessionARead(),
  )
  await page.waitForTimeout(80)
  await expect(page.locator('.agent-job-row[data-job-id="101"]')).toHaveCount(0)
  await expect(page.locator('.agent-job-activity')).not.toContainText('must not cross sessions')
  expect(await page.locator('.center').evaluate((element) => element.innerHTML)).toBe(centerBefore)
})

test('renders completed and failed agent job outcomes and stops after final logs', async ({ page }) => {
  await installConnectedCodexAuth(page)
  await page.addInitScript((codexCapabilities) => {
    const bridgeWindow = window as Window & {
      __agentJobCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __terminalCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __releaseCompletedJobReads: () => void
      __GTUM_AGENT_JOB_POLL_INTERVAL_MS__: number
      __GTUM_AGENT_JOB_RUNTIME__: unknown
      __GTUM_AGENT_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
      __GTUM_TERMINAL_RUNTIME__: unknown
    }
    const projectPath = '/workspace/job-outcomes'
    const readCounts = new Map<number, number>()
    let sessionId = ''
    let releaseReads = () => undefined
    const readGate = new Promise<void>((resolve) => {
      releaseReads = resolve
    })
    const snapshot = (
      jobId: number,
      name: string,
      command: string,
      status: string,
      exitCode: number | null,
      logsComplete: boolean,
    ) => ({
      jobId,
      sessionId,
      name,
      command,
      cwd: projectPath,
      runner: command.split(' ')[0],
      runnerArgs: command.split(' ').slice(1),
      processId: status === 'running' ? jobId * 100 : null,
      status,
      createdAt: jobId,
      updatedAt: jobId + 1,
      finishedAt: status === 'running' ? null : jobId + 1,
      cancellationRequestedAt: null,
      exitCode,
      logsComplete,
      logCaptureError: null,
      processError: status === 'failed' ? 'process exited with code 2' : null,
      persistenceError: null,
      logLineCount: status === 'running' ? 1 : 2,
      maxLogEntries: 400,
      lastEvent: status === 'failed' ? 'agent job failed' : 'agent job created',
    })
    const logs = (
      jobId: number,
      status: string,
      exitCode: number | null,
      logsComplete: boolean,
      entries: Array<{
        sequence: number
        stream: string
        text: string
        recordedAt: number
      }>,
    ) => ({
      jobId,
      status,
      limit: 100,
      logLineCount: entries.length,
      truncated: false,
      entries,
      updatedAt: jobId + entries.length + 10,
      finishedAt: status === 'running' ? null : jobId + entries.length + 10,
      cancellationRequestedAt: null,
      exitCode,
      logsComplete,
      logCaptureError: null,
      processError: status === 'failed' ? 'process exited with code 2' : null,
      persistenceError: null,
      lastEvent: status === 'failed' ? 'agent job failed' : 'agent job completed',
    })

    bridgeWindow.__agentJobCalls = []
    bridgeWindow.__terminalCalls = []
    bridgeWindow.__releaseCompletedJobReads = () => releaseReads()
    bridgeWindow.__GTUM_AGENT_JOB_POLL_INTERVAL_MS__ = 20
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async () => ({
        metadata: { name: 'job-outcomes', path: projectPath },
        tree: { name: 'job-outcomes', path: projectPath, kind: 'directory', children: [] },
        git: {
          isRepository: true,
          branch: 'feature/jobs',
          branchType: 'feature',
          changedFilesCount: 0,
        },
      }),
    }
    bridgeWindow.__GTUM_AGENT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string) => {
        if (command === 'read_agent_provider_capabilities') {
          return codexCapabilities
        }

        return [
          {
            id: 'completed-job',
            provider: 'codex',
            summary: 'Run the completion probe',
            command: 'npm run completion-probe',
            preferredTarget: 'current_tab',
            confidence: 'low',
            error: null,
          },
        ]
      },
    }
    bridgeWindow.__GTUM_AGENT_JOB_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__agentJobCalls.push({ command, args })
        if (command === 'list_agent_jobs') {
          sessionId = String(args?.sessionId || '')
          return [snapshot(40, 'restored-failure', 'npm test', 'failed', 2, true)]
        }
        if (command === 'create_agent_job') {
          sessionId = String(
            (args?.request as { sessionId?: string } | undefined)?.sessionId || sessionId,
          )
          return snapshot(41, 'agent-completed-job-1', 'npm run completion-probe', 'running', null, false)
        }
        if (command === 'read_agent_job_logs') {
          const jobId = Number(args?.jobId)
          const count = (readCounts.get(jobId) ?? 0) + 1
          readCounts.set(jobId, count)
          if (jobId === 40) {
            return logs(40, 'failed', 2, true, [
              { sequence: 1, stream: 'command', text: 'npm test', recordedAt: 40 },
              { sequence: 2, stream: 'stderr', text: 'assertion failed', recordedAt: 41 },
            ])
          }
          if (jobId === 41) {
            await readGate
            if (count === 1) {
              return logs(41, 'completed', 0, false, [
                {
                  sequence: 1,
                  stream: 'stdout',
                  text: 'process exited; draining logs',
                  recordedAt: 42,
                },
              ])
            }
            return logs(41, 'completed', 0, true, [
              {
                sequence: 1,
                stream: 'stdout',
                text: 'process exited; draining logs',
                recordedAt: 42,
              },
              { sequence: 2, stream: 'system', text: 'final log flushed', recordedAt: 43 },
            ])
          }
        }
        throw new Error(`unexpected agent job command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_TERMINAL_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__terminalCalls.push({ command, args })
        throw new Error('job outcomes must not touch the center terminal')
      },
    }
  }, nonSelectableCodexCapabilities)

  await page.goto('/')
  await page.getByText('Open project folder').click()
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & { __GTUM_BACKEND_BRIDGE__?: { projectPath: string } }
          ).__GTUM_BACKEND_BRIDGE__?.projectPath ?? '',
      ),
    )
    .toBe('/workspace/job-outcomes')

  const failed = page.locator('.agent-job-row[data-job-id="40"]')
  await expect(failed).toHaveAttribute('data-status', 'failed')
  await expect(failed).toContainText('assertion failed')
  await expect(failed.locator('.agent-job-exit')).toHaveText('Exit 2')
  await expect(failed.locator('.agent-job-error')).toContainText('process exited with code 2')
  await expect(failed.getByRole('button', { name: 'Cancel' })).toHaveCount(0)

  const centerBefore = await page.locator('.center').evaluate((element) => element.innerHTML)
  await page.getByPlaceholder('Ask Codex').fill('run completion probe')
  await page.locator('.composer-input .send').click()
  await page.locator('.composer-approval').getByRole('button', { name: 'Allow once' }).click()

  const completed = page.locator('.agent-job-row[data-job-id="41"]')
  await expect(completed).toHaveAttribute('data-status', 'running')
  await expect(completed.getByRole('button', { name: 'Cancel' })).toBeVisible()
  await page.evaluate(() =>
    (
      window as Window & { __releaseCompletedJobReads: () => void }
    ).__releaseCompletedJobReads(),
  )
  await expect(completed).toHaveAttribute('data-status', 'completed')
  await expect(completed).toContainText('final log flushed')
  await expect(completed.locator('.agent-job-exit')).toHaveText('Exit 0')
  await expect(completed.getByRole('button', { name: 'Cancel' })).toHaveCount(0)

  const finalReadCount = await page.evaluate(
    () =>
      (
        window as Window & {
          __agentJobCalls: Array<{ command: string; args?: Record<string, unknown> }>
        }
      ).__agentJobCalls.filter(
        (call) => call.command === 'read_agent_job_logs' && call.args?.jobId === 41,
      ).length,
  )
  await page.waitForTimeout(120)
  expect(
    await page.evaluate(
      () =>
        (
          window as Window & {
            __agentJobCalls: Array<{ command: string; args?: Record<string, unknown> }>
          }
        ).__agentJobCalls.filter(
          (call) => call.command === 'read_agent_job_logs' && call.args?.jobId === 41,
        ).length,
    ),
  ).toBe(finalReadCount)
  expect(finalReadCount).toBe(2)
  expect(await page.locator('.center').evaluate((element) => element.innerHTML)).toBe(centerBefore)
  expect(
    await page.evaluate(
      () =>
        (
          window as Window & { __terminalCalls: Array<{ command: string }> }
        ).__terminalCalls,
    ),
  ).toEqual([])
})

test('restores interrupted agent job history after a real page reload', async ({ page }) => {
  await page.addInitScript(() => {
    const projectPath = '/workspace/restored-jobs'
    const restoredSessionId = 'agent-restored-session'
    const bridgeWindow = window as Window & {
      __GTUM_AGENT_JOB_POLL_INTERVAL_MS__: number
      __GTUM_AGENT_JOB_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
      __GTUM_TERMINAL_RUNTIME__: unknown
      __GTUM_WORKSPACE_RUNTIME__: unknown
    }
    const increment = (key: string) => {
      const next = Number(sessionStorage.getItem(key) || '0') + 1
      sessionStorage.setItem(key, String(next))
    }

    localStorage.setItem(
      'gtum.agent-session-directory.v1',
      JSON.stringify({
        [projectPath]: {
          workspaceTitle: 'restored-jobs',
          activeSessionId: restoredSessionId,
          sessions: [
            {
              id: restoredSessionId,
              title: 'harbor',
              createdAt: '10:00',
              updatedAt: '10:00',
            },
          ],
        },
      }),
    )

    bridgeWindow.__GTUM_AGENT_JOB_POLL_INTERVAL_MS__ = 20
    bridgeWindow.__GTUM_WORKSPACE_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string) => {
        if (command === 'read_workspace_runtime_snapshot') {
          return {
            storagePath: '/tmp/workspace.json',
            restoredAt: 100,
            snapshot: {
              recentProjects: [projectPath],
              lastOpenedProjectPath: projectPath,
              updatedAt: 100,
              storageVersion: 1,
            },
          }
        }
        return null
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async () => ({
        metadata: { name: 'restored-jobs', path: projectPath },
        tree: { name: 'restored-jobs', path: projectPath, kind: 'directory', children: [] },
        git: {
          isRepository: true,
          branch: 'dev',
          branchType: 'development',
          changedFilesCount: 0,
        },
      }),
    }
    bridgeWindow.__GTUM_AGENT_JOB_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        if (command === 'list_agent_jobs') {
          if (args?.sessionId == null) return []
          increment('restored-list-count')
          if (String(args.sessionId) !== restoredSessionId) return []
          return [
            {
              jobId: 63,
              sessionId: restoredSessionId,
              name: 'restored-after-reload',
              command: 'npm run interrupted',
              cwd: projectPath,
              runner: 'npm',
              runnerArgs: ['run', 'interrupted'],
              processId: null,
              status: 'interrupted',
              createdAt: 60,
              updatedAt: 63,
              finishedAt: 63,
              cancellationRequestedAt: null,
              exitCode: null,
              logsComplete: true,
              logCaptureError: null,
              processError: null,
              persistenceError: null,
              logLineCount: 1,
              maxLogEntries: 400,
              lastEvent: 'agent job interrupted by runtime restart',
            },
          ]
        }
        if (command === 'read_agent_job_logs') {
          increment('restored-read-count')
          return {
            jobId: 63,
            status: 'interrupted',
            limit: 100,
            logLineCount: 1,
            truncated: false,
            entries: [
              {
                sequence: 1,
                stream: 'system',
                text: 'runtime restart interrupted this process',
                recordedAt: 63,
              },
            ],
            updatedAt: 63,
            finishedAt: 63,
            cancellationRequestedAt: null,
            exitCode: null,
            logsComplete: true,
            logCaptureError: null,
            processError: null,
            persistenceError: null,
            lastEvent: 'agent job interrupted by runtime restart',
          }
        }
        if (command === 'create_agent_job') increment('restored-create-count')
        throw new Error(`unexpected agent job command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_TERMINAL_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async () => {
        increment('restored-terminal-count')
        throw new Error('restoration must not touch the terminal runtime')
      },
    }
  })

  await page.goto('/')
  const restored = page.locator('.agent-job-row[data-job-id="63"]')
  await expect(restored).toHaveAttribute('data-status', 'interrupted')
  await expect(restored).toContainText('runtime restart interrupted this process')
  const centerBefore = await page.locator('.center').evaluate((element) => element.innerHTML)

  await page.reload()
  await expect(restored).toHaveAttribute('data-status', 'interrupted')
  await expect(restored).toContainText('runtime restart interrupted this process')
  expect(await page.locator('.center').evaluate((element) => element.innerHTML)).toBe(centerBefore)
  expect(await page.evaluate(() => Number(sessionStorage.getItem('restored-list-count')))).toBe(2)
  expect(await page.evaluate(() => Number(sessionStorage.getItem('restored-read-count')))).toBe(2)
  expect(await page.evaluate(() => Number(sessionStorage.getItem('restored-create-count') || '0'))).toBe(0)
  expect(await page.evaluate(() => Number(sessionStorage.getItem('restored-terminal-count') || '0'))).toBe(0)
})

test('keeps a newly created agent job when delayed hydration returns an empty history', async ({ page }) => {
  await installConnectedCodexAuth(page)
  await page.addInitScript((codexCapabilities) => {
    type Resolver = (jobs: unknown[]) => void
    const bridgeWindow = window as Window & {
      __resolveDelayedJobHistory: () => void
      __terminalCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __GTUM_AGENT_JOB_POLL_INTERVAL_MS__: number
      __GTUM_AGENT_JOB_RUNTIME__: unknown
      __GTUM_AGENT_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
      __GTUM_TERMINAL_RUNTIME__: unknown
    }
    const projectPath = '/workspace/create-race'
    const historyResolvers: Resolver[] = []
    let sessionId = ''

    bridgeWindow.__terminalCalls = []
    bridgeWindow.__GTUM_AGENT_JOB_POLL_INTERVAL_MS__ = 20
    bridgeWindow.__resolveDelayedJobHistory = () => {
      for (const resolve of historyResolvers.splice(0)) resolve([])
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async () => ({
        metadata: { name: 'create-race', path: projectPath },
        tree: { name: 'create-race', path: projectPath, kind: 'directory', children: [] },
        git: {
          isRepository: true,
          branch: 'feature/jobs',
          branchType: 'feature',
          changedFilesCount: 0,
        },
      }),
    }
    bridgeWindow.__GTUM_AGENT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string) => {
        if (command === 'read_agent_provider_capabilities') {
          return codexCapabilities
        }

        return [
          {
            id: 'create-race',
            provider: 'codex',
            summary: 'Create while hydration is pending',
            command: 'npm run race',
            preferredTarget: 'current_tab',
            confidence: 'low',
            error: null,
          },
        ]
      },
    }
    bridgeWindow.__GTUM_AGENT_JOB_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        if (command === 'list_agent_jobs') {
          sessionId = String(args?.sessionId || '')
          return new Promise<unknown[]>((resolve) => historyResolvers.push(resolve))
        }
        if (command === 'create_agent_job') {
          sessionId = String(
            (args?.request as { sessionId?: string } | undefined)?.sessionId || sessionId,
          )
          return {
            jobId: 71,
            sessionId,
            name: 'agent-create-race-1',
            command: 'npm run race',
            cwd: projectPath,
            runner: 'npm',
            runnerArgs: ['run', 'race'],
            processId: 7100,
            status: 'running',
            createdAt: 70,
            updatedAt: 71,
            finishedAt: null,
            cancellationRequestedAt: null,
            exitCode: null,
            logsComplete: false,
            logCaptureError: null,
            processError: null,
            persistenceError: null,
            logLineCount: 0,
            maxLogEntries: 400,
            lastEvent: 'agent job created',
          }
        }
        if (command === 'read_agent_job_logs') {
          return new Promise(() => undefined)
        }
        throw new Error(`unexpected agent job command: ${command}`)
      },
    }
    bridgeWindow.__GTUM_TERMINAL_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__terminalCalls.push({ command, args })
        throw new Error('create/hydration races must not use terminal commands')
      },
    }
  }, nonSelectableCodexCapabilities)

  await page.goto('/')
  await page.getByText('Open project folder').click()
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & { __GTUM_BACKEND_BRIDGE__?: { projectPath: string } }
          ).__GTUM_BACKEND_BRIDGE__?.projectPath ?? '',
      ),
    )
    .toBe('/workspace/create-race')
  const centerBefore = await page.locator('.center').evaluate((element) => element.innerHTML)

  await page.getByPlaceholder('Ask Codex').fill('test creation race')
  await page.locator('.composer-input .send').click()
  await page.locator('.composer-approval').getByRole('button', { name: 'Allow once' }).click()
  const created = page.locator('.agent-job-row[data-job-id="71"]')
  await expect(created).toHaveAttribute('data-status', 'running')

  await page.evaluate(() =>
    (
      window as Window & { __resolveDelayedJobHistory: () => void }
    ).__resolveDelayedJobHistory(),
  )
  await page.waitForTimeout(80)
  await expect(created).toHaveAttribute('data-status', 'running')
  expect(await page.locator('.center').evaluate((element) => element.innerHTML)).toBe(centerBefore)
  expect(
    await page.evaluate(
      () =>
        (
          window as Window & {
            __terminalCalls: Array<{ command: string; args?: Record<string, unknown> }>
          }
        ).__terminalCalls,
    ),
  ).toEqual([])
})

test('hydrates interrupted agent job history and ignores stale project responses', async ({ page }) => {
  await page.addInitScript(() => {
    type Resolver = (value: unknown[]) => void
    const bridgeWindow = window as Window & {
      __resolveProjectAJobs: () => void
      __GTUM_AGENT_JOB_POLL_INTERVAL_MS__: number
      __GTUM_AGENT_JOB_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
    }
    const projectA = '/workspace/project-a'
    const projectB = '/workspace/project-b'
    const staleResolvers: Resolver[] = []
    const sessionByProject = new Map<string, string>()
    let overviewCount = 0
    const jobSnapshot = (jobId: number, name: string, cwd: string, status: string) => ({
      jobId,
      sessionId: sessionByProject.get(cwd) || '',
      name,
      command: `echo ${name}`,
      cwd,
      runner: 'echo',
      runnerArgs: [name],
      processId: null,
      status,
      createdAt: jobId,
      updatedAt: jobId + 1,
      finishedAt: jobId + 1,
      cancellationRequestedAt: null,
      exitCode: status === 'completed' ? 0 : null,
      logsComplete: true,
      logCaptureError: null,
      processError: null,
      persistenceError: null,
      logLineCount: 1,
      maxLogEntries: 400,
      lastEvent: status === 'interrupted' ? 'agent job interrupted by runtime restart' : 'done',
    })

    bridgeWindow.__GTUM_AGENT_JOB_POLL_INTERVAL_MS__ = 20
    bridgeWindow.__resolveProjectAJobs = () => {
      for (const resolve of staleResolvers.splice(0)) {
        resolve([jobSnapshot(91, 'stale-project-a', projectA, 'completed')])
      }
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async () => {
        overviewCount += 1
        const path = overviewCount === 1 ? projectA : projectB
        return {
          metadata: { name: path.endsWith('a') ? 'project-a' : 'project-b', path },
          tree: { name: 'project', path, kind: 'directory', children: [] },
          git: {
            isRepository: true,
            branch: 'dev',
            branchType: 'development',
            changedFilesCount: 0,
          },
        }
      },
    }
    bridgeWindow.__GTUM_AGENT_JOB_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        const projectPath = String(args?.projectPath || '')
        if (command === 'list_agent_jobs') {
          sessionByProject.set(projectPath, String(args?.sessionId || ''))
          if (projectPath === projectA) {
            return new Promise<unknown[]>((resolve) => staleResolvers.push(resolve))
          }
          if (projectPath === projectB) {
            return [jobSnapshot(92, 'restored-project-b', projectB, 'interrupted')]
          }
        }
        if (command === 'read_agent_job_logs') {
          return {
            jobId: 92,
            status: 'interrupted',
            limit: 100,
            logLineCount: 1,
            truncated: false,
            entries: [
              { sequence: 1, stream: 'system', text: 'restart interrupted this job', recordedAt: 93 },
            ],
            updatedAt: 93,
            finishedAt: 93,
            cancellationRequestedAt: null,
            exitCode: null,
            logsComplete: true,
            logCaptureError: null,
            processError: null,
            persistenceError: null,
            lastEvent: 'agent job interrupted by runtime restart',
          }
        }
        throw new Error(`unexpected agent job command: ${command}`)
      },
    }
  })

  await page.goto('/')
  await page.getByText('Open project folder').click()
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __GTUM_BACKEND_BRIDGE__?: { projectPath: string }
            }
          ).__GTUM_BACKEND_BRIDGE__?.projectPath ?? '',
      ),
    )
    .toBe('/workspace/project-a')

  await page.getByText('Open project folder').click()
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __GTUM_BACKEND_BRIDGE__?: { projectPath: string }
            }
          ).__GTUM_BACKEND_BRIDGE__?.projectPath ?? '',
      ),
    )
    .toBe('/workspace/project-b')
  const restored = page.locator('.agent-job-row').filter({ hasText: 'restored-project-b' })
  await expect(restored).toHaveAttribute('data-status', 'interrupted')
  await expect(restored).toContainText('restart interrupted this job')

  await page.evaluate(() =>
    (
      window as Window & {
        __resolveProjectAJobs: () => void
      }
    ).__resolveProjectAJobs(),
  )
  await page.waitForTimeout(100)
  await expect(page.locator('.agent-job-row')).toHaveCount(1)
  await expect(page.locator('.agent-job-row')).not.toContainText('stale-project-a')
})

test('keeps Codex setup guidance in the agent panel without opening a login terminal', async ({ page }) => {
  await page.addInitScript(() => {
    const codexDisconnected = {
      provider: 'codex',
      displayName: 'Codex',
      status: 'disconnected',
      connectionKind: 'real',
      accountLabel: null,
      accountEmail: null,
      requiredScopes: ['project:read', 'terminal:read'],
      expiresAt: null,
      callbackUrl: null,
      authUrl: null,
      activeLoginId: null,
      activeLoginState: null,
      connectedAt: null,
      lastLoginAttemptAt: null,
      updatedAt: 100,
      lastError: null,
    }
    const codexError = {
      ...codexDisconnected,
      status: 'error',
      lastLoginAttemptAt: 125,
      updatedAt: 130,
      lastError: 'Codex CLI session is missing or expired. Run codex login, then reconnect.',
    }
    const claudeDeferred = {
      provider: 'claude',
      displayName: 'Claude',
      status: 'error',
      connectionKind: 'prototype',
      accountLabel: null,
      accountEmail: null,
      requiredScopes: ['provider:deferred'],
      expiresAt: null,
      callbackUrl: null,
      authUrl: null,
      activeLoginId: null,
      activeLoginState: null,
      connectedAt: null,
      lastLoginAttemptAt: null,
      updatedAt: 100,
      lastError: 'Claude real-provider support is deferred.',
    }
    const bridgeWindow = window as Window & {
      __authCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __GTUM_AGENT_AUTH_RUNTIME__: unknown
    }

    bridgeWindow.__authCalls = []
    bridgeWindow.__GTUM_AGENT_AUTH_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__authCalls.push({ command, args })

        if (command === 'list_agent_connections') return [claudeDeferred, codexDisconnected]
        if (command === 'begin_agent_login') return codexError
        if (command === 'create_terminal_session_with_command') {
          throw new Error('Codex setup guidance must stay in the agent panel')
        }
        if (command === 'read_agent_provider_diagnostics') {
          return {
            provider: 'codex',
            setupState: 'ready',
            connectionPath: 'Codex CLI ChatGPT session',
            summary: 'Codex CLI is ready',
            guidance: 'Run codex login, then reconnect.',
            baseUrl: null,
            model: 'Codex CLI default',
            requirements: [],
          }
        }

        return codexDisconnected
      },
    }
  })

  await page.goto('/')
  await page.locator('.titlebar .pill.icon-only').click()
  await page
    .locator('.settings-provider')
    .filter({ hasText: 'Codex' })
    .getByRole('button', { name: 'Connect' })
    .click()

  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __authCalls?: Array<{ command: string }>
            }
          ).__authCalls?.map((call) => call.command) ?? [],
      ),
    )
    .toEqual(
      expect.arrayContaining([
        'list_agent_connections',
        'begin_agent_login',
      ]),
    )

  await expect(page.locator('.group-tabbar').getByText('Codex Login')).toHaveCount(0)
  await expect(page.locator('.settings-provider').filter({ hasText: 'Codex' })).toContainText(
    'Codex CLI session is missing or expired. Run codex login, then reconnect.',
  )
  await expect(page.locator('.msg.assistant').last()).toContainText(
    'Codex CLI session is missing or expired. Run codex login, then reconnect.',
  )

  const calls = await page.evaluate(
    () =>
      (
        window as Window & {
          __authCalls?: Array<{ command: string; args?: Record<string, unknown> }>
        }
      ).__authCalls ?? [],
  )

  expect(calls.map((call) => call.command)).not.toContain('create_terminal_session_with_command')
})

test('connects an existing Codex session without opening a login terminal', async ({ page }) => {
  await page.addInitScript(() => {
    const codexDisconnected = {
      provider: 'codex',
      displayName: 'Codex',
      status: 'disconnected',
      connectionKind: 'real',
      accountLabel: null,
      accountEmail: null,
      requiredScopes: ['project:read', 'terminal:read'],
      expiresAt: null,
      callbackUrl: null,
      authUrl: null,
      activeLoginId: null,
      activeLoginState: null,
      connectedAt: null,
      lastLoginAttemptAt: null,
      updatedAt: 100,
      lastError: null,
    }
    const codexConnected = {
      ...codexDisconnected,
      status: 'connected',
      accountLabel: 'Codex ChatGPT Session',
      connectedAt: 130,
      lastLoginAttemptAt: 125,
      updatedAt: 140,
    }
    const bridgeWindow = window as Window & {
      __authCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __GTUM_AGENT_AUTH_RUNTIME__: unknown
    }

    bridgeWindow.__authCalls = []
    bridgeWindow.__GTUM_AGENT_AUTH_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__authCalls.push({ command, args })

        if (command === 'list_agent_connections') return [codexDisconnected]
        if (command === 'begin_agent_login') return codexConnected
        if (command === 'create_terminal_session_with_command') {
          throw new Error('login terminal should not open for an existing session')
        }

        return codexDisconnected
      },
    }
  })

  await page.goto('/')
  await page.locator('.titlebar .pill.icon-only').click()
  await page
    .locator('.settings-provider')
    .filter({ hasText: 'Codex' })
    .getByRole('button', { name: 'Connect' })
    .click()

  await expect(page.locator('.settings-modal')).toBeHidden()
  await page.locator('.titlebar .pill.icon-only').click()
  await expect(page.locator('.settings-provider').filter({ hasText: 'Codex' })).toContainText(
    'Connected',
  )
  await expect(page.locator('.group-tabbar').getByText('Codex Login')).toHaveCount(0)

  const calls = await page.evaluate(
    () =>
      (
        window as Window & {
          __authCalls?: Array<{ command: string }>
        }
      ).__authCalls?.map((call) => call.command) ?? [],
  )

  expect(calls).toContain('begin_agent_login')
  expect(calls).not.toContain('create_terminal_session_with_command')
})

test('does not render corrupted placeholder markers in visible settings copy', async ({ page }) => {
  await page.goto('/')
  await page.locator('.titlebar .pill.icon-only').click()

  await expect(page.locator('.settings-modal')).toBeVisible()
  await expect(page.locator('.settings-modal')).not.toContainText('??')

  await page.getByRole('button', { name: 'About' }).click()
  await expect(page.locator('.settings-modal')).not.toContainText('??')
})

test('keeps exact Codex login failure visible in settings', async ({ page }) => {
  await page.addInitScript(() => {
    const codexDisconnected = {
      provider: 'codex',
      displayName: 'Codex',
      status: 'disconnected',
      connectionKind: 'real',
      accountLabel: null,
      accountEmail: null,
      requiredScopes: ['project:read', 'terminal:read'],
      expiresAt: null,
      callbackUrl: null,
      authUrl: null,
      activeLoginId: null,
      activeLoginState: null,
      connectedAt: null,
      lastLoginAttemptAt: null,
      updatedAt: 100,
      lastError: null,
    }
    const codexError = {
      ...codexDisconnected,
      status: 'error',
      lastLoginAttemptAt: 125,
      updatedAt: 130,
      lastError: 'Codex CLI session is missing or expired. Run codex login, then reconnect.',
    }
    const bridgeWindow = window as Window & {
      __authCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __GTUM_AGENT_AUTH_RUNTIME__: unknown
    }

    bridgeWindow.__authCalls = []
    bridgeWindow.__GTUM_AGENT_AUTH_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__authCalls.push({ command, args })

        if (command === 'list_agent_connections') return [codexDisconnected]
        if (command === 'create_terminal_session_with_command') {
          throw new Error('Codex setup guidance must stay in the agent panel')
        }
        if (command === 'begin_agent_login') return codexError

        return codexDisconnected
      },
    }
  })

  await page.goto('/')
  await page.locator('.titlebar .pill.icon-only').click()
  await page
    .locator('.settings-provider')
    .filter({ hasText: 'Codex' })
    .getByRole('button', { name: 'Connect' })
    .click()

  await expect(page.locator('.settings-modal')).toBeVisible()
  await expect(page.locator('.settings-provider').filter({ hasText: 'Codex' })).toContainText(
    'Codex CLI session is missing or expired. Run codex login, then reconnect.',
  )
})

test('reconnects Codex after the CLI session is completed', async ({ page }) => {
  await page.addInitScript(() => {
    const codexDisconnected = {
      provider: 'codex',
      displayName: 'Codex',
      status: 'disconnected',
      connectionKind: 'real',
      accountLabel: null,
      accountEmail: null,
      requiredScopes: ['project:read', 'terminal:read'],
      expiresAt: null,
      callbackUrl: null,
      authUrl: null,
      activeLoginId: null,
      activeLoginState: null,
      connectedAt: null,
      lastLoginAttemptAt: null,
      updatedAt: 100,
      lastError: null,
    }
    const codexError = {
      ...codexDisconnected,
      status: 'error',
      lastLoginAttemptAt: 125,
      updatedAt: 130,
      lastError: 'Codex CLI session is missing or expired. Run codex login, then reconnect.',
    }
    const codexConnected = {
      ...codexDisconnected,
      status: 'connected',
      accountLabel: 'Codex ChatGPT Session',
      connectedAt: 150,
      lastLoginAttemptAt: 145,
      updatedAt: 155,
      lastError: null,
    }
    const bridgeWindow = window as Window & {
      __authCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __GTUM_AGENT_AUTH_RUNTIME__: unknown
      __beginAttempts: number
    }

    bridgeWindow.__authCalls = []
    bridgeWindow.__beginAttempts = 0
    bridgeWindow.__GTUM_AGENT_AUTH_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string, args?: Record<string, unknown>) => {
        bridgeWindow.__authCalls.push({ command, args })

        if (command === 'list_agent_connections') return [codexDisconnected]
        if (command === 'create_terminal_session_with_command') {
          throw new Error('reconnect must not open a Codex login terminal')
        }
        if (command === 'begin_agent_login') {
          bridgeWindow.__beginAttempts += 1
          return bridgeWindow.__beginAttempts === 1 ? codexError : codexConnected
        }

        return codexDisconnected
      },
    }
  })

  await page.goto('/')
  await page.locator('.titlebar .pill.icon-only').click()
  const codexRow = page.locator('.settings-provider').filter({ hasText: 'Codex' })

  await codexRow.getByRole('button', { name: 'Connect' }).click()
  await expect(codexRow).toContainText(
    'Codex CLI session is missing or expired. Run codex login, then reconnect.',
  )
  await codexRow.getByRole('button', { name: 'Connect' }).click()

  await expect(page.locator('.settings-modal')).toBeHidden()
  await page.locator('.titlebar .pill.icon-only').click()
  await expect(page.locator('.settings-provider').filter({ hasText: 'Codex' })).toContainText(
    'Connected',
  )
  await expect(page.locator('.settings-provider').filter({ hasText: 'Codex' })).toContainText(
    'CLI session',
  )

  const calls = await page.evaluate(
    () =>
      (
        window as Window & {
          __authCalls?: Array<{ command: string }>
        }
      ).__authCalls?.map((call) => call.command) ?? [],
  )

  expect(calls).not.toContain('create_terminal_session_with_command')
})

test('starts browser fallback without bundled project files', async ({ page }) => {
  await page.goto('/')

  const filesSection = page.locator('.sb-section').filter({ hasText: 'Files' })

  await expect(filesSection.getByText('OnboardingFunnel.tsx')).toHaveCount(0)
  await expect(filesSection.getByText('Open a real project folder in the desktop app.')).toBeVisible()
  await expect(page.locator('.group-tabbar').getByText('OnboardingFunnel.tsx')).toHaveCount(0)
})

test('renders Windows caption buttons when the OS override is windows', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as Window & { __GTUM_OS__?: string }).__GTUM_OS__ = 'windows'
  })
  await page.goto('/')

  await expect(page.locator('.titlebar.os-windows')).toBeVisible()
  await expect(page.locator('.win-controls .winbtn')).toHaveCount(3)
  await expect(page.locator('.win-controls .winbtn.close')).toHaveCount(1)
  await expect(page.locator('.traffic.mac')).toHaveCount(0)
})

test('renders macOS traffic lights when the OS override is mac', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as Window & { __GTUM_OS__?: string }).__GTUM_OS__ = 'mac'
  })
  await page.goto('/')

  await expect(page.locator('.titlebar.os-mac')).toBeVisible()
  await expect(page.locator('.traffic.mac .dot')).toHaveCount(3)
  await expect(page.locator('.win-controls')).toHaveCount(0)
})

test('collapses side panels responsively when the maximized window is narrow', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 })
  await page.goto('/')

  // Maximize so the window fills the stage at 1:1 — only then does the real
  // window width (here 900px) drive the responsive width class and auto-collapse.
  await page.getByLabel('Maximize').first().click()

  await expect(page.locator('.gtum-window')).toHaveClass(/w-sm/)
  await expect(page.locator('.body-grid')).toHaveClass(/sidebar-closed/)
  await expect(page.locator('.body-grid')).toHaveClass(/agent-closed/)
})

test('routes custom caption buttons to native window controls when available', async ({ page }) => {
  await page.addInitScript(() => {
    const events: string[] = []

    ;(window as Window & {
      __GTUM_OS__?: string
      __GTUM_WINDOW_EVENTS__?: string[]
      __GTUM_WINDOW_CONTROLS__?: unknown
    }).__GTUM_OS__ = 'windows'
    ;(window as Window & { __GTUM_WINDOW_EVENTS__?: string[] }).__GTUM_WINDOW_EVENTS__ = events
    ;(window as Window & { __GTUM_WINDOW_CONTROLS__?: unknown }).__GTUM_WINDOW_CONTROLS__ = {
      available: true,
      minimize: async () => events.push('minimize'),
      close: async () => events.push('close'),
      toggleMaximize: async () => events.push('toggleMaximize'),
      startDragging: async () => events.push('startDragging'),
    }
  })
  await page.goto('/')

  await page.getByLabel('Minimize').click()
  await page.getByLabel('Maximize').click()
  await expect(page.locator('.gtum-window')).toHaveClass(/is-max/)

  await page.getByLabel('Maximize').click()
  await expect(page.locator('.gtum-window')).not.toHaveClass(/is-max/)

  await page.getByLabel('Close').click()

  const events = await page.evaluate(() =>
    (window as Window & { __GTUM_WINDOW_EVENTS__?: string[] }).__GTUM_WINDOW_EVENTS__,
  )
  expect(events).toEqual(['minimize', 'toggleMaximize', 'toggleMaximize', 'close'])
})

test('routes frameless window edge resizing to native window controls', async ({ page }) => {
  await page.addInitScript(() => {
    const events: string[] = []

    ;(window as Window & {
      __GTUM_OS__?: string
      __GTUM_WINDOW_EVENTS__?: string[]
      __GTUM_WINDOW_CONTROLS__?: unknown
    }).__GTUM_OS__ = 'windows'
    ;(window as Window & { __GTUM_WINDOW_EVENTS__?: string[] }).__GTUM_WINDOW_EVENTS__ = events
    ;(window as Window & { __GTUM_WINDOW_CONTROLS__?: unknown }).__GTUM_WINDOW_CONTROLS__ = {
      available: true,
      minimize: async () => events.push('minimize'),
      close: async () => events.push('close'),
      toggleMaximize: async () => events.push('toggleMaximize'),
      startDragging: async () => events.push('startDragging'),
      startResizeDragging: async (direction: string) => events.push(`resize:${direction}`),
    }
  })
  await page.goto('/')

  await page.locator('.window-resize-zone.se').click({ position: { x: 2, y: 2 } })
  await page.locator('.window-resize-zone.w').click({ position: { x: 2, y: 12 } })

  const events = await page.evaluate(() =>
    (window as Window & { __GTUM_WINDOW_EVENTS__?: string[] }).__GTUM_WINDOW_EVENTS__,
  )
  expect(events).toEqual(['resize:SouthEast', 'resize:West'])
})

test('allows native frameless resize dragging in the Tauri capability manifest', async () => {
  expect(tauriDefaultPermissions()).toContain('core:window:allow-start-resize-dragging')
})

test('does not poll native maximized state from resize events', async ({ page }) => {
  await page.addInitScript(() => {
    const events: string[] = []

    ;(window as Window & {
      __GTUM_OS__?: string
      __GTUM_WINDOW_EVENTS__?: string[]
      __GTUM_WINDOW_CONTROLS__?: unknown
    }).__GTUM_OS__ = 'mac'
    ;(window as Window & { __GTUM_WINDOW_EVENTS__?: string[] }).__GTUM_WINDOW_EVENTS__ = events
    ;(window as Window & { __GTUM_WINDOW_CONTROLS__?: unknown }).__GTUM_WINDOW_CONTROLS__ = {
      available: true,
      minimize: async () => events.push('minimize'),
      close: async () => events.push('close'),
      toggleMaximize: async () => events.push('toggleMaximize'),
      startDragging: async () => events.push('startDragging'),
      isMaximized: async () => {
        events.push('isMaximized')
        return false
      },
      onResized: async (handler: () => void) => {
        events.push('onResized')
        handler()
        handler()

        return () => events.push('unlisten')
      },
    }
  })
  await page.goto('/')
  await expect(page.locator('.gtum-window')).toBeVisible()
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )

  const events = await page.evaluate(() =>
    (window as Window & { __GTUM_WINDOW_EVENTS__?: string[] }).__GTUM_WINDOW_EVENTS__,
  )
  expect(events).toEqual([])
})

test('starts native window dragging from the titlebar background only', async ({ page }) => {
  await page.addInitScript(() => {
    const events: string[] = []

    ;(window as Window & {
      __GTUM_OS__?: string
      __GTUM_WINDOW_EVENTS__?: string[]
      __GTUM_WINDOW_CONTROLS__?: unknown
    }).__GTUM_OS__ = 'windows'
    ;(window as Window & { __GTUM_WINDOW_EVENTS__?: string[] }).__GTUM_WINDOW_EVENTS__ = events
    ;(window as Window & { __GTUM_WINDOW_CONTROLS__?: unknown }).__GTUM_WINDOW_CONTROLS__ = {
      available: true,
      minimize: async () => events.push('minimize'),
      close: async () => events.push('close'),
      toggleMaximize: async () => events.push('toggleMaximize'),
      startDragging: async () => events.push('startDragging'),
    }
  })
  await page.goto('/')

  await page.getByLabel('Minimize').click()
  await page.locator('.titlebar.os-windows .title-left').click({ position: { x: 24, y: 12 } })

  const events = await page.evaluate(() =>
    (window as Window & { __GTUM_WINDOW_EVENTS__?: string[] }).__GTUM_WINDOW_EVENTS__,
  )
  expect(events).toEqual(['minimize', 'startDragging'])
})
