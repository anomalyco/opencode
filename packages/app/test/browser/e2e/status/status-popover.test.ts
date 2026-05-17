import { describe, expect, test } from "vitest"
import { By } from "selenium-webdriver"
import type { WebElement } from "selenium-webdriver"
import { waitAbsent } from "../../support/wd-wait"
import { wdOpenStatusPopover, wdPressEscape, wdStatusPopoverBy } from "../../support/wd-actions"
import { useAppWebDriver } from "../../support/use-app-webdriver"

function tab(pop: WebElement, needle: string) {
  return pop.findElement(
    By.xpath(
      `.//*[@role="tab"][contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "${needle}")]`,
    ),
  )
}

describe("status popover (webdriver migration)", () => {
  const app = useAppWebDriver()

  test("opens and shows tabs", async () => {
    await app.gotoSession()
    const pop = await wdOpenStatusPopover(app.driver)
    for (const needle of ["server", "mcp", "lsp", "plugin"] as const) {
      expect(await (await tab(pop, needle)).isDisplayed()).toBe(true)
    }
    await wdPressEscape(app.driver)
    await waitAbsent(app.driver, wdStatusPopoverBy)
  })

  test("servers tab shows current server", async () => {
    await app.gotoSession()
    const pop = await wdOpenStatusPopover(app.driver)
    const servers = await tab(pop, "server")
    expect(await servers.getAttribute("aria-selected")).toBe("true")
    const panel = (await pop.findElements(By.css('[role="tabpanel"]')))[0]
    if (!panel) throw new Error("tabpanel missing")
    const btn = await panel.findElement(By.css("button"))
    expect(await btn.isDisplayed()).toBe(true)
  })

  test("can switch to mcp tab", async () => {
    await app.gotoSession()
    const pop = await wdOpenStatusPopover(app.driver)
    const mcp = await tab(pop, "mcp")
    await mcp.click()
    expect(await mcp.getAttribute("aria-selected")).toBe("true")
  })

  test("can switch to lsp tab", async () => {
    await app.gotoSession()
    const pop = await wdOpenStatusPopover(app.driver)
    const lsp = await tab(pop, "lsp")
    await lsp.click()
    expect(await lsp.getAttribute("aria-selected")).toBe("true")
  })

  test("can switch to plugins tab", async () => {
    await app.gotoSession()
    const pop = await wdOpenStatusPopover(app.driver)
    const plugins = await tab(pop, "plugin")
    await plugins.click()
    expect(await plugins.getAttribute("aria-selected")).toBe("true")
  })

  test("closes on escape", async () => {
    await app.gotoSession()
    await wdOpenStatusPopover(app.driver)
    await wdPressEscape(app.driver)
    await waitAbsent(app.driver, wdStatusPopoverBy)
  })

  test("closes when clicking outside", async () => {
    await app.gotoSession()
    await wdOpenStatusPopover(app.driver)
    await app.driver.findElement(By.css("main")).click()
    await waitAbsent(app.driver, wdStatusPopoverBy)
  })
})
