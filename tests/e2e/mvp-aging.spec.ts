import { expect, test } from '@playwright/test'

test('repeats the core MVP flow and restores workspace state after reload', async ({ page }) => {
  await page.goto('/?e2eMock=1')

  await page.getByRole('article').filter({ hasText: 'Start' }).getByRole('button', { name: 'Open Folder' }).click()
  await page.getByRole('button', { name: 'Connect Codex' }).click()
  await page.getByRole('button', { name: 'Complete Mock Callback' }).dispatchEvent('click')

  const modes = ['Fast', 'Balanced', 'Deep'] as const

  for (const mode of modes) {
    await page.getByRole('radio', { name: mode }).check()
    await page.getByRole('button', { name: 'Append Sample Log' }).click()
    await page
      .getByTestId('terminal-workspace')
      .getByRole('button', { name: /Use Active Log|Refresh Agent Context/ })
      .click()
    await page.getByLabel('Task Request').fill(`repeat ${mode.toLowerCase()} review`)
    await page.getByRole('button', { name: 'Request Suggestion' }).click()

    const suggestionCard = page.getByTestId('suggestion-card-codex').first()
    await expect(suggestionCard).toContainText('Status: pending')
    await suggestionCard.getByRole('button', { name: 'Approve In Current Tab' }).click()
    await expect(suggestionCard).toContainText('Status: approved-current-tab')
  }

  const taskHistory = page.getByTestId('task-history-panel')
  await page.locator('summary', { hasText: 'Task History' }).click()
  await expect(taskHistory).toContainText('Recent Activity')
  await expect(taskHistory).toContainText('mode Deep')

  await page.reload()

  await expect(page.getByText('/mock/demo-project', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Deep' })).toBeChecked()
  await expect(page.getByRole('tab', { name: 'workspace' })).toBeVisible()
  await page.locator('summary', { hasText: 'Task History' }).click()
  await expect(page.getByTestId('task-history-panel')).toContainText('Recent Activity')
})
