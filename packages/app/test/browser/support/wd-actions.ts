import { Key } from "selenium-webdriver"
import type { WebDriver } from "selenium-webdriver"
import type { WebElement } from "selenium-webdriver"
import { By } from "selenium-webdriver"
import { titlebarRightSelector } from "../../../e2e/selectors"
import { waitAbsent, waitLocated, waitVisible, waitUrlMatches } from "./wd-wait"

export async function wdDefocus(driver: WebDriver) {
  await driver.executeScript(
    "const el = document.activeElement; if (el instanceof HTMLElement) el.blur()",
  )
}

export async function wdOpenPalette(driver: WebDriver) {
  await wdDefocus(driver)
  const mod = process.platform === "darwin" ? Key.META : Key.CONTROL
  await driver.actions().keyDown(mod).sendKeys("p").keyUp(mod).perform()
  await waitVisible(driver, By.css('[role="dialog"]'))
  await waitVisible(driver, By.css('[role="dialog"] [role="textbox"], [role="dialog"] textarea, [role="dialog"] [data-component="inline-input"]'))
}

export async function wdPressEscape(driver: WebDriver) {
  await driver.actions().sendKeys(Key.ESCAPE).perform()
}

const wdStatusPopoverBy = By.xpath(
  `//*[@data-slot="popover-body"][.//*[@role="tab"][contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "server")]]`,
)

export { wdStatusPopoverBy }

/** Opens the titlebar status popover (tabs: servers, mcp, …). */
export async function wdOpenStatusPopover(driver: WebDriver) {
  await wdDefocus(driver)
  const bar = await waitVisible(driver, By.css(titlebarRightSelector))
  const trigger = await bar.findElement(
    By.xpath(
      `.//button[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "status")]`,
    ),
  )
  const open = await driver.findElements(wdStatusPopoverBy).then((xs) => xs.length > 0)
  if (!open) {
    await trigger.click()
    await waitVisible(driver, wdStatusPopoverBy)
  }
  return driver.findElement(wdStatusPopoverBy)
}

export async function wdOpenSidebar(driver: WebDriver) {
  const toggle = await waitLocated(
    driver,
    By.xpath(
      `//button[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "toggle sidebar")]`,
    ),
  )
  if ((await toggle.getAttribute("aria-expanded")) === "true") return
  await toggle.click()
  try {
    await driver.wait(async () => (await toggle.getAttribute("aria-expanded")) === "true", 2000)
  } catch {
    await wdDefocus(driver)
    const mod = process.platform === "darwin" ? Key.META : Key.CONTROL
    await driver.actions().keyDown(mod).sendKeys("b").keyUp(mod).perform()
    await driver.wait(async () => (await toggle.getAttribute("aria-expanded")) === "true", 5000)
  }
}

export async function wdCloseDialog(driver: WebDriver) {
  const open = await driver.findElements(By.css('[role="dialog"]'))
  if (open.length === 0) return
  await wdPressEscape(driver)
  await waitAbsent(driver, By.css('[role="dialog"]'), 2000).catch(() => undefined)
  if ((await driver.findElements(By.css('[role="dialog"]'))).length === 0) return
  await wdPressEscape(driver)
  await waitAbsent(driver, By.css('[role="dialog"]'), 2000).catch(() => undefined)
  if ((await driver.findElements(By.css('[role="dialog"]'))).length === 0) return
  const overlay = await driver.findElements(By.css('[data-component="dialog-overlay"]'))
  if (overlay[0]) {
    await driver.actions().move({ origin: overlay[0], x: 5, y: 5 }).click().perform()
  }
  await waitAbsent(driver, By.css('[role="dialog"]'), 5000)
}

export async function wdClickMenuItem(menu: WebElement, pattern: RegExp) {
  const items = await menu.findElements(By.css('[role="menuitem"]'))
  for (const item of items) {
    const text = await item.getText()
    if (pattern.test(text)) {
      await item.click()
      return
    }
  }
  throw new Error("menuitem not found for pattern")
}

