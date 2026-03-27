import { test, expect, settingsKey } from "../fixtures"
import { closeDialog, openSettings } from "../actions"
import {
  settingsColorSchemeSelector,
  settingsCodeFontSelector,
  settingsLanguageSelectSelector,
  settingsNotificationsAgentSelector,
  settingsNotificationsErrorsSelector,
  settingsNotificationsPermissionsSelector,
  settingsReleaseNotesSelector,
  settingsSoundsAgentSelector,
  settingsSoundsErrorsSelector,
  settingsSoundsPermissionsSelector,
  settingsThemeSelector,
  settingsUIFontSelector,
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

  const currentThemeId = await page.evaluate(() => {
    return document.documentElement.getAttribute("data-theme")
  })
  const currentTheme = (await select.locator('[data-slot="select-select-trigger-value"]').textContent())?.trim() ?? ""

  await select.locator('[data-slot="select-select-trigger"]').click()

  const items = page.locator('[data-slot="select-select-item"]')
  const count = await items.count()
  expect(count).toBeGreaterThan(1)

  const nextTheme = (await items.locator('[data-slot="select-select-item-label"]').allTextContents())
    .map((x) => x.trim())
    .find((x) => x && x !== currentTheme)
  expect(nextTheme).toBeTruthy()

  await items.filter({ hasText: nextTheme! }).first().click()

  await page.keyboard.press("Escape")

  const storedThemeId = await page.evaluate(() => {
    return localStorage.getItem("opencode-theme-id")
  })

  expect(storedThemeId).not.toBeNull()
  expect(storedThemeId).not.toBe(currentThemeId)

  const dataTheme = await page.evaluate(() => {
    return document.documentElement.getAttribute("data-theme")
  })
  expect(dataTheme).toBe(storedThemeId)
})

test("legacy oc-1 theme migrates to oc-2", async ({ page, gotoSession }) => {
  await page.addInitScript(() => {
    localStorage.setItem("opencode-theme-id", "oc-1")
    localStorage.setItem("opencode-theme-css-light", "--background-base:#fff;")
    localStorage.setItem("opencode-theme-css-dark", "--background-base:#000;")
  })

  await gotoSession()

  await expect(page.locator("html")).toHaveAttribute("data-theme", "oc-2")

  await expect
    .poll(async () => {
      return await page.evaluate(() => {
        return localStorage.getItem("opencode-theme-id")
      })
    })
    .toBe("oc-2")

  await expect
    .poll(async () => {
      return await page.evaluate(() => {
        return localStorage.getItem("opencode-theme-css-light")
      })
    })
    .toBeNull()

  await expect
    .poll(async () => {
      return await page.evaluate(() => {
        return localStorage.getItem("opencode-theme-css-dark")
      })
    })
    .toBeNull()
})

test("typing a code font with spaces persists and updates CSS variable", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  const input = dialog.locator(settingsCodeFontSelector)
  await expect(input).toBeVisible()
  await expect(input).toHaveAttribute("placeholder", "IBM Plex Mono")

  const initialFontFamily = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono").trim(),
  )
  const initialUIFamily = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--font-family-sans").trim(),
  )
  expect(initialFontFamily).toContain("IBM Plex Mono")

  const next = "Test Mono"

  await input.click()
  await input.clear()
  await input.pressSequentially(next)
  await expect(input).toHaveValue(next)

  await expect
    .poll(async () => {
      return await page.evaluate((key) => {
        const raw = localStorage.getItem(key)
        return raw ? JSON.parse(raw) : null
      }, settingsKey)
    })
    .toMatchObject({
      appearance: {
        font: next,
      },
    })

  const newFontFamily = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono").trim(),
  )
  const newUIFamily = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--font-family-sans").trim(),
  )
  expect(newFontFamily).toContain(next)
  expect(newFontFamily).not.toBe(initialFontFamily)
  expect(newUIFamily).toBe(initialUIFamily)
})

test("typing a UI font with spaces persists and updates CSS variable", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  const input = dialog.locator(settingsUIFontSelector)
  await expect(input).toBeVisible()
  await expect(input).toHaveAttribute("placeholder", "Inter")

  const initialFontFamily = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--font-family-sans").trim(),
  )
  const initialCodeFamily = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono").trim(),
  )
  expect(initialFontFamily).toContain("Inter")

  const next = "Test Sans"

  await input.click()
  await input.clear()
  await input.pressSequentially(next)
  await expect(input).toHaveValue(next)

  await expect
    .poll(async () => {
      return await page.evaluate((key) => {
        const raw = localStorage.getItem(key)
        return raw ? JSON.parse(raw) : null
      }, settingsKey)
    })
    .toMatchObject({
      appearance: {
        uiFont: next,
      },
    })

  const newFontFamily = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--font-family-sans").trim(),
  )
  const newCodeFamily = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono").trim(),
  )
  expect(newFontFamily).toContain(next)
  expect(newFontFamily).not.toBe(initialFontFamily)
  expect(newCodeFamily).toBe(initialCodeFamily)
})

