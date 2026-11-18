import type { Page } from "@playwright/test"
import { expect, sourceURL, story } from "../../stories/playwright/story"

const source = (path: string) => sourceURL(new URL(path, import.meta.url))

const modules = {
  fixture: source("../../gui-plugins/src/browser/settings.fixture.tsx"),
  ui: source("../src/runtime/plugin/ui.tsx"),
}

// Any story loads the app styles; the fixture mounts the real Settings > Browser page beside it. `target` is the entry
// a settings search or the command palette is revealing.
async function open(page: Page, target?: string) {
  await page.evaluate(
    async (input) => {
      const [{ mountBrowserSettings }, { ui }] = await Promise.all([import(input.modules.fixture), import(input.modules.ui)])

      mountBrowserSettings({ ui, target: input.target })
    },
    { modules, target },
  )

  const root = page.getByTestId("browser-settings-fixture")

  return { advanced: root.getByRole("button", { name: /^Advanced/ }), stored: root.getByTestId("browser-settings-stored") }
}

story.beforeEach(async ({ mount }) => {
  await mount("ui-line-comment--editor")
})

story("a search that lands inside Advanced opens it once, and the person's toggle wins after that", async ({ page }) => {
  const view = await open(page, "settings-browser-sites")

  // Open for the visit, without the device remembering it.
  await expect(view.advanced).toHaveAttribute("aria-expanded", "true")
  await expect(view.stored).not.toContainText("advanced")

  // The search's target stays set for the whole visit: closing must still close.
  await view.advanced.click()
  await expect(view.advanced).toHaveAttribute("aria-expanded", "false")
  await expect(view.stored).toContainText('"advanced":false')

  await view.advanced.click()
  await expect(view.advanced).toHaveAttribute("aria-expanded", "true")
  await expect(view.stored).toContainText('"advanced":true')
  await view.advanced.click()
  await expect(view.advanced).toHaveAttribute("aria-expanded", "false")
})
