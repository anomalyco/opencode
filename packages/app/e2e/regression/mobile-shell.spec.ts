import { expect, test } from "@playwright/test"
import { fixture } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

test.beforeEach(async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory: fixture.directory,
    project: fixture.project,
    provider: fixture.provider,
    sessions: fixture.sessions,
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(
    ({ directory, server, sessions }) => {
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] } }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify(sessions.map((session) => ({ type: "session", server, sessionId: session.id }))),
      )
    },
    { directory: fixture.directory, server: fixture.serverKey, sessions: fixture.sessions },
  )
  await page.goto("/")
  await expect(page.locator('[data-component="home-session-row"]')).toHaveCount(fixture.sessions.length)
})

test("mobile project selection and drawer navigation preserve session identity", async ({ page }) => {
  const projects = page.getByRole("button", { name: "Projects", exact: true })
  await projects.click()
  const picker = page.getByRole("dialog", { name: "Projects", exact: true })
  await expect(picker.getByRole("button", { name: "All projects", exact: true })).toBeVisible()
  await picker.getByRole("button", { name: new RegExp(` ${fixture.project.name}$`) }).click()
  await expect(picker).toBeHidden()
  await expect(projects).toContainText(fixture.project.name)

  const trigger = page.locator('[data-slot="mobile-tabs-trigger"]')
  const drawer = page.locator('[data-slot="mobile-tabs-drawer"]')
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(drawer.locator('[data-slot="tab-project"]')).toHaveCount(0)
  const settings = drawer.getByRole("button", { name: "Settings", exact: true })
  const help = drawer.getByRole("button", { name: "Help", exact: true })
  await expect(settings).toBeVisible()
  await expect(help).toBeVisible()
  expect((await settings.boundingBox())?.width).toBeGreaterThan((await help.boundingBox())?.width ?? 0)

  await drawer.locator('[data-slot="tab-link"]').filter({ hasText: fixture.expected.sourceTitle }).click()
  await expect(page).toHaveURL(new RegExp(`/session/${fixture.sourceID}$`))
  await expect(drawer).toBeHidden()
  await expect(trigger).toContainText(fixture.expected.sourceTitle)
  await trigger.click()
  await drawer.getByRole("button", { name: "Home", exact: true }).click()
  await expect(page).toHaveURL("/")
  await expect(drawer).toBeHidden()
  await expect(page.locator('[data-component="home-session-row"]')).toHaveCount(fixture.sessions.length)
})

test("mobile settings section menu stays above a full-width panel", async ({ page }) => {
  await page.locator('[data-slot="mobile-tabs-trigger"]').click()
  await page.locator('[data-slot="mobile-tabs-drawer"]').getByRole("button", { name: "Settings", exact: true }).click()
  const settings = page.getByTestId("settings-screen")
  const menu = settings.getByRole("button", { name: "Preferences", exact: true })
  const panel = settings.getByRole("tabpanel")
  await expect(settings.getByRole("heading", { name: "General", exact: true })).toBeVisible()
  await expect(page).toHaveURL("/settings")
  await expect(menu).toBeVisible()
  await menu.click()
  await expect(page.getByRole("menuitemradio", { name: "Preferences", exact: true })).toBeChecked()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menuitemradio", { name: "Preferences", exact: true })).toBeHidden()
  await expect(settings).toBeVisible()
  await menu.click()
  await page.getByRole("menuitemradio", { name: "Models", exact: true }).click()
  await expect(settings.getByRole("heading", { name: "Models", exact: true })).toBeVisible()
  await expect(settings.getByRole("button", { name: "Models", exact: true })).toBeVisible()
  await expect(settings.getByRole("switch", { name: "Claude Opus 4.6", exact: true })).toBeAttached()
  await expect
    .poll(async () => {
      const navigation = await settings.getByRole("button", { name: "Models", exact: true }).boundingBox()
      const content = await panel.boundingBox()
      return !!navigation && !!content && navigation.y + navigation.height <= content.y
    })
    .toBe(true)
  await expect.poll(async () => (await panel.boundingBox())?.width ?? 0).toBeGreaterThan(350)
  await settings.getByRole("button", { name: "Back to app", exact: true }).click()
  await expect(page).toHaveURL("/")
  await expect(settings).toBeHidden()
  await expect(page.locator('[data-component="home-session-row"]')).toHaveCount(fixture.sessions.length)
})
