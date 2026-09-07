import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

test.use({ viewport: { width: 1280, height: 720 }, contextOptions: { reducedMotion: "reduce" } })

test("project icon is configured in Experimental and persists across reloads", async ({ page }) => {
  const directory = "/tmp/settings-project-icon"
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_settings_project_icon",
      canonical: directory,
      name: "Settings project icon",
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
  await expect(settings).toBeFocused()
  await expect(settings.getByRole("tab", { name: "Preferences", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(settings.locator('[data-action="settings-show-project-icon"]')).toHaveCount(0)

  await settings.getByRole("tab", { name: "Experimental", exact: true }).click()
  const toggle = settings.getByRole("switch", { name: "Project icon", exact: true })
  await expect(toggle).not.toBeChecked()
  await settings.locator('[data-action="settings-show-project-icon"] [data-slot="switch-control"]').click()
  await expect(toggle).toBeChecked()
  await expect(toggle).toBeFocused()

  await page.reload()
  await expect(settings).toBeFocused()
  await settings.getByRole("tab", { name: "Experimental", exact: true }).click()
  await expect(toggle).toBeChecked()
  await toggle.press("Space")
  await expect(toggle).not.toBeChecked()
  await expect(toggle).toBeFocused()

  await settings.getByRole("tab", { name: "Preferences", exact: true }).click()
  await expect(settings.locator('[data-action="settings-show-project-icon"]')).toHaveCount(0)
  await settings.getByRole("tab", { name: "Experimental", exact: true }).click()
  await expect(toggle).not.toBeChecked()
})
