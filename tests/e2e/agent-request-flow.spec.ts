import { expect, test } from '@playwright/test'

test('requests a Codex suggestion and approves it in a new terminal tab', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('article').filter({ hasText: 'Start' }).getByRole('button', { name: 'Open Folder' }).click()
  await page.getByRole('button', { name: 'Connect Codex' }).click()

  await page.getByLabel('Task Request').fill('rerun tests with a focused command')
  await page.getByRole('button', { name: 'Ask Codex' }).click()

  const suggestionCard = page.getByTestId('suggestion-card-codex')
  await expect(suggestionCard).toContainText('npm run test -- --runInBand')
  await expect(suggestionCard).toContainText('Status: pending')

  await suggestionCard.getByRole('button', { name: 'Approve In New Tab' }).click()

  await expect(suggestionCard).toContainText('Status: approved-new-tab')
  await expect(page.getByRole('tab', { name: 'agent-codex-2' })).toBeVisible()
  await expect(page.getByRole('tabpanel')).toContainText('PS> npm run test -- --runInBand')
})
