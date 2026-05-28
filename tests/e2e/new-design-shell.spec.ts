import { expect, test } from '@playwright/test'

test('renders the new product design shell', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTestId('app-titlebar')).toBeVisible()
  await expect(page.getByTestId('app-statusbar')).toBeVisible()
  await expect(page.getByTestId('left-projects-section')).toBeVisible()
  await expect(page.getByTestId('left-files-section')).toBeVisible()
  await expect(page.getByTestId('agent-model-row')).toBeVisible()
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
