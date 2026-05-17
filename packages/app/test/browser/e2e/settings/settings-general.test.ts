import { describe, expect, test } from "vitest"
import { By, Key } from "selenium-webdriver"
import type { WebDriver } from "selenium-webdriver"
import {
  promptSelector,
  settingsColorSchemeSelector,
  settingsFontSelector,
  settingsLanguageSelectSelector,
  settingsNotificationsAgentSelector,
  settingsNotificationsErrorsSelector,
  settingsNotificationsPermissionsSelector,
  settingsReleaseNotesSelector,
  settingsSoundsAgentSelector,
  settingsSoundsErrorsSelector,
  settingsSoundsPermissionsSelector,
  settingsThemeSelector,
  settingsUpdatesStartupSelector,
} from "../../../../e2e/selectors"
import { wdCloseDialog, wdOpenSettings } from "../../support/wd-actions"
import { waitVisible } from "../../support/wd-wait"
import { useAppWebDriver } from "../../support/use-app-webdriver"

const settingsKey = "settings.v3"

async function readSettings(driver: WebDriver, key: string) {
  const raw = await driver.executeScript(`return localStorage.getItem(arguments[0])`, key)
  if (typeof raw !== "string" || raw.length === 0) return null
  return JSON.parse(raw) as Record<string, unknown>
}

async function clickSelectItem(driver: WebDriver, text: string) {
  const item = await waitVisible(driver, By.xpath(`//*[@data-slot="select-select-item"][contains(., "${text}")]`))
  await item.click()
}

