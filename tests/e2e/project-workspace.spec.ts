import { expect, test } from '@playwright/test'

test('opens a project path and shows repository context', async ({ page }) => {
  await page.goto('/?e2eMock=1')

  await page.getByLabel('Project Path').fill('/mock/demo-project')
  await page.getByRole('button', { name: 'Open Project' }).click()

  const projectMetadata = page.getByRole('article').filter({ hasText: 'Project Metadata' })
  const recentProjects = page.getByRole('article').filter({ hasText: 'Recent Projects' })

  await expect(page.getByText('feature/mock-project-open • Dirty')).toBeVisible()
  await expect(projectMetadata.getByText('/mock/demo-project')).toBeVisible()
  await expect(recentProjects.getByRole('button', { name: '/mock/demo-project' })).toBeVisible()
  await expect(page.getByText('package.json')).toBeVisible()
  await expect(page.getByText('src')).toBeVisible()
})
