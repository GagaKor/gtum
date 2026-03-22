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

test('starts provider login and completes mock callback', async ({ page }) => {
  await page.goto('/?e2eMock=1')

  await setProjectPath(page, '/mock/demo-project')
  await page.getByRole('button', { name: 'Open Project' }).click()
  await page.getByRole('button', { name: 'Append Sample Log' }).click()
  await page.getByRole('button', { name: 'Use Active Log As Agent Context' }).click()

  const providerPanel = page.getByTestId('provider-auth-panel')
  await expect(providerPanel).toContainText('Codex')
  await page.getByRole('radio', { name: 'Codex' }).check()
  await expect(page.getByTestId('provider-card-codex')).toContainText(
    'Selected provider for the next auth action.',
  )

  await page.getByRole('button', { name: 'Connect Codex' }).click()
  await expect(providerPanel).toContainText('pending')
  await expect(providerPanel).toContainText('project:read, terminal:read')

  await page.getByRole('button', { name: 'Complete Mock Callback' }).dispatchEvent('click')

  await expect(providerPanel).toContainText('connected')
  await expect(providerPanel).toContainText('codex sandbox')
  await expect(page.getByTestId('provider-request-preview')).toContainText('workspace')
  await expect(page.getByTestId('provider-request-preview')).toContainText(
    'captured line(s) prepared for provider requests',
  )
})

test('shows provider login failure state for Claude mock callback', async ({ page }) => {
  await page.goto('/?e2eMock=1&authMock=claude-fail')

  await setProjectPath(page, '/mock/demo-project')
  await page.getByRole('button', { name: 'Open Project' }).click()

  const providerPanel = page.getByTestId('provider-auth-panel')
  await page.getByRole('radio', { name: 'Claude' }).check()
  await expect(page.getByTestId('provider-card-claude')).toContainText(
    'Selected provider for the next auth action.',
  )

  await page.getByRole('button', { name: 'Connect Claude' }).click()
  await expect(providerPanel).toContainText('pending')

  await page.getByRole('button', { name: 'Complete Mock Callback' }).dispatchEvent('click')

  await expect(page.getByTestId('provider-card-claude')).toContainText('error')
  await expect(page.getByTestId('provider-card-claude')).toContainText(
    'claude mock callback failed.',
  )
  await expect(page.getByText('Sprint 4 Claude login failed')).toBeVisible()
})
