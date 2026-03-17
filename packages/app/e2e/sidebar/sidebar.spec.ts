import { test, expect } from "../fixtures"
import { openSidebar, toggleSidebar, withSession } from "../actions"

test("sidebar can be collapsed and expanded", async ({ page, gotoSession }) => {
  await gotoSession()

  await openSidebar(page)
  const button = page.getByRole("button", { name: /toggle sidebar/i }).first()
  await expect(button).toHaveAttribute("aria-expanded", "true")

  await toggleSidebar(page)
  await expect(button).toHaveAttribute("aria-expanded", "false")

  await toggleSidebar(page)
  await expect(button).toHaveAttribute("aria-expanded", "true")
})

test("narrow desktop sidebar toggle shows tooltip and controls mobile nav", async ({ page, gotoSession }) => {
  await page.setViewportSize({ width: 1100, height: 800 })
  await gotoSession()

  const button = page.getByRole("button", { name: /toggle sidebar/i }).first()
  const nav = page.locator('[data-component="sidebar-nav-mobile"]').first()
  const tip = page.locator('[data-component="tooltip"]').filter({ hasText: /toggle sidebar/i }).last()

  await expect(button).toBeVisible()
  await expect(button).toHaveAttribute("aria-expanded", "false")
  await expect(nav).toHaveClass(/-translate-x-full/)

  await button.hover()
  await expect(tip).toBeVisible()
  await expect(tip).toContainText("B")

  await toggleSidebar(page)
  await expect(button).toHaveAttribute("aria-expanded", "true")
  await expect(nav).toHaveClass(/translate-x-0/)

  await toggleSidebar(page)
  await expect(button).toHaveAttribute("aria-expanded", "false")
  await expect(nav).toHaveClass(/-translate-x-full/)
})

test("sidebar collapsed state persists across navigation and reload", async ({ page, sdk, gotoSession }) => {
  await withSession(sdk, "sidebar persist session 1", async (session1) => {
    await withSession(sdk, "sidebar persist session 2", async (session2) => {
      await gotoSession(session1.id)

      await openSidebar(page)
      const button = page.getByRole("button", { name: /toggle sidebar/i }).first()
      await toggleSidebar(page)
      await expect(button).toHaveAttribute("aria-expanded", "false")

      await gotoSession(session2.id)
      await expect(button).toHaveAttribute("aria-expanded", "false")

      await page.reload()
      await expect(button).toHaveAttribute("aria-expanded", "false")

      const opened = await page.evaluate(
        () => JSON.parse(localStorage.getItem("opencode.global.dat:layout") ?? "{}").sidebar?.opened,
      )
      await expect(opened).toBe(false)
    })
  })
})
