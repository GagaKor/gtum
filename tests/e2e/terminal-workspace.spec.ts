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

test('manages terminal tabs and promotes active logs into agent context', async ({ page }) => {
  await page.goto('/?e2eMock=1')

  await setProjectPath(page, '/mock/demo-project')
  await page.getByRole('button', { name: 'Open Project' }).click()

  await expect(page.getByTestId('terminal-workspace')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'workspace' })).toHaveAttribute('aria-selected', 'true')

  await page.getByRole('button', { name: '+ New Tab' }).click()
  await page.getByLabel('Active Tab Name').fill('qa-watch')
  await page.getByLabel('Active Tab Name').press('Enter')

  await expect(page.getByRole('tab', { name: 'qa-watch' })).toBeVisible()

  await page.getByRole('button', { name: 'Append Sample Log' }).click()
  await expect(page.getByTestId('active-log-buffer')).toContainText('qa-watch: live log sample')

  await page.getByRole('button', { name: 'Use Active Log As Agent Context' }).click()
  await expect(page.getByTestId('agent-context-buffer')).toContainText('qa-watch')
  await expect(page.getByText('Sprint 2 Agent Context Ready')).toBeVisible()

  await page.getByRole('button', { name: 'Close qa-watch' }).click()
  await expect(page.getByRole('tab', { name: 'qa-watch' })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'workspace' })).toHaveAttribute('aria-selected', 'true')
})
