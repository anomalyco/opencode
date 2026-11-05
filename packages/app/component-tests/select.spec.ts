import { expect, story } from "../../stories/playwright/story"

story("selects the option arrow keys move to while the menu stays open", async ({ mount, page }) => {
  const root = await mount("ui-select--select-on-navigate")
  const current = root.getByTestId("select-on-navigate-current")
  const listbox = page.getByRole("listbox")

  await root.locator('[data-component="select-v2"]').click()
  await expect(listbox).toBeVisible()
  // Opening only highlights the current option.
  await expect(current).toHaveText("Selected: Banana")

  await page.keyboard.press("ArrowDown")
  await expect(current).toHaveText("Selected: Cherry")
  await expect(listbox).toBeVisible()

  await page.keyboard.press("ArrowDown")
  await expect(current).toHaveText("Selected: Date")

  await page.keyboard.press("ArrowUp")
  await expect(current).toHaveText("Selected: Cherry")

  // Hover highlights without selecting.
  await page.getByRole("option", { name: "Apple" }).hover()
  await expect(page.getByRole("option", { name: "Apple" })).toHaveAttribute("data-highlighted", "")
  await expect(current).toHaveText("Selected: Cherry")

  await page.keyboard.press("Escape")
  await expect(listbox).toBeHidden()
  await expect(current).toHaveText("Selected: Cherry")
})

story("keeps the selection when the keyboard opens the menu", async ({ mount, page }) => {
  const root = await mount("ui-select--select-on-navigate")
  const current = root.getByTestId("select-on-navigate-current")

  await root.locator('[data-component="select-v2"]').focus()
  await page.keyboard.press("ArrowDown")
  await expect(page.getByRole("listbox")).toBeVisible()
  await expect(current).toHaveText("Selected: Banana")

  await page.keyboard.press("ArrowDown")
  await expect(current).toHaveText("Selected: Cherry")

  await page.keyboard.press("Enter")
  await expect(page.getByRole("listbox")).toBeHidden()
  await expect(current).toHaveText("Selected: Cherry")
})
