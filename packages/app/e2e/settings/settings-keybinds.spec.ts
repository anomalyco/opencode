import { test, expect } from "../fixtures"
import { openSettings, closeDialog, withSession } from "../actions"
import { keybindButtonSelector } from "../selectors"
import { modKey } from "../utils"

test("changing sidebar toggle keybind works", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("sidebar.toggle"))
  await expect(keybindButton).toBeVisible()

  const initialKeybind = await keybindButton.textContent()
  expect(initialKeybind).toContain("B")

  await keybindButton.click()
  await expect(keybindButton).toHaveText(/press/i)

  await page.keyboard.press(`${modKey}+Shift+KeyH`)
  await page.waitForTimeout(100)

  const newKeybind = await keybindButton.textContent()
  expect(newKeybind).toContain("H")

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("settings.v3")
    return raw ? JSON.parse(raw) : null
  })
  expect(stored?.keybinds?.["sidebar.toggle"]).toBe("mod+shift+h")

  await closeDialog(page, dialog)

  const main = page.locator("main")
  const initialClasses = (await main.getAttribute("class")) ?? ""
  const initiallyClosed = initialClasses.includes("xl:border-l")

  await page.keyboard.press(`${modKey}+Shift+H`)
  await page.waitForTimeout(100)

  const afterToggleClasses = (await main.getAttribute("class")) ?? ""
  const afterToggleClosed = afterToggleClasses.includes("xl:border-l")
  expect(afterToggleClosed).toBe(!initiallyClosed)

  await page.keyboard.press(`${modKey}+Shift+H`)
  await page.waitForTimeout(100)

  const finalClasses = (await main.getAttribute("class")) ?? ""
  const finalClosed = finalClasses.includes("xl:border-l")
  expect(finalClosed).toBe(initiallyClosed)
})

test("resetting all keybinds to defaults works", async ({ page, gotoSession }) => {
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ keybinds: { "sidebar.toggle": "mod+shift+x" } }))
  })

  await gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("sidebar.toggle"))
  await expect(keybindButton).toBeVisible()

  const customKeybind = await keybindButton.textContent()
  expect(customKeybind).toContain("X")

  const resetButton = dialog.getByRole("button", { name: "Reset to defaults" })
  await expect(resetButton).toBeVisible()
  await expect(resetButton).toBeEnabled()
  await resetButton.click()
  await page.waitForTimeout(100)

  const restoredKeybind = await keybindButton.textContent()
  expect(restoredKeybind).toContain("B")

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("settings.v3")
    return raw ? JSON.parse(raw) : null
  })
  expect(stored?.keybinds?.["sidebar.toggle"]).toBeUndefined()

  await closeDialog(page, dialog)
})

test("clearing a keybind works", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("sidebar.toggle"))
  await expect(keybindButton).toBeVisible()

  const initialKeybind = await keybindButton.textContent()
  expect(initialKeybind).toContain("B")

  await keybindButton.click()
  await expect(keybindButton).toHaveText(/press/i)

  await page.keyboard.press("Delete")
  await page.waitForTimeout(100)

  const clearedKeybind = await keybindButton.textContent()
  expect(clearedKeybind).toMatch(/unassigned|press/i)

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("settings.v3")
    return raw ? JSON.parse(raw) : null
  })
  expect(stored?.keybinds?.["sidebar.toggle"]).toBe("none")

  await closeDialog(page, dialog)

  await page.keyboard.press(`${modKey}+B`)
  await page.waitForTimeout(100)

  const stillOnSession = page.url().includes("/session")
  expect(stillOnSession).toBe(true)
})

test("changing settings open keybind works", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("settings.open"))
  await expect(keybindButton).toBeVisible()

  const initialKeybind = await keybindButton.textContent()
  expect(initialKeybind).toContain(",")

  await keybindButton.click()
  await expect(keybindButton).toHaveText(/press/i)

  await page.keyboard.press(`${modKey}+Slash`)
  await page.waitForTimeout(100)

  const newKeybind = await keybindButton.textContent()
  expect(newKeybind).toContain("/")

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("settings.v3")
    return raw ? JSON.parse(raw) : null
  })
  expect(stored?.keybinds?.["settings.open"]).toBe("mod+/")

  await closeDialog(page, dialog)

  const settingsDialog = page.getByRole("dialog")
  await expect(settingsDialog).toHaveCount(0)

  await page.keyboard.press(`${modKey}+Slash`)
  await page.waitForTimeout(100)

  await expect(settingsDialog).toBeVisible()

  await closeDialog(page, settingsDialog)
})

