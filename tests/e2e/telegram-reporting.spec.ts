import { expect, test } from '@playwright/test'

test('drafts and queues a telegram report from the current workspace', async ({ page }) => {
  await page.goto('/?e2eMock=1')

  await page.getByRole('article').filter({ hasText: 'Start' }).getByRole('button', { name: 'Open Folder' }).click()
  await page.getByRole('button', { name: 'Append Sample Log' }).click()
  await page.getByRole('button', { name: 'Use Active Log' }).click()
  await page.locator('summary', { hasText: 'Telegram' }).click()

  const telegramPanel = page.getByTestId('telegram-report-panel')
  await expect(telegramPanel).toContainText('Post-MVP Reporting Prototype')
  await expect(telegramPanel).toContainText('Status: idle')

  await page.getByRole('button', { name: 'Generate Telegram Draft' }).click()

  await expect(telegramPanel).toContainText('Status: draft-ready')
  await expect(page.getByTestId('telegram-report-preview')).toContainText('Telegram status report draft')
  await expect(page.getByTestId('telegram-report-preview')).toContainText('Project path: /mock/demo-project')

  await page.getByRole('button', { name: 'Queue Telegram Draft' }).click()

  await expect(telegramPanel).toContainText('Status: queued')
  await expect(telegramPanel).toContainText('Queued at')

  await page.reload()
  await page.locator('summary', { hasText: 'Telegram' }).click()

  await expect(page.getByTestId('telegram-report-panel')).toContainText('Status: queued')
  await expect(page.getByTestId('telegram-report-preview')).toContainText('/mock/demo-project')
})
