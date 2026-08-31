import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

const directory = "C:/OpenCode/PwaNavigation"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

const portrait = { width: 390, height: 844 }
const empty = { top: 0, right: 0, bottom: 0, left: 0 }

// Insets and iOS standalone are emulated; native status-bar rendering still needs a device check.
for (const input of [
  { name: "browser", viewport: portrait, insets: empty, ios: false, standalone: false },
  { name: "desktop", viewport: { width: 1280, height: 800 }, insets: empty, ios: false, standalone: false },
  { name: "Android PWA", viewport: portrait, insets: { ...empty, top: 24, bottom: 24 }, ios: false },
  { name: "iOS PWA", viewport: portrait, insets: { ...empty, top: 47, bottom: 34 }, ios: true },
  { name: "iOS zero inset", viewport: portrait, insets: empty, ios: true },
  { name: "iOS Dynamic Island", viewport: portrait, insets: { ...empty, top: 59, bottom: 34 }, ios: true },
  {
    name: "iOS bottom navigation",
    viewport: portrait,
    insets: { ...empty, top: 47, bottom: 34 },
    ios: true,
    bottom: true,
  },
  {
    name: "iOS landscape RTL",
    viewport: { width: 844, height: 390 },
    insets: { top: 0, right: 47, bottom: 21, left: 47 },
    ios: true,
    rtl: true,
  },
].map((input) => ({ standalone: true, bottom: false, rtl: false, ...input }))) {
  test.describe(input.name, () => {
    test.use({ viewport: input.viewport, hasTouch: true })

    test("keeps navigation outside the reserved edges and accepts taps", async ({ page, browserName }) => {
      const insets = browserName === "chromium" ? input.insets : empty
      if (browserName === "chromium") {
        const cdp = await page.context().newCDPSession(page)
        await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets })
        await cdp.send("Emulation.setEmulatedMedia", {
          features: [{ name: "display-mode", value: input.standalone ? "standalone" : "browser" }],
        })
      }
      await mockOpenCodeServer(page, {
        directory,
        project: {
          id: "proj_pwa_navigation",
          worktree: directory,
          vcs: "git",
          name: "pwa-navigation",
          time: { created: 1700000000000, updated: 1700000000000 },
          sandboxes: [],
        },
        provider: { all: [], connected: [], default: {} },
        sessions: [],
        pageMessages: () => ({ items: [] }),
      })
      await page.addInitScript(
        ({ directory, server, ios, bottom }) => {
          Object.defineProperty(navigator, "standalone", { value: ios })
          localStorage.setItem(
            "settings.v3",
            JSON.stringify({ general: { mobileTitlebarPosition: bottom ? "bottom" : "top" } }),
          )
          localStorage.setItem(
            "opencode.global.dat:server",
            JSON.stringify({
              projects: { [server]: [{ worktree: directory, expanded: true }] },
              lastProject: { [server]: directory },
            }),
          )
        },
        { directory, server, ios: input.ios, bottom: input.bottom },
      )

      await page.goto("/")
      await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute(
        "content",
        "black-translucent",
      )
      if (input.rtl) await page.locator("html").evaluate((element) => element.setAttribute("dir", "rtl"))
      const shell = page.locator('[data-slot="app-shell"]')
      await expect(shell).toHaveCSS("padding-top", `${insets.top + (input.ios ? 32 : 0)}px`)
      await expect(shell).toHaveCSS("padding-right", `${insets.right}px`)
      await expect(shell).toHaveCSS("padding-bottom", `${insets.bottom}px`)
      await expect(shell).toHaveCSS("padding-left", `${insets.left}px`)
      const titlebar = page.locator('[data-slot="titlebar-v2"]')
      const home = titlebar.getByRole("button", { name: "Home", exact: true })
      const create = titlebar.getByRole("button", { name: "New session", exact: true })
      await expect(home).toHaveAttribute("aria-pressed", "true")
      await expect(page.getByText("pwa-navigation", { exact: true })).toBeVisible()
      await expect(create).toBeInViewport({ ratio: 1 })
      const bounds = await titlebar.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.y).toBeGreaterThanOrEqual(insets.top + (input.ios ? 32 : 0))
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(input.viewport.height - insets.bottom)
      expect(bounds!.x).toBeGreaterThanOrEqual(insets.left)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(input.viewport.width - insets.right)
      if (input.bottom) expect(bounds!.y + bounds!.height).toBe(input.viewport.height - insets.bottom - 1)
      await create.tap()
      await expect(page).toHaveURL(/\/new-session\?draftId=.+/)
      await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
      await expect(home).toHaveAttribute("aria-pressed", "false")
      await home.tap()
      await expect(page).toHaveURL(/\/$/)
      await expect(home).toHaveAttribute("aria-pressed", "true")
      expect(await titlebar.boundingBox()).toEqual(bounds)
    })
  })
}
