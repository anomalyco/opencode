import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"

test("dropping an image file adds an attachment", async ({ page, gotoSession }) => {
  await gotoSession()

  const prompt = page.locator(promptSelector)
  await prompt.click()

  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3+4uQAAAAASUVORK5CYII="
  const dt = await page.evaluateHandle((b64) => {
    const dt = new DataTransfer()
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const file = new File([bytes], "drop.png", { type: "image/png" })
    dt.items.add(file)
    return dt
  }, png)

  await page.dispatchEvent("body", "drop", { dataTransfer: dt })

  const img = page.locator('img[alt="drop.png"]').first()
  await expect(img).toBeVisible()

  const remove = page.getByRole("button", { name: "Remove attachment" }).first()
  await expect(remove).toBeVisible()

  await img.hover()
  await remove.click()
  await expect(page.locator('img[alt="drop.png"]')).toHaveCount(0)
})
