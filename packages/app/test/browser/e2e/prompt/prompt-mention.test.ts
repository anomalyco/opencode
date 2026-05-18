import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { promptSelector } from "../../../../e2e/selectors"

describe("prompt mention", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("smoke @mention inserts file pill token", async () => {
    await app.gotoSession()
    const page = app.page

    await page.locator(promptSelector).click()
    const sep = process.platform === "win32" ? "\\" : "/"
    const file = ["packages", "app", "package.json"].join(sep)
    const filePattern = /packages[\\/]+app[\\/]+\s*package\.json/

    await page.keyboard.type(`@${file}`)

    const suggestion = page.getByRole("button", { name: filePattern }).first()
    await suggestion.waitFor({ state: "visible" })
    await suggestion.hover()

    await page.keyboard.press("Tab")

    const pill = page.locator(`${promptSelector} [data-type="file"]`).first()
    await pill.waitFor({ state: "visible" })
    expect(await pill.getAttribute("data-path")).toMatch(filePattern)

    await page.keyboard.type(" ok")
    await expect.poll(async () => (await page.locator(promptSelector).textContent()) ?? "").toContain("ok")
  })
})
