import type { Locator, Page } from "playwright"
import { modKey } from "../../../e2e/utils"
import { titlebarRightSelector } from "../../../e2e/selectors"
import { By, loc, waitAbsent, waitLocated, waitVisible, waitUrlMatches } from "./wd-wait"

export async function wdDefocus(page: Page) {
  await page
    .evaluate(() => {
      const el = document.activeElement
      if (el instanceof HTMLElement) el.blur()
    })
    .catch(() => undefined)
}

export async function wdOpenPalette(page: Page) {
  await wdDefocus(page)
  await page.keyboard.press(`${modKey}+P`)
  const dialog = page.getByRole("dialog")
  await dialog.waitFor({ state: "visible" })
  await dialog.getByRole("textbox").first().waitFor({ state: "visible" })
}

export async function wdPressEscape(page: Page) {
  await page.keyboard.press("Escape")
}

const wdStatusPopoverBy = By.xpath(
  `//*[@data-slot="popover-body"][.//*[@role="tab"][contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "server")]]`,
)

export { wdStatusPopoverBy }

/** Opens the titlebar status popover (tabs: servers, mcp, …). */
export async function wdOpenStatusPopover(page: Page) {
  await wdDefocus(page)
  const bar = await waitVisible(page, By.css(titlebarRightSelector))
  const trigger = bar.locator(
    `xpath=.//button[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "status")]`,
  )
  const pop = loc(page, wdStatusPopoverBy)
  const n = await pop.count()
  let visible = false
  for (let i = 0; i < n; i++) {
    if (await pop.nth(i).isVisible().catch(() => false)) {
      visible = true
      break
    }
  }
  if (!visible) {
    await trigger.click()
    await waitVisible(page, wdStatusPopoverBy)
  }
  return loc(page, wdStatusPopoverBy).first()
}

export async function wdOpenSidebar(page: Page) {
  const toggle = await waitLocated(
    page,
    By.xpath(
      `//button[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "toggle sidebar")]`,
    ),
  )
  if ((await toggle.getAttribute("aria-expanded")) === "true") return
  await toggle.click()
  const opened = await (async () => {
    const deadline = Date.now() + 2000
    while (Date.now() < deadline) {
      if ((await toggle.getAttribute("aria-expanded")) === "true") return true
      await new Promise((r) => setTimeout(r, 50))
    }
    return false
  })()
  if (opened) return
  await wdDefocus(page)
  await page.keyboard.press(`${modKey}+B`)
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if ((await toggle.getAttribute("aria-expanded")) === "true") return
    await new Promise((r) => setTimeout(r, 50))
  }
}

export async function wdCloseDialog(page: Page) {
  if ((await page.locator('[role="dialog"]').count()) === 0) return
  await wdPressEscape(page)
  await waitAbsent(page, By.css('[role="dialog"]'), 2000).catch(() => undefined)
  if ((await page.locator('[role="dialog"]').count()) === 0) return
  await wdPressEscape(page)
  await waitAbsent(page, By.css('[role="dialog"]'), 2000).catch(() => undefined)
  if ((await page.locator('[role="dialog"]').count()) === 0) return
  const overlay = page.locator('[data-component="dialog-overlay"]').first()
  if ((await overlay.count()) > 0) await overlay.click({ position: { x: 5, y: 5 } })
  await waitAbsent(page, By.css('[role="dialog"]'), 5000)
}

export async function wdClickMenuItem(menu: Locator, pattern: RegExp) {
  const items = menu.locator('[role="menuitem"]')
  const n = await items.count()
  for (let i = 0; i < n; i++) {
    const item = items.nth(i)
    const text = (await item.textContent()) ?? ""
    if (pattern.test(text)) {
      await item.click()
      return
    }
  }
  throw new Error("menuitem not found for pattern")
}

