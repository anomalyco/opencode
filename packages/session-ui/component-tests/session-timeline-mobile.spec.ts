import { expect, story } from "../../storybook/playwright/story"

story.describe("touch timeline", () => {
  story.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

  story("keeps message actions and metadata visible without hover", async ({ mount, page }) => {
    const timeline = await mount("current-session-timeline-rows--conversation", { args: { scenario: "interruption" } })
    expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(true)

    for (const action of [
      { slot: "user-message-copy-wrapper", name: "Copy message" },
      { slot: "text-part-copy-wrapper", name: "Copy response" },
    ]) {
      const actions = timeline.locator(`[data-slot="${action.slot}"]`)
      await expect(actions).toHaveCount(1)
      await expect(actions).toHaveCSS("opacity", "1")
      await expect(actions).toHaveCSS("pointer-events", "auto")
      await expect(actions.getByRole("button", { name: action.name, exact: true })).toBeVisible()
    }

    await expect(timeline.locator('[data-slot="user-message-meta"]')).toContainText("Build")
    await expect(timeline.locator('[data-slot="user-message-meta-tail"]')).not.toBeEmpty()
    await expect(timeline.locator('[data-slot="text-part-meta"]')).toContainText("Build")
    await expect(timeline.locator('[data-slot="text-part-meta"]')).toContainText("Sonnet")
  })

  story("keeps shell copy visible without hover", async ({ mount }) => {
    const timeline = await mount("current-session-terminal-work--expanded-shell")
    const copy = timeline.locator('[data-slot="bash-copy"]')
    await expect(copy).toHaveCount(1)
    await expect(copy).toHaveCSS("opacity", "1")
    await expect(copy).toHaveCSS("pointer-events", "auto")
  })

  story("keeps error copy visible without hover", async ({ mount, page }) => {
    const errors = await mount("components-tool-error-card--all")
    const patch = errors.locator('[data-kind="tool-error-card"]').filter({ hasText: "Patch" })
    await patch.getByRole("button", { name: /Patch.*Verification failed/ }).tap()
    await page.touchscreen.tap(385, 800)
    const copy = patch.locator('[data-slot="tool-error-card-copy"]')
    await expect(copy).toHaveCSS("opacity", "1")
    await expect(copy).toHaveCSS("pointer-events", "auto")
  })

  story("keeps fenced code copy visible without hover", async ({ mount }) => {
    const markdown = await mount("components-markdown--complete-response")
    const code = markdown.locator('[data-component="markdown-code"]').filter({ hasText: "export const value = 42" })
    await expect(code).toHaveCount(1)
    await expect(code.locator('[data-slot="markdown-copy-button"]')).toHaveCSS("opacity", "1")
  })
})

story("desktop message actions still appear on hover and keyboard focus", async ({ mount, page }) => {
  const timeline = await mount("current-session-timeline-rows--conversation", { args: { scenario: "interruption" } })
  expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(true)

  for (const action of [
    { slot: "user-message-copy-wrapper", name: "Copy message" },
    { slot: "text-part-copy-wrapper", name: "Copy response" },
  ]) {
    const actions = timeline.locator(`[data-slot="${action.slot}"]`)
    await expect(actions).toHaveCount(1)
    await expect(actions).toHaveCSS("opacity", "0")
    await expect(actions).toHaveCSS("pointer-events", "none")
    await actions.locator("..").hover()
    await expect(actions).toHaveCSS("opacity", "1")
    await expect(actions).toHaveCSS("pointer-events", "auto")
    await page.mouse.move(0, 0)
    await expect(actions).toHaveCSS("opacity", "0")
    await actions.getByRole("button", { name: action.name, exact: true }).focus()
    await expect(actions).toHaveCSS("opacity", "1")
    await expect(actions).toHaveCSS("pointer-events", "auto")
    await page.getByRole("button", { name: "Reset", exact: true }).focus()
  }
})
