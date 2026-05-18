import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { closeDialog, openSettings, withSession } from "../../../../e2e/actions"
import { keybindButtonSelector } from "../../../../e2e/selectors"
import { modKey } from "../../../../e2e/utils"

describe("settings keybinds", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("changing sidebar toggle keybind works", async () => {
    const page = app.page
    await app.gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("sidebar.toggle")).first()
  await keybindButton.waitFor({ state: "visible" })

  const initialKeybind = await keybindButton.textContent()
  expect(initialKeybind).toContain("B")

  await keybindButton.click()
  await expect.poll(async () => (await keybindButton.textContent()) ?? "").toMatch(/press/i)

  await page.keyboard.press(`${modKey}+Shift+KeyH`)
  await new Promise((r) => setTimeout(r, 100))

  const newKeybind = await keybindButton.textContent()
  expect(newKeybind).toContain("H")

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("settings.v3")
    return raw ? JSON.parse(raw) : null
  })
  expect(stored?.keybinds?.["sidebar.toggle"]).toBe("mod+shift+h")

  await closeDialog(page, dialog)

  const button = page.getByRole("button", { name: /toggle sidebar/i }).first()
  const initiallyClosed = (await button.getAttribute("aria-expanded")) !== "true"

  await page.keyboard.press(`${modKey}+Shift+H`)
  await expect.poll(async () => await button.getAttribute("aria-expanded")).toBe(initiallyClosed ? "true" : "false")

  const afterToggleClosed = (await button.getAttribute("aria-expanded")) !== "true"
  expect(afterToggleClosed).toBe(!initiallyClosed)

  await page.keyboard.press(`${modKey}+Shift+H`)
  await expect.poll(async () => await button.getAttribute("aria-expanded")).toBe(initiallyClosed ? "false" : "true")

  const finalClosed = (await button.getAttribute("aria-expanded")) !== "true"
  expect(finalClosed).toBe(initiallyClosed)
})

  test("sidebar toggle keybind guards against shortcut conflicts", async () => {
    const page = app.page
    await app.gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("sidebar.toggle"))
  await keybindButton.waitFor({ state: "visible" })

  const initialKeybind = await keybindButton.textContent()
  expect(initialKeybind).toContain("B")

  await keybindButton.click()
  await expect.poll(async () => (await keybindButton.textContent()) ?? "").toMatch(/press/i)

  await page.keyboard.press(`${modKey}+Shift+KeyP`)
  await new Promise((r) => setTimeout(r, 100))

  const toast = page.locator('[data-component="toast"]').last()
  await toast.waitFor({ state: "visible" })
  await expect.poll(async () => (await toast.textContent()) ?? "").toMatch(/already/i)

  await keybindButton.click()
  await expect.poll(async () => (await keybindButton.textContent()) ?? "").toMatch("B")

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("settings.v3")
    return raw ? JSON.parse(raw) : null
  })
  expect(stored?.keybinds?.["sidebar.toggle"]).toBeUndefined()

  await closeDialog(page, dialog)
})

  test("resetting all keybinds to defaults works", async () => {
    const page = app.page
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ keybinds: { "sidebar.toggle": "mod+shift+x" } }))
  })

    await app.gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("sidebar.toggle"))
  await keybindButton.waitFor({ state: "visible" })

  const customKeybind = await keybindButton.textContent()
  expect(customKeybind).toContain("X")

  const resetButton = dialog.getByRole("button", { name: "Reset to defaults" })
  await resetButton.waitFor({ state: "visible" })
  expect(await resetButton.isEnabled()).toBe(true)
  await resetButton.click()
  await new Promise((r) => setTimeout(r, 100))

  const restoredKeybind = await keybindButton.textContent()
  expect(restoredKeybind).toContain("B")

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("settings.v3")
    return raw ? JSON.parse(raw) : null
  })
  expect(stored?.keybinds?.["sidebar.toggle"]).toBeUndefined()

  await closeDialog(page, dialog)
})

  test("clearing a keybind works", async () => {
    const page = app.page
    await app.gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("sidebar.toggle"))
  await keybindButton.waitFor({ state: "visible" })

  const initialKeybind = await keybindButton.textContent()
  expect(initialKeybind).toContain("B")

  await keybindButton.click()
  await expect.poll(async () => (await keybindButton.textContent()) ?? "").toMatch(/press/i)

  await page.keyboard.press("Delete")
  await new Promise((r) => setTimeout(r, 100))

  const clearedKeybind = await keybindButton.textContent()
  expect(clearedKeybind).toMatch(/unassigned|press/i)

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("settings.v3")
    return raw ? JSON.parse(raw) : null
  })
  expect(stored?.keybinds?.["sidebar.toggle"]).toBe("none")

  await closeDialog(page, dialog)

  await page.keyboard.press(`${modKey}+B`)
  await new Promise((r) => setTimeout(r, 100))

  const stillOnSession = page.url().includes("/session")
  expect(stillOnSession).toBe(true)
})

  test("changing settings open keybind works", async () => {
    const page = app.page
    await app.gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("settings.open"))
  await keybindButton.waitFor({ state: "visible" })

  const initialKeybind = await keybindButton.textContent()
  expect(initialKeybind).toContain(",")

  await keybindButton.click()
  await expect.poll(async () => (await keybindButton.textContent()) ?? "").toMatch(/press/i)

  await page.keyboard.press(`${modKey}+Slash`)
  await new Promise((r) => setTimeout(r, 100))

  const newKeybind = await keybindButton.textContent()
  expect(newKeybind).toContain("/")

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("settings.v3")
    return raw ? JSON.parse(raw) : null
  })
  expect(stored?.keybinds?.["settings.open"]).toBe("mod+/")

  await closeDialog(page, dialog)

  const settingsDialog = page.getByRole("dialog")
  expect(await settingsDialog.count()).toBe(0)

  await page.keyboard.press(`${modKey}+Slash`)
  await new Promise((r) => setTimeout(r, 100))

  await settingsDialog.waitFor({ state: "visible" })

  await closeDialog(page, settingsDialog)
})

  test("changing new session keybind works", async () => {
    const page = app.page
  await withSession(app.sdk, "test session for keybind", async (session) => {
    await app.gotoSession(session.id)

    const initialUrl = page.url()
    expect(initialUrl).toContain(`/session/${session.id}`)

    const dialog = await openSettings(page)
    await dialog.getByRole("tab", { name: "Shortcuts" }).click()

    const keybindButton = dialog.locator(keybindButtonSelector("session.new"))
    await keybindButton.waitFor({ state: "visible" })

    await keybindButton.click()
    await expect.poll(async () => (await keybindButton.textContent()) ?? "").toMatch(/press/i)

    await page.keyboard.press(`${modKey}+Shift+KeyN`)
    await new Promise((r) => setTimeout(r, 100))

    const newKeybind = await keybindButton.textContent()
    expect(newKeybind).toContain("N")

    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem("settings.v3")
      return raw ? JSON.parse(raw) : null
    })
    expect(stored?.keybinds?.["session.new"]).toBe("mod+shift+n")

    await closeDialog(page, dialog)

    await page.keyboard.press(`${modKey}+Shift+N`)
    await new Promise((r) => setTimeout(r, 200))

    const newUrl = page.url()
    expect(newUrl).toMatch(/\/session\/?$/)
    expect(newUrl).not.toContain(session.id)
  })
})

  test("changing file open keybind works", async () => {
    const page = app.page
    await app.gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("file.open"))
  await keybindButton.waitFor({ state: "visible" })

  const initialKeybind = await keybindButton.textContent()
  expect(initialKeybind).toContain("P")

  await keybindButton.click()
  await expect.poll(async () => (await keybindButton.textContent()) ?? "").toMatch(/press/i)

  await page.keyboard.press(`${modKey}+Shift+KeyF`)
  await new Promise((r) => setTimeout(r, 100))

  const newKeybind = await keybindButton.textContent()
  expect(newKeybind).toContain("F")

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("settings.v3")
    return raw ? JSON.parse(raw) : null
  })
  expect(stored?.keybinds?.["file.open"]).toBe("mod+shift+f")

  await closeDialog(page, dialog)

  const filePickerDialog = page.getByRole("dialog").filter({ has: page.getByPlaceholder(/search files/i) })
  expect(await filePickerDialog.count()).toBe(0)

  await page.keyboard.press(`${modKey}+Shift+F`)
  await new Promise((r) => setTimeout(r, 100))

  await filePickerDialog.waitFor({ state: "visible" })

  await page.keyboard.press("Escape")
  expect(await filePickerDialog.count()).toBe(0)
})

  test("changing command palette keybind works", async () => {
    const page = app.page
    await app.gotoSession()

  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Shortcuts" }).click()

  const keybindButton = dialog.locator(keybindButtonSelector("command.palette"))
  await keybindButton.waitFor({ state: "visible" })

  const initialKeybind = await keybindButton.textContent()
  expect(initialKeybind).toContain("P")

  await keybindButton.click()
  await expect.poll(async () => (await keybindButton.textContent()) ?? "").toMatch(/press/i)

  await page.keyboard.press(`${modKey}+Shift+KeyK`)
  await new Promise((r) => setTimeout(r, 100))

  const newKeybind = await keybindButton.textContent()
  expect(newKeybind).toContain("K")

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("settings.v3")
    return raw ? JSON.parse(raw) : null
  })
  expect(stored?.keybinds?.["command.palette"]).toBe("mod+shift+k")

  await closeDialog(page, dialog)

  const palette = page.getByRole("dialog").filter({ has: page.getByRole("textbox").first() })
  expect(await palette.count()).toBe(0)

  await page.keyboard.press(`${modKey}+Shift+K`)
  await new Promise((r) => setTimeout(r, 100))

  await palette.waitFor({ state: "visible" })
  await palette.getByRole("textbox").first().waitFor({ state: "visible" })

  await page.keyboard.press("Escape")
  expect(await palette.count()).toBe(0)
})

})
