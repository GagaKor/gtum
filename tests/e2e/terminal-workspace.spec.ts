import { expect, test } from '@playwright/test'

test('manages terminal tabs and promotes active logs into agent context', async ({ page }) => {
  await page.goto('/?e2eMock=1')

  await page.getByRole('article').filter({ hasText: 'Start' }).getByRole('button', { name: 'Open Folder' }).click()

  await expect(page.getByTestId('terminal-workspace')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'workspace' })).toHaveAttribute('aria-selected', 'true')

  await page.getByTestId('terminal-workspace').getByRole('button', { name: '+ New Tab' }).click()
  await page.getByLabel('Active Tab Name').fill('qa-watch')
  await page.getByLabel('Active Tab Name').press('Enter')

  await expect(page.getByRole('tab', { name: 'qa-watch' })).toBeVisible()

  await page.getByRole('button', { name: 'Append Sample Log' }).click()
  await expect(page.getByTestId('active-log-buffer')).toContainText('qa-watch: live log sample')

  await page.getByRole('button', { name: 'Use Active Log' }).click()
  await expect(page.getByTestId('agent-context-buffer')).toContainText('qa-watch')
  await expect(page.getByText('Sprint 2 Agent Context Ready')).toBeVisible()

  await page.getByRole('button', { name: 'Close qa-watch' }).click()
  await expect(page.getByRole('tab', { name: 'qa-watch' })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'workspace' })).toHaveAttribute('aria-selected', 'true')
})
