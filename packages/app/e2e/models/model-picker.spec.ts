import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"
import { clickListItem } from "../actions"
import { modKey } from "../utils"

test("smoke model selection updates prompt footer", async ({ page, gotoSession }) => {
  await gotoSession()

  await page.locator(promptSelector).click()
  await page.keyboard.type("/model")

  const command = page.locator('[data-slash-id="model.choose"]')
  await expect(command).toBeVisible()
  await command.hover()

  await page.keyboard.press("Enter")

  const picker = page.locator('[data-component="model-selector"]').first()
  await expect(picker).toBeVisible()

  const selected = picker.locator('[data-slot="list-item"][data-selected="true"]').first()
  await expect(selected).toBeVisible()

  const other = picker.locator('[data-slot="list-item"]:not([data-selected="true"])').first()
  const target = (await other.count()) > 0 ? other : selected

  const key = await target.getAttribute("data-key")
  if (!key) throw new Error("Failed to resolve model key from list item")

  const name = (await target.locator("span").first().innerText()).trim()

  await clickListItem(picker, { key })

  await expect(page.locator('[data-component="model-selector"]').first()).not.toBeVisible()

  const form = page.locator(promptSelector).locator("xpath=ancestor::form[1]")
  await expect(form.locator('[data-component="button"]').filter({ hasText: name }).first()).toBeVisible()
})

test("model chooser shortcut opens selector", async ({ page, gotoSession }) => {
  await gotoSession()

  await page.locator(promptSelector).click()
  await page.keyboard.press(`${modKey}+Quote`)

  const picker = page.locator('[data-component="model-selector"]').first()
  await expect(picker).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(page.locator('[data-component="model-selector"]').first()).not.toBeVisible()
})