test("clearing the code font field restores the default placeholder and stack", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  const input = dialog.locator(settingsCodeFontSelector)
  await expect(input).toBeVisible()

  await input.click()
  await input.clear()
  await input.pressSequentially("Reset Mono")

  await expect
    .poll(async () => {
      return await page.evaluate((key) => {
        const raw = localStorage.getItem(key)
        return raw ? JSON.parse(raw) : null
      }, settingsKey)
    })
    .toMatchObject({
      appearance: {
        font: "Reset Mono",
      },
    })

  await input.clear()
  await input.press("Space")
  await expect(input).toHaveValue("")
  await expect(input).toHaveAttribute("placeholder", "IBM Plex Mono")

  await expect
    .poll(async () => {
      return await page.evaluate((key) => {
        const raw = localStorage.getItem(key)
        return raw ? JSON.parse(raw) : null
      }, settingsKey)
    })
    .toMatchObject({
      appearance: {
        font: "",
      },
    })

  const fontFamily = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono").trim(),
  )
  expect(fontFamily).toContain("IBM Plex Mono")
  expect(fontFamily).not.toContain("Reset Mono")
})

test("clearing the UI font field restores the default placeholder and stack", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  const input = dialog.locator(settingsUIFontSelector)
  await expect(input).toBeVisible()

  await input.click()
  await input.clear()
  await input.pressSequentially("Reset Sans")

  await expect
    .poll(async () => {
      return await page.evaluate((key) => {
        const raw = localStorage.getItem(key)
        return raw ? JSON.parse(raw) : null
      }, settingsKey)
    })
    .toMatchObject({
      appearance: {
        uiFont: "Reset Sans",
      },
    })

  await input.clear()
  await input.press("Space")
  await expect(input).toHaveValue("")
  await expect(input).toHaveAttribute("placeholder", "Inter")

  await expect
    .poll(async () => {
      return await page.evaluate((key) => {
        const raw = localStorage.getItem(key)
        return raw ? JSON.parse(raw) : null
      }, settingsKey)
    })
    .toMatchObject({
      appearance: {
        uiFont: "",
      },
    })

  const fontFamily = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--font-family-sans").trim(),
  )
  expect(fontFamily).toContain("Inter")
  expect(fontFamily).not.toContain("Reset Sans")
})

test("color scheme, code font, and UI font rehydrate after reload", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)

  const colorSchemeSelect = dialog.locator(settingsColorSchemeSelector)
  await expect(colorSchemeSelect).toBeVisible()
  await colorSchemeSelect.locator('[data-slot="select-select-trigger"]').click()
  await page.locator('[data-slot="select-select-item"]').filter({ hasText: "Dark" }).click()
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")

  const code = dialog.locator(settingsCodeFontSelector)
  const ui = dialog.locator(settingsUIFontSelector)
  await expect(code).toBeVisible()
  await expect(ui).toBeVisible()

  const initialMono = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono").trim(),
  )
  const initialSans = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--font-family-sans").trim(),
  )

  const initialSettings = await page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  }, settingsKey)

  const mono = initialSettings?.appearance?.font === "Reload Mono" ? "Reload Mono 2" : "Reload Mono"
  const sans = initialSettings?.appearance?.uiFont === "Reload Sans" ? "Reload Sans 2" : "Reload Sans"

  await code.click()
  await code.clear()
  await code.pressSequentially(mono)
  await expect(code).toHaveValue(mono)

  await ui.click()
  await ui.clear()
  await ui.pressSequentially(sans)
  await expect(ui).toHaveValue(sans)

  await expect
    .poll(async () => {
      return await page.evaluate((key) => {
        const raw = localStorage.getItem(key)
        return raw ? JSON.parse(raw) : null
      }, settingsKey)
    })
    .toMatchObject({
      appearance: {
        font: mono,
        uiFont: sans,
      },
    })

  const updatedSettings = await page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  }, settingsKey)

  const updatedMono = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono").trim(),
  )
  const updatedSans = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--font-family-sans").trim(),
  )
  expect(updatedMono).toContain(mono)
  expect(updatedMono).not.toBe(initialMono)
  expect(updatedSans).toContain(sans)
  expect(updatedSans).not.toBe(initialSans)
  expect(updatedSettings?.appearance?.font).toBe(mono)
  expect(updatedSettings?.appearance?.uiFont).toBe(sans)

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
        font: mono,
        uiFont: sans,
      },
    })

  const rehydratedSettings = await page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  }, settingsKey)

  await expect
    .poll(async () => {
      return await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono").trim(),
      )
    })
    .toContain(mono)

  await expect
    .poll(async () => {
      return await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--font-family-sans").trim(),
      )
    })
    .toContain(sans)

  const rehydratedMono = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono").trim(),
  )
  const rehydratedSans = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--font-family-sans").trim(),
  )
  expect(rehydratedMono).toContain(mono)
  expect(rehydratedMono).not.toBe(initialMono)
  expect(rehydratedSans).toContain(sans)
  expect(rehydratedSans).not.toBe(initialSans)
  expect(rehydratedSettings?.appearance?.font).toBe(mono)
  expect(rehydratedSettings?.appearance?.uiFont).toBe(sans)
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

test("selecting none disables agent sound", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  const select = dialog.locator(settingsSoundsAgentSelector)
  const trigger = select.locator('[data-slot="select-select-trigger"]')
  await expect(select).toBeVisible()
  await expect(trigger).toBeEnabled()

  await trigger.click()
  const items = page.locator('[data-slot="select-select-item"]')
  await expect(items.first()).toBeVisible()
  await items.first().click()

  const stored = await page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  }, settingsKey)

  expect(stored?.sounds?.agentEnabled).toBe(false)
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
