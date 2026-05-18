import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { openStatusPopover } from "../../../../e2e/actions"

describe("status popover", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("opens and shows tabs", async () => {
    await app.gotoSession()
    const page = app.page
    const { popoverBody } = await openStatusPopover(page)

    await popoverBody.getByRole("tab", { name: /servers/i }).waitFor({ state: "visible" })
    await popoverBody.getByRole("tab", { name: /mcp/i }).waitFor({ state: "visible" })
    await popoverBody.getByRole("tab", { name: /lsp/i }).waitFor({ state: "visible" })
    await popoverBody.getByRole("tab", { name: /plugins/i }).waitFor({ state: "visible" })

    await page.keyboard.press("Escape")
    expect(await popoverBody.count()).toBe(0)
  })

  test("servers tab shows current server", async () => {
    await app.gotoSession()
    const page = app.page
    const { popoverBody } = await openStatusPopover(page)

    const serversTab = popoverBody.getByRole("tab", { name: /servers/i })
    expect(await serversTab.getAttribute("aria-selected")).toBe("true")

    const serverList = popoverBody.locator('[role="tabpanel"]').first()
    await serverList.locator("button").first().waitFor({ state: "visible" })
  })

  test("can switch to mcp tab", async () => {
    await app.gotoSession()
    const page = app.page
    const { popoverBody } = await openStatusPopover(page)

    const mcpTab = popoverBody.getByRole("tab", { name: /mcp/i })
    await mcpTab.click()

    expect(await mcpTab.getAttribute("aria-selected")).toBe("true")

    const mcpContent = popoverBody.locator('[role="tabpanel"]:visible').first()
    await mcpContent.waitFor({ state: "visible" })
  })

  test("can switch to lsp tab", async () => {
    await app.gotoSession()
    const page = app.page
    const { popoverBody } = await openStatusPopover(page)

    const lspTab = popoverBody.getByRole("tab", { name: /lsp/i })
    await lspTab.click()

    expect(await lspTab.getAttribute("aria-selected")).toBe("true")

    const lspContent = popoverBody.locator('[role="tabpanel"]:visible').first()
    await lspContent.waitFor({ state: "visible" })
  })

  test("can switch to plugins tab", async () => {
    await app.gotoSession()
    const page = app.page
    const { popoverBody } = await openStatusPopover(page)

    const pluginsTab = popoverBody.getByRole("tab", { name: /plugins/i })
    await pluginsTab.click()

    expect(await pluginsTab.getAttribute("aria-selected")).toBe("true")

    const pluginsContent = popoverBody.locator('[role="tabpanel"]:visible').first()
    await pluginsContent.waitFor({ state: "visible" })
  })

  test("closes on escape", async () => {
    await app.gotoSession()
    const page = app.page
    const { popoverBody } = await openStatusPopover(page)
    await popoverBody.waitFor({ state: "visible" })

    await page.keyboard.press("Escape")
    expect(await popoverBody.count()).toBe(0)
  })

  test("closes when clicking outside", async () => {
    await app.gotoSession()
    const page = app.page
    const { popoverBody } = await openStatusPopover(page)
    await popoverBody.waitFor({ state: "visible" })

    await page.getByRole("main").click({ position: { x: 5, y: 5 } })

    expect(await popoverBody.count()).toBe(0)
  })
})
