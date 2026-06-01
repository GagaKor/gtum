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
  await expect(titlebar).toContainText('aurora-monorepo')
  await expect(titlebar).toContainText('feature/onboarding-funnel')
  await expect(titlebar).toContainText('[backend]')
  await expect(titlebar).toContainText('라이브 · 1 활성 에이전트')

  await expect(statusbar).toContainText('준비됨')
  await expect(statusbar).toContainText('feature/onboarding-funnel')
  await expect(statusbar).toContainText('7 변경')
  await expect(statusbar).toContainText('↑3 ↓0')
  await expect(statusbar).toContainText('5 터미널 탭 · 2 그룹 · 2 실패 · 2 실행 중')
  await expect(statusbar).toContainText('모드: Balanced')
  await expect(statusbar).toContainText('Cmd+K로 명령 팔레트')

  await titlebar.locator('.pill.icon-only').click()
  await expect(page.locator('.settings-modal')).toBeVisible()
})

test('preserves prototype interactions without legacy frontend state', async ({ page }) => {
  await page.goto('/')

  const projectsSection = page.locator('.sb-section').filter({ hasText: '프로젝트' })
  const filesSection = page.locator('.sb-section').filter({ hasText: '파일' })

  await expect(projectsSection.getByText('aurora-monorepo')).toBeVisible()
  await expect(filesSection.getByText('OnboardingFunnel.tsx')).toBeVisible()

  await projectsSection.locator('.sb-section-h').click()
  await expect(projectsSection.getByText('aurora-monorepo')).toBeHidden()
  await expect(filesSection.getByText('OnboardingFunnel.tsx')).toBeVisible()
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
  expect(bridge.projectPath).toContain('aurora-monorepo')

  await page.locator('.project-item.action').click()
  await expect(page.locator('.titlebar').getByText('aurora-monorepo')).toBeVisible()
})

test('routes terminal tab lifecycle through the runtime PTY bridge', async ({ page }) => {
  await page.addInitScript(() => {
    const snapshot = {
      sessionId: 77,
      name: '새 탭',
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
      __terminalCalls: Array<{ command: string; args?: Record<string, unknown> }>
      __GTUM_TERMINAL_RUNTIME__: unknown
    }

    bridgeWindow.__terminalCalls = []
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
  await page.getByText('프로젝트 폴더 열기').click()
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

  await page.getByPlaceholder('에이전트에게 질문하기').fill('테스트 다시 실행해줘')
  await page.locator('.composer-input .send').click()

  await expect(page.locator('.sugg').last()).toContainText('Run the failing funnel test')
  await expect(page.locator('.sugg').last()).toContainText('pnpm test:funnel --reporter=verbose')

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
    activeTabId: 't-backend',
    activeTabTitle: 'backend',
    executionMode: 'balanced',
    userTask: '테스트 다시 실행해줘',
  })
  expect(requestCall?.args?.request?.lastNLogLines).toContain(
    'Error: listen EADDRINUSE: address already in use :::3001',
  )
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
      projectPath: '~/code/aurora-monorepo',
    })

  const initialSuggestionCount = await page.locator('.sugg').count()

  await page.getByPlaceholder('에이전트에게 질문하기').fill('테스트 다시 실행해줘')
  await page.locator('.composer-input .send').click()

  await expect(page.locator('.msg.assistant').last()).toContainText('프로젝트')
  await expect(page.locator('.msg.assistant').last()).toContainText('로컬 폴더')
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
    ;(window as Window & {
      __GTUM_AGENT_RUNTIME__?: unknown
    }).__GTUM_AGENT_RUNTIME__ = {
      hasRuntime: () => true,
      invokeRuntime: async () => {
        throw new Error('runtime should not be called for deferred providers')
      },
    }
  })

  await page.goto('/')
  await page.locator('.model-picker-btn').click()
  await page.locator('.model-picker-item').filter({ hasText: 'Claude Sonnet' }).click()
  await page.getByPlaceholder('에이전트에게 질문하기').fill('테스트 다시 실행해줘')
  await page.locator('.composer-input .send').click()

  await expect(page.locator('.msg.assistant').last()).toContainText('Claude')
  await expect(page.locator('.msg.assistant').last()).toContainText('보류')
  await expect(page.locator('.msg.assistant').last()).not.toContainText('useFunnelState')
})

test('runs approved Codex commands in a real PTY when the suggested target is a mock tab', async ({ page }) => {
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

  await page.goto('/')
  await page.getByText('프로젝트 폴더 열기').click()
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

  await page.getByPlaceholder('에이전트에게 질문하기').fill('테스트 다시 실행해줘')
  await page.locator('.composer-input .send').click()
  await expect(page.locator('.sugg').last()).toContainText('Run the current tab test command')

  await page.locator('.sugg').last().getByRole('button', { name: '검토' }).click()
  await expect(page.locator('.modal')).toBeVisible()
  await page.locator('.modal-foot').getByRole('button', { name: '승인' }).click()

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
    .toContain('create_terminal_session_with_command')

  const terminalCalls = await page.evaluate(
    () =>
      (
        window as Window & {
          __terminalCalls?: Array<{ command: string; args?: Record<string, unknown> }>
        }
      ).__terminalCalls ?? [],
  )
  const runCall = terminalCalls.find((call) => call.command === 'create_terminal_session_with_command')

  expect(runCall?.args).toMatchObject({
    request: {
      command: 'pnpm test:funnel --reporter=verbose',
    },
  })
})

test('launches Codex CLI login from settings through the auth runtime bridge', async ({ page }) => {
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
    const loginTerminal = {
      sessionId: 88,
      name: 'Codex Login',
      cwd: '/workspace/project',
      shell: '/bin/zsh',
      shellArgs: ['-i'],
      processId: 9088,
      status: 'running',
      createdAt: 100,
      updatedAt: 120,
      exitCode: null,
      logLineCount: 1,
      maxLogEntries: 400,
      lastEvent: 'session created',
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
        if (command === 'begin_agent_login') return codexConnected
        if (command === 'create_terminal_session_with_command') return loginTerminal
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
    .getByRole('button', { name: '연결' })
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
        'create_terminal_session_with_command',
        'begin_agent_login',
      ]),
    )

  await expect(page.locator('.group-tabbar.active')).toContainText('Codex Login')

  const calls = await page.evaluate(
    () =>
      (
        window as Window & {
          __authCalls?: Array<{ command: string; args?: Record<string, unknown> }>
        }
      ).__authCalls ?? [],
  )
  const loginLaunch = calls.find((call) => call.command === 'create_terminal_session_with_command')

  expect(loginLaunch?.args).toMatchObject({
    request: {
      session: {
        name: 'Codex Login',
        cwd: '~/code/aurora-monorepo',
      },
      command: 'codex login --device-auth',
    },
  })
})

test('keeps rich prototype file content when browser fallback opens a file', async ({ page }) => {
  await page.goto('/')

  const filesSection = page.locator('.sb-section').filter({ hasText: '파일' })

  await filesSection.getByText('OnboardingFunnel.tsx').click()

  await expect(page.locator('.group-tabbar').getByText('OnboardingFunnel.tsx')).toBeVisible()
  await expect(page.locator('.editor-code')).toContainText('export function OnboardingFunnel')
  await expect(page.locator('.editor-code')).not.toContainText(
    'Browser preview is using bundled project data',
  )
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
