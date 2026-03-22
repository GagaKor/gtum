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

test('drafts and queues a telegram report from the current workspace', async ({ page }) => {
  await page.goto('/?e2eMock=1')

  await setProjectPath(page, '/mock/demo-project')
  await page.getByRole('button', { name: 'Open Project' }).click()
  await page.getByRole('button', { name: 'Append Sample Log' }).click()
  await page.getByRole('button', { name: 'Use Active Log As Agent Context' }).click()

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

  await expect(page.getByTestId('telegram-report-panel')).toContainText('Status: queued')
  await expect(page.getByTestId('telegram-report-preview')).toContainText('/mock/demo-project')
})
