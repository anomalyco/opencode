import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

const directory = "C:/OpenCode/SettingsThemeSelectClose"

test("theme setting selects hide their closing dropdown before applying theme colors", async ({ page }) => {
  await openSettings(page)

  await chooseThemeSetting(page, "Dark", "Light")
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
  await expectThemeSelectClosedWithoutFlash(page)

  await chooseThemeSetting(page, "OC-2", "Material")
  await expect(page.locator("html")).toHaveAttribute("data-theme", "material")
  await expectThemeSelectClosedWithoutFlash(page)
})

async function openSettings(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true, releaseNotes: false } }))
    localStorage.setItem("opencode-theme-id", "oc-2")
    localStorage.setItem("opencode-color-scheme", "dark")
  })
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_settings_theme_select_close",
      worktree: directory,
      vcs: "git",
      name: "settings-theme-select-close",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" } },
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })

  await page.goto("/")
  await page.getByRole("button", { name: "Settings" }).click()
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible()
}

async function chooseThemeSetting(page: Page, trigger: string, option: string) {
  await page.getByRole("button", { name: trigger }).click()
  const listbox = page.locator('[data-slot="select-v2-listbox"]')
  await expect(listbox.getByText(option, { exact: true })).toBeVisible()
  await listbox.getByText(option, { exact: true }).click()
}

async function expectThemeSelectClosedWithoutFlash(page: Page) {
  await page.waitForTimeout(40)
  expect(await page.evaluate(selectContentState)).toMatchObject({ visible: false })
}

function selectContentState() {
  const element = document.querySelector<HTMLElement>('[data-slot="select-v2-content"]')
  if (!element) return { visible: false }
  const style = getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  return {
    visible:
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) > 0 &&
      rect.width > 0 &&
      rect.height > 0,
  }
}
