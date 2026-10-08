import { expect, test, type Page } from "@playwright/test"
import { fixture, installStressSessionTabs } from "../utils/session-fixture"
import { sessionHref } from "../utils/app"
import { openWithDirection } from "../utils/direction"
import { mockOpenCodeServer } from "../utils/mock-server"

for (const { width, direction } of [
  { width: 390, direction: "ltr" },
  { width: 390, direction: "rtl" },
  { width: 1280, direction: "ltr" },
] as const) {
  test(`submitting a prompt ${width < 768 ? "unfocuses" : "keeps focus on"} the composer at ${width}px in ${direction}`, async ({
    page,
  }) => {
    await openSubmitSession(page, width, direction)

    const editor = page.getByRole("textbox", { name: "Prompt", exact: true })
    await expect(editor).toBeEditable()
    await editor.fill("Please check focus after sending.")
    await expect(editor).toBeFocused()

    const admitted = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/api/session/${fixture.targetID}/prompt`,
    )

    await editor.press("Enter")
    expect((await admitted).ok()).toBe(true)
    await expect(editor).toBeEmpty()

    if (width < 768) {
      await expect(editor).not.toBeFocused()

      return
    }

    await expect(editor).toBeFocused()
  })
}

test.describe("touch submission", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test("tapping Send unfocuses the composer", async ({ page }) => {
    await openSubmitSession(page, 390, "ltr")
    const editor = page.getByRole("textbox", { name: "Prompt", exact: true })
    await expect(editor).toBeEditable()
    await editor.fill("Please dismiss the keyboard after sending.")
    await expect(editor).toBeFocused()

    const admitted = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/api/session/${fixture.targetID}/prompt`,
    )

    await page.getByRole("button", { name: "Send", exact: true }).tap()
    expect((await admitted).ok()).toBe(true)
    await expect(editor).toBeEmpty()
    await expect(editor).not.toBeFocused()
  })
})

async function openSubmitSession(page: Page, width: number, direction: "ltr" | "rtl") {
  await page.setViewportSize({ width, height: 844 })
  await mockOpenCodeServer(page, {
    directory: fixture.directory,
    project: fixture.project,
    sessions: fixture.sessions,
    provider: fixture.provider,
    pageMessages: () => ({ items: [] }),
  })
  await installStressSessionTabs(page)
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { mobileTitlebarPosition: "bottom" } }))
  })
  await openWithDirection(page, sessionHref(fixture.targetID), direction)
}
