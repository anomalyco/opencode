import { describe, expect, test } from "vitest"
import { useFullAppStack } from "../../support/use-full-app-stack"

import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { By, Key } from "selenium-webdriver"
import type { WebDriver, WebElement } from "selenium-webdriver"
import { withSession } from "../../../../e2e/actions"
import { keybindButtonSelector } from "../../../../e2e/selectors"
import { createSdk, serverUrl } from "../../../../e2e/utils"
import { wdCloseDialog, wdOpenSettings } from "../../support/wd-actions"
import { waitVisible } from "../../support/wd-wait"
import { openProjectSession, useAppWebDriver } from "../../support/use-app-webdriver"

function mod() {
  return process.platform === "darwin" ? Key.META : Key.CONTROL
}

async function delay() {
  await new Promise((r) => setTimeout(r, 100))
}

async function chordModShift(driver: WebDriver, letter: string) {
  const m = mod()
  await driver.actions().keyDown(m).keyDown(Key.SHIFT).sendKeys(letter).keyUp(Key.SHIFT).keyUp(m).perform()
}

async function chordModB(driver: WebDriver) {
  const m = mod()
  await driver.actions().keyDown(m).sendKeys("b").keyUp(m).perform()
}

async function chordModSlash(driver: WebDriver) {
  const m = mod()
  await driver.actions().keyDown(m).sendKeys("/").keyUp(m).perform()
}

async function chordModShiftF(driver: WebDriver) {
  await chordModShift(driver, "f")
}

async function chordModShiftK(driver: WebDriver) {
  await chordModShift(driver, "k")
}

async function chordModShiftN(driver: WebDriver) {
  await chordModShift(driver, "n")
}

async function chordModShiftP(driver: WebDriver) {
  await chordModShift(driver, "p")
}

async function firstKeybind(dialog: WebElement, id: string) {
  const xs = await dialog.findElements(By.css(keybindButtonSelector(id)))
  const el = xs[0]
  if (!el) throw new Error(`missing keybind ${id}`)
  return el
}

async function readSettingsV3(driver: WebDriver) {
  return driver.executeScript(() => {
    const raw = localStorage.getItem("settings.v3")
    if (!raw) return null
    return JSON.parse(raw) as { keybinds?: Record<string, string> }
  }) as Promise<{ keybinds?: Record<string, string> } | null>
}

async function shortcutsTab(dialog: WebElement) {
  await dialog.findElement(By.xpath(`.//button[@role="tab" and contains(., "Shortcuts")]`)).click()
}

