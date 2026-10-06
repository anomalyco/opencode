import { expect, test, type Page } from "@playwright/test"
import { fixture, installStressSessionTabs } from "../utils/session-fixture"
import { sessionHref } from "../utils/app"
import { openWithDirection } from "../utils/direction"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

for (const direction of ["ltr", "rtl"] as const) {
  for (const paid of [true, false]) {
    test(`mobile model and variant pickers use drawers with ${paid ? "paid" : "free"} models in ${direction}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await openPickerSession(page, direction, paid)
      const composer = page.locator('[data-component="composer"]')
      const variant = composer.getByRole("button", { name: "Choose model variant", exact: true })
      await expect(variant).toHaveText("balanced")
      await variant.click()
      const variants = page.getByRole("dialog", { name: "Choose model variant", exact: true })
      await expect(variants.getByRole("button", { name: "balanced", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      )
      await expect(variants.getByRole("button", { name: "Close", exact: true })).toHaveCount(0)
      await expect(variants).toBeInViewport({ ratio: 1 })
      await expect(variants).not.toHaveAttribute("data-transitioning")
      await variants.screenshot({ path: testInfo.outputPath("variants.png") })
      await page.keyboard.press("Escape")
      await expect(variants).toBeHidden()
      await expect(variant).toBeFocused()
      await variant.click()
      await variants.getByRole("button", { name: "high", exact: true }).click()
      await expect(variants).toBeHidden()
      await expect(variant).toHaveText("high")
      await expect(variant).toBeFocused()

      const model = composer.locator('[data-action="composer-model"]')
      await expect(model).toHaveText("Mobile Model A")
      await expect(model).toHaveAttribute("data-control-type", "drawer")
      await model.click()
      const models = page.getByRole("dialog", { name: "Select model", exact: true })
      const search = models.getByRole("searchbox", { name: "Search models", exact: true })
      await expect(models.locator('[data-slot="model-selector-drawer"]')).toBeFocused()
      await expect(search).not.toBeFocused()
      await expect(models.getByRole("button", { name: /Mobile Model A/ })).toHaveAttribute("aria-pressed", "true")
      await expect(models.getByRole("button", { name: "Close", exact: true })).toHaveCount(0)
      await expect(models).toBeInViewport({ ratio: 1 })
      await expect(models).not.toHaveAttribute("data-transitioning")
      await expect
        .poll(() =>
          models.evaluate((element) => {
            const drawer = element.getBoundingClientRect()
            const search = element.querySelector('[data-component="text-input-v2"]')!.getBoundingClientRect()
            const row = element.querySelector('[data-component="settings-row"]')!.getBoundingClientRect()
            const searchClip = element.querySelector('[data-slot="mobile-panel-content"]')!.getBoundingClientRect()
            const rowClip = element.querySelector(".settings-models")!.getBoundingClientRect()

            return {
              searchStart: Math.round(search.left - drawer.left),
              searchEnd: Math.round(drawer.right - search.right),
              rowStart: Math.round(row.left - drawer.left),
              rowEnd: Math.round(drawer.right - row.right),
              searchClipStart: Math.round(search.left - searchClip.left),
              searchClipEnd: Math.round(searchClip.right - search.right),
              rowClipStart: Math.round(row.left - rowClip.left),
              rowClipEnd: Math.round(rowClip.right - row.right),
            }
          }),
        )
        .toEqual({
          searchStart: 12,
          searchEnd: 12,
          rowStart: 12,
          rowEnd: 12,
          searchClipStart: 12,
          searchClipEnd: 12,
          rowClipStart: 12,
          rowClipEnd: 12,
        })
      await expect(models.getByRole("button", { name: /Mobile Model A/ })).toHaveCSS("padding-inline-start", "12px")
      await expect(models.getByRole("button", { name: /Mobile Model A/ })).toHaveCSS("padding-block-start", "16px")
      await models.screenshot({ path: testInfo.outputPath("models.png") })
      await search.click()
      await expect(search).toBeFocused()
      await search.fill("no-matching-model")
      await expect(models.getByText("No model results", { exact: true })).toBeVisible()
      await search.fill("Mobile Model B")
      await expect(models.getByRole("button", { name: /Mobile Model A/ })).toHaveCount(0)
      await search.press("Enter")
      await expect(models).toBeHidden()
      await expect(model).toHaveText("Mobile Model B")
      await expect(composer.getByRole("textbox", { name: "Prompt", exact: true })).toBeFocused()

      await model.click()
      await expect(search).toHaveValue("")
      await expect(models.locator('[data-slot="model-selector-drawer"]')).toBeFocused()
      await expect(models.getByRole("button", { name: /Mobile Model B/ })).toHaveAttribute("aria-pressed", "true")
      await expect
        .poll(() => models.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42))
        .toBe(0)
      await expect(models).not.toHaveAttribute("data-transitioning")
      await page.locator('[data-slot="mobile-drawer-overlay"]').click({ position: { x: 10, y: 10 } })
      await expect(models).toBeHidden()
      await expect(model).toBeFocused()

      if (paid) {
        await model.click()
        await models.getByRole("button", { name: "Manage models", exact: true }).click()
        await expect(models).toBeHidden()
        await expect(page.getByRole("dialog", { name: "Manage models", exact: true })).toBeVisible()
        await expect(page.getByRole("dialog")).toHaveCount(1)

        return
      }

      await model.click()
      await models.getByRole("button", { name: "Connect provider", exact: true }).click()
      await expect(models).toBeHidden()
      const providers = page.getByRole("dialog", { name: "Connect provider", exact: true })
      await expect(providers.getByRole("searchbox", { name: "Search providers", exact: true })).toBeVisible()
      await expect(page.getByRole("dialog")).toHaveCount(1)
    })
  }

  test(`desktop model and variant pickers retain menus in ${direction}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await openPickerSession(page, direction, true)
    const composer = page.locator('[data-component="composer"]')
    const variant = composer.getByRole("button", { name: "Choose model variant", exact: true })
    await variant.click()
    await page.getByRole("menuitemradio", { name: "high", exact: true }).click()
    await expect(variant).toHaveText("high")
    await expect(page.locator('[data-slot="mobile-drawer-content"]')).toHaveCount(0)
    const model = composer.locator('[data-action="composer-model"]')
    await expect(model).toHaveAttribute("data-control-type", "popover")
    await model.click()
    await expect(page.getByPlaceholder("Search models", { exact: true })).toBeFocused()
    await page.getByRole("menuitemradio", { name: /Mobile Model B/ }).click()
    await expect(model).toHaveText("Mobile Model B")
    await expect(page.locator('[data-slot="mobile-drawer-content"]')).toHaveCount(0)
  })
}

