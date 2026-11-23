import { expect, story } from "../../stories/playwright/story"

story("distinguishes both Codex windows without a Console workspace", async ({ mount, page }) => {
  await mount("app-dialog-usage--codex")
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("Reviews · 5 hours")).toBeVisible()
  await expect(dialog.getByText("Reviews · 7 days")).toBeVisible()
  await expect(dialog.getByText("100% used")).toBeVisible()
  await expect(dialog.getByText(/^Resets in /)).toHaveCount(2)
  await expect(dialog.getByText("OpenCode Console")).toHaveCount(0)
})
