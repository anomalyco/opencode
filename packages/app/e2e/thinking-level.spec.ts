import { test, expect } from "./fixtures"
import { modelVariantCycleSelector } from "./selectors"

test("smoke model variant cycle updates label", async ({ page, gotoSession }) => {
  await gotoSession()

  await page.addStyleTag({
    content: `${modelVariantCycleSelector} { display: inline-block !important; }`,
  })

  const button = page.locator(modelVariantCycleSelector)
  const exists = (await button.count()) > 0
  test.skip(!exists, "current model has no variants")
  if (!exists) return

  await expect(button).toBeVisible()

  const before = (await button.innerText()).trim()
  await button.click()
  await expect(button).not.toHaveText(before)

  const after = (await button.innerText()).trim()
  await button.click()
  await expect(button).not.toHaveText(after)
})
