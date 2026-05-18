import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { closeDialog, openSettings } from "../../../../e2e/actions"
import { promptSelector } from "../../../../e2e/selectors"

describe("models visibility", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("hiding a model removes it from the model picker", async () => {
    await app.gotoSession()

    await app.page.locator(promptSelector).click()
    await app.page.keyboard.type("/model")

    const command = app.page.locator('[data-slash-id="model.choose"]')
    await command.waitFor({ state: "visible" })
    await command.hover()
    await app.page.keyboard.press("Enter")

    const picker = app.page.getByRole("dialog")
    await picker.waitFor({ state: "visible" })

    const target = picker.locator('[data-slot="list-item"]').first()
    await target.waitFor({ state: "visible" })

    const key = await target.getAttribute("data-key")
    if (!key) throw new Error("Failed to resolve model key from list item")

    const name = (await target.locator("span").first().innerText()).trim()
    if (!name) throw new Error("Failed to resolve model name from list item")

    await app.page.keyboard.press("Escape")
    await expect.poll(async () => await picker.count(), { timeout: 5000 }).toBe(0)

    const settings = await openSettings(app.page)

    await settings.getByRole("tab", { name: "Models" }).click()
    const search = settings.getByPlaceholder("Search models")
    await search.waitFor({ state: "visible" })
    await search.fill(name)

    const toggle = settings.locator('[data-component="switch"]').filter({ hasText: name }).first()
    const sw = toggle.locator('[data-slot="switch-input"]')
    await toggle.waitFor({ state: "visible" })
    expect(await sw.getAttribute("aria-checked")).toBe("true")
    await toggle.locator('[data-slot="switch-control"]').click()
    expect(await sw.getAttribute("aria-checked")).toBe("false")

    await closeDialog(app.page, settings)

    await app.page.locator(promptSelector).click()
    await app.page.keyboard.type("/model")
    await command.waitFor({ state: "visible" })
    await command.hover()
    await app.page.keyboard.press("Enter")

    const pickerAgain = app.page.getByRole("dialog")
    await pickerAgain.waitFor({ state: "visible" })
    await pickerAgain.locator('[data-slot="list-item"]').first().waitFor({ state: "visible" })

    expect(await pickerAgain.locator(`[data-slot="list-item"][data-key="${key}"]`).count()).toBe(0)

    await app.page.keyboard.press("Escape")
    await expect.poll(async () => await pickerAgain.count()).toBe(0)
  })

  test("showing a hidden model restores it to the model picker", async () => {
    await app.gotoSession()

    await app.page.locator(promptSelector).click()
    await app.page.keyboard.type("/model")

    const command = app.page.locator('[data-slash-id="model.choose"]')
    await command.waitFor({ state: "visible" })
    await command.hover()
    await app.page.keyboard.press("Enter")

    const picker = app.page.getByRole("dialog")
    await picker.waitFor({ state: "visible" })

    const target = picker.locator('[data-slot="list-item"]').first()
    await target.waitFor({ state: "visible" })

    const key = await target.getAttribute("data-key")
    if (!key) throw new Error("Failed to resolve model key from list item")

    const name = (await target.locator("span").first().innerText()).trim()
    if (!name) throw new Error("Failed to resolve model name from list item")

    await app.page.keyboard.press("Escape")
    await expect.poll(async () => await picker.count(), { timeout: 5000 }).toBe(0)

    const settings = await openSettings(app.page)

    await settings.getByRole("tab", { name: "Models" }).click()
    const search = settings.getByPlaceholder("Search models")
    await search.waitFor({ state: "visible" })
    await search.fill(name)

    const toggle = settings.locator('[data-component="switch"]').filter({ hasText: name }).first()
    const sw = toggle.locator('[data-slot="switch-input"]')
    await toggle.waitFor({ state: "visible" })
    expect(await sw.getAttribute("aria-checked")).toBe("true")

    await toggle.locator('[data-slot="switch-control"]').click()
    expect(await sw.getAttribute("aria-checked")).toBe("false")

    await toggle.locator('[data-slot="switch-control"]').click()
    expect(await sw.getAttribute("aria-checked")).toBe("true")

    await closeDialog(app.page, settings)

    await app.page.locator(promptSelector).click()
    await app.page.keyboard.type("/model")
    await command.waitFor({ state: "visible" })
    await command.hover()
    await app.page.keyboard.press("Enter")

    const pickerAgain = app.page.getByRole("dialog")
    await pickerAgain.waitFor({ state: "visible" })
    await pickerAgain.locator(`[data-slot="list-item"][data-key="${key}"]`).waitFor({ state: "visible" })

    await app.page.keyboard.press("Escape")
    await expect.poll(async () => await pickerAgain.count()).toBe(0)
  })
})
