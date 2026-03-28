import { expect, test } from '@playwright/test'

test('connects the real Codex-first preview path', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('article').filter({ hasText: 'Start' }).getByRole('button', { name: 'Open Folder' }).click()

  await expect(page.getByTestId('provider-card-codex')).toContainText('Real')
  await page.getByRole('radio', { name: 'Codex' }).check()
  await expect(page.getByTestId('provider-card-codex')).toContainText(
    'Selected provider for the next request.',
  )

  await page.getByTestId('provider-action-codex').click()
  await expect(page.getByTestId('provider-card-codex')).toContainText('Connected')
  await expect(page.getByTestId('provider-card-codex')).toContainText('Codex Windows Preview')
  await expect(page.getByTestId('provider-card-codex')).toContainText('project:read, terminal:read')
  await page.getByTestId('provider-diagnostics-codex').locator('summary').click()
  await expect(page.getByTestId('provider-diagnostics-codex')).toContainText(
    'Previewed env-backed OpenAI Responses API bridge',
  )
  await expect(page.getByTestId('provider-diagnostics-codex')).toContainText('Ready')
  await expect(page.getByTestId('provider-diagnostics-codex')).toContainText('OPENAI_API_KEY')
  await expect(page.getByTestId('provider-diagnostics-codex')).toContainText('gpt-5.3-codex')
  await expect(page.getByTestId('provider-diagnostics-codex')).toContainText('base URL: https://api.openai.com/v1')
  await expect(page.getByTestId('provider-diagnostics-codex')).not.toContainText('gtum://auth/callback')
  await expect(page.getByTestId('provider-request-preview')).toContainText('workspace')
  await expect(page.getByTestId('provider-request-preview')).toContainText(
    'active log line(s) prepared for the provider request',
  )

  await page.getByTestId('provider-action-codex').click()
  await expect(page.getByTestId('provider-card-codex')).toContainText('Needs Connection')
  await expect(page.getByTestId('provider-card-codex')).toContainText(
    'Connect this provider to validate desktop Codex access before the first suggestion request.',
  )
  await expect(page.getByTestId('agent-request-panel')).toContainText(
    'Connect Codex after the desktop provider setup is ready, then use the validated request flow.',
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

  await page.getByTestId('provider-action-claude').click()

  await expect(page.getByTestId('provider-card-claude')).toContainText('Attention Needed')
  await expect(page.getByTestId('provider-card-claude')).toContainText(
    'Claude real-provider support is deferred for the first daily-use release.',
  )
  await page.getByTestId('provider-diagnostics-claude').locator('summary').click()
  await expect(page.getByTestId('provider-diagnostics-claude')).toContainText(
    'Deferred real-provider path',
  )
  await expect(page.getByTestId('provider-diagnostics-claude')).toContainText('Deferred')
  await expect(page.getByText('Daily-use Claude connection blocked')).toBeVisible()
})
