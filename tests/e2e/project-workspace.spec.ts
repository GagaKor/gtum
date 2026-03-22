import { expect, test, type Page } from '@playwright/test'

async function setProjectPath(page: Page, value: string) {
  await page.getByLabel('Project Path').evaluate((element, nextValue) => {
    const input = element as HTMLInputElement
    const descriptor = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )

    descriptor?.set?.call(input, nextValue)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

test('opens a project path and shows repository context', async ({ page }) => {
  await page.goto('/?e2eMock=1')

  await setProjectPath(page, '/mock/demo-project')
  await page.getByRole('button', { name: 'Open Project' }).click()

  const projectMetadata = page.getByRole('article').filter({ hasText: 'Project Metadata' })
  const recentProjects = page.getByRole('article').filter({ hasText: 'Recent Projects' })
  const fileTree = page.getByRole('article').filter({ hasText: 'File Tree' })

  await expect(page.getByText('feature/mock-project-open • Dirty')).toBeVisible()
  await expect(projectMetadata.getByText('/mock/demo-project')).toBeVisible()
  await expect(recentProjects.getByRole('button', { name: '/mock/demo-project' })).toBeVisible()
  await expect(fileTree.getByText('package.json', { exact: true })).toBeVisible()
  await expect(fileTree.getByText('src', { exact: true })).toBeVisible()
})