test.describe("touch composer pickers", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("model and default variant open with one tap", async ({ page }) => {
    await openPickerSession(page, "ltr", true)
    expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(true)
    const composer = page.locator('[data-component="composer"]')
    const variant = composer.getByRole("button", { name: "Choose model variant", exact: true })
    await variant.tap()
    const variants = page.getByRole("dialog", { name: "Choose model variant", exact: true })
    await variants.getByRole("button", { name: "default", exact: true }).tap()
    await expect(variants).toBeHidden()
    await expect(variant).toHaveText("default")
    await page.touchscreen.tap(5, 300)
    await expect(variant).toHaveCSS("pointer-events", "auto")
    await expect(variant).toHaveCSS("opacity", "1")
    await variant.tap()
    await expect(variants).toBeVisible()
    await expect
      .poll(() => variants.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42))
      .toBe(0)
    await page.locator('[data-slot="mobile-drawer-overlay"]').tap({ position: { x: 10, y: 10 } })
    await expect(variants).toBeHidden()

    await composer.locator('[data-action="composer-model"]').tap()
    const models = page.getByRole("dialog", { name: "Select model", exact: true })
    await expect(models.locator('[data-slot="model-selector-drawer"]')).toBeFocused()
    const search = models.getByRole("searchbox", { name: "Search models", exact: true })
    await expect(search).not.toBeFocused()
    await search.tap()
    await expect(search).toBeFocused()
  })
})

async function openPickerSession(page: Page, direction: "ltr" | "rtl", paid: boolean) {
  await mockOpenCodeServer(page, {
    ...fixture,
    sessions: fixture.sessions.map((session) => ({
      ...session,
      model: { id: "mobile-a", providerID: "opencode", variant: "balanced" },
    })),
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: Object.fromEntries(
            ["a", "b"].map((id) => [
              `mobile-${id}`,
              {
                id: `mobile-${id}`,
                name: `Mobile Model ${id.toUpperCase()}`,
                cost: { input: paid ? 1 : 0, output: paid ? 1 : 0 },
                limit: { context: 200_000 },
                variants: { balanced: {}, high: {} },
              },
            ]),
          ),
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "mobile-a" },
    },
    pageMessages: () => ({ items: [] }),
  })
  await installStressSessionTabs(page)
  await page.addInitScript((direction) => {
    localStorage.setItem("opencode-color-scheme", direction === "rtl" ? "dark" : "light")
    localStorage.setItem(
      "opencode.global.dat:model",
      JSON.stringify({
        user: ["a", "b"].map((id) => ({ providerID: "opencode", modelID: `mobile-${id}`, visibility: "show" })),
        recent: [],
        variant: {},
      }),
    )
  }, direction)
  await openWithDirection(page, sessionHref(fixture.targetID), direction)
  await expectAppVisible(page.getByRole("textbox", { name: "Prompt", exact: true }))
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeEditable()
}
