import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"

test("dropping text/plain file: uri inserts a file pill", async ({ page, gotoSession }) => {
  await gotoSession()

  const prompt = page.locator(promptSelector)
  await prompt.click()

  const path = process.platform === "win32" ? "C:\\opencode-e2e-drop.txt" : "/tmp/opencode-e2e-drop.txt"
  const dt = await page.evaluateHandle((text) => {
    const dt = new DataTransfer()
    dt.setData("text/plain", text)
    return dt
  }, `file:${path}`)

  await page.dispatchEvent("body", "drop", { dataTransfer: dt })

  const pill = page.locator(`${promptSelector} [data-type="file"]`).first()
  await expect(pill).toBeVisible()
  await expect(pill).toHaveAttribute("data-path", path)
})
