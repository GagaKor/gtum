import { expect, test } from '@playwright/test'

test('renders the new product design shell', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('gtum-window')).toBeVisible()
  await expect(page.getByTestId('app-titlebar')).toBeVisible()
  await expect(page.getByTestId('app-statusbar')).toBeVisible()
  await expect(page.getByTestId('left-projects-section')).toBeVisible()
  await expect(page.getByTestId('left-files-section')).toBeVisible()
  await expect(page.getByTestId('agent-model-row')).toBeVisible()
})

test('keeps the reference draft window proportions', async ({ page }) => {
  await page.goto('/')

  const windowBox = await page.getByTestId('gtum-window').boundingBox()
  const titlebarBox = await page.getByTestId('app-titlebar').boundingBox()
  const leftBox = await page.getByTestId('left-dock').boundingBox()
  const rightBox = await page.locator('.right-dock').boundingBox()
  const activityRailCount = await page.locator('.activity-rail').count()
  const scale = await page.evaluate(() => {
    const scaler = document.querySelector<HTMLElement>('.gtum-scaler')
    const value = scaler ? window.getComputedStyle(scaler).getPropertyValue('--scale') : '1'

    return Number.parseFloat(value) || 1
  })

  expect(windowBox).not.toBeNull()
  expect(titlebarBox).not.toBeNull()
  expect(leftBox).not.toBeNull()
  expect(rightBox).not.toBeNull()

  expect(windowBox!.width / scale).toBeLessThanOrEqual(1320)
  expect(windowBox!.height / scale).toBeLessThanOrEqual(824)
  expect(titlebarBox!.height / scale).toBeLessThanOrEqual(48)
  expect(leftBox!.width / scale).toBeLessThanOrEqual(276)
  expect(rightBox!.width / scale).toBeGreaterThanOrEqual(360)
  expect(activityRailCount).toBe(0)
})

test('collapses projects and files sections independently', async ({ page }) => {
  await page.goto('/')

  const projects = page.getByTestId('left-projects-section')
  const files = page.getByTestId('left-files-section')

  await expect(projects.getByRole('button', { name: 'Open Folder' })).toBeVisible()
  await expect(files.getByText('File Tree')).toBeVisible()

  await projects.getByRole('button', { name: 'Projects' }).click()
  await expect(projects.getByRole('button', { name: 'Open Folder' })).toBeHidden()
  await expect(files.getByText('File Tree')).toBeVisible()

  await files.getByRole('button', { name: 'Files' }).click()
  await expect(files.getByText('File Tree')).toBeHidden()
  await expect(projects.getByRole('button', { name: 'Open Folder' })).toBeHidden()
})
