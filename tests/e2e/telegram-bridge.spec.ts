import { expect, test } from '@playwright/test'

test('connects telegram, sends a report, and approves a remote command', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('article').filter({ hasText: 'Start' }).getByRole('button', { name: 'Open Folder' }).click()
  await page.locator('summary', { hasText: 'Telegram' }).click()

  const telegramPanel = page.getByTestId('telegram-bridge-panel')
  await page.getByRole('button', { name: 'Connect Telegram' }).click()

  await expect(telegramPanel).toContainText('@gtum_preview')
  await expect(telegramPanel).toContainText('Status: connected')

  await page.getByRole('button', { name: 'Send Status Report' }).click()
  await expect(telegramPanel).toContainText('Workspace report for demo-project')

  const remoteCommands = page.getByTestId('telegram-remote-commands-panel')
  await page.getByRole('button', { name: 'Queue /status' }).click()
  await expect(remoteCommands).toContainText('Remote /status request from Telegram')
  await remoteCommands.getByRole('button', { name: 'Approve In New Tab' }).click()

  await expect(page.getByRole('tab', { name: 'telegram-2' })).toBeVisible()
  await expect(page.getByRole('tabpanel')).toContainText('PS> git status --short')
  await page.locator('summary', { hasText: 'Task History' }).click()
  await expect(page.getByTestId('task-history-panel')).toContainText('Telegram command executed')
})
