import { test, expect } from "./fixtures"
import { modKey } from "./utils"

test("sidebar can be collapsed and expanded", async ({ page, gotoSession }) => {
  await gotoSession()

  const createButton = page.getByRole("button", { name: /New (session|workspace)/ }).first()
  const opened = (await createButton.count()) > 0

  if (!opened) {
    await page.keyboard.press(`${modKey}+B`)
    await expect(createButton).toBeVisible()
  }

  await page.keyboard.press(`${modKey}+B`)
  await expect(createButton).toHaveCount(0)

  await page.keyboard.press(`${modKey}+B`)
  await expect(createButton).toBeVisible()
})
