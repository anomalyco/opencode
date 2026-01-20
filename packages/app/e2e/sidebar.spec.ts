import { test, expect } from "./fixtures"
import { modKey } from "./utils"

test("sidebar can be collapsed and expanded", async ({ page, gotoSession }) => {
  await gotoSession()

  const main = page.locator("main")
  const closedClass = /xl:border-l/
  const isClosed = await main.evaluate((node) => node.className.includes("xl:border-l"))

  if (isClosed) {
    await page.keyboard.press(`${modKey}+B`)
    await expect(main).not.toHaveClass(closedClass)
  }

  await page.keyboard.press(`${modKey}+B`)
  await expect(main).toHaveClass(closedClass)

  await page.keyboard.press(`${modKey}+B`)
  await expect(main).not.toHaveClass(closedClass)
})
