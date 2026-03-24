import { expect, test } from '@playwright/test'

test('starts provider login and completes mock callback', async ({ page }) => {
  await page.goto('/?e2eMock=1')

  await page.getByRole('article').filter({ hasText: 'Start' }).getByRole('button', { name: 'Open Folder' }).click()
  await page.getByRole('button', { name: 'Append Sample Log' }).click()
  await page.getByRole('button', { name: 'Use Active Log' }).click()

  await expect(page.getByTestId('provider-card-codex')).toContainText('Mock')
  await page.getByRole('radio', { name: 'Codex' }).check()
  await expect(page.getByTestId('provider-card-codex')).toContainText(
    'Selected provider for the next request.',
  )

  await page.getByRole('button', { name: 'Connect Codex' }).click()
  await expect(page.getByTestId('provider-card-codex')).toContainText('Needs Approval')
  await expect(page.getByTestId('provider-card-codex')).toContainText('project:read, terminal:read')

  await page.getByRole('button', { name: 'Complete Mock Callback' }).dispatchEvent('click')

  await expect(page.getByTestId('provider-card-codex')).toContainText('Connected')
  await expect(page.getByTestId('provider-card-codex')).toContainText('codex sandbox')
  await expect(page.getByTestId('provider-card-codex').locator('code').first()).toBeHidden()
  await expect(page.getByTestId('provider-request-preview')).toContainText('workspace')
  await expect(page.getByTestId('provider-request-preview')).toContainText(
    'captured line(s) prepared for provider requests',
  )
})

test('shows provider login failure state for Claude mock callback', async ({ page }) => {
  await page.goto('/?e2eMock=1&authMock=claude-fail')

  await page.getByRole('article').filter({ hasText: 'Start' }).getByRole('button', { name: 'Open Folder' }).click()

  await page.getByRole('radio', { name: 'Claude' }).check()
  await expect(page.getByTestId('provider-card-claude')).toContainText('Mock')
  await expect(page.getByTestId('provider-card-claude')).toContainText(
    'Selected provider for the next request.',
  )

  await page.getByRole('button', { name: 'Connect Claude' }).click()
  await expect(page.getByTestId('provider-card-claude')).toContainText('Needs Approval')

  await page.getByRole('button', { name: 'Complete Mock Callback' }).dispatchEvent('click')

  await expect(page.getByTestId('provider-card-claude')).toContainText('Attention Needed')
  await expect(page.getByTestId('provider-card-claude')).toContainText(
    'claude mock callback failed.',
  )
  await expect(page.getByText('Sprint 4 Claude login failed')).toBeVisible()
})
