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
  settingsSoundsErrorsSelector,
  settingsSoundsPermissionsSelector,
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

test("color scheme and font rehydrate after reload", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)

  const colorSchemeSelect = dialog.locator(settingsColorSchemeSelector)
  await expect(colorSchemeSelect).toBeVisible()
  await colorSchemeSelect.locator('[data-slot="select-select-trigger"]').click()
  await page.locator('[data-slot="select-select-item"]').filter({ hasText: "Dark" }).click()
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")

  const fontSelect = dialog.locator(settingsFontSelector)
  await expect(fontSelect).toBeVisible()

  const initialFontFamily = await page.evaluate(() => {
    return getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono").trim()
  })

  const initialSettings = await page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  }, settingsKey)

  const currentFont =
    (await fontSelect.locator('[data-slot="select-select-trigger-value"]').textContent())?.trim() ?? ""
  await fontSelect.locator('[data-slot="select-select-trigger"]').click()

  const fontItems = page.locator('[data-slot="select-select-item"]')
  expect(await fontItems.count()).toBeGreaterThan(1)

  if (currentFont) {
    await fontItems.filter({ hasNotText: currentFont }).first().click()
  }
  if (!currentFont) {
    await fontItems.nth(1).click()
  }

  await expect
    .poll(async () => {
      return await page.evaluate((key) => {
        const raw = localStorage.getItem(key)
        return raw ? JSON.parse(raw) : null
      }, settingsKey)
    })
    .toMatchObject({
      appearance: {
        font: expect.any(String),
      },
    })

  const updatedSettings = await page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  }, settingsKey)

  const updatedFontFamily = await page.evaluate(() => {
    return getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono").trim()
  })
  expect(updatedFontFamily).not.toBe(initialFontFamily)
  expect(updatedSettings?.appearance?.font).not.toBe(initialSettings?.appearance?.font)

  await closeDialog(page, dialog)
  await page.reload()

  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")

  await expect
    .poll(async () => {
      return await page.evaluate((key) => {
        const raw = localStorage.getItem(key)
        return raw ? JSON.parse(raw) : null
      }, settingsKey)
    })
    .toMatchObject({
      appearance: {
        font: updatedSettings?.appearance?.font,
      },
    })

  const rehydratedSettings = await page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  }, settingsKey)

  await expect
    .poll(async () => {
      return await page.evaluate(() => {
        return getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono").trim()
      })
    })
    .not.toBe(initialFontFamily)

  const rehydratedFontFamily = await page.evaluate(() => {
    return getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono").trim()
  })
  expect(rehydratedFontFamily).not.toBe(initialFontFamily)
  expect(rehydratedSettings?.appearance?.font).toBe(updatedSettings?.appearance?.font)
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

test("changing permissions and errors sounds updates localStorage", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  const permissionsSelect = dialog.locator(settingsSoundsPermissionsSelector)
  const errorsSelect = dialog.locator(settingsSoundsErrorsSelector)
  await expect(permissionsSelect).toBeVisible()
  await expect(errorsSelect).toBeVisible()

  const initial = await page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  }, settingsKey)

  const permissionsCurrent =
    (await permissionsSelect.locator('[data-slot="select-select-trigger-value"]').textContent())?.trim() ?? ""
  await permissionsSelect.locator('[data-slot="select-select-trigger"]').click()
  const permissionItems = page.locator('[data-slot="select-select-item"]')
  expect(await permissionItems.count()).toBeGreaterThan(1)
  if (permissionsCurrent) {
    await permissionItems.filter({ hasNotText: permissionsCurrent }).first().click()
  }
  if (!permissionsCurrent) {
    await permissionItems.nth(1).click()
  }

  const errorsCurrent =
    (await errorsSelect.locator('[data-slot="select-select-trigger-value"]').textContent())?.trim() ?? ""
  await errorsSelect.locator('[data-slot="select-select-trigger"]').click()
  const errorItems = page.locator('[data-slot="select-select-item"]')
  expect(await errorItems.count()).toBeGreaterThan(1)
  if (errorsCurrent) {
    await errorItems.filter({ hasNotText: errorsCurrent }).first().click()
  }
  if (!errorsCurrent) {
    await errorItems.nth(1).click()
  }

  await expect
    .poll(async () => {
      return await page.evaluate((key) => {
        const raw = localStorage.getItem(key)
        return raw ? JSON.parse(raw) : null
      }, settingsKey)
    })
    .toMatchObject({
      sounds: {
        permissions: expect.any(String),
        errors: expect.any(String),
      },
    })

  const stored = await page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  }, settingsKey)

  expect(stored?.sounds?.permissions).not.toBe(initial?.sounds?.permissions)
  expect(stored?.sounds?.errors).not.toBe(initial?.sounds?.errors)
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
