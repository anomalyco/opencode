import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { promptSelector } from "../../../../e2e/selectors"

describe("prompt multiline", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("shift+enter inserts a newline without submitting", async () => {
    await app.gotoSession()
    const page = app.page

    expect(page.url()).toMatch(/\/session\/?$/)

    const prompt = page.locator(promptSelector)
    await prompt.click()
    await page.keyboard.type("line one")
    await page.keyboard.press("Shift+Enter")
    await page.keyboard.type("line two")

    expect(page.url()).toMatch(/\/session\/?$/)
    const t = (await prompt.textContent()) ?? ""
    expect(t).toContain("line one")
    expect(t).toContain("line two")
  })
})
