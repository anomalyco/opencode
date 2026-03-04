import { test, expect } from "../fixtures"
import { openStatusPopover } from "../actions"

test("status popover opens and shows tabs", async ({ page, gotoSession }) => {
  await gotoSession()

  const { popoverBody } = await openStatusPopover(page)

  await expect(popoverBody.getByRole("tab", { name: /servers/i })).toBeVisible()
  await expect(popoverBody.getByRole("tab", { name: /mcp/i })).toBeVisible()
  await expect(popoverBody.getByRole("tab", { name: /lsp/i })).toBeVisible()
  await expect(popoverBody.getByRole("tab", { name: /plugins/i })).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(popoverBody).toHaveCount(0)
})

test("status popover servers tab shows current server", async ({ page, gotoSession }) => {
  await gotoSession()

  const { popoverBody } = await openStatusPopover(page)

  const serversTab = popoverBody.getByRole("tab", { name: /servers/i })
  await expect(serversTab).toHaveAttribute("aria-selected", "true")

  const serverList = popoverBody.locator('[role="tabpanel"]').first()
  await expect(serverList.locator("button").first()).toBeVisible()
})

test("status popover can switch to mcp tab", async ({ page, gotoSession }) => {
  await gotoSession()

  const { popoverBody } = await openStatusPopover(page)

  const mcpTab = popoverBody.getByRole("tab", { name: /mcp/i })
  await mcpTab.click()

  const ariaSelected = await mcpTab.getAttribute("aria-selected")
  expect(ariaSelected).toBe("true")

  const mcpContent = popoverBody.locator('[role="tabpanel"]:visible').first()
  await expect(mcpContent).toBeVisible()
})

test("status popover can switch to lsp tab", async ({ page, gotoSession }) => {
  await gotoSession()

  const { popoverBody } = await openStatusPopover(page)

  const lspTab = popoverBody.getByRole("tab", { name: /lsp/i })
  await lspTab.click()

  const ariaSelected = await lspTab.getAttribute("aria-selected")
  expect(ariaSelected).toBe("true")

  const lspContent = popoverBody.locator('[role="tabpanel"]:visible').first()
  await expect(lspContent).toBeVisible()
})

test("status popover can switch to plugins tab", async ({ page, gotoSession }) => {
  await gotoSession()

  const { popoverBody } = await openStatusPopover(page)

  const pluginsTab = popoverBody.getByRole("tab", { name: /plugins/i })
  await pluginsTab.click()

  const ariaSelected = await pluginsTab.getAttribute("aria-selected")
  expect(ariaSelected).toBe("true")

  const pluginsContent = popoverBody.locator('[role="tabpanel"]:visible').first()
  await expect(pluginsContent).toBeVisible()
})

test("status popover closes on escape", async ({ page, gotoSession }) => {
  await gotoSession()

  const { popoverBody } = await openStatusPopover(page)
  await expect(popoverBody).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(popoverBody).toHaveCount(0)
})

test("status popover closes when clicking outside", async ({ page, gotoSession }) => {
  await gotoSession()

  const { popoverBody } = await openStatusPopover(page)
  await expect(popoverBody).toBeVisible()

  await page.getByRole("main").click({ position: { x: 5, y: 5 } })

  await expect(popoverBody).toHaveCount(0)
})
