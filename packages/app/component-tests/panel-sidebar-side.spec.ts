import type { Locator, Page } from "@playwright/test"
import { expect, story } from "../../stories/playwright/story"

const box = async (locator: Locator) => {
  const value = await locator.boundingBox()

  if (!value) throw new Error("not laid out")

  return value
}

// Hovers "Sidebar position", then walks the pointer into its submenu, as a hand does, and picks one side.
const pick = async (page: Page, side: "Left" | "Right", checked: "Left" | "Right") => {
  const trigger = page.getByRole("menuitem", { name: "Sidebar position" })

  await trigger.hover()
  const option = page.getByRole("menuitemradio", { name: side })

  await expect(page.getByRole("menuitemradio", { name: checked })).toHaveAttribute("aria-checked", "true")
  const target = await box(option)

  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 })
  await option.click()
  await expect(page.getByRole("menuitemradio")).toHaveCount(0)
}

for (const { name, id } of [
  { name: "Review", id: "plugins-review--changes-and-comments" },
  { name: "Open file", id: "plugins-files--source" },
]) {
  story(`${name}: the Sidebar position submenu moves the file tree right and back`, async ({ mount, page }) => {
    const component = await mount(id)
    const panel = component.locator('[data-component="session-review-v2"]')
    const sidebar = panel.locator('[data-slot="session-review-v2-sidebar"]')
    const preview = panel.locator('[data-slot="session-review-v2-preview"]')
    const toggle = panel.getByRole("button", { name: "Toggle file tree" })

    await expect(sidebar).toBeVisible()
    await expect(panel).toHaveAttribute("data-sidebar-side", "start")
    expect((await box(sidebar)).x).toBeLessThan((await box(preview)).x)

    await panel.locator('[data-slot="session-review-v2-sidebar-header"]').click({ button: "right" })
    await pick(page, "Right", "Left")

    await expect(panel).toHaveAttribute("data-sidebar-side", "end")
    expect((await box(sidebar)).x).toBeGreaterThan((await box(preview)).x)
    // The toggle follows the tree to the right edge.
    expect((await box(toggle)).x).toBeGreaterThan((await box(sidebar)).x)

    // Collapsed, the toggle keeps the menu.
    await toggle.click()
    await expect(sidebar).toBeHidden()
    await toggle.click({ button: "right" })
    await pick(page, "Left", "Right")
    await expect(panel).toHaveAttribute("data-sidebar-side", "start")
    await toggle.click()
    await expect(sidebar).toBeVisible()
    expect((await box(sidebar)).x).toBeLessThan((await box(preview)).x)
  })
}

const pickWithKeyboard = async (
  page: Page,
  direction: "ltr" | "rtl",
  side: "Left" | "Right",
  checked: "Left" | "Right",
) => {
  const trigger = page.getByRole("menuitem", { name: "Sidebar position" })

  await expect(page.getByRole("menu")).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await expect(trigger).toBeFocused()
  await page.keyboard.press(direction === "rtl" ? "ArrowLeft" : "ArrowRight")

  const option = page.getByRole("menuitemradio", { name: side })

  await expect(page.getByRole("menuitemradio", { name: "Left" })).toBeFocused()
  await expect(page.getByRole("menuitemradio", { name: checked })).toHaveAttribute("aria-checked", "true")

  if (side === "Right") await page.keyboard.press("ArrowDown")
  await expect(option).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("menuitemradio")).toHaveCount(0)
}

for (const direction of ["ltr", "rtl"] as const) {
  story(`Shift+F10 on the toggle moves the file tree from the keyboard (${direction})`, async ({ mount, page }) => {
    const component = await mount("plugins-review--changes-and-comments", { globals: { direction } })
    const panel = component.locator('[data-component="session-review-v2"]')
    const sidebar = panel.locator('[data-slot="session-review-v2-sidebar"]')
    const toggle = panel.getByRole("button", { name: "Toggle file tree" })
    const startSide = direction === "rtl" ? "Right" : "Left"
    const endSide = direction === "rtl" ? "Left" : "Right"

    await expect(sidebar).toBeVisible()
    await page.keyboard.press("Shift")
    await toggle.focus()
    await page.keyboard.press("Shift+F10")
    await expect(page.getByRole("menu")).toBeFocused()
    await expect(page.getByRole("menuitem", { name: "Sidebar position" })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("menuitem", { name: "Sidebar position" })).toHaveCount(0)
    await expect(toggle).toBeFocused()
    await expect(toggle).toHaveCSS("outline-style", "solid")

    await page.keyboard.press("Shift+F10")
    await pickWithKeyboard(page, direction, endSide, startSide)
    await expect(panel).toHaveAttribute("data-sidebar-side", "end")
    await expect(toggle).toBeFocused()
    await expect(toggle).toHaveCSS("outline-style", "solid")

    // Enter still toggles the sidebar, and Shift+F10 works while collapsed.
    await page.keyboard.press("Enter")
    await expect(sidebar).toBeHidden()
    await page.keyboard.press("Shift+F10")
    await pickWithKeyboard(page, direction, startSide, endSide)
    await expect(panel).toHaveAttribute("data-sidebar-side", "start")
    await expect(toggle).toBeFocused()
    await expect(toggle).toHaveCSS("outline-style", "solid")
  })
}

story("the file tree filter keeps the system context menu", async ({ mount, page }) => {
  const component = await mount("plugins-review--changes-and-comments")
  const filter = component.getByRole("searchbox", { name: "Filter files" })

  await filter.click({ button: "right" })
  await expect(page.getByRole("menuitem", { name: "Sidebar position" })).toHaveCount(0)

  await filter.focus()
  await page.keyboard.press("Shift+F10")
  await expect(page.getByRole("menuitem", { name: "Sidebar position" })).toHaveCount(0)
})
