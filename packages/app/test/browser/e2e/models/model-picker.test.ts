import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { clickListItem } from "../../../../e2e/actions"
import { promptSelector } from "../../../../e2e/selectors"

describe("model picker", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("smoke model selection updates prompt footer", async () => {
    await app.gotoSession()

    await app.page.locator(promptSelector).click()
    await app.page.keyboard.type("/model")

    const command = app.page.locator('[data-slash-id="model.choose"]')
    await command.waitFor({ state: "visible" })
    await command.hover()

    await app.page.keyboard.press("Enter")

    const dialog = app.page.getByRole("dialog")
    await dialog.waitFor({ state: "visible" })

    const input = dialog.getByRole("textbox").first()

    const selected = dialog.locator('[data-slot="list-item"][data-selected="true"]').first()
    await selected.waitFor({ state: "visible" })

    const other = dialog.locator('[data-slot="list-item"]:not([data-selected="true"])').first()
    const target = (await other.count()) > 0 ? other : selected

    const key = await target.getAttribute("data-key")
    if (!key) throw new Error("Failed to resolve model key from list item")

    const model = key.split(":").slice(1).join(":")

    await input.fill(model)

    await clickListItem(dialog, { key })

    await expect.poll(async () => await dialog.count(), { timeout: 10_000 }).toBe(0)

    await app.page.locator(promptSelector).click()
    await app.page.keyboard.type("/model")
    await command.waitFor({ state: "visible" })
    await command.hover()
    await app.page.keyboard.press("Enter")

    const dialogAgain = app.page.getByRole("dialog")
    await dialogAgain.waitFor({ state: "visible" })
    await dialogAgain.locator(`[data-slot="list-item"][data-key="${key}"][data-selected="true"]`).waitFor({
      state: "visible",
    })
  })
})
