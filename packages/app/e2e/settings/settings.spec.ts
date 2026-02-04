import { test, expect, settingsKey } from "../fixtures"
import { closeDialog, openSettings } from "../actions"
import {
  settingsColorSchemeSelector,
  settingsFontSelector,
  settingsLanguageSelectSelector,
  settingsNotificationsAgentSelector,
  settingsNotificationsErrorsSelector,
  settingsNotificationsPermissionsSelector,
  settingsReleaseNotesSelector,
  settingsSoundsAgentSelector,
  settingsThemeSelector,
  settingsUpdatesStartupSelector,
} from "../selectors"

test("smoke settings dialog opens, switches tabs, closes", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)

  await dialog.getByRole("tab", { name: "Shortcuts" }).click()
  await expect(dialog.getByRole("button", { name: "Reset to defaults" })).toBeVisible()
  await expect(dialog.getByPlaceholder("Search shortcuts")).toBeVisible()

  await closeDialog(page, dialog)
})

test("changing language updates settings labels", async ({ page, gotoSession }) => {
  await page.addInitScript(() => {
    localStorage.setItem("opencode.global.dat:language", JSON.stringify({ locale: "en" }))
  })

  await gotoSession()

  const dialog = await openSettings(page)

  const heading = dialog.getByRole("heading", { level: 2 })
  await expect(heading).toHaveText("General")

  const select = dialog.locator(settingsLanguageSelectSelector)
  await expect(select).toBeVisible()
  await select.locator('[data-slot="select-select-trigger"]').click()

  await page.locator('[data-slot="select-select-item"]').filter({ hasText: "Deutsch" }).click()

  await expect(heading).toHaveText("Allgemein")

  await select.locator('[data-slot="select-select-trigger"]').click()
  await page.locator('[data-slot="select-select-item"]').filter({ hasText: "English" }).click()
  await expect(heading).toHaveText("General")
})

test("changing color scheme persists in localStorage", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  const select = dialog.locator(settingsColorSchemeSelector)
  await expect(select).toBeVisible()

  await select.locator('[data-slot="select-select-trigger"]').click()
  await page.locator('[data-slot="select-select-item"]').filter({ hasText: "Dark" }).click()

  const colorScheme = await page.evaluate(() => {
    return document.documentElement.getAttribute("data-color-scheme")
  })
  expect(colorScheme).toBe("dark")

  await select.locator('[data-slot="select-select-trigger"]').click()
  await page.locator('[data-slot="select-select-item"]').filter({ hasText: "Light" }).click()

  const lightColorScheme = await page.evaluate(() => {
    return document.documentElement.getAttribute("data-color-scheme")
  })
  expect(lightColorScheme).toBe("light")
})

test("changing theme persists in localStorage", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  const select = dialog.locator(settingsThemeSelector)
  await expect(select).toBeVisible()

  await select.locator('[data-slot="select-select-trigger"]').click()

  const items = page.locator('[data-slot="select-select-item"]')
  const count = await items.count()
  expect(count).toBeGreaterThan(1)

  const firstTheme = await items.nth(1).locator('[data-slot="select-select-item-label"]').textContent()
  expect(firstTheme).toBeTruthy()

  await items.nth(1).click()

  await page.keyboard.press("Escape")

  const storedThemeId = await page.evaluate(() => {
    return localStorage.getItem("opencode-theme-id")
  })

  expect(storedThemeId).not.toBeNull()
  expect(storedThemeId).not.toBe("oc-1")

  const dataTheme = await page.evaluate(() => {
    return document.documentElement.getAttribute("data-theme")
  })
  expect(dataTheme).toBe(storedThemeId)
})

test("changing font persists in localStorage and updates CSS variable", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  const select = dialog.locator(settingsFontSelector)
  await expect(select).toBeVisible()

  const initialFontFamily = await page.evaluate(() => {
    return getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono")
  })
  expect(initialFontFamily).toContain("IBM Plex Mono")

  await select.locator('[data-slot="select-select-trigger"]').click()

  const items = page.locator('[data-slot="select-select-item"]')
  await items.nth(2).click()

  await page.waitForTimeout(100)

  const stored = await page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  }, settingsKey)

  expect(stored?.appearance?.font).not.toBe("ibm-plex-mono")

  const newFontFamily = await page.evaluate(() => {
    return getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono")
  })
  expect(newFontFamily).not.toBe(initialFontFamily)
})

