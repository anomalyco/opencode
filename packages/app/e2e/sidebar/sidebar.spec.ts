import { test, expect } from "../fixtures"
import { openSidebar, toggleSidebar } from "../actions"

test("sidebar can be collapsed and expanded", async ({ page, gotoSession }) => {
  await gotoSession()

  await openSidebar(page)

  await toggleSidebar(page)
  await expect(page.locator("main")).toHaveClass(/xl:border-l/)

  await toggleSidebar(page)
  await expect(page.locator("main")).not.toHaveClass(/xl:border-l/)
})
