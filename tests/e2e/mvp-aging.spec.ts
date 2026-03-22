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

test('repeats the core MVP flow and restores workspace state after reload', async ({ page }) => {
  await page.goto('/?e2eMock=1')

  await setProjectPath(page, '/mock/demo-project')
  await page.getByRole('button', { name: 'Open Project' }).click()
  await page.getByRole('button', { name: 'Connect Codex' }).click()
  await page.getByRole('button', { name: 'Complete Mock Callback' }).dispatchEvent('click')

  const modes = ['Fast', 'Balanced', 'Deep'] as const

  for (const mode of modes) {
    await page.getByRole('radio', { name: mode }).check()
    await page.getByRole('button', { name: 'Append Sample Log' }).click()
    await page.getByRole('button', { name: 'Use Active Log As Agent Context' }).click()
    await page.getByLabel('Task Request').fill(`repeat ${mode.toLowerCase()} review`)
    await page.getByRole('button', { name: 'Request Suggestion' }).click()

    const suggestionCard = page.getByTestId('suggestion-card-codex').first()
    await expect(suggestionCard).toContainText('Status: pending')
    await suggestionCard.getByRole('button', { name: 'Approve In Current Tab' }).click()
    await expect(suggestionCard).toContainText('Status: approved-current-tab')
  }

  const taskHistory = page.getByTestId('task-history-panel')
  await expect(taskHistory).toContainText('Recent Activity')
  await expect(taskHistory).toContainText('mode Deep')

  await page.reload()

  await expect(
    page.getByRole('article').filter({ hasText: 'Project Metadata' }).first(),
  ).toContainText('/mock/demo-project')
  await expect(page.getByRole('radio', { name: 'Deep' })).toBeChecked()
  await expect(page.getByRole('tab', { name: 'workspace' })).toBeVisible()
  await expect(page.getByTestId('task-history-panel')).toContainText('Recent Activity')
})
