import { fileURLToPath } from "node:url"
import { expect, story } from "../../storybook/playwright/story"

const fixture = `/@fs/${fileURLToPath(new URL("./browser-pane.fixture.tsx", import.meta.url)).replaceAll("\\", "/")}`

story.beforeEach(async ({ mount, page }) => {
  const component = await mount("opencode-composer-flow--mixed-attachments")
  await expect(component.getByRole("textbox", { name: "Prompt", exact: true })).toBeVisible()
  await page.evaluate(async (fixture) => {
    const { mountBrowserPane } = await import(fixture)
    mountBrowserPane()
  }, fixture)
  await expect(page.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
})

story("hides the previous registration when the mounted pane switches sessions", async ({ page }, testInfo) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Beta", exact: true }).click()
  await expect(root.getByTestId("native-Beta")).toHaveAttribute("data-visible", "true")
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "false")
  await page.screenshot({ path: testInfo.outputPath("session-switch.png") })
  await root.getByRole("button", { name: "Alpha", exact: true }).click()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
  await expect(root.getByTestId("native-Beta")).toHaveAttribute("data-visible", "false")
})

story("hides the outgoing browser when the destination has no browser pane", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Empty", exact: true }).click()
  await expect(root.locator("#browser-panel")).toHaveCount(0)
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "false")
  await root.getByRole("button", { name: "Alpha", exact: true }).click()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
})

story("hides and restores the same registration for Review tabs and unmount", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Toggle Review tab", exact: true }).click()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "false")
  await root.getByRole("button", { name: "Toggle Review tab", exact: true }).click()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
  await root.getByRole("button", { name: "Unmount pane", exact: true }).click()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "false")
})

story("shows the empty state over a blank native page and restores navigation", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Blank page", exact: true }).click()
  await expect(root.getByText("Enter URL", { exact: true })).toBeVisible()
  await expect(root.getByText('Or prompt "Open my app in the browser"', { exact: true })).toBeVisible()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "false")
  await expect(root.getByRole("button", { name: "Reload", exact: true })).toBeDisabled()

  const address = root.getByRole("textbox", { name: "Browser address", exact: true })
  await address.fill("https://example.com/")
  await expect(root.getByText("Enter URL", { exact: true })).toBeVisible()
  await address.press("Enter")
  await expect(address).not.toBeFocused()
  await expect(root.getByText("Enter URL", { exact: true })).toBeHidden()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
  await expect(root.getByRole("button", { name: "Reload", exact: true })).toBeEnabled()
})

story("keeps Stop available without exposing a blank native page during loading", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Loading page", exact: true }).click()
  await expect(root.getByText("Enter URL", { exact: true })).toBeHidden()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "false")
  await root.getByRole("button", { name: "Stop", exact: true }).click()
  await expect(root.getByText("Enter URL", { exact: true })).toBeVisible()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "false")
})

story("keeps the submitted URL visible until the browser reports navigation", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Blank page", exact: true }).click()
  await root.getByRole("button", { name: "Delay navigation", exact: true }).click()
  const address = root.getByRole("textbox", { name: "Browser address", exact: true })
  await address.fill("https://example.com/")
  await address.press("Enter")
  await expect(address).not.toBeFocused()
  await expect(address).toHaveValue("https://example.com/")
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "false")

  await root.getByRole("button", { name: "Complete navigation", exact: true }).click()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
  await expect(address).toHaveValue("https://example.com/")

  await address.fill("https://unsubmitted.example/")
  await root.getByRole("button", { name: "Delay navigation", exact: true }).click()
  await expect(address).toHaveValue("https://example.com/")
})

