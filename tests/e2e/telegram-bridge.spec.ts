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

test('connects telegram, sends a report, and approves a remote command', async ({ page }) => {
  await page.goto('/?e2eMock=1')

  await setProjectPath(page, '/mock/demo-project')
  await page.getByRole('button', { name: 'Open Project' }).click()
  await page.getByRole('button', { name: 'Append Sample Log' }).click()
  await page.getByRole('button', { name: 'Use Active Log As Agent Context' }).click()

  const telegramPanel = page.getByTestId('telegram-bridge-panel')
  await page.getByRole('button', { name: 'Connect Telegram' }).click()
  await page.getByRole('button', { name: 'Complete Telegram Mock Link' }).click()

  await expect(telegramPanel).toContainText('@gtum_ops')
  await expect(telegramPanel).toContainText('Status: connected')

  await page.getByRole('button', { name: 'Send Status Report' }).click()
  await expect(telegramPanel).toContainText('Workspace report for demo-project')

  const remoteCommands = page.getByTestId('telegram-remote-commands-panel')
  await page.getByRole('button', { name: 'Queue /status' }).click()
  await expect(remoteCommands).toContainText('Remote /status request from Telegram')
  await remoteCommands.getByRole('button', { name: 'Approve In New Tab' }).click()

  await expect(page.getByRole('tab', { name: 'telegram-2' })).toBeVisible()
  await expect(page.getByRole('tabpanel')).toContainText('[telegram] git status --short')
  await expect(page.getByTestId('task-history-panel')).toContainText('Telegram command executed')
})
