import { expect, story } from "../../stories/playwright/story"

story("a subagent status line shows its model and the way back", async ({ mount, page }) => {
  await mount("app-current-session-surface--child-session")

  const bar = page.locator('[data-component="subagent-bar"]')
  // The variant follows the model name, dimmer and without a separator, like the message metadata.
  const model = bar.locator('[data-slot="subagent-model"]')
  await expect(model).toHaveText("Anthropic / Claude Opus 5.5 high")
  await expect(model.getByText("high", { exact: true })).toHaveCSS("opacity", "0.66")
  await expect(page.locator('[data-component="composer"]')).toHaveCount(0)

  // A status line, not a composer card of its own; the subagent's composer sits under it.
  await expect(bar).toHaveCSS("border-top-left-radius", "0px")
  await expect(bar).toHaveCSS("height", "32px")

  await bar.getByRole("button", { name: /main session/i }).click()
  await expect(page.getByText("Opened the parent Session locally")).toBeVisible()
})

story("a subagent with no recorded outcome starts its line at the agent", async ({ mount, page }) => {
  await mount("app-current-session-surface--child-session-no-outcome")

  const bar = page.locator('[data-component="subagent-bar"]')
  await expect(bar.locator('[data-slot="subagent-model"]')).toBeVisible()
  // No empty status icon box, and no separator before the first item.
  await expect(bar.locator(":scope > span")).toHaveCount(0)
  await expect(bar).toHaveText(/^surveyor·Anthropic/)
})

story("a subagent takes a steered message from its own composer", async ({ mount, page }) => {
  await mount("app-current-session-surface--child-session")

  const composer = page.locator('[data-component="subagent-composer"]')
  const input = composer.getByRole("textbox", { name: "Message this subagent" })
  const send = composer.getByRole("button", { name: "Send" })

  await expect(composer).toBeVisible()
  await expect(input).toHaveAttribute("placeholder", "Message this subagent")
  await expect(send).toBeDisabled()

  // Focus is the user's to give: entering a child Session is for reading, so the composer does not take it.
  await expect(input).not.toBeFocused()

  // An IME candidate's Return confirms the composition instead of sending a half-composed message.
  await input.fill("半角")
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true })
  await expect(page.getByText(/Sent to the subagent locally/)).toBeHidden()
  await expect(input).toHaveValue("半角")

  await input.fill("Check the failing test first")
  await expect(send).toBeEnabled()
  await input.press("Shift+Enter")
  await expect(input).toHaveValue("Check the failing test first\n")
  await expect(page.getByText(/Sent to the subagent locally/)).toBeHidden()

  await input.press("Enter")
  await expect(page.getByText("Sent to the subagent locally: Check the failing test first")).toBeVisible()
  await expect(input).toHaveValue("")
  await expect(send).toBeDisabled()

  await input.click()
  await expect(input).toBeFocused()
})

story("the subagent composer is off until its experimental setting is on", async ({ mount, page }) => {
  await mount("app-current-session-surface--child-session-composer-off")

  const bar = page.locator('[data-component="subagent-bar"]')
  await expect(bar).toBeVisible()
  await expect(bar).toHaveCSS("height", "32px")
  await expect(page.locator('[data-component="subagent-composer"]')).toHaveCount(0)

  // The same child surface with the setting on mounts it, so an inverted accessor fails one of the two stories.
  await mount("app-current-session-surface--child-session")
  await expect(page.locator('[data-component="subagent-bar"]')).toBeVisible()
  await expect(page.locator('[data-component="subagent-composer"]')).toHaveCount(1)
})

story("a subagent composer keeps its controls inside a narrow window", async ({ mount, page }) => {
  await page.setViewportSize({ width: 360, height: 720 })
  await mount("app-current-session-surface--child-session")

  const composer = page.locator('[data-component="subagent-composer"]')
  const input = composer.getByRole("textbox", { name: "Message this subagent" })
  const send = composer.getByRole("button", { name: "Send" })

  await input.fill("A long instruction that keeps the field occupied while the layout is measured")
  await expect(send).toBeEnabled()
  // The frame is `w-full` whatever overflows it, so assert the content and the controls, not the form box.
  expect(await composer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await expect(send).toBeInViewport()
  await expect(input).toBeInViewport()

  const bounds = await send.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(360)
})