story("shows a themed failure state for only the failed tab and allows retry", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Failed page", exact: true }).click()
  await expect(root.getByText("URL can't be reached", { exact: true })).toBeVisible()
  await expect(root.getByText("Check the URL and your connection, then try again.", { exact: true })).toBeVisible()
  await expect(root.getByText("Request failed", { exact: true })).toBeHidden()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "false")
  await expect(root.getByRole("textbox", { name: "Browser address", exact: true })).toHaveValue("https://alpha.example/")

  await root.getByRole("button", { name: "Beta", exact: true }).click()
  await expect(root.getByText("URL can't be reached", { exact: true })).toBeHidden()
  await expect(root.getByTestId("native-Beta")).toHaveAttribute("data-visible", "true")
  await root.getByRole("button", { name: "Alpha", exact: true }).click()
  await expect(root.getByText("URL can't be reached", { exact: true })).toBeVisible()

  await root.getByRole("button", { name: "Reload", exact: true }).click()
  await expect(root.getByText("URL can't be reached", { exact: true })).toBeHidden()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
})

story("returns a failed tab to the empty state when an empty URL is submitted", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Failed page", exact: true }).click()
  await expect(root.getByText("URL can't be reached", { exact: true })).toBeVisible()
  await root.getByRole("button", { name: "Delay navigation", exact: true }).click()
  const shows = await root.getByTestId("native-Alpha").getAttribute("data-shows")

  const address = root.getByRole("textbox", { name: "Browser address", exact: true })
  await address.fill("")
  await address.press("Enter")
  await expect(address).not.toBeFocused()
  await expect(address).toHaveValue("")
  await root.getByRole("button", { name: "Load current page", exact: true }).click()
  await expect(root.getByRole("button", { name: "Stop", exact: true })).toBeEnabled()
  await root.getByRole("button", { name: "Complete navigation", exact: true }).click()
  await expect(root.getByText("URL can't be reached", { exact: true })).toBeHidden()
  await expect(root.getByText("Enter URL", { exact: true })).toBeVisible()
  await expect(root.getByRole("button", { name: "Reload", exact: true })).toBeDisabled()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "false")
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-shows", shows!)
})

story("selects the full URL when the address field gains focus", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const address = root.getByRole("textbox", { name: "Browser address", exact: true })
  await address.click()
  await expect(address).toHaveJSProperty("selectionStart", 0)
  await expect(address).toHaveJSProperty("selectionEnd", "https://alpha.example/".length)
  await address.pressSequentially("https://example.com/")
  await expect(address).toHaveValue("https://example.com/")
  await address.press("Enter")
  await expect(address).not.toBeFocused()
  await address.focus()
  await expect(address).toHaveJSProperty("selectionStart", 0)
  await expect(address).toHaveJSProperty("selectionEnd", "https://example.com/".length)
  await address.press("ArrowRight")
  await address.click()
  await expect(address).toHaveJSProperty("selectionStart", 0)
  await expect(address).toHaveJSProperty("selectionEnd", "https://example.com/".length)
})

story("hides the native page immediately on submission and throughout loading", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  await root.getByRole("button", { name: "Delay navigation", exact: true }).click()
  const address = root.getByRole("textbox", { name: "Browser address", exact: true })
  await address.fill("https://example.com/")
  await address.press("Enter")
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "false")
  await expect(address).toHaveValue("https://example.com/")

  await root.getByRole("button", { name: "Load current page", exact: true }).click()
  await expect(root.getByRole("button", { name: "Stop", exact: true })).toBeEnabled()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "false")
  await root.getByRole("button", { name: "Complete navigation", exact: true }).click()
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
  await expect(address).toHaveValue("https://example.com/")
})

story("keeps the current page and restores its URL when an empty address is submitted", async ({ page }) => {
  const root = page.getByTestId("browser-pane-fixture")
  const address = root.getByRole("textbox", { name: "Browser address", exact: true })
  await address.fill("")
  await address.press("Enter")
  await expect(address).not.toBeFocused()
  await expect(address).toHaveValue("https://alpha.example/")
  await expect(root.getByTestId("native-Alpha")).toHaveAttribute("data-visible", "true")
  await expect(root.getByText("Enter URL", { exact: true })).toBeHidden()
  await expect(root.getByRole("button", { name: "Reload", exact: true })).toBeEnabled()
})
