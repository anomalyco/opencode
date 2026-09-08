import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { fixture } from "../performance/timeline/session-timeline-stress.fixture"
import { installStressSessionTabs } from "../performance/timeline/timeline-test-helpers"

test.use({ viewport: { width: 1280, height: 720 }, serviceWorkers: "block" })
test("server tools remain available without a native extension manager", async ({ page }, info) => {
  await mockOpenCodeServer(page, {
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages: () => ({ items: [] }),
  })
  await installStressSessionTabs(page)
  await page.goto("/")
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Tools", exact: true }).click()
  await expect(settings.getByRole("heading", { name: "Tools", exact: true })).toBeVisible()
  await expect(settings.getByRole("tab", { name: "MCPs", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(settings.getByRole("tab", { name: "Plugins", exact: true })).toBeVisible()
  await expect(settings.getByRole("tab", { name: "Skills", exact: true })).toBeVisible()
  await expect(settings.getByRole("tab", { name: "Extensions", exact: true })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath("tools-settings.png") })
})
