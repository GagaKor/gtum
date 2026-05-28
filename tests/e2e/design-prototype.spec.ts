import { expect, test } from '@playwright/test'

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
