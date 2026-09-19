import { expect, type Locator, type Page } from "@playwright/test"

export const APP_READY_TIMEOUT = 30_000

export async function expectAppVisible(locator: Locator) {
  await expect(locator).toBeVisible({ timeout: APP_READY_TIMEOUT })
}

export async function expectSessionTitle(page: Page, title: string) {
  await expectAppVisible(page.getByRole("heading", { name: title }))
}

export function sessionHistoryRow(page: Page, sessionID: string) {
  return page.locator(`[data-component="session-history-row"][data-session-id="${sessionID}"]`)
}

export function draftHistoryRow(page: Page, draftID: string) {
  return page.locator(`[data-component="session-history-row"][data-draft-id="${draftID}"]`)
}

export async function switchHistorySession(page: Page, sessionID: string, title: string) {
  const row = sessionHistoryRow(page, sessionID)
  await expect(row).toBeVisible()
  await row.click()
  await expectSessionTitle(page, title)
}
