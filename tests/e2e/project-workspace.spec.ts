import { expect, test } from '@playwright/test'

test('opens a project path and shows repository context', async ({ page }) => {
  await page.goto('/?e2eMock=1')

  await page.getByRole('button', { name: 'Open Folder' }).click()

  const projectMetadata = page.getByRole('article').filter({ hasText: 'Project Summary' })
  const recentProjects = page.getByRole('article').filter({ hasText: 'Recent Projects' })
  const fileTree = page.getByRole('article').filter({ hasText: 'File Tree' })

  await expect(projectMetadata.getByText('feature/mock-project-open • Dirty')).toBeVisible()
  await expect(projectMetadata.getByText('/mock/demo-project')).toBeVisible()
  await expect(recentProjects.getByRole('button', { name: '/mock/demo-project' })).toBeVisible()
  await expect(fileTree.getByText('package.json', { exact: true })).toBeVisible()
  await expect(fileTree.getByText('src', { exact: true })).toBeVisible()
})

test('opens a project using the folder picker fallback in mock mode', async ({ page }) => {
  await page.goto('/?e2eMock=1')

  await page.getByRole('button', { name: 'Open Folder' }).click()

  const projectMetadata = page.getByRole('article').filter({ hasText: 'Project Summary' })

  await expect(projectMetadata.getByText('feature/mock-project-open • Dirty')).toBeVisible()
  await expect(projectMetadata.getByText('/mock/demo-project')).toBeVisible()
  await expect(page.getByRole('button', { name: '/mock/demo-project' })).toBeVisible()
})
