import { fileURLToPath } from "node:url"
import { expect, story } from "../../storybook/playwright/story"

const source = (path: string) => `/@fs/${fileURLToPath(new URL(path, import.meta.url)).replaceAll("\\", "/")}`

const modules = {
  fixture: source("../../gui-extensions/src/browser/panel.fixture.tsx"),
  host: source("../src/runtime/extension/host.tsx"),
  panels: source("../src/runtime/extension/panels.tsx"),
  language: source("../src/runtime/i18n/language.tsx"),
  browser: source("../../gui-extensions/src/browser/index.ts"),
  browserRenderer: source("../../gui-extensions/src/browser/renderer.tsx"),
  file: source("../../gui-extensions/src/file/index.ts"),
  fileRenderer: source("../../gui-extensions/src/file/renderer.tsx"),
}

story.beforeEach(async ({ mount, page }) => {
  // Any story loads the app styles; the fixture mounts the real side region and extensions beside it.
  await mount("ui-line-comment--editor")
  await page.evaluate(async (modules) => {
    const [{ mountBrowserRegion }, host, panels, language, browser, file] = await Promise.all([
      import(modules.fixture),
      import(modules.host),
      import(modules.panels),
      import(modules.language),
      import(modules.browser),
      import(modules.file),
    ])

    mountBrowserRegion({
      LanguageProvider: language.LanguageProvider,
      ExtensionHostProvider: host.ExtensionHostProvider,
      useExtensionHost: host.useExtensionHost,
      createRegion: panels.createRegion,
      definitions: [
        { ...browser.default, renderer: () => import(modules.browserRenderer) },
        { ...file.default, renderer: () => import(modules.fileRenderer) },
      ],
    })
  }, modules)
})

story("keeps a restored browser tab selected and undrawn until the desktop's first inventory", async ({ page }) => {
  const root = page.getByTestId("browser-region-fixture")
  const tabs = root.getByRole("tab")
  const tree = root.getByTestId("tree")
  await expect(root.getByText("Registrations: 1", { exact: true })).toBeVisible()
  await expect(tabs).toHaveText(["alpha.ts"])
  await expect(tree).toHaveText('{"tab":"changes"}')

  // Beta was left on its browser tab, which the desktop has not reported yet.
  await root.getByRole("button", { name: "Beta", exact: true }).click()
  await expect(root.getByText("Registrations: 2", { exact: true })).toBeVisible()
  await expect(root.getByTestId("selected")).toHaveText(/^browser:tab_/)
  await expect(tabs).toHaveText(["beta.ts"])
  // No fallback tab was selected, so the file tab's selection never switched the tree to All files.
  await expect(tree).toHaveText('{"tab":"changes"}')

  await root.getByRole("button", { name: "First inventory", exact: true }).click()
  await expect(tabs).toHaveText(["beta.ts", "Preview"])
  await expect(root.getByRole("tab", { name: "Preview", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(tree).toHaveText('{"tab":"changes"}')
})

story(
  "keeps the browser tabs while the pane's Ipc is away and registers them again when it returns",
  async ({ page }) => {
    const root = page.getByTestId("browser-region-fixture")
    const tabs = root.getByRole("tab")
    await expect(root.getByText("Registrations: 1", { exact: true })).toBeVisible()
    await root.getByRole("button", { name: "Beta", exact: true }).click()
    await expect(root.getByText("Registrations: 2", { exact: true })).toBeVisible()
    await root.getByRole("button", { name: "First inventory", exact: true }).click()
    await expect(tabs).toHaveText(["beta.ts", "Preview"])

    // The pane's main extension reloads: every binding goes with it, and the strip keeps the tab it will restore.
    await root.getByRole("button", { name: "Pane away", exact: true }).click()
    await expect(tabs).toHaveText(["beta.ts", "Preview"])
    await expect(root.getByRole("tab", { name: "Preview", exact: true })).toHaveAttribute("aria-selected", "true")

    // Both attachments register again at once, without a retry timer; Beta hands main the tab to restore.
    await root.getByRole("button", { name: "Pane back", exact: true }).click()
    await expect(root.getByText("Registrations: 4", { exact: true })).toBeVisible()
    await expect(root.getByText("Beta restores: 1", { exact: true })).toBeVisible()
    await expect(tabs).toHaveText(["beta.ts", "Preview"])
  },
)
