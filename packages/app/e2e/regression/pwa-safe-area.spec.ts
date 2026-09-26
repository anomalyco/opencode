import { expect, test } from "@playwright/test"
import { fixture } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

const cases = [
  { name: "mobile browser", inset: 47, standalone: false, bottom: false },
  { name: "iOS standalone", inset: 47, standalone: true, bottom: false },
  { name: "iOS standalone with bottom tabs", inset: 47, standalone: true, bottom: true },
  // Landscape or a system-reserved status bar reports 0; the fade offset must not apply.
  { name: "iOS standalone without status bar", inset: 0, standalone: true, bottom: false },
]

for (const input of cases) {
  test.describe(input.name, () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

    test("keeps the titlebar below the status bar", async ({ page }) => {
      const cdp = await page.context().newCDPSession(page)
      await cdp.send("Emulation.setSafeAreaInsetsOverride", {
        insets: { top: input.inset, right: 0, bottom: 34, left: 0 },
      })
      await mockOpenCodeServer(page, {
        directory: fixture.directory,
        project: fixture.project,
        provider: fixture.provider,
        sessions: fixture.sessions,
        pageMessages: () => ({ items: [] }),
      })
      await page.addInitScript(
        ({ bottom, directory, server, sessions, standalone }) => {
          Object.defineProperty(navigator, "standalone", { value: standalone })
          localStorage.setItem(
            "settings.v3",
            JSON.stringify({ general: { mobileTitlebarPosition: bottom ? "bottom" : "top" } }),
          )
          localStorage.setItem(
            "opencode.global.dat:server",
            JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] } }),
          )
          localStorage.setItem(
            "opencode.window.browser.dat:tabs",
            JSON.stringify(sessions.map((session) => ({ type: "session", server, sessionId: session.id }))),
          )
        },
        {
          bottom: input.bottom,
          directory: fixture.directory,
          server: fixture.serverKey,
          sessions: fixture.sessions,
          standalone: input.standalone,
        },
      )

      await page.goto("/")

      const titlebar = page.locator('[data-slot="titlebar-v2"]')
      const top = input.inset + (input.standalone && input.inset > 0 ? 32 : 0)
      if (input.bottom) {
        await expect(page.getByRole("main")).toHaveCSS("padding-top", `${top}px`)
      } else {
        await expect(titlebar).toHaveCSS("padding-top", `${top}px`)
      }

      const navigation = titlebar.getByRole("button", { name: "Tabs", exact: true })
      await expect(navigation).toBeInViewport({ ratio: 1 })
      await navigation.tap()
      await expect(navigation).toHaveAttribute("aria-expanded", "true")
    })
  })
}
