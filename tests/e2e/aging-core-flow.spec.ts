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

async function ensureCodexConnected(page: Page) {
  const disconnectButton = page.getByRole('button', { name: 'Disconnect Codex' })

  if ((await disconnectButton.count()) > 0) {
    return
  }

  await page.getByRole('radio', { name: 'Codex' }).check()
  await page.getByRole('button', { name: 'Connect Codex' }).click()
  await page.getByRole('button', { name: 'Complete Mock Callback' }).dispatchEvent('click')
  await expect(page.getByTestId('provider-card-codex')).toContainText('connected')
}

async function runCoreFlow(page: Page, iteration: number) {
  await page.getByRole('button', { name: 'Append Sample Log' }).click()
  await page.getByRole('button', { name: 'Use Active Log As Agent Context' }).click()
  await page.getByLabel('Task Request').fill(`repeat sprint flow iteration ${iteration}`)
  await page.getByRole('button', { name: 'Request Suggestion' }).click()

  const suggestion = page.getByTestId('suggestion-card-codex').first()
  await suggestion.getByRole('button', { name: 'Approve In Current Tab' }).click()

  await expect(suggestion).toContainText('approved-current-tab')
  await expect(page.getByTestId('active-log-buffer')).toContainText('[agent:codex] npm run build')
}

test('repeats the core workspace flow across reloads with restored state', async ({ page }) => {
  await page.goto('/?e2eMock=1')

  await page.getByRole('radio', { name: 'Deep' }).check()
  await setProjectPath(page, '/mock/demo-project')
  await page.getByRole('button', { name: 'Open Project' }).click()
  await ensureCodexConnected(page)

  for (const iteration of [1, 2, 3]) {
    if (iteration > 1) {
      await page.reload()
      await expect(page.getByTestId('execution-mode-panel')).toContainText('Deep')
      await expect(
        page.getByRole('article').filter({ hasText: 'Project Metadata' }).first(),
      ).toContainText('/mock/demo-project')
      await ensureCodexConnected(page)
    }

    await runCoreFlow(page, iteration)
  }

  const historyPanel = page.getByTestId('task-history-panel')
  await expect(historyPanel).toContainText('Project opened')
  await expect(historyPanel).toContainText('Codex connected')
  await expect(historyPanel).toContainText('Codex suggestion approved')
})