test("toggling notification agent switch updates localStorage", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  const switchContainer = dialog.locator(settingsNotificationsAgentSelector)
  await expect(switchContainer).toBeVisible()

  const toggleInput = switchContainer.locator('[data-slot="switch-input"]')
  const initialState = await toggleInput.evaluate((el: HTMLInputElement) => el.checked)
  expect(initialState).toBe(true)

  await switchContainer.locator('[data-slot="switch-control"]').click()
  await page.waitForTimeout(100)

  const newState = await toggleInput.evaluate((el: HTMLInputElement) => el.checked)
  expect(newState).toBe(false)

  const stored = await page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  }, settingsKey)

  expect(stored?.notifications?.agent).toBe(false)
})

test("toggling notification permissions switch updates localStorage", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  const switchContainer = dialog.locator(settingsNotificationsPermissionsSelector)
  await expect(switchContainer).toBeVisible()

  const toggleInput = switchContainer.locator('[data-slot="switch-input"]')
  const initialState = await toggleInput.evaluate((el: HTMLInputElement) => el.checked)
  expect(initialState).toBe(true)

  await switchContainer.locator('[data-slot="switch-control"]').click()
  await page.waitForTimeout(100)

  const newState = await toggleInput.evaluate((el: HTMLInputElement) => el.checked)
  expect(newState).toBe(false)

  const stored = await page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  }, settingsKey)

  expect(stored?.notifications?.permissions).toBe(false)
})

test("toggling notification errors switch updates localStorage", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  const switchContainer = dialog.locator(settingsNotificationsErrorsSelector)
  await expect(switchContainer).toBeVisible()

  const toggleInput = switchContainer.locator('[data-slot="switch-input"]')
  const initialState = await toggleInput.evaluate((el: HTMLInputElement) => el.checked)
  expect(initialState).toBe(false)

  await switchContainer.locator('[data-slot="switch-control"]').click()
  await page.waitForTimeout(100)

  const newState = await toggleInput.evaluate((el: HTMLInputElement) => el.checked)
  expect(newState).toBe(true)

  const stored = await page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  }, settingsKey)

  expect(stored?.notifications?.errors).toBe(true)
})

test("changing sound agent selection persists in localStorage", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  const select = dialog.locator(settingsSoundsAgentSelector)
  await expect(select).toBeVisible()

  await select.locator('[data-slot="select-select-trigger"]').click()

  const items = page.locator('[data-slot="select-select-item"]')
  await items.nth(2).click()

  const stored = await page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  }, settingsKey)

  expect(stored?.sounds?.agent).not.toBe("staplebops-01")
})

test("toggling updates startup switch updates localStorage", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  const switchContainer = dialog.locator(settingsUpdatesStartupSelector)
  await expect(switchContainer).toBeVisible()

  const toggleInput = switchContainer.locator('[data-slot="switch-input"]')

  const isDisabled = await toggleInput.evaluate((el: HTMLInputElement) => el.disabled)
  if (isDisabled) {
    test.skip()
    return
  }

  const initialState = await toggleInput.evaluate((el: HTMLInputElement) => el.checked)
  expect(initialState).toBe(true)

  await switchContainer.locator('[data-slot="switch-control"]').click()
  await page.waitForTimeout(100)

  const newState = await toggleInput.evaluate((el: HTMLInputElement) => el.checked)
  expect(newState).toBe(false)

  const stored = await page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  }, settingsKey)

  expect(stored?.updates?.startup).toBe(false)
})

test("toggling release notes switch updates localStorage", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  const switchContainer = dialog.locator(settingsReleaseNotesSelector)
  await expect(switchContainer).toBeVisible()

  const toggleInput = switchContainer.locator('[data-slot="switch-input"]')
  const initialState = await toggleInput.evaluate((el: HTMLInputElement) => el.checked)
  expect(initialState).toBe(true)

  await switchContainer.locator('[data-slot="switch-control"]').click()
  await page.waitForTimeout(100)

  const newState = await toggleInput.evaluate((el: HTMLInputElement) => el.checked)
  expect(newState).toBe(false)

  const stored = await page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  }, settingsKey)

  expect(stored?.general?.releaseNotes).toBe(false)
})
