import fs from "node:fs/promises"
import path from "node:path"
import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"

test("smoke @mention inserts file pill token", async ({ page, withProject }) => {
  await withProject(async ({ directory, gotoSession }) => {
    // Scaffold nested file to test slashes and subdirectories
    await fs.mkdir(path.join(directory, "packages", "app"), { recursive: true })
    await fs.writeFile(path.join(directory, "packages", "app", "package.json"), "{}")

    await gotoSession()

    const file = "packages/app/package.json"
    const filePattern = /packages[\\/]+app[\\/]+\s*package\.json/

    const suggestion = page.getByRole("button", { name: filePattern }).first()

    await expect(async () => {
      await page.locator(promptSelector).click()
      await page.keyboard.press("Control+A")
      await page.keyboard.press("Backspace")
      await page.keyboard.type(`@${file}`)
      await expect(suggestion).toBeVisible({ timeout: 500 })
    }).toPass({ timeout: 10_000 })

    await suggestion.hover()

    await page.keyboard.press("Tab")

    const pill = page.locator(`${promptSelector} [data-type="file"]`).first()
    await expect(pill).toBeVisible()
    await expect(pill).toHaveAttribute("data-path", filePattern)

    await page.keyboard.type(" ok")
    await expect(page.locator(promptSelector)).toContainText("ok")
  })
})