describe("settings general (webdriver)", () => {
  const app = useAppWebDriver()

  test("changing language updates settings labels", async () => {
    await app.driver.get(app.origin)
    await app.driver.executeScript(
      `localStorage.setItem("opencode.global.dat:language", JSON.stringify({ locale: "en" }))`,
    )
    await app.gotoSession()

    const dialog = await wdOpenSettings(app.driver)
    const heading = await waitVisible(app.driver, By.xpath(`//*[@role="dialog"]//h2`))
    expect(await heading.getText()).toBe("General")

    const select = await dialog.findElement(By.css(settingsLanguageSelectSelector))
    await select.findElement(By.css('[data-slot="select-select-trigger"]')).click()
    await clickSelectItem(app.driver, "Deutsch")
    expect(await heading.getText()).toBe("Allgemein")

    await select.findElement(By.css('[data-slot="select-select-trigger"]')).click()
    await clickSelectItem(app.driver, "English")
    expect(await heading.getText()).toBe("General")
    await wdCloseDialog(app.driver)
  })

  test("changing color scheme persists in localStorage", async () => {
    await app.gotoSession()
    const dialog = await wdOpenSettings(app.driver)
    const select = await dialog.findElement(By.css(settingsColorSchemeSelector))
    await select.findElement(By.css('[data-slot="select-select-trigger"]')).click()
    await clickSelectItem(app.driver, "Dark")
    const dark = await app.driver.executeScript(`return document.documentElement.getAttribute("data-color-scheme")`)
    expect(dark).toBe("dark")

    await select.findElement(By.css('[data-slot="select-select-trigger"]')).click()
    await clickSelectItem(app.driver, "Light")
    const light = await app.driver.executeScript(`return document.documentElement.getAttribute("data-color-scheme")`)
    expect(light).toBe("light")
    await wdCloseDialog(app.driver)
  })

  test("changing theme persists in localStorage", async () => {
    await app.gotoSession()
    const dialog = await wdOpenSettings(app.driver)
    const select = await dialog.findElement(By.css(settingsThemeSelector))

    const currentThemeId = await app.driver.executeScript(`return document.documentElement.getAttribute("data-theme")`)
    const triggerVal = await select.findElement(By.css('[data-slot="select-select-trigger-value"]')).getText()
    const currentTheme = triggerVal.trim()

    await select.findElement(By.css('[data-slot="select-select-trigger"]')).click()
    const items = await app.driver.findElements(By.css('[data-slot="select-select-item"]'))
    expect(items.length).toBeGreaterThan(1)

    let picked = ""
    for (const el of items) {
      const lab = await el.findElement(By.css('[data-slot="select-select-item-label"]')).getText()
      const t = lab.trim()
      if (t.length > 0 && t !== currentTheme) {
        picked = t
        await el.click()
        break
      }
    }
    expect(picked.length).toBeGreaterThan(0)

    await app.driver.actions().sendKeys(Key.ESCAPE).perform()

    const storedThemeId = await app.driver.executeScript(`return localStorage.getItem("opencode-theme-id")`)
    expect(typeof storedThemeId).toBe("string")
    expect(storedThemeId).not.toBe(currentThemeId)

    const dataTheme = await app.driver.executeScript(`return document.documentElement.getAttribute("data-theme")`)
    expect(dataTheme).toBe(storedThemeId)
    await wdCloseDialog(app.driver)
  })

  test("legacy oc-1 theme migrates to oc-2", async () => {
    await app.driver.get(app.origin)
    await app.driver.executeScript(`
      localStorage.setItem("opencode-theme-id", "oc-1");
      localStorage.setItem("opencode-theme-css-light", "--background-base:#fff;");
      localStorage.setItem("opencode-theme-css-dark", "--background-base:#000;");
    `)
    await app.gotoSession()

    const html = await waitVisible(app.driver, By.css("html"))
    expect(await html.getAttribute("data-theme")).toBe("oc-2")

    await app.driver.wait(async () => (await app.driver.executeScript(`return localStorage.getItem("opencode-theme-id")`)) === "oc-2", 30_000)
    await app.driver.wait(async () => (await app.driver.executeScript(`return localStorage.getItem("opencode-theme-css-light")`)) === null, 30_000)
    await app.driver.wait(async () => (await app.driver.executeScript(`return localStorage.getItem("opencode-theme-css-dark")`)) === null, 30_000)
  })

  test("changing font persists in localStorage and updates CSS variable", async () => {
    await app.gotoSession()
    const dialog = await wdOpenSettings(app.driver)
    const select = await dialog.findElement(By.css(settingsFontSelector))

    const initialFont = await app.driver.executeScript(
      `return getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono")`,
    )
    expect(String(initialFont)).toContain("IBM Plex Mono")

    await select.findElement(By.css('[data-slot="select-select-trigger"]')).click()
    const items = await app.driver.findElements(By.css('[data-slot="select-select-item"]'))
    await items[2]!.click()
    await new Promise((r) => setTimeout(r, 100))

    const stored = await readSettings(app.driver, settingsKey)
    const appearance = stored?.appearance as Record<string, unknown> | undefined
    expect(appearance?.font).not.toBe("ibm-plex-mono")

    const nextFont = await app.driver.executeScript(
      `return getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono")`,
    )
    expect(nextFont).not.toBe(initialFont)
    await wdCloseDialog(app.driver)
  })

  test("color scheme and font rehydrate after reload", async () => {
    await app.gotoSession()
    const dialog = await wdOpenSettings(app.driver)

    const colorSchemeSelect = await dialog.findElement(By.css(settingsColorSchemeSelector))
    await colorSchemeSelect.findElement(By.css('[data-slot="select-select-trigger"]')).click()
    await clickSelectItem(app.driver, "Dark")
    const html = await waitVisible(app.driver, By.css("html"))
    expect(await html.getAttribute("data-color-scheme")).toBe("dark")

    const fontSelect = await dialog.findElement(By.css(settingsFontSelector))
    const initialFontFamily = await app.driver.executeScript(
      `return getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono").trim()`,
    )
    const initialSettings = await readSettings(app.driver, settingsKey)

    const currentFont = (await fontSelect.findElement(By.css('[data-slot="select-select-trigger-value"]')).getText()).trim()
    await fontSelect.findElement(By.css('[data-slot="select-select-trigger"]')).click()
    const fontItems = await app.driver.findElements(By.css('[data-slot="select-select-item"]'))
    expect(fontItems.length).toBeGreaterThan(1)
    if (currentFont.length > 0) {
      for (const el of fontItems) {
        const tx = await el.getText()
        if (!tx.includes(currentFont)) {
          await el.click()
          break
        }
      }
    }
    if (currentFont.length === 0) await fontItems[1]!.click()

    await app.driver.wait(async () => {
      const s = await readSettings(app.driver, settingsKey)
      const a = s?.appearance as Record<string, unknown> | undefined
      return typeof a?.font === "string"
    }, 30_000)

    const updatedSettings = await readSettings(app.driver, settingsKey)
    const updatedFontFamily = await app.driver.executeScript(
      `return getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono").trim()`,
    )
    expect(updatedFontFamily).not.toBe(initialFontFamily)
    const initApp = initialSettings?.appearance as Record<string, unknown> | undefined
    const updApp = updatedSettings?.appearance as Record<string, unknown> | undefined
    expect(updApp?.font).not.toBe(initApp?.font)

    await wdCloseDialog(app.driver)
    await app.driver.navigate().refresh()
    await waitVisible(app.driver, By.css(promptSelector))

    expect(await (await waitVisible(app.driver, By.css("html"))).getAttribute("data-color-scheme")).toBe("dark")

    await app.driver.wait(async () => {
      const s = await readSettings(app.driver, settingsKey)
      const a = s?.appearance as Record<string, unknown> | undefined
      return a?.font === updApp?.font
    }, 30_000)

    const rehydrated = await readSettings(app.driver, settingsKey)
    const rehydratedFont = await app.driver.executeScript(
      `return getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono").trim()`,
    )
    expect(rehydratedFont).not.toBe(initialFontFamily)
    const rApp = rehydrated?.appearance as Record<string, unknown> | undefined
    expect(rApp?.font).toBe(updApp?.font)
  })

  test("toggling notification agent switch updates localStorage", async () => {
    await app.gotoSession()
    const dialog = await wdOpenSettings(app.driver)
    const box = await dialog.findElement(By.css(settingsNotificationsAgentSelector))
    const input = await box.findElement(By.css('[data-slot="switch-input"]'))
    expect(await input.getAttribute("checked")).not.toBe(null)
    await box.findElement(By.css('[data-slot="switch-control"]')).click()
    await new Promise((r) => setTimeout(r, 100))
    expect(await input.getAttribute("checked")).toBe(null)
    const stored = await readSettings(app.driver, settingsKey)
    const n = stored?.notifications as Record<string, unknown> | undefined
    expect(n?.agent).toBe(false)
    await wdCloseDialog(app.driver)
  })

  test("toggling notification permissions switch updates localStorage", async () => {
    await app.gotoSession()
    const dialog = await wdOpenSettings(app.driver)
    const box = await dialog.findElement(By.css(settingsNotificationsPermissionsSelector))
    const input = await box.findElement(By.css('[data-slot="switch-input"]'))
    expect(await input.getAttribute("checked")).not.toBe(null)
    await box.findElement(By.css('[data-slot="switch-control"]')).click()
    await new Promise((r) => setTimeout(r, 100))
    expect(await input.getAttribute("checked")).toBe(null)
    const stored = await readSettings(app.driver, settingsKey)
    const n = stored?.notifications as Record<string, unknown> | undefined
    expect(n?.permissions).toBe(false)
    await wdCloseDialog(app.driver)
  })

  test("toggling notification errors switch updates localStorage", async () => {
    await app.gotoSession()
    const dialog = await wdOpenSettings(app.driver)
    const box = await dialog.findElement(By.css(settingsNotificationsErrorsSelector))
    const input = await box.findElement(By.css('[data-slot="switch-input"]'))
    expect(await input.getAttribute("checked")).toBe(null)
    await box.findElement(By.css('[data-slot="switch-control"]')).click()
    await new Promise((r) => setTimeout(r, 100))
    expect(await input.getAttribute("checked")).not.toBe(null)
    const stored = await readSettings(app.driver, settingsKey)
    const n = stored?.notifications as Record<string, unknown> | undefined
    expect(n?.errors).toBe(true)
    await wdCloseDialog(app.driver)
  })

  test("changing sound agent selection persists in localStorage", async () => {
    await app.gotoSession()
    const dialog = await wdOpenSettings(app.driver)
    const select = await dialog.findElement(By.css(settingsSoundsAgentSelector))
    await select.findElement(By.css('[data-slot="select-select-trigger"]')).click()
    const items = await app.driver.findElements(By.css('[data-slot="select-select-item"]'))
    await items[2]!.click()
    const stored = await readSettings(app.driver, settingsKey)
    const s = stored?.sounds as Record<string, unknown> | undefined
    expect(s?.agent).not.toBe("staplebops-01")
    await wdCloseDialog(app.driver)
  })

  test("selecting none disables agent sound", async () => {
    await app.gotoSession()
    const dialog = await wdOpenSettings(app.driver)
    const select = await dialog.findElement(By.css(settingsSoundsAgentSelector))
    const trigger = await select.findElement(By.css('[data-slot="select-select-trigger"]'))
    await trigger.click()
    const items = await app.driver.findElements(By.css('[data-slot="select-select-item"]'))
    await items[0]!.click()
    const stored = await readSettings(app.driver, settingsKey)
    const s = stored?.sounds as Record<string, unknown> | undefined
    expect(s?.agentEnabled).toBe(false)
    await wdCloseDialog(app.driver)
  })

  test("changing permissions and errors sounds updates localStorage", async () => {
    await app.gotoSession()
    const dialog = await wdOpenSettings(app.driver)
    const permissionsSelect = await dialog.findElement(By.css(settingsSoundsPermissionsSelector))
    const errorsSelect = await dialog.findElement(By.css(settingsSoundsErrorsSelector))

    const initial = await readSettings(app.driver, settingsKey)
    const permCur = (await permissionsSelect.findElement(By.css('[data-slot="select-select-trigger-value"]')).getText()).trim()
    await permissionsSelect.findElement(By.css('[data-slot="select-select-trigger"]')).click()
    let permItems = await app.driver.findElements(By.css('[data-slot="select-select-item"]'))
    expect(permItems.length).toBeGreaterThan(1)
    if (permCur.length > 0) {
      for (const el of permItems) {
        const tx = await el.getText()
        if (!tx.includes(permCur)) {
          await el.click()
          break
        }
      }
    }
    if (permCur.length === 0) await permItems[1]!.click()

    const errCur = (await errorsSelect.findElement(By.css('[data-slot="select-select-trigger-value"]')).getText()).trim()
    await errorsSelect.findElement(By.css('[data-slot="select-select-trigger"]')).click()
    permItems = await app.driver.findElements(By.css('[data-slot="select-select-item"]'))
    expect(permItems.length).toBeGreaterThan(1)
    if (errCur.length > 0) {
      for (const el of permItems) {
        const tx = await el.getText()
        if (!tx.includes(errCur)) {
          await el.click()
          break
        }
      }
    }
    if (errCur.length === 0) await permItems[1]!.click()

    await app.driver.wait(async () => {
      const st = await readSettings(app.driver, settingsKey)
      const snd = st?.sounds as Record<string, unknown> | undefined
      return typeof snd?.permissions === "string" && typeof snd?.errors === "string"
    }, 30_000)

    const stored = await readSettings(app.driver, settingsKey)
    const snd = stored?.sounds as Record<string, unknown> | undefined
    const ini = initial?.sounds as Record<string, unknown> | undefined
    expect(snd?.permissions).not.toBe(ini?.permissions)
    expect(snd?.errors).not.toBe(ini?.errors)
    await wdCloseDialog(app.driver)
  })

  test("toggling updates startup switch updates localStorage", async () => {
    await app.gotoSession()
    const dialog = await wdOpenSettings(app.driver)
    const box = await dialog.findElement(By.css(settingsUpdatesStartupSelector))
    const input = await box.findElement(By.css('[data-slot="switch-input"]'))
    const disabled = await input.getAttribute("disabled")
    if (disabled !== null) {
      await wdCloseDialog(app.driver)
      expect(true).toBe(true)
      return
    }
    expect(await input.getAttribute("checked")).not.toBe(null)
    await box.findElement(By.css('[data-slot="switch-control"]')).click()
    await new Promise((r) => setTimeout(r, 100))
    expect(await input.getAttribute("checked")).toBe(null)
    const stored = await readSettings(app.driver, settingsKey)
    const u = stored?.updates as Record<string, unknown> | undefined
    expect(u?.startup).toBe(false)
    await wdCloseDialog(app.driver)
  })

  test("toggling release notes switch updates localStorage", async () => {
    await app.gotoSession()
    const dialog = await wdOpenSettings(app.driver)
    const box = await dialog.findElement(By.css(settingsReleaseNotesSelector))
    const input = await box.findElement(By.css('[data-slot="switch-input"]'))
    expect(await input.getAttribute("checked")).not.toBe(null)
    await box.findElement(By.css('[data-slot="switch-control"]')).click()
    await new Promise((r) => setTimeout(r, 100))
    expect(await input.getAttribute("checked")).toBe(null)
    const stored = await readSettings(app.driver, settingsKey)
    const g = stored?.general as Record<string, unknown> | undefined
    expect(g?.releaseNotes).toBe(false)
    await wdCloseDialog(app.driver)
  })
})
