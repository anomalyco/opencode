import { test, expect } from "../fixtures"
import { openSidebar, toggleSidebar, withSession } from "../actions"

test("sidebar can be collapsed and expanded", async ({ page, gotoSession }) => {
  await gotoSession()

  await openSidebar(page)

  await toggleSidebar(page)
  await expect(page.locator("main")).toHaveClass(/xl:border-l/)

  await toggleSidebar(page)
  await expect(page.locator("main")).not.toHaveClass(/xl:border-l/)
})

test("sidebar collapsed state persists across navigation and reload", async ({ page, sdk, gotoSession }) => {
  await withSession(sdk, "sidebar persist session 1", async (session1) => {
    await withSession(sdk, "sidebar persist session 2", async (session2) => {
      await gotoSession(session1.id)

      await openSidebar(page)
      await toggleSidebar(page)
      await expect(page.locator("main")).toHaveClass(/xl:border-l/)

      await gotoSession(session2.id)
      await expect(page.locator("main")).toHaveClass(/xl:border-l/)

      await page.reload()
      await expect(page.locator("main")).toHaveClass(/xl:border-l/)

      const opened = await page.evaluate(
        () => JSON.parse(localStorage.getItem("opencode.global.dat:layout") ?? "{}").sidebar?.opened,
      )
      await expect(opened).toBe(false)
    })
  })
})
