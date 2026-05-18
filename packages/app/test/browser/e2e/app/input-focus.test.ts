import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { modKey } from "../../../../e2e/utils"
import { promptSelector } from "../../../../e2e/selectors"

describe("input focus", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("ctrl+l focuses the prompt", async () => {
    await app.gotoSession()
    const prompt = app.page.locator(promptSelector)
    await prompt.waitFor({ state: "visible" })
    await app.page.locator("main").click({ position: { x: 5, y: 5 } })
    await expect.poll(async () => await prompt.evaluate((el) => el === document.activeElement)).toBe(false)
    await app.page.keyboard.press(`${modKey}+L`)
    await expect.poll(async () => await prompt.evaluate((el) => el === document.activeElement)).toBe(true)
  })
})
