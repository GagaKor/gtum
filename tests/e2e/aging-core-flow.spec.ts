import { expect, test, type Page } from '@playwright/test'

async function ensureCodexConnected(page: Page) {
  const disconnectButton = page.getByRole('button', { name: 'Disconnect Codex' })

  if ((await disconnectButton.count()) > 0) {
    return
  }

  await page.getByRole('radio', { name: 'Codex' }).check()
  await page.getByRole('button', { name: 'Connect Codex' }).click()
  await expect(page.getByTestId('provider-card-codex')).toContainText('Connected')
}

async function runCoreFlow(page: Page, iteration: number) {
  await page.getByLabel('Task Request').fill(`repeat sprint flow iteration ${iteration}`)
  await page.getByRole('button', { name: 'Ask Codex' }).click()

  const suggestion = page.getByTestId('suggestion-card-codex').first()
  await suggestion.getByRole('button', { name: 'Approve In Current Tab' }).click()

  await expect(suggestion).toContainText('approved-current-tab')
  await expect(page.getByRole('tabpanel')).toContainText('PS> npm run test -- --runInBand')
}

test('repeats the core workspace flow across reloads with restored state', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('radio', { name: 'Deep' }).check()
  await page.getByRole('article').filter({ hasText: 'Start' }).getByRole('button', { name: 'Open Folder' }).click()
  await ensureCodexConnected(page)

  for (const iteration of [1, 2, 3]) {
    if (iteration > 1) {
      await page.reload()
      await expect(page.getByTestId('execution-mode-panel')).toContainText('Deep')
      await expect(page.getByText('C:/Users/demo/demo-project', { exact: true }).first()).toBeVisible()
      await ensureCodexConnected(page)
    }

    await runCoreFlow(page, iteration)
  }

  const historyPanel = page.getByTestId('task-history-panel')
  await page.locator('summary', { hasText: 'Task History' }).click()
  await expect(historyPanel).toContainText('Project opened')
  await expect(historyPanel).toContainText('Codex connected')
  await expect(historyPanel).toContainText('Codex suggestion approved')
})
