import type { Locator } from "@playwright/test"
import { expect, story } from "../../stories/playwright/story"

const box = async (locator: Locator) => {
  const value = await locator.boundingBox()

  if (!value) throw new Error("not laid out")

  return value
}

for (const { name, id } of [
  { name: "Review", id: "plugins-review--changes-and-comments" },
  { name: "Open file", id: "plugins-files--source" },
]) {
  story(`${name}: the file tree's context menu moves it to the right and back`, async ({ mount, page }) => {
    const component = await mount(id)
    const panel = component.locator('[data-component="session-review-v2"]')
    const sidebar = panel.locator('[data-slot="session-review-v2-sidebar"]')
    const preview = panel.locator('[data-slot="session-review-v2-preview"]')
    const toggle = panel.getByRole("button", { name: "Toggle file tree" })

    await expect(sidebar).toBeVisible()
    await expect(panel).toHaveAttribute("data-sidebar-side", "start")
    expect((await box(sidebar)).x).toBeLessThan((await box(preview)).x)

    await panel.locator('[data-slot="session-review-v2-sidebar-header"]').click({ button: "right" })
    await page.getByRole("menuitem", { name: "Move file tree to the right" }).click()

    await expect(panel).toHaveAttribute("data-sidebar-side", "end")
    expect((await box(sidebar)).x).toBeGreaterThan((await box(preview)).x)
    // The toggle follows the tree to the right edge.
    expect((await box(toggle)).x).toBeGreaterThan((await box(sidebar)).x)

    // Collapsed, the toggle keeps the menu.
    await toggle.click()
    await expect(sidebar).toBeHidden()
    await toggle.click({ button: "right" })
    await page.getByRole("menuitem", { name: "Move file tree to the left" }).click()
    await expect(panel).toHaveAttribute("data-sidebar-side", "start")
    await toggle.click()
    await expect(sidebar).toBeVisible()
    expect((await box(sidebar)).x).toBeLessThan((await box(preview)).x)
  })
}

story("the file tree filter keeps the system context menu", async ({ mount, page }) => {
  const component = await mount("plugins-review--changes-and-comments")

  await component.getByRole("searchbox", { name: "Filter files" }).click({ button: "right" })
  await expect(page.getByRole("menuitem", { name: /Move file tree/ })).toHaveCount(0)
})
