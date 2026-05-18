import { describe, expect, test } from "vitest"
import { useE2eStack } from "../../support/use-e2e-stack"
import { useAppBrowser } from "../../support/use-app-browser"
import { closeDialog, openSettings } from "../../../../e2e/actions"

describe("settings providers", () => {
  useE2eStack()
  const app = useAppBrowser()

  test("custom provider form can be filled and validates input", async () => {
    const page = app.page
    await app.gotoSession()

    const settings = await openSettings(page)
    await settings.getByRole("tab", { name: "Providers" }).click()

    const customProviderSection = settings.locator('[data-component="custom-provider-section"]')
    await customProviderSection.waitFor({ state: "visible" })

    const connectButton = customProviderSection.getByRole("button", { name: "Connect" })
    await connectButton.click()

    const providerDialog = page.getByRole("dialog").filter({ has: page.getByText("Custom provider") })
    await providerDialog.waitFor({ state: "visible" })

    await providerDialog.getByLabel("Provider ID").fill("test-provider")
    await providerDialog.getByLabel("Display name").fill("Test Provider")
    await providerDialog.getByLabel("Base URL").fill("http://localhost:9999/fake")
    await providerDialog.getByLabel("API key").fill("fake-key")

    await providerDialog.getByPlaceholder("model-id").first().fill("test-model")
    await providerDialog.getByPlaceholder("Display Name").first().fill("Test Model")

    expect(await providerDialog.getByRole("textbox", { name: "Provider ID" }).inputValue()).toBe("test-provider")
    expect(await providerDialog.getByRole("textbox", { name: "Display name" }).inputValue()).toBe("Test Provider")
    expect(await providerDialog.getByRole("textbox", { name: "Base URL" }).inputValue()).toBe(
      "http://localhost:9999/fake",
    )
    expect(await providerDialog.getByRole("textbox", { name: "API key" }).inputValue()).toBe("fake-key")
    expect(await providerDialog.getByPlaceholder("model-id").first().inputValue()).toBe("test-model")
    expect(await providerDialog.getByPlaceholder("Display Name").first().inputValue()).toBe("Test Model")

    await page.keyboard.press("Escape")
    expect(await providerDialog.count()).toBe(0)

    await closeDialog(page, settings)
  })

  test("custom provider form shows validation errors", async () => {
    const page = app.page
    await app.gotoSession()

    const settings = await openSettings(page)
    await settings.getByRole("tab", { name: "Providers" }).click()

    const customProviderSection = settings.locator('[data-component="custom-provider-section"]')
    await customProviderSection.getByRole("button", { name: "Connect" }).click()

    const providerDialog = page.getByRole("dialog").filter({ has: page.getByText("Custom provider") })
    await providerDialog.waitFor({ state: "visible" })

    await providerDialog.getByLabel("Provider ID").fill("invalid provider id")
    await providerDialog.getByLabel("Base URL").fill("not-a-url")

    await providerDialog.getByRole("button", { name: /submit|save/i }).click()

    await providerDialog
      .locator('[data-slot="input-error"]')
      .filter({ hasText: /lowercase/i })
      .first()
      .waitFor({ state: "visible" })
    await providerDialog
      .locator('[data-slot="input-error"]')
      .filter({ hasText: /http/i })
      .first()
      .waitFor({ state: "visible" })

    await page.keyboard.press("Escape")
    expect(await providerDialog.count()).toBe(0)

    await closeDialog(page, settings)
  })

  test("custom provider form can add and remove models", async () => {
    const page = app.page
    await app.gotoSession()

    const settings = await openSettings(page)
    await settings.getByRole("tab", { name: "Providers" }).click()

    const customProviderSection = settings.locator('[data-component="custom-provider-section"]')
    await customProviderSection.getByRole("button", { name: "Connect" }).click()

    const providerDialog = page.getByRole("dialog").filter({ has: page.getByText("Custom provider") })
    await providerDialog.waitFor({ state: "visible" })

    await providerDialog.getByLabel("Provider ID").fill("multi-model-test")
    await providerDialog.getByLabel("Display name").fill("Multi Model Test")
    await providerDialog.getByLabel("Base URL").fill("http://localhost:9999/multi")

    await providerDialog.getByPlaceholder("model-id").first().fill("model-1")
    await providerDialog.getByPlaceholder("Display Name").first().fill("Model 1")

    const idInputsBefore = await providerDialog.getByPlaceholder("model-id").count()
    await providerDialog.getByRole("button", { name: "Add model" }).click()
    const idInputsAfter = await providerDialog.getByPlaceholder("model-id").count()
    expect(idInputsAfter).toBe(idInputsBefore + 1)

    await providerDialog.getByPlaceholder("model-id").nth(1).fill("model-2")
    await providerDialog.getByPlaceholder("Display Name").nth(1).fill("Model 2")

    expect(await providerDialog.getByPlaceholder("model-id").nth(1).inputValue()).toBe("model-2")
    expect(await providerDialog.getByPlaceholder("Display Name").nth(1).inputValue()).toBe("Model 2")

    await page.keyboard.press("Escape")
    expect(await providerDialog.count()).toBe(0)

    await closeDialog(page, settings)
  })

  test("custom provider form can add and remove headers", async () => {
    const page = app.page
    await app.gotoSession()

    const settings = await openSettings(page)
    await settings.getByRole("tab", { name: "Providers" }).click()

    const customProviderSection = settings.locator('[data-component="custom-provider-section"]')
    await customProviderSection.getByRole("button", { name: "Connect" }).click()

    const providerDialog = page.getByRole("dialog").filter({ has: page.getByText("Custom provider") })
    await providerDialog.waitFor({ state: "visible" })

    await providerDialog.getByLabel("Provider ID").fill("header-test")
    await providerDialog.getByLabel("Display name").fill("Header Test")
    await providerDialog.getByLabel("Base URL").fill("http://localhost:9999/headers")

    await providerDialog.getByPlaceholder("model-id").first().fill("model-x")
    await providerDialog.getByPlaceholder("Display Name").first().fill("Model X")

    const headerInputsBefore = await providerDialog.getByPlaceholder("Header-Name").count()
    await providerDialog.getByRole("button", { name: "Add header" }).click()
    const headerInputsAfter = await providerDialog.getByPlaceholder("Header-Name").count()
    expect(headerInputsAfter).toBe(headerInputsBefore + 1)

    await providerDialog.getByPlaceholder("Header-Name").first().fill("Authorization")
    await providerDialog.getByPlaceholder("value").first().fill("Bearer token123")

    expect(await providerDialog.getByPlaceholder("Header-Name").first().inputValue()).toBe("Authorization")
    expect(await providerDialog.getByPlaceholder("value").first().inputValue()).toBe("Bearer token123")

    await page.keyboard.press("Escape")
    expect(await providerDialog.count()).toBe(0)

    await closeDialog(page, settings)
  })
})
