import type { Page } from "@playwright/test"
import { expect, sourceURL, story } from "../../storybook/playwright/story"

const modules = {
  fixture: sourceURL(new URL("../../gui-extensions/src/file/artifact-view.fixture.tsx", import.meta.url)),
  language: sourceURL(new URL("../src/runtime/i18n/language.tsx", import.meta.url)),
}

story.beforeEach(async ({ mount, page }) => {
  await mount("ui-line-comment--editor")
  await page.evaluate(async (modules) => {
    const [{ mountArtifactView }, language] = await Promise.all([import(modules.fixture), import(modules.language)])
    mountArtifactView({
      LanguageProvider: language.LanguageProvider,
      UiI18nBridge: language.UiI18nBridge,
      useLanguage: language.useLanguage,
    })
  }, modules)
  await expect(
    page.getByTestId("artifact-panel").frameLocator("iframe").getByRole("heading", { name: "Local HTML preview" }),
  ).toBeVisible()
})

const chrome = (page: Page) =>
  page.getByTestId("artifact-view-fixture").getByRole("button", { name: "Open in Chrome", exact: true })

story("shows the action only for a local HTML file on macOS with Chrome installed", async ({ page }) => {
  const root = page.getByTestId("artifact-view-fixture")
  // The installation check has not answered yet.
  await expect(chrome(page)).toHaveCount(0)
  await root.getByRole("button", { name: "Chrome installed", exact: true }).click()
  await expect(chrome(page)).toBeEnabled()

  for (const toggle of ["Windows desktop", "Remote session", "SVG file"]) {
    await root.getByRole("button", { name: toggle, exact: true }).click()
    await expect(chrome(page)).toHaveCount(0)
    await root.getByRole("button", { name: toggle, exact: true }).click()
    await expect(chrome(page)).toBeEnabled()
  }

  await expect(root.getByTestId("launches")).toHaveText("[]")
})

story("hides the action once the installation check answers absent", async ({ page }) => {
  const root = page.getByTestId("artifact-view-fixture")
  await expect(chrome(page)).toHaveCount(0)
  await root.getByRole("button", { name: "Chrome absent", exact: true }).click()
  await expect(root.getByTestId("installation")).toHaveText("absent")
  await expect(chrome(page)).toHaveCount(0)
})

story("hides the action when the installation check rejects", async ({ page }) => {
  const root = page.getByTestId("artifact-view-fixture")
  await root.getByRole("button", { name: "Chrome lookup fails", exact: true }).click()
  await expect(root.getByTestId("installation")).toHaveText("rejected")
  await expect(chrome(page)).toHaveCount(0)
  await expect(page.getByTestId("artifact-panel").locator("iframe")).toBeVisible()
})

story("launches the resolved absolute path of relative and already-absolute files", async ({ page }) => {
  const root = page.getByTestId("artifact-view-fixture")
  await root.getByRole("button", { name: "Chrome installed", exact: true }).click()
  await expect(chrome(page)).toBeEnabled()
  // The accessible name carries the action; the button itself shows only an icon.
  await chrome(page).press("Enter")
  await root.getByRole("button", { name: "Launch succeeds", exact: true }).click()
  await expect(chrome(page)).toBeEnabled()
  await root.getByRole("button", { name: "Absolute file", exact: true }).click()
  await chrome(page).click()
  await expect(root.getByTestId("launches")).toHaveText(
    '[{"path":"/workspace/Alpha/preview/page one.html","app":"Google Chrome"},{"path":"/outside/page one.html","app":"Google Chrome"}]',
  )
})

story("starts one launch while a launch is in flight", async ({ page }) => {
  const root = page.getByTestId("artifact-view-fixture")
  await root.getByRole("button", { name: "Chrome installed", exact: true }).click()
  await expect(chrome(page)).toBeEnabled()
  await chrome(page).evaluate((button) => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
  await expect(chrome(page)).toBeDisabled()
  await expect(root.getByTestId("launches")).toHaveText(
    '[{"path":"/workspace/Alpha/preview/page one.html","app":"Google Chrome"}]',
  )
})

story("reports a failed launch and keeps the action available to retry", async ({ page }) => {
  const root = page.getByTestId("artifact-view-fixture")
  await root.getByRole("button", { name: "Chrome installed", exact: true }).click()
  await expect(chrome(page)).toBeEnabled()
  await chrome(page).click()
  await root.getByRole("button", { name: "Launch fails", exact: true }).click()
  await expect(page.getByText("Chrome could not open this file", { exact: true })).toBeVisible()
  await expect(chrome(page)).toBeEnabled()
  await chrome(page).click()
  await expect(root.getByTestId("launches")).toHaveText(
    '[{"path":"/workspace/Alpha/preview/page one.html","app":"Google Chrome"},{"path":"/workspace/Alpha/preview/page one.html","app":"Google Chrome"}]',
  )
})
