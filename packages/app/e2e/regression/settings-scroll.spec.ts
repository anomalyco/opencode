import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

test.use({ contextOptions: { reducedMotion: "reduce" }, colorScheme: "dark" })

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 900, height: 600 },
  { width: 780, height: 600 },
  { width: 390, height: 844 },
]) {
  test(`preferences scroll only inside the panel at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const directory = "/tmp/settings-scroll"
    await mockOpenCodeServer(page, {
      directory,
      project: {
        id: "proj_settings_scroll",
        canonical: directory,
        name: "Settings scroll",
        vcs: "git",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
      provider: { all: [], connected: [], default: {} },
      sessions: [],
      pageMessages: () => ({ items: [] }),
    })
    await page.goto("/")
    await page.getByRole("button", { name: "Settings", exact: true }).click()

    const settings = page.getByTestId("settings-screen")
    const panel = settings.getByRole("tabpanel")
    const main = page.getByRole("main")
    const slider = settings.getByRole("slider", { name: "Timeline detail", exact: true })
    await expect(settings).toBeFocused()
    await page.setViewportSize(viewport)
    await expect(slider).toHaveAccessibleDescription(/Choose how much activity appears in the timeline/)
    await expect.poll(() => main.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1)

    // Wheel over the outer gutter must not move the entire settings screen.
    await main.hover({ position: { x: 1, y: 200 } })
    await page.mouse.wheel(0, 10000)
    await panel.hover()
    await page.mouse.wheel(0, 10000)
    await expect.poll(() => panel.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
    await expect(main).toHaveJSProperty("scrollTop", 0)
    await expect(settings.getByRole("heading", { name: "Preferences", exact: true })).toBeInViewport()

    await slider.scrollIntoViewIfNeeded()
    await slider.click()
    await page.keyboard.press("Home")
    await expect(slider).toHaveValue("0")
    await page.keyboard.press("ArrowRight")
    await expect(slider).toHaveValue("1")
    await expect(slider).toBeFocused()

    await settings.getByRole("button", { name: "Advanced", exact: true }).click()
    await expect(
      settings.getByRole("group", { name: "Set placement and details for each activity category.", exact: true }),
    ).toBeVisible()
    await panel.hover()
    await page.mouse.wheel(0, 10000)
    await expect
      .poll(() => panel.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop))
      .toBeLessThanOrEqual(1)
    await expect(main).toHaveJSProperty("scrollTop", 0)
    await expect.poll(() => main.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1)
    await expect(settings.getByRole("heading", { name: "Preferences", exact: true })).toBeInViewport()
  })
}
