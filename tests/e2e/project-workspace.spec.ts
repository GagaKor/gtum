import { expect, test } from '@playwright/test'

test('opens a project path and shows repository context', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('article').filter({ hasText: 'Start' }).getByRole('button', { name: 'Open Folder' }).click()

  const recentProjects = page.getByRole('article').filter({ hasText: 'Recent Projects' })
  const fileTree = page.getByRole('article').filter({ hasText: 'File Tree' })
  const codeViewer = page.getByTestId('code-viewer')

  await expect(page.getByText('Project: demo-project', { exact: true })).toBeVisible()
  await expect(page.getByText('feature/windows-real-use • Dirty', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('C:/Users/demo/demo-project', { exact: true }).first()).toBeVisible()
  await expect(recentProjects.getByRole('button', { name: 'C:/Users/demo/demo-project' })).toBeVisible()
  await expect(fileTree.getByText('package.json', { exact: true })).toBeVisible()
  await expect(fileTree.getByText('src', { exact: true })).toBeVisible()
  await expect(page.getByTestId('terminal-workspace')).toBeVisible()
  await expect(page.getByTestId('provider-auth-panel')).toBeVisible()
  await expect(codeViewer).toContainText('src/App.tsx')
  await page.getByTestId('terminal-reference-1').click()
  await expect(page.getByTestId('code-anchor-pill')).toContainText('Anchor: L4')
  await expect(codeViewer).toContainText('src/App.tsx:L4')

  await fileTree.getByRole('button', { name: 'package.json' }).click()

  await expect(codeViewer).toContainText('package.json')
  await expect(codeViewer).toContainText('"name": "demo-project"')
  await expect(codeViewer).toContainText('"build": "tsc && vite build"')
  await expect(page.getByTestId('code-anchor-pill')).toContainText('No Anchor')

  await fileTree.getByRole('button', { name: 'build-output.log' }).click()
  await expect(codeViewer).toContainText('logs/build-output.log')
  await expect(codeViewer).toContainText('Preview Truncated')

  await fileTree.getByRole('button', { name: 'demo.bin' }).click()
  await expect(codeViewer).toContainText('assets/demo.bin')
  await expect(codeViewer).toContainText('Binary preview unavailable')
})

test('opens a project using the folder picker fallback in preview contract mode', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('article').filter({ hasText: 'Start' }).getByRole('button', { name: 'Open Folder' }).click()

  await expect(page.getByText('feature/windows-real-use • Dirty', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('C:/Users/demo/demo-project', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'C:/Users/demo/demo-project' })).toBeVisible()
})
