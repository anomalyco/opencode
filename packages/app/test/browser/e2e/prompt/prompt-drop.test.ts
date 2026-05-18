import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { promptSelector } from "../../../../e2e/selectors"

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3+4uQAAAAASUVORK5CYII="

describe("prompt drop", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("dropping an image file adds an attachment", async () => {
    await app.gotoSession()
    const page = app.page
    const prompt = page.locator(promptSelector)
    await prompt.click()

    const dt = await page.evaluateHandle((b64: string) => {
      const t = new DataTransfer()
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const file = new File([bytes], "drop.png", { type: "image/png" })
      t.items.add(file)
      return t
    }, png)

    await page.dispatchEvent("body", "drop", { dataTransfer: dt })

    const img = page.locator('img[alt="drop.png"]').first()
    await img.waitFor({ state: "visible" })

    const remove = page.getByRole("button", { name: "Remove attachment" }).first()
    await remove.waitFor({ state: "visible" })

    await img.hover()
    await remove.click()
    await expect.poll(async () => await page.locator('img[alt="drop.png"]').count()).toBe(0)
  })

  test("dropping text/plain file: uri inserts a file pill", async () => {
    await app.gotoSession()
    const page = app.page
    const prompt = page.locator(promptSelector)
    await prompt.click()

    const path = process.platform === "win32" ? "C:\\opencode-e2e-drop.txt" : "/tmp/opencode-e2e-drop.txt"
    const dt = await page.evaluateHandle((text: string) => {
      const t = new DataTransfer()
      t.setData("text/plain", text)
      return t
    }, `file:${path}`)

    await page.dispatchEvent("body", "drop", { dataTransfer: dt })

    const pill = page.locator(`${promptSelector} [data-type="file"]`).first()
    await pill.waitFor({ state: "visible" })
    expect(await pill.getAttribute("data-path")).toBe(path)
  })
})