/** Opens server-management popover (`Manage servers`) from the titlebar Status control. */
export async function wdEnsureServerManagePopover(page: Page) {
  const popBy = By.xpath(`//*[@data-component="popover-content"][contains(., "Manage servers")]`)
  const popLoc = loc(page, popBy)
  const c = await popLoc.count()
  for (let i = 0; i < c; i++) {
    const el = popLoc.nth(i)
    if (await el.isVisible()) return el
  }
  const bar = await waitVisible(page, By.css(titlebarRightSelector))
  await bar.locator("button.titlebar-icon").click()
  return waitVisible(page, popBy)
}

export async function wdToggleReviewPanel(page: Page) {
  await wdDefocus(page)
  await page.keyboard.press(`${modKey}+Shift+R`)
}

export async function wdPressModW(page: Page) {
  await wdDefocus(page)
  await page.keyboard.press(`${modKey}+W`)
}

/** Cmd/Ctrl+F without defocusing (viewer or prompt may already be focused). */
export async function wdChordModF(page: Page) {
  await page.keyboard.press(`${modKey}+F`)
}

export async function wdOpenSettings(page: Page) {
  await wdDefocus(page)
  await page.keyboard.press(`${modKey}+Comma`).catch(() => undefined)
  const dialog = page.getByRole("dialog")
  const opened = await dialog
    .waitFor({ state: "visible", timeout: 3000 })
    .then(() => true)
    .catch(() => false)
  if (opened) return dialog
  await page.getByRole("button", { name: "Settings" }).first().click()
  await dialog.waitFor({ state: "visible" })
  return dialog
}

export async function wdClickListItemByKey(root: Locator, key: string) {
  const items = root.locator('[data-slot="list-item"]')
  const n = await items.count()
  for (let i = 0; i < n; i++) {
    const el = items.nth(i)
    if ((await el.getAttribute("data-key")) === key) {
      await el.click()
      return
    }
  }
  throw new Error("list item key not found")
}

/** Session header “…” menu (Rename / Archive / Delete). */
export async function wdOpenSessionMoreMenu(page: Page, sessionId: string) {
  await waitUrlMatches(page, new RegExp(`/session/${sessionId}(?:[/?#]|$)`))
  const scroller = await waitVisible(page, By.css(".scroll-view__viewport"))
  await waitVisible(page, By.css(".scroll-view__viewport h1"), 30_000)

  const menuXPath = `//*[@data-component="dropdown-menu-content"][.//*[@role="menuitem" and contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "rename")]][.//*[@role="menuitem" and contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "archive")]][.//*[@role="menuitem" and contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "delete")]]`
  const menuLoc = page.locator(`xpath=${menuXPath}`)
  const mc = await menuLoc.count()
  for (let i = 0; i < mc; i++) {
    const m = menuLoc.nth(i)
    if (await m.isVisible()) return m
  }
  const trigger = scroller.locator(
    `xpath=.//button[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "more options")]`,
  )
  await trigger.click()
  return waitVisible(page, By.xpath(menuXPath))
}

export async function wdConfirmDialog(page: Page, pattern: RegExp) {
  const dialog = await waitVisible(page, By.css('[role="dialog"]'))
  const buttons = dialog.locator("button")
  const bn = await buttons.count()
  for (let i = 0; i < bn; i++) {
    const b = buttons.nth(i)
    const text = (await b.textContent()) ?? ""
    if (pattern.test(text)) {
      await b.click()
      return
    }
  }
  throw new Error("confirm dialog button not found")
}

/** Share popover body (Publish / Unpublish). */
export async function wdOpenSharePopover(page: Page) {
  const bar = await waitVisible(page, By.css(titlebarRightSelector))
  const share = bar.locator(`xpath=.//button[normalize-space(.)='Share']`)
  const popXPath = `//*[@data-slot="popover-body"][.//button[contains(., "Publish") or contains(., "Unpublish")]]`
  const popLoc = page.locator(`xpath=${popXPath}`)
  const pc = await popLoc.count()
  for (let i = 0; i < pc; i++) {
    const p = popLoc.nth(i)
    if (await p.isVisible()) return p
  }
  await share.click()
  return waitVisible(page, By.xpath(popXPath))
}
