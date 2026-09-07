import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/util/encode"
import { fixture } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  contextOptions: { reducedMotion: "reduce" },
})

test.beforeEach(async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory: fixture.directory,
    project: fixture.project,
    provider: fixture.provider,
    sessions: fixture.sessions,
    pageMessages: () => ({ items: [] }),
  })
  const devtools = await page.context().newCDPSession(page)
  await devtools.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 47, bottom: 34 } })
  // Desktop browsers cannot show an iOS keyboard. Model only its viewport API:
  // the layout viewport and safe-area inset stay unchanged while the visible area shrinks.
  await page.addInitScript(() => {
    const viewport = window.visualViewport!
    Object.defineProperty(viewport, "height", {
      configurable: true,
      get: () => Number(document.documentElement.dataset.viewportHeight ?? window.innerHeight),
    })
  })
})

async function open(page: Page, position: "top" | "bottom" = "top") {
  await page.addInitScript(
    (position) =>
      localStorage.setItem("settings.v3", JSON.stringify({ general: { mobileTitlebarPosition: position } })),
    position,
  )
  await page.goto(`/server/${base64Encode(fixture.serverKey)}/session/${fixture.sourceID}`)
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeEditable()
}

async function viewport(page: Page, height: number) {
  await page.evaluate((height) => {
    document.documentElement.dataset.viewportHeight = String(height)
    window.visualViewport!.dispatchEvent(new Event("resize"))
  }, height)
}

for (const position of ["top", "bottom"] as const) {
  test(`removes and restores the safe area with ${position} navigation`, async ({ page }) => {
    await open(page, position)
    const bottom = page.getByRole(position === "top" ? "main" : "banner")
    const top = page.getByRole(position === "top" ? "banner" : "main")
    const composer = page.getByRole("textbox", { name: "Prompt", exact: true })
    await expect(bottom).toHaveCSS("padding-bottom", "34px")
    await composer.click()
    await expect(composer).toBeFocused()
    // Focus alone (including a hardware keyboard) must not remove home-indicator clearance.
    await expect(bottom).toHaveCSS("padding-bottom", "34px")
    await viewport(page, 500)
    await expect(bottom).toHaveCSS("padding-bottom", "0px")
    await expect(top).toHaveCSS("padding-top", "47px")
    await expect(composer).toBeFocused()
    const text = Array.from({ length: 40 }, (_, i) => `Line ${i}: ${"long-value-".repeat(30)}`).join("\n")
    await composer.fill(text)
    await expect(composer).toHaveText(text, { useInnerText: true })
    await expect(bottom).toHaveCSS("padding-bottom", "0px")
    // iOS can dismiss its keyboard without blurring the editor.
    await viewport(page, 844)
    await expect(bottom).toHaveCSS("padding-bottom", "34px")
    await expect(composer).toBeFocused()
    await composer.fill("")
    await viewport(page, 500)
    await expect(bottom).toHaveCSS("padding-bottom", "0px")
  })
}

test("does not mistake browser chrome or pinch zoom for the keyboard", async ({ page }) => {
  await open(page)
  const main = page.getByRole("main")
  const composer = page.getByRole("textbox", { name: "Prompt", exact: true })
  await expect(composer).not.toBeFocused()
  await viewport(page, 500)
  await expect(main).toHaveCSS("padding-bottom", "34px")
  await viewport(page, 780)
  await composer.click()
  await expect(composer).toBeFocused()
  await expect(main).toHaveCSS("padding-bottom", "34px")
  const devtools = await page.context().newCDPSession(page)
  await devtools.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 })
  await viewport(page, 500)
  await expect(main).toHaveCSS("padding-bottom", "34px")
  // A keyboard still needs no home-indicator inset when the page is zoomed.
  await viewport(page, 250)
  await expect(main).toHaveCSS("padding-bottom", "0px")
  await viewport(page, 500)
  await expect(main).toHaveCSS("padding-bottom", "34px")
  await devtools.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 })
  await expect(main).toHaveCSS("padding-bottom", "0px")
})

test("retains safe areas when VisualViewport is unavailable", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, "visualViewport", { value: undefined }))
  await open(page)
  await page.getByRole("textbox", { name: "Prompt", exact: true }).click()
  await expect(page.getByRole("main")).toHaveCSS("padding-bottom", "34px")
})
