import { expect, test } from '@playwright/test'

test('manages terminal tabs and promotes active logs into the agent context panel', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('article').filter({ hasText: 'Start' }).getByRole('button', { name: 'Open Folder' }).click()

  await expect(page.getByTestId('terminal-workspace')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'workspace' })).toHaveAttribute('aria-selected', 'true')

  await page.getByTestId('terminal-workspace').getByRole('button', { name: '+ New Tab' }).click()
  await page.getByLabel('Active Tab Name').fill('qa-watch')
  await page.getByLabel('Active Tab Name').press('Enter')

  await expect(page.getByRole('tab', { name: 'qa-watch' })).toBeVisible()
  await expect(page.getByTestId('active-log-buffer')).toContainText('PS> Set-Location')

  await page.getByTestId('terminal-workspace').getByRole('button', { name: 'Pin Active Log' }).click()
  await expect(page.getByTestId('agent-context-buffer')).toContainText('PS> Set-Location')
  await expect(page.getByText('Daily-use Agent Context Ready')).toBeVisible()

  await page.getByRole('button', { name: 'Close qa-watch' }).click()
  await expect(page.getByRole('tab', { name: 'qa-watch' })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'workspace' })).toHaveAttribute('aria-selected', 'true')
})
