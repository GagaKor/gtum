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

test('requests an agent suggestion and approves it in a new terminal tab', async ({ page }) => {
  await page.goto('/?e2eMock=1')

  await setProjectPath(page, '/mock/demo-project')
  await page.getByRole('button', { name: 'Open Project' }).click()
  await page.getByRole('button', { name: 'Connect Codex' }).click()
  await page.getByRole('button', { name: 'Complete Mock Callback' }).dispatchEvent('click')

  await page.getByRole('button', { name: 'Append Sample Log' }).click()
  await page.getByRole('button', { name: 'Use Active Log As Agent Context' }).click()

  await page.getByLabel('Task Request').fill('rerun tests with a focused command')
  await page.getByRole('button', { name: 'Request Suggestion' }).click()

  const suggestionCard = page.getByTestId('suggestion-card-codex')
  await expect(suggestionCard).toContainText('npm run test -- --runInBand')
  await expect(suggestionCard).toContainText('Status: pending')

  await suggestionCard.getByRole('button', { name: 'Approve In New Tab' }).click()

  await expect(suggestionCard).toContainText('Status: approved-new-tab')
  await expect(page.getByRole('tab', { name: 'agent-codex-2' })).toBeVisible()
  await expect(page.getByRole('tabpanel')).toContainText('[agent:codex] npm run test -- --runInBand')
})
