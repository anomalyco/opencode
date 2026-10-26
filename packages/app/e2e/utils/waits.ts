import { expect, type Locator, type Page } from "@playwright/test"
import { sessionHref } from "./app"

export const APP_READY_TIMEOUT = 30_000

export async function expectAppVisible(locator: Locator) {
  await expect(locator).toBeVisible({ timeout: APP_READY_TIMEOUT })
}

export async function expectSessionTitle(page: Page, title: string) {
  // The phone layout follows the input: only a narrow touch screen without hover gets the mobile tabs.
  if (await page.evaluate(() => matchMedia("(hover: none) and (pointer: coarse) and (max-width: 767px)").matches)) {
    const trigger = page.locator('[data-slot="mobile-tabs-trigger"]')
    await expectAppVisible(trigger)
    await expect(trigger.locator('span[dir="auto"]')).toHaveText(title, { timeout: APP_READY_TIMEOUT })

    return
  }

  await expectAppVisible(page.getByRole("heading", { name: title }))
}

export async function expectSessionReady(page: Page, input: { server: string; sessionID: string; title: string }) {
  await expect(page).toHaveURL(sessionHref(input.sessionID, input.server))
  await expectSessionTitle(page, input.title)
}
