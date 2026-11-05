import { expect, sourceURL, story } from "../../stories/playwright/story"

const toastModule = sourceURL(new URL("../../ui/src/feedback/toast/toast.tsx", import.meta.url))

story.beforeEach(async ({ mount }) => {
  await mount("ui-toast--all-examples")
})

story("keeps toasts hidden behind the stack out of reach of the keyboard", async ({ page }) => {
  await page.evaluate(async (toastModule) => {
    const { showToast } = await import(toastModule)
    const titles = ["First", "Second", "Third", "Fourth"]

    titles.forEach((title) => showToast({ title, persistent: true }))
  }, toastModule)
  await expect(page.locator(".toast-v2-region .toast-v2")).toHaveCount(4)

  const hidden = page.locator('.toast-v2-region .toast-v2[data-visible="false"]')
  await expect(hidden).toHaveCount(1)
  await expect(hidden).toHaveJSProperty("inert", true)
  await expect(hidden).toHaveAttribute("tabindex", "-1")
  await expect(page.locator('.toast-v2-region .toast-v2[data-visible="true"][tabindex="0"]')).toHaveCount(3)
})