describe("settings keybinds (webdriver migration)", () => {
  useFullAppStack()
  const app = useAppWebDriver()

  test("changing sidebar toggle keybind works", async () => {
    await app.gotoSession()
    const dialog = await wdOpenSettings(app.driver)
    await shortcutsTab(dialog)

    const keybindButton = await firstKeybind(dialog, "sidebar.toggle")
    expect(await keybindButton.getText()).toContain("B")

    await keybindButton.click()
    await app.driver.wait(async () => /press/i.test(await keybindButton.getText()), 5000)

    await chordModShift(app.driver, "h")
    await delay()
    expect(await keybindButton.getText()).toContain("H")

    const stored = await readSettingsV3(app.driver)
    expect(stored?.keybinds?.["sidebar.toggle"]).toBe("mod+shift+h")

    await wdCloseDialog(app.driver)

    const toggle = await waitVisible(
      app.driver,
      By.xpath(
        `//button[contains(translate(normalize-space(.), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "toggle sidebar")]`,
      ),
    )
    const initiallyClosed = (await toggle.getAttribute("aria-expanded")) !== "true"

    await chordModShift(app.driver, "h")
    await app.driver.wait(async () => (await toggle.getAttribute("aria-expanded")) === (initiallyClosed ? "true" : "false"), 5000)

    const afterToggleClosed = (await toggle.getAttribute("aria-expanded")) !== "true"
    expect(afterToggleClosed).toBe(!initiallyClosed)

    await chordModShift(app.driver, "h")
    await app.driver.wait(async () => (await toggle.getAttribute("aria-expanded")) === (initiallyClosed ? "false" : "true"), 5000)

    const finalClosed = (await toggle.getAttribute("aria-expanded")) !== "true"
    expect(finalClosed).toBe(initiallyClosed)
  })

  test("sidebar toggle keybind guards against shortcut conflicts", async () => {
    await app.gotoSession()
    const dialog = await wdOpenSettings(app.driver)
    await shortcutsTab(dialog)

    const keybindButton = await firstKeybind(dialog, "sidebar.toggle")
    expect(await keybindButton.getText()).toContain("B")

    await keybindButton.click()
    await app.driver.wait(async () => /press/i.test(await keybindButton.getText()), 5000)

    await chordModShiftP(app.driver)
    await delay()

    const toast = await waitVisible(app.driver, By.css('[data-component="toast"]'), 10_000)
    expect(await toast.getText()).toMatch(/already/i)

    await keybindButton.click()
    expect(await keybindButton.getText()).toContain("B")

    const stored = await readSettingsV3(app.driver)
    expect(stored?.keybinds?.["sidebar.toggle"]).toBeUndefined()

    await wdCloseDialog(app.driver)
  })

  test("resetting all keybinds to defaults works", async () => {
    await app.driver.get(app.origin)
    await app.driver.executeScript(
      `localStorage.setItem("settings.v3", arguments[0])`,
      JSON.stringify({ keybinds: { "sidebar.toggle": "mod+shift+x" } }),
    )
    await app.gotoSession()

    const dialog = await wdOpenSettings(app.driver)
    await shortcutsTab(dialog)

    const keybindButton = await firstKeybind(dialog, "sidebar.toggle")
    expect(await keybindButton.getText()).toContain("X")

    const reset = await dialog.findElement(By.xpath(`.//button[contains(., "Reset to defaults")]`))
    expect(await reset.isEnabled()).toBe(true)
    await reset.click()
    await delay()

    expect(await keybindButton.getText()).toContain("B")

    const stored = await readSettingsV3(app.driver)
    expect(stored?.keybinds?.["sidebar.toggle"]).toBeUndefined()

    await wdCloseDialog(app.driver)
  })

  test("clearing a keybind works", async () => {
    await app.gotoSession()
    const dialog = await wdOpenSettings(app.driver)
    await shortcutsTab(dialog)

    const keybindButton = await firstKeybind(dialog, "sidebar.toggle")
    expect(await keybindButton.getText()).toContain("B")

    await keybindButton.click()
    await app.driver.wait(async () => /press/i.test(await keybindButton.getText()), 5000)

    await app.driver.actions().sendKeys(Key.DELETE).perform()
    await delay()

    const cleared = await keybindButton.getText()
    expect(cleared).toMatch(/unassigned|press/i)

    const stored = await readSettingsV3(app.driver)
    expect(stored?.keybinds?.["sidebar.toggle"]).toBe("none")

    await wdCloseDialog(app.driver)

    await chordModB(app.driver)
    await delay()
    expect(await app.driver.getCurrentUrl()).toContain("/session")
  })

  test("changing settings open keybind works", async () => {
    await app.gotoSession()
    const dialog = await wdOpenSettings(app.driver)
    await shortcutsTab(dialog)

    const keybindButton = await firstKeybind(dialog, "settings.open")
    expect(await keybindButton.getText()).toContain(",")

    await keybindButton.click()
    await app.driver.wait(async () => /press/i.test(await keybindButton.getText()), 5000)

    await chordModSlash(app.driver)
    await delay()

    expect(await keybindButton.getText()).toContain("/")

    const stored = await readSettingsV3(app.driver)
    expect(stored?.keybinds?.["settings.open"]).toBe("mod+/")

    await wdCloseDialog(app.driver)
    expect((await app.driver.findElements(By.css('[role="dialog"]'))).length).toBe(0)

    await chordModSlash(app.driver)
    await delay()
    await waitVisible(app.driver, By.css('[role="dialog"]'))

    await wdCloseDialog(app.driver)
  })

  test("changing new session keybind works", async () => {
    const listSdk = createOpencodeClient({ baseUrl: serverUrl(), throwOnError: true })
    const created = await listSdk.project.create({ name: `e2e keybind ${Date.now()}` })
    if (!created.data?.project?.id) throw new Error("project create failed")
    const pid = created.data.project.id
    const sdk = createSdk({ id: pid })

    await withSession(sdk, "test session for keybind", async (session) => {
      await openProjectSession(app.driver, app.origin, pid, session.id)
      expect(await app.driver.getCurrentUrl()).toContain(`/session/${session.id}`)

      const dialog = await wdOpenSettings(app.driver)
      await shortcutsTab(dialog)

      const keybindButton = await firstKeybind(dialog, "session.new")
      await keybindButton.click()
      await app.driver.wait(async () => /press/i.test(await keybindButton.getText()), 5000)

      await chordModShiftN(app.driver)
      await delay()
      expect(await keybindButton.getText()).toContain("N")

      const stored = await readSettingsV3(app.driver)
      expect(stored?.keybinds?.["session.new"]).toBe("mod+shift+n")

      await wdCloseDialog(app.driver)

      await chordModShiftN(app.driver)
      await new Promise((r) => setTimeout(r, 200))

      const u = await app.driver.getCurrentUrl()
      expect(u).toMatch(/\/session\/?$/)
      expect(u).not.toContain(session.id)
    })
  })

  test("changing file open keybind works", async () => {
    await app.gotoSession()
    const dialog = await wdOpenSettings(app.driver)
    await shortcutsTab(dialog)

    const keybindButton = await firstKeybind(dialog, "file.open")
    expect(await keybindButton.getText()).toContain("P")

    await keybindButton.click()
    await app.driver.wait(async () => /press/i.test(await keybindButton.getText()), 5000)

    await chordModShiftF(app.driver)
    await delay()
    expect(await keybindButton.getText()).toContain("F")

    const stored = await readSettingsV3(app.driver)
    expect(stored?.keybinds?.["file.open"]).toBe("mod+shift+f")

    await wdCloseDialog(app.driver)

    await chordModShiftF(app.driver)
    await delay()
    await waitVisible(
      app.driver,
      By.xpath(
        `//*[@role="dialog"][.//*[contains(translate(@placeholder, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "search file")]]`,
      ),
    )

    await app.driver.actions().sendKeys(Key.ESCAPE).perform()
    await app.driver.wait(async () => (await app.driver.findElements(By.css('[role="dialog"]'))).length === 0, 10_000)
  })

  test("changing command palette keybind works", async () => {
    await app.gotoSession()
    const dialog = await wdOpenSettings(app.driver)
    await shortcutsTab(dialog)

    const keybindButton = await firstKeybind(dialog, "command.palette")
    expect(await keybindButton.getText()).toContain("P")

    await keybindButton.click()
    await app.driver.wait(async () => /press/i.test(await keybindButton.getText()), 5000)

    await chordModShiftK(app.driver)
    await delay()
    expect(await keybindButton.getText()).toContain("K")

    const stored = await readSettingsV3(app.driver)
    expect(stored?.keybinds?.["command.palette"]).toBe("mod+shift+k")

    await wdCloseDialog(app.driver)

    await chordModShiftK(app.driver)
    await delay()
    await waitVisible(app.driver, By.css('[role="dialog"]'))
    await waitVisible(app.driver, By.css('[role="dialog"] [role="textbox"], [role="dialog"] textarea'))

    await app.driver.actions().sendKeys(Key.ESCAPE).perform()
    await app.driver.wait(async () => (await app.driver.findElements(By.css('[role="dialog"]'))).length === 0, 10_000)
  })
})
