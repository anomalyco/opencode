import { expect, story } from "../../storybook/playwright/story"

story("raises the docked composer only in dark mode", async ({ mount, page }) => {
  const component = await mount("opencode-composer-flow--empty-draft")
  const composer = component.locator('[data-component="composer"]')

  await page.locator("html").evaluate((root) => root.setAttribute("data-color-scheme", "light"))
  await expect(composer).toHaveCSS("background-color", "rgb(255, 255, 255)")

  await page.locator("html").evaluate((root) => root.setAttribute("data-color-scheme", "dark"))
  await expect(composer).toHaveCSS("background-color", "rgb(36, 36, 36)")
})

story("centers add menu shortcuts in a consistent column", async ({ mount, page }) => {
  const component = await mount("opencode-composer-flow--empty-draft")
  await component.locator('[data-action="composer-attach"]').click()

  const shortcuts = page.locator('[role="menu"] [data-slot="menu-v2-item-shortcut"]')
  await expect(shortcuts).toHaveCount(4)
  const boxes = await shortcuts.evaluateAll((items) =>
    items.map((item) => {
      const box = item.getBoundingClientRect()
      return { width: box.width, center: box.left + box.width / 2 }
    }),
  )

  expect(new Set(boxes.map((box) => box.width)).size).toBe(1)
  expect(new Set(boxes.map((box) => box.center)).size).toBe(1)
})

for (const draft of ["empty-draft", "multiline-draft", "mixed-attachments"]) {
  story(`select all stays inside the composer with ${draft}`, async ({ mount, page }) => {
    const component = await mount(`opencode-composer-flow--${draft}`)
    const input = component.getByRole("textbox", { name: "Prompt", exact: true })
    const text = await input.textContent()

    for (let count = 0; count < 2; count++) {
      await input.press("ControlOrMeta+a")
      expect(
        await input.evaluate((editor) => {
          const selection = window.getSelection()
          return {
            text: selection?.toString(),
            inside: editor.contains(selection?.anchorNode ?? null) && editor.contains(selection?.focusNode ?? null),
          }
        }),
      ).toEqual({ text, inside: true })
    }

    await page.keyboard.type("Replacement draft")
    await expect(input).toHaveText("Replacement draft")
    await expect(component.getByRole("status")).toHaveText("Ready")
    if (draft === "mixed-attachments") {
      await expect(component.getByAltText("layout.png")).toBeVisible()
      await expect(component.getByText("Keep the normal flow flat", { exact: true })).toBeVisible()
    }
  })
}

story("renders a draft once and supports editing, caret restoration, and failure recovery", async ({ mount, page }) => {
  await page.addInitScript(() => {
    const replace = Element.prototype.replaceChildren
    Element.prototype.replaceChildren = function (this: Element, ...nodes) {
      // The ref can run before data-component is assigned, so count on every target.
      this.setAttribute("data-test-replacements", String(Number(this.getAttribute("data-test-replacements")) + 1))
      return replace.apply(this, nodes)
    }
  })
  const component = await mount("opencode-composer-flow--failed-submission-restoration")
  const input = component.getByRole("textbox", { name: "Prompt", exact: true })
  await expect(input).toHaveText("Preserve this draft on failure")
  await expect(input).toHaveAttribute("data-test-replacements", "1")

  await input.press("Home")
  await input.press("Shift+ArrowRight")
  await input.pressSequentially("XY")
  await expect(input).toHaveText("XYreserve this draft on failure")
  await expect(input).toHaveAttribute("data-test-replacements", "1")

  // Closing the model picker restores the controller's saved caret through its editor ref.
  await component.locator('[data-action="composer-model"]').click()
  await page.getByRole("menu").getByRole("textbox").press("Escape")
  await expect(input).toBeFocused()
  await input.pressSequentially("!")
  await expect(input).toHaveText("XY!reserve this draft on failure")
  await component.getByRole("button", { name: "Send", exact: true }).click()
  await expect(component.getByRole("status")).toHaveText("Submission failed; draft restored")
  await expect(input).toHaveText("Preserve this draft on failure")
})

// Moved from packages/app/e2e/regression/prompt-thinking-level.spec.ts
story("shows the thinking level control while relevant", async ({ mount, page }) => {
  const component = await mount("opencode-composer-flow--model-and-variant")
  const composer = component.locator('[data-component="composer"]')
  const input = composer.locator('[data-component="composer-editor"]')
  const control = composer.getByRole("button", { name: "Choose model variant" })

  await page.mouse.move(0, 0)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await expect(control).toBeVisible()

  await control.click()
  const high = page.getByRole("menuitemradio", { name: "high" })
  await expect(high).toBeVisible()
  await page.mouse.move(0, 0)
  await expect(control).toBeVisible()
  await expect(high).toBeVisible()
  await high.click()

  await input.focus()
  await expect(control).toBeVisible()
  await input.blur()
  await expect(control).toBeVisible()
})