/** Opens server-management popover (`Manage servers`) from the titlebar Status control. */
export async function wdEnsureServerManagePopover(driver: WebDriver) {
  const popBy = By.xpath(`//*[@data-component="popover-content"][contains(., "Manage servers")]`)
  for (const el of await driver.findElements(popBy)) {
    if (await el.isDisplayed()) return el
  }
  const bar = await waitVisible(driver, By.css(titlebarRightSelector))
  const status = await bar.findElement(By.css("button.titlebar-icon"))
  await status.click()
  return waitVisible(driver, popBy)
}

export async function wdToggleReviewPanel(driver: WebDriver) {
  await wdDefocus(driver)
  const mod = process.platform === "darwin" ? Key.META : Key.CONTROL
  await driver.actions().keyDown(mod).keyDown(Key.SHIFT).sendKeys("r").keyUp(Key.SHIFT).keyUp(mod).perform()
}

export async function wdPressModW(driver: WebDriver) {
  await wdDefocus(driver)
  const mod = process.platform === "darwin" ? Key.META : Key.CONTROL
  await driver.actions().keyDown(mod).sendKeys("w").keyUp(mod).perform()
}

/** Cmd/Ctrl+F without defocusing (viewer or prompt may already be focused). */
export async function wdChordModF(driver: WebDriver) {
  const mod = process.platform === "darwin" ? Key.META : Key.CONTROL
  await driver.actions().keyDown(mod).sendKeys("f").keyUp(mod).perform()
}

export async function wdOpenSettings(driver: WebDriver) {
  await wdDefocus(driver)
  const mod = process.platform === "darwin" ? Key.META : Key.CONTROL
  await driver.actions().keyDown(mod).sendKeys(",").keyUp(mod).perform()
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    for (const d of await driver.findElements(By.css('[role="dialog"]'))) {
      if (await d.isDisplayed()) return d
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  const settings = await waitVisible(driver, By.xpath(`//button[contains(., "Settings")]`))
  await settings.click()
  return waitVisible(driver, By.css('[role="dialog"]'))
}

export async function wdClickListItemByKey(root: WebElement, key: string) {
  for (const el of await root.findElements(By.css('[data-slot="list-item"]'))) {
    if ((await el.getAttribute("data-key")) === key) {
      await el.click()
      return
    }
  }
  throw new Error("list item key not found")
}

/** Session header “…” menu (Rename / Archive / Delete). */
export async function wdOpenSessionMoreMenu(driver: WebDriver, sessionId: string) {
  await waitUrlMatches(driver, new RegExp(`/session/${sessionId}(?:[/?#]|$)`))
  const scroller = await waitVisible(driver, By.css(".scroll-view__viewport"))
  await waitVisible(driver, By.css(".scroll-view__viewport h1"), 30_000)

  const menuXPath = `//*[@data-component="dropdown-menu-content"][.//*[@role="menuitem" and contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "rename")]][.//*[@role="menuitem" and contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "archive")]][.//*[@role="menuitem" and contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "delete")]]`
  for (const m of await driver.findElements(By.xpath(menuXPath))) {
    if (await m.isDisplayed()) return m
  }
  const trigger = await scroller.findElement(
    By.xpath(`.//button[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "more options")]`),
  )
  await trigger.click()
  return waitVisible(driver, By.xpath(menuXPath))
}

export async function wdConfirmDialog(driver: WebDriver, pattern: RegExp) {
  const dialog = await waitVisible(driver, By.css('[role="dialog"]'))
  for (const b of await dialog.findElements(By.css("button"))) {
    if (pattern.test(await b.getText())) {
      await b.click()
      return
    }
  }
  throw new Error("confirm dialog button not found")
}

/** Share popover body (Publish / Unpublish). */
export async function wdOpenSharePopover(driver: WebDriver) {
  const bar = await waitVisible(driver, By.css(titlebarRightSelector))
  const share = await bar.findElement(By.xpath(`.//button[normalize-space(.)='Share']`))
  const popXPath = `//*[@data-slot="popover-body"][.//button[contains(., "Publish") or contains(., "Unpublish")]]`
  for (const p of await driver.findElements(By.xpath(popXPath))) {
    if (await p.isDisplayed()) return p
  }
  await share.click()
  return waitVisible(driver, By.xpath(popXPath))
}
