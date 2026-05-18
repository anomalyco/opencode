import type { Page } from "playwright"
import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { closeDialog, openSettings } from "../../../../e2e/actions"
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

const settingsKey = "settings.v3"

async function readSettings(page: Page, key: string) {
  const raw = await page.evaluate((k: string) => localStorage.getItem(k), key)
  if (typeof raw !== "string" || raw.length === 0) return null
  return JSON.parse(raw) as Record<string, unknown>
}

async function clickSelectItem(page: Page, text: string) {
  await page.locator('[data-slot="select-select-item"]').filter({ hasText: text }).first().click()
}

describe("settings general", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("changing language updates settings labels", async () => {
    await app.page.goto(app.origin)
    await app.page.evaluate(() => {
      localStorage.setItem("opencode.global.dat:language", JSON.stringify({ locale: "en" }))
    })
    await app.gotoSession()

    const dialog = await openSettings(app.page)
    const heading = dialog.getByRole("heading", { level: 2 })
    expect((await heading.textContent())?.trim()).toBe("General")

    const select = dialog.locator(settingsLanguageSelectSelector)
    await select.locator('[data-slot="select-select-trigger"]').click()
    await clickSelectItem(app.page, "Deutsch")
    expect((await heading.textContent())?.trim()).toBe("Allgemein")

    await select.locator('[data-slot="select-select-trigger"]').click()
    await clickSelectItem(app.page, "English")
    expect((await heading.textContent())?.trim()).toBe("General")
    await closeDialog(app.page, dialog)
  })

  test("changing color scheme persists in localStorage", async () => {
    await app.gotoSession()
    const dialog = await openSettings(app.page)
    const select = dialog.locator(settingsColorSchemeSelector)
    await select.locator('[data-slot="select-select-trigger"]').click()
    await clickSelectItem(app.page, "Dark")
    const dark = await app.page.evaluate(() => document.documentElement.getAttribute("data-color-scheme"))
    expect(dark).toBe("dark")

    await select.locator('[data-slot="select-select-trigger"]').click()
    await clickSelectItem(app.page, "Light")
    const light = await app.page.evaluate(() => document.documentElement.getAttribute("data-color-scheme"))
    expect(light).toBe("light")
    await closeDialog(app.page, dialog)
  })

  test("changing theme persists in localStorage", async () => {
    await app.gotoSession()
    const dialog = await openSettings(app.page)
    const select = dialog.locator(settingsThemeSelector)

    const currentThemeId = await app.page.evaluate(() => document.documentElement.getAttribute("data-theme"))
    const currentTheme = (
      (await select.locator('[data-slot="select-select-trigger-value"]').textContent()) ?? ""
    ).trim()

    await select.locator('[data-slot="select-select-trigger"]').click()
    const items = app.page.locator('[data-slot="select-select-item"]')
    expect(await items.count()).toBeGreaterThan(1)

    let picked = ""
    const n = await items.count()
    for (let i = 0; i < n; i++) {
      const el = items.nth(i)
      const t = ((await el.locator('[data-slot="select-select-item-label"]').textContent()) ?? "").trim()
      if (t.length > 0 && t !== currentTheme) {
        picked = t
        await el.click()
        break
      }
    }
    expect(picked.length).toBeGreaterThan(0)

    await app.page.keyboard.press("Escape")

    const storedThemeId = await app.page.evaluate(() => localStorage.getItem("opencode-theme-id"))
    expect(typeof storedThemeId).toBe("string")
    expect(storedThemeId).not.toBe(currentThemeId)

    const dataTheme = await app.page.evaluate(() => document.documentElement.getAttribute("data-theme"))
    expect(dataTheme).toBe(storedThemeId)
    await closeDialog(app.page, dialog)
  })

  test("legacy oc-1 theme migrates to oc-2", async () => {
    await app.page.goto(app.origin)
    await app.page.evaluate(() => {
      localStorage.setItem("opencode-theme-id", "oc-1")
      localStorage.setItem("opencode-theme-css-light", "--background-base:#fff;")
      localStorage.setItem("opencode-theme-css-dark", "--background-base:#000;")
    })
    await app.gotoSession()

    const html = app.page.locator("html")
    expect(await html.getAttribute("data-theme")).toBe("oc-2")

    await expect
      .poll(async () => await app.page.evaluate(() => localStorage.getItem("opencode-theme-id")), { timeout: 30_000 })
      .toBe("oc-2")
    await expect
      .poll(async () => await app.page.evaluate(() => localStorage.getItem("opencode-theme-css-light")), {
        timeout: 30_000,
      })
      .toBeNull()
    await expect
      .poll(async () => await app.page.evaluate(() => localStorage.getItem("opencode-theme-css-dark")), {
        timeout: 30_000,
      })
      .toBeNull()
  })

  test("changing font persists in localStorage and updates CSS variable", async () => {
    await app.gotoSession()
    const dialog = await openSettings(app.page)
    const select = dialog.locator(settingsFontSelector)

    const initialFont = await app.page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono"),
    )
    expect(String(initialFont)).toContain("IBM Plex Mono")

    await select.locator('[data-slot="select-select-trigger"]').click()
    await app.page.locator('[data-slot="select-select-item"]').nth(2).click()
    await new Promise((r) => setTimeout(r, 100))

    const stored = await readSettings(app.page, settingsKey)
    const appearance = stored?.appearance as Record<string, unknown> | undefined
    expect(appearance?.font).not.toBe("ibm-plex-mono")

    const nextFont = await app.page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono"),
    )
    expect(nextFont).not.toBe(initialFont)
    await closeDialog(app.page, dialog)
  })

  test("color scheme and font rehydrate after reload", async () => {
    await app.gotoSession()
    const dialog = await openSettings(app.page)

    const colorSchemeSelect = dialog.locator(settingsColorSchemeSelector)
    await colorSchemeSelect.locator('[data-slot="select-select-trigger"]').click()
    await clickSelectItem(app.page, "Dark")
    const html = app.page.locator("html")
    expect(await html.getAttribute("data-color-scheme")).toBe("dark")

    const fontSelect = dialog.locator(settingsFontSelector)
    const initialFontFamily = await app.page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono").trim(),
    )
    const initialSettings = await readSettings(app.page, settingsKey)

    const currentFont = (
      (await fontSelect.locator('[data-slot="select-select-trigger-value"]').textContent()) ?? ""
    ).trim()
    await fontSelect.locator('[data-slot="select-select-trigger"]').click()
    const fontItems = app.page.locator('[data-slot="select-select-item"]')
    expect(await fontItems.count()).toBeGreaterThan(1)
    const fc = await fontItems.count()
    if (currentFont.length > 0) {
      for (let i = 0; i < fc; i++) {
        const el = fontItems.nth(i)
        const tx = (await el.textContent()) ?? ""
        if (!tx.includes(currentFont)) {
          await el.click()
          break
        }
      }
    }
    if (currentFont.length === 0) await fontItems.nth(1).click()

    await expect
      .poll(async () => {
        const s = await readSettings(app.page, settingsKey)
        const a = s?.appearance as Record<string, unknown> | undefined
        return typeof a?.font === "string"
      }, { timeout: 30_000 })
      .toBe(true)

    const updatedSettings = await readSettings(app.page, settingsKey)
    const updatedFontFamily = await app.page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono").trim(),
    )
    expect(updatedFontFamily).not.toBe(initialFontFamily)
    const initApp = initialSettings?.appearance as Record<string, unknown> | undefined
    const updApp = updatedSettings?.appearance as Record<string, unknown> | undefined
    expect(updApp?.font).not.toBe(initApp?.font)

    await closeDialog(app.page, dialog)
    await app.page.reload()
    await app.page.locator(promptSelector).waitFor({ state: "visible" })

    expect(await app.page.locator("html").getAttribute("data-color-scheme")).toBe("dark")

    await expect
      .poll(async () => {
        const s = await readSettings(app.page, settingsKey)
        const a = s?.appearance as Record<string, unknown> | undefined
        return a?.font === updApp?.font
      }, { timeout: 30_000 })
      .toBe(true)

    const rehydrated = await readSettings(app.page, settingsKey)
    const rehydratedFont = await app.page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono").trim(),
    )
    expect(rehydratedFont).not.toBe(initialFontFamily)
    const rApp = rehydrated?.appearance as Record<string, unknown> | undefined
    expect(rApp?.font).toBe(updApp?.font)
  })

  test("toggling notification agent switch updates localStorage", async () => {
    await app.gotoSession()
    const dialog = await openSettings(app.page)
    const box = dialog.locator(settingsNotificationsAgentSelector)
    const input = box.locator('[data-slot="switch-input"]')
    expect(await input.getAttribute("checked")).not.toBe(null)
    await box.locator('[data-slot="switch-control"]').click()
    await new Promise((r) => setTimeout(r, 100))
    expect(await input.getAttribute("checked")).toBe(null)
    const stored = await readSettings(app.page, settingsKey)
    const n = stored?.notifications as Record<string, unknown> | undefined
    expect(n?.agent).toBe(false)
    await closeDialog(app.page, dialog)
  })

  test("toggling notification permissions switch updates localStorage", async () => {
    await app.gotoSession()
    const dialog = await openSettings(app.page)
    const box = dialog.locator(settingsNotificationsPermissionsSelector)
    const input = box.locator('[data-slot="switch-input"]')
    expect(await input.getAttribute("checked")).not.toBe(null)
    await box.locator('[data-slot="switch-control"]').click()
    await new Promise((r) => setTimeout(r, 100))
    expect(await input.getAttribute("checked")).toBe(null)
    const stored = await readSettings(app.page, settingsKey)
    const n = stored?.notifications as Record<string, unknown> | undefined
    expect(n?.permissions).toBe(false)
    await closeDialog(app.page, dialog)
  })

  test("toggling notification errors switch updates localStorage", async () => {
    await app.gotoSession()
    const dialog = await openSettings(app.page)
    const box = dialog.locator(settingsNotificationsErrorsSelector)
    const input = box.locator('[data-slot="switch-input"]')
    expect(await input.getAttribute("checked")).toBe(null)
    await box.locator('[data-slot="switch-control"]').click()
    await new Promise((r) => setTimeout(r, 100))
    expect(await input.getAttribute("checked")).not.toBe(null)
    const stored = await readSettings(app.page, settingsKey)
    const n = stored?.notifications as Record<string, unknown> | undefined
    expect(n?.errors).toBe(true)
    await closeDialog(app.page, dialog)
  })

  test("changing sound agent selection persists in localStorage", async () => {
    await app.gotoSession()
    const dialog = await openSettings(app.page)
    const select = dialog.locator(settingsSoundsAgentSelector)
    await select.locator('[data-slot="select-select-trigger"]').click()
    await app.page.locator('[data-slot="select-select-item"]').nth(2).click()
    const stored = await readSettings(app.page, settingsKey)
    const s = stored?.sounds as Record<string, unknown> | undefined
    expect(s?.agent).not.toBe("staplebops-01")
    await closeDialog(app.page, dialog)
  })

  test("selecting none disables agent sound", async () => {
    await app.gotoSession()
    const dialog = await openSettings(app.page)
    const select = dialog.locator(settingsSoundsAgentSelector)
    const trigger = select.locator('[data-slot="select-select-trigger"]')
    await trigger.click()
    await app.page.locator('[data-slot="select-select-item"]').nth(0).click()
    const stored = await readSettings(app.page, settingsKey)
    const s = stored?.sounds as Record<string, unknown> | undefined
    expect(s?.agentEnabled).toBe(false)
    await closeDialog(app.page, dialog)
  })

  test("changing permissions and errors sounds updates localStorage", async () => {
    await app.gotoSession()
    const dialog = await openSettings(app.page)
    const permissionsSelect = dialog.locator(settingsSoundsPermissionsSelector)
    const errorsSelect = dialog.locator(settingsSoundsErrorsSelector)

    const initial = await readSettings(app.page, settingsKey)
    const permCur = (
      (await permissionsSelect.locator('[data-slot="select-select-trigger-value"]').textContent()) ?? ""
    ).trim()
    await permissionsSelect.locator('[data-slot="select-select-trigger"]').click()
    let permItems = app.page.locator('[data-slot="select-select-item"]')
    expect(await permItems.count()).toBeGreaterThan(1)
    const pc = await permItems.count()
    if (permCur.length > 0) {
      for (let i = 0; i < pc; i++) {
        const el = permItems.nth(i)
        const tx = (await el.textContent()) ?? ""
        if (!tx.includes(permCur)) {
          await el.click()
          break
        }
      }
    }
    if (permCur.length === 0) await permItems.nth(1).click()

    const errCur = ((await errorsSelect.locator('[data-slot="select-select-trigger-value"]').textContent()) ?? "").trim()
    await errorsSelect.locator('[data-slot="select-select-trigger"]').click()
    permItems = app.page.locator('[data-slot="select-select-item"]')
    expect(await permItems.count()).toBeGreaterThan(1)
    const ec = await permItems.count()
    if (errCur.length > 0) {
      for (let i = 0; i < ec; i++) {
        const el = permItems.nth(i)
        const tx = (await el.textContent()) ?? ""
        if (!tx.includes(errCur)) {
          await el.click()
          break
        }
      }
    }
    if (errCur.length === 0) await permItems.nth(1).click()

    await expect
      .poll(async () => {
        const st = await readSettings(app.page, settingsKey)
        const snd = st?.sounds as Record<string, unknown> | undefined
        return typeof snd?.permissions === "string" && typeof snd?.errors === "string"
      }, { timeout: 30_000 })
      .toBe(true)

    const stored = await readSettings(app.page, settingsKey)
    const snd = stored?.sounds as Record<string, unknown> | undefined
    const ini = initial?.sounds as Record<string, unknown> | undefined
    expect(snd?.permissions).not.toBe(ini?.permissions)
    expect(snd?.errors).not.toBe(ini?.errors)
    await closeDialog(app.page, dialog)
  })

  test("toggling updates startup switch updates localStorage", async () => {
    await app.gotoSession()
    const dialog = await openSettings(app.page)
    const box = dialog.locator(settingsUpdatesStartupSelector)
    const input = box.locator('[data-slot="switch-input"]')
    const disabled = await input.getAttribute("disabled")
    if (disabled !== null) {
      await closeDialog(app.page, dialog)
      expect(true).toBe(true)
      return
    }
    expect(await input.getAttribute("checked")).not.toBe(null)
    await box.locator('[data-slot="switch-control"]').click()
    await new Promise((r) => setTimeout(r, 100))
    expect(await input.getAttribute("checked")).toBe(null)
    const stored = await readSettings(app.page, settingsKey)
    const u = stored?.updates as Record<string, unknown> | undefined
    expect(u?.startup).toBe(false)
    await closeDialog(app.page, dialog)
  })

  test("toggling release notes switch updates localStorage", async () => {
    await app.gotoSession()
    const dialog = await openSettings(app.page)
    const box = dialog.locator(settingsReleaseNotesSelector)
    const input = box.locator('[data-slot="switch-input"]')
    expect(await input.getAttribute("checked")).not.toBe(null)
    await box.locator('[data-slot="switch-control"]').click()
    await new Promise((r) => setTimeout(r, 100))
    expect(await input.getAttribute("checked")).toBe(null)
    const stored = await readSettings(app.page, settingsKey)
    const g = stored?.general as Record<string, unknown> | undefined
    expect(g?.releaseNotes).toBe(false)
    await closeDialog(app.page, dialog)
  })
})
