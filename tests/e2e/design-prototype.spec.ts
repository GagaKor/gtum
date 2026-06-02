import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

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

test('does not expose fixed Codex models or fake execution modes', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('.agent')).not.toContainText('GPT-5')
  await expect(page.locator('.agent')).not.toContainText('Fast')
  await expect(page.locator('.agent')).not.toContainText('Balanced')
  await expect(page.locator('.agent')).not.toContainText('Deep')
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
  await expect(settings).not.toContainText('Fast')
  await expect(settings).not.toContainText('Balanced')
  await expect(settings).not.toContainText('Deep')
})

test('uses runtime provider capabilities for the composer model picker', async ({ page }) => {
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

  await expect(page.locator('.composer-model-chip')).toContainText('GPT-5.5')
  await expect(page.locator('.composer-tool')).toHaveAttribute('title', /Image/)
  await page.locator('.composer-tool').click()
  await expect(page.locator('.composer-attachment-chip')).toContainText('screenshot.png')
  await page.locator('.composer-model-chip').click()
  await page.locator('.composer-model-option').filter({ hasText: 'GPT-5 Codex' }).click()
  await expect(page.locator('.composer-model-chip')).toContainText('GPT-5 Codex')

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
  expect(requestCall?.args?.request?.attachments).toEqual([
    {
      kind: 'image',
      path: '/tmp/screenshot.png',
      label: 'screenshot.png',
    },
  ])
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

test('persists runtime project opens without writing hidden execution mode', async ({ page }) => {
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
        'remember_workspace_project',
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
  const rememberCall = calls.find((call) => call.command === 'remember_workspace_project')

  expect(rememberCall?.args).toEqual({
    request: {
      path: '/workspace/gtum',
    },
  })
  expect(calls.map((call) => call.command)).not.toContain('set_workspace_execution_mode')
})

test('routes terminal tab lifecycle through the runtime PTY bridge', async ({ page }) => {
  await page.addInitScript(() => {
    const snapshot = {
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
            sessionId: 77,
            status: 'running',
            limit: 100,
            logLineCount: 1,
            truncated: false,
            entries: ['runtime ready'],
            updatedAt: 120,
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
})

test('routes agent requests through the Codex suggestion runtime bridge', async ({ page }) => {
  await page.addInitScript(() => {
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
  await expect(permissionPanel).toContainText('Always allow')
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
  await page.addInitScript(() => {
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
  await page.addInitScript(() => {
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
  await page.addInitScript(() => {
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
  await page.addInitScript(() => {
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
  await page.addInitScript(() => {
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
  await page.addInitScript(() => {
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

        return []
      },
    }
    bridgeWindow.__GTUM_PROJECT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async () => {
        throw new Error('project runtime should not be invoked before a real project is opened')
      },
    }
  })

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

test('does not use canned agent replies for deferred desktop providers', async ({ page }) => {
  await page.addInitScript(() => {
    const bridgeWindow = window as Window & {
      __GTUM_AGENT_AUTH_RUNTIME__?: unknown
      __GTUM_AGENT_RUNTIME__?: unknown
    }

    bridgeWindow.__GTUM_AGENT_AUTH_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async (command: string) => {
        const claudeConnection = {
          provider: 'claude',
          displayName: 'Claude',
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
      invokeRuntime: async () => {
        throw new Error('runtime should not be called for deferred providers')
      },
    }
  })

  await page.goto('/')
  await page.locator('.agent-provider-tab').filter({ hasText: 'Claude' }).click()
  await page.getByPlaceholder('Ask Codex').fill('test prompt')
  await page.locator('.composer-input .send').click()

  await expect(page.locator('.msg.assistant').last()).toContainText('Claude')
  await expect(page.locator('.msg.assistant').last()).toContainText('deferred')
  await expect(page.locator('.msg.assistant').last()).not.toContainText('useFunnelState')
})

test('keeps Codex command decisions in the agent panel without terminal execution', async ({ page }) => {
  await page.addInitScript(() => {
    const bridgeWindow = window as Window & {
      __agentCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __projectCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __terminalCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __GTUM_AGENT_RUNTIME__: unknown
      __GTUM_PROJECT_RUNTIME__: unknown
      __GTUM_TERMINAL_RUNTIME__: unknown
    }

    bridgeWindow.__agentCalls = []
    bridgeWindow.__projectCalls = []
    bridgeWindow.__terminalCalls = []
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
  })

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
  await expect(permissionPanel.getByRole('button', { name: 'Always allow' })).toBeVisible()
  await expect(permissionPanel.getByRole('button', { name: 'Deny' })).toBeVisible()
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
  await expect(page.locator('.composer-provider-chip')).toContainText('Codex')
  await expect(page.locator('.composer-provider-chip')).not.toContainText('gpt-5')
  await expect(page.locator('.composer-foot')).not.toContainText('Fast')
  await expect(page.locator('.composer-scope-chip')).toContainText('Project scope')
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
  await expect(page.locator('.msg.assistant').last()).toContainText(
    'Permission allowed once in the agent panel',
  )
  await expect(page.locator('.composer-approval')).toHaveCount(0)
  await expect(activityRow).toContainText('Allowed once')

  const terminalCalls = await page.evaluate(
    () =>
      (
        window as Window & {
          __terminalCalls?: Array<{ command: string; args?: Record<string, unknown> }>
        }
      ).__terminalCalls ?? [],
  )

  expect(terminalCalls).toEqual([])
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
