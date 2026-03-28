import { expect, test } from '@playwright/test'

test('connects the real Codex-first preview path', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('article').filter({ hasText: 'Start' }).getByRole('button', { name: 'Open Folder' }).click()

  await expect(page.getByTestId('provider-card-codex')).toContainText('Real')
  await page.getByRole('radio', { name: 'Codex' }).check()
  await expect(page.getByTestId('provider-card-codex')).toContainText(
    'Selected provider for the next request.',
  )

  await page.getByRole('button', { name: 'Connect Codex' }).click()
  await expect(page.getByTestId('provider-card-codex')).toContainText('Connected')
  await expect(page.getByTestId('provider-card-codex')).toContainText('Codex Windows Preview')
  await expect(page.getByTestId('provider-card-codex')).toContainText('project:read, terminal:read')
  await expect(page.getByTestId('provider-request-preview')).toContainText('workspace')
  await expect(page.getByTestId('provider-request-preview')).toContainText(
    'active log line(s) prepared for the provider request',
  )
})

test('shows provider error state for deferred Claude support', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('article').filter({ hasText: 'Start' }).getByRole('button', { name: 'Open Folder' }).click()

  await page.getByRole('radio', { name: 'Claude' }).check()
  await expect(page.getByTestId('provider-card-claude')).toContainText('Prototype')
  await expect(page.getByTestId('provider-card-claude')).toContainText(
    'Selected provider for the next request.',
  )

  await page.getByRole('button', { name: 'Connect Claude' }).click()

  await expect(page.getByTestId('provider-card-claude')).toContainText('Attention Needed')
  await expect(page.getByTestId('provider-card-claude')).toContainText(
    'Claude real-provider support is deferred for the first daily-use release.',
  )
  await expect(page.getByText('Daily-use Claude connection blocked')).toBeVisible()
})