test("changing new session keybind works", async ({ page, sdk, gotoSession }) => {
  await withSession(sdk, "test session for keybind", async (session) => {
    await gotoSession(session.id)

    const initialUrl = page.url()
    expect(initialUrl).toContain(`/session/${session.id}`)

    const dialog = await openSettings(page)
    await dialog.getByRole("tab", { name: "Shortcuts" }).click()

    const keybindButton = dialog.locator(keybindButtonSelector("session.new"))
    await expect(keybindButton).toBeVisible()

    await keybindButton.click()
    await expect(keybindButton).toHaveText(/press/i)

    await page.keyboard.press(`${modKey}+Shift+KeyN`)
    await page.waitForTimeout(100)

    const newKeybind = await keybindButton.textContent()
    expect(newKeybind).toContain("N")

    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem("settings.v3")
      return raw ? JSON.parse(raw) : null
    })
    expect(stored?.keybinds?.["session.new"]).toBe("mod+shift+n")

    await closeDialog(page, dialog)

    await page.keyboard.press(`${modKey}+Shift+N`)
    await page.waitForTimeout(200)

    const newUrl = page.url()
    expect(newUrl).toMatch(/\/session\/?$/)
    expect(newUrl).not.toContain(session.id)
  })
})

test("changing file open keybind works", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("file.open"))
  await expect(keybindButton).toBeVisible()

  const initialKeybind = await keybindButton.textContent()
  expect(initialKeybind).toContain("P")

  await keybindButton.click()
  await expect(keybindButton).toHaveText(/press/i)

  await page.keyboard.press(`${modKey}+Shift+KeyF`)
  await page.waitForTimeout(100)

  const newKeybind = await keybindButton.textContent()
  expect(newKeybind).toContain("F")

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("settings.v3")
    return raw ? JSON.parse(raw) : null
  })
  expect(stored?.keybinds?.["file.open"]).toBe("mod+shift+f")

  await closeDialog(page, dialog)

  const filePickerDialog = page.getByRole("dialog").filter({ has: page.getByPlaceholder(/search files/i) })
  await expect(filePickerDialog).toHaveCount(0)

  await page.keyboard.press(`${modKey}+Shift+F`)
  await page.waitForTimeout(100)

  await expect(filePickerDialog).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(filePickerDialog).toHaveCount(0)
})

test("changing terminal toggle keybind works", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("terminal.toggle"))
  await expect(keybindButton).toBeVisible()

  await keybindButton.click()
  await expect(keybindButton).toHaveText(/press/i)

  await page.keyboard.press(`${modKey}+KeyY`)
  await page.waitForTimeout(100)

  const newKeybind = await keybindButton.textContent()
  expect(newKeybind).toContain("Y")

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("settings.v3")
    return raw ? JSON.parse(raw) : null
  })
  expect(stored?.keybinds?.["terminal.toggle"]).toBe("mod+y")

  await closeDialog(page, dialog)

  await page.keyboard.press(`${modKey}+Y`)
  await page.waitForTimeout(100)

  const pageStable = await page.evaluate(() => document.readyState === "complete")
  expect(pageStable).toBe(true)
})

test("changing command palette keybind works", async ({ page, gotoSession }) => {
  await gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("command.palette"))
  await expect(keybindButton).toBeVisible()

  const initialKeybind = await keybindButton.textContent()
  expect(initialKeybind).toContain("P")

  await keybindButton.click()
  await expect(keybindButton).toHaveText(/press/i)

  await page.keyboard.press(`${modKey}+Shift+KeyK`)
  await page.waitForTimeout(100)

  const newKeybind = await keybindButton.textContent()
  expect(newKeybind).toContain("K")

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("settings.v3")
    return raw ? JSON.parse(raw) : null
  })
  expect(stored?.keybinds?.["command.palette"]).toBe("mod+shift+k")

  await closeDialog(page, dialog)

  const palette = page.getByRole("dialog").filter({ has: page.getByRole("textbox").first() })
  await expect(palette).toHaveCount(0)

  await page.keyboard.press(`${modKey}+Shift+K`)
  await page.waitForTimeout(100)

  await expect(palette).toBeVisible()
  await expect(palette.getByRole("textbox").first()).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(palette).toHaveCount(0)
})
