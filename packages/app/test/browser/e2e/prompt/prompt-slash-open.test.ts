import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { promptSelector } from "../../../../e2e/selectors"

describe("prompt slash open", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("smoke /open opens file picker dialog", async () => {
    await app.gotoSession()
    const page = app.page

    await page.locator(promptSelector).click()
    await page.keyboard.type("/open")

    const command = page.locator('[data-slash-id="file.open"]')
    await command.waitFor({ state: "visible" })
    await command.hover()

    await page.keyboard.press("Enter")

    const dialog = page.getByRole("dialog")
    await dialog.waitFor({ state: "visible" })
    await dialog.getByRole("textbox").first().waitFor({ state: "visible" })

    await page.keyboard.press("Escape")
    expect(await dialog.count()).toBe(0)
  })
})
