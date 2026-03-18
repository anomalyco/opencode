import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"

test("desktop native drop event inserts a file pill", async ({ page, gotoSession }) => {
  await gotoSession()

  const prompt = page.locator(promptSelector)
  await prompt.click()

  const path = process.platform === "win32" ? "C:\\opencode-e2e-native-drop.ts" : "/tmp/opencode-e2e-native-drop.ts"

  await page.evaluate((value) => {
    window.dispatchEvent(new CustomEvent("opencode:native-file-drop", { detail: { paths: [value] } }))
  }, path)

  const pill = page.locator(`${promptSelector} [data-type="file"]`).first()
  await expect(pill).toBeVisible()
  await expect(pill).toHaveAttribute("data-path", path)
})

test("native and browser drop do not duplicate file pill", async ({ page, gotoSession }) => {
  await gotoSession()

  const prompt = page.locator(promptSelector)
  await prompt.click()

  const path =
    process.platform === "win32" ? "C:\\opencode-e2e-native-drop-once.ts" : "/tmp/opencode-e2e-native-drop-once.ts"

  await page.evaluate((value) => {
    window.dispatchEvent(new CustomEvent("opencode:native-file-drop", { detail: { paths: [value] } }))
  }, path)

  const dt = await page.evaluateHandle((value) => {
    const dt = new DataTransfer()
    dt.setData("text/plain", value)
    return dt
  }, path)

  await page.dispatchEvent("body", "drop", { dataTransfer: dt })

  const pills = page.locator(`${promptSelector} [data-type="file"][data-path="${path}"]`)
  await expect(pills).toHaveCount(1)
})

test("desktop native drop event adds image attachment preview", async ({ page, gotoSession }) => {
  const dataUrl =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3+4uQAAAAASUVORK5CYII="

  await page.addInitScript((url) => {
    const target = window as Window & {
      __OPENCODE__?: {
        readAttachmentFromPath?: (
          path: string,
        ) =>
          | Promise<{ filename: string; mime: string; dataUrl: string } | null>
          | { filename: string; mime: string; dataUrl: string }
          | null
      }
    }
    target.__OPENCODE__ ??= {}
    target.__OPENCODE__.readAttachmentFromPath = async (path: string) => {
      if (!path.toLowerCase().endsWith(".png")) return null
      return { filename: "native-drop.png", mime: "image/png", dataUrl: url }
    }
  }, dataUrl)

  await gotoSession()

  const prompt = page.locator(promptSelector)
  await prompt.click()

  const path = process.platform === "win32" ? "C:\\opencode-e2e-native-drop.png" : "/tmp/opencode-e2e-native-drop.png"

  await page.evaluate((value) => {
    window.dispatchEvent(new CustomEvent("opencode:native-file-drop", { detail: { paths: [value] } }))
  }, path)

  await expect(page.locator('img[alt="native-drop.png"]').first()).toBeVisible()
  await expect(page.locator(`${promptSelector} [data-type="file"][data-path="${path}"]`)).toHaveCount(0)
})

test("browser and native drop do not duplicate file pill", async ({ page, gotoSession }) => {
  await gotoSession()

  const prompt = page.locator(promptSelector)
  await prompt.click()

  const path =
    process.platform === "win32"
      ? "C:\\opencode-e2e-native-drop-reverse.ts"
      : "/tmp/opencode-e2e-native-drop-reverse.ts"

  const dt = await page.evaluateHandle((value) => {
    const dt = new DataTransfer()
    dt.setData("text/plain", value)
    return dt
  }, path)

  await page.dispatchEvent("body", "drop", { dataTransfer: dt })

  await page.evaluate((value) => {
    window.dispatchEvent(new CustomEvent("opencode:native-file-drop", { detail: { paths: [value] } }))
  }, path)

  const pills = page.locator(`${promptSelector} [data-type="file"][data-path="${path}"]`)
  await expect(pills).toHaveCount(1)
})
