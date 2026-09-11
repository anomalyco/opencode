import { expect, story } from "../../storybook/playwright/story"

for (const direction of ["ltr", "rtl"]) {
  for (const alternate of ["none", "queue", "steer"]) {
    story(`scrolls overflowing controls beside fixed ${alternate} actions in ${direction}`, async ({ mount, page }) => {
      const component = await mount("opencode-composer-flow--toolbar-overflow", {
        args: { alternate },
        globals: { direction },
      })
      const controls = component.locator('[data-slot="composer-controls"]')
      const actions = component.locator('[data-slot="composer-actions"]')
      const submit = component.locator('[data-action="composer-submit"]')
      const add = component.locator('[data-action="composer-attach"]')
      const agent = controls.getByRole("button", { name: "Choose agent" })
      const variant = controls.getByRole("button", { name: "Choose model variant" })
      await expect(controls).toHaveCSS("overflow-x", "auto")
      await expect(controls).toHaveCSS("overscroll-behavior-x", "contain")
      await expect(controls).toHaveCSS("direction", direction)
      await expect(controls).toHaveCSS("padding-inline-start", "0px")
      await expect(controls).toHaveCSS("padding-inline-end", "0px")
      await expect(component.locator('[data-action="composer-alternate-delivery"]')).toHaveCount(
        alternate === "none" ? 0 : 1,
      )

      for (const width of [1024, 360]) {
        await page.setViewportSize({ width, height: 720 })
        await expect
          .poll(() => controls.evaluate((element) => element.scrollWidth - element.clientWidth))
          .toBeGreaterThan(0)
        const fixed = await submit.boundingBox()
        const fixedAdd = await add.boundingBox()
        const viewport = await controls.boundingBox()
        const action = await actions.boundingBox()
        expect(fixed).not.toBeNull()
        expect(viewport).not.toBeNull()
        expect(action).not.toBeNull()
        expect(fixedAdd).not.toBeNull()
        if (!fixed || !viewport || !action || !fixedAdd) return
        expect(direction === "ltr" ? fixedAdd.x + fixedAdd.width : viewport.x + viewport.width).toBeCloseTo(
          direction === "ltr" ? viewport.x - 4 : fixedAdd.x - 4,
          1,
        )
        expect(direction === "ltr" ? viewport.x + viewport.width : action.x + action.width).toBeCloseTo(
          direction === "ltr" ? action.x - 12 : viewport.x - 12,
          1,
        )

        await controls.evaluate((element) => {
          element.scrollLeft = 0
        })
        await expect(controls).toHaveAttribute("data-overflow-start", "false")
        await expect(controls).toHaveAttribute("data-overflow-end", "true")
        await expect(controls).toHaveCSS(
          "mask-image",
          `linear-gradient(to ${direction === "ltr" ? "right" : "left"}, rgba(0, 0, 0, 0), rgb(0, 0, 0) 0px, rgb(0, 0, 0) calc(100% - 16px), rgba(0, 0, 0, 0))`,
        )
        const first = await agent.boundingBox()
        if (!first) throw new Error("Missing agent control")
        expect(
          direction === "ltr" ? first.x - viewport.x : viewport.x + viewport.width - first.x - first.width,
        ).toBeCloseTo(0, 0)
        await controls.evaluate((element) => {
          element.scrollLeft =
            ((getComputedStyle(element).direction === "rtl" ? -1 : 1) * (element.scrollWidth - element.clientWidth)) / 2
        })
        await expect(controls).toHaveAttribute("data-overflow-start", "true")
        await expect(controls).toHaveAttribute("data-overflow-end", "true")
        const scrolled = (await controls.boundingBox())!
        expect(scrolled.x).toBeCloseTo(viewport.x, 1)
        expect(scrolled.width).toBeCloseTo(viewport.width, 1)
        await controls.hover()
        await page.mouse.wheel(direction === "ltr" ? 1000 : -1000, 0)
        await expect.poll(() => controls.evaluate((element) => Math.abs(element.scrollLeft))).toBeGreaterThan(0)
        expect(await submit.boundingBox()).toEqual(fixed)
        expect(await add.boundingBox()).toEqual(fixedAdd)

        // The fade disappears at the endpoint instead of reserving padding.
        await variant.focus()
        await controls.evaluate((element) => {
          element.scrollLeft =
            getComputedStyle(element).direction === "rtl" ? -element.scrollWidth : element.scrollWidth
        })
        await expect(controls).toHaveAttribute("data-overflow-start", "true")
        await expect(controls).toHaveAttribute("data-overflow-end", "false")
        const last = await variant.boundingBox()
        if (!last) throw new Error("Missing variant control")
        expect(
          Math.abs(direction === "ltr" ? viewport.x + viewport.width - last.x - last.width : last.x - viewport.x),
        ).toBeLessThan(1)
        expect(
          Math.abs((direction === "ltr" ? action.x - last.x - last.width : last.x - action.x - action.width) - 12),
        ).toBeLessThan(1)
        await page.keyboard.press("Enter")
        await expect(page.getByRole("menuitemradio", { name: "high", exact: true })).toBeVisible()
        await page.keyboard.press("Escape")
        await expect(variant).toBeFocused()
        await expect(submit).toBeInViewport()
        await expect(add).toBeInViewport()
        await add.click()
        await expect(page.getByRole("menuitem", { name: "Images and files" })).toBeVisible()
        await page.keyboard.press("Escape")
        expect(await add.boundingBox()).toEqual(fixedAdd)
      }

      if (alternate !== "none") {
        const width = (await controls.boundingBox())!.width
        await component.getByRole("textbox", { name: "Prompt", exact: true }).fill("")
        await expect(component.locator('[data-action="composer-alternate-delivery"]')).toHaveCount(0)
        await expect.poll(async () => (await controls.boundingBox())!.width).toBeGreaterThan(width)
      }
    })
  }
}

story("does not mask or pad controls when they fit", async ({ mount }) => {
  const component = await mount("opencode-composer-flow--model-and-variant")
  const controls = component.locator('[data-slot="composer-controls"]')
  await expect(controls).toHaveAttribute("data-overflow-start", "false")
  await expect(controls).toHaveAttribute("data-overflow-end", "false")
  await expect(controls).toHaveCSS("mask-image", "none")
  await expect(controls).toHaveCSS("padding-inline-start", "0px")
  await expect(controls).toHaveCSS("padding-inline-end", "0px")
})

// ThemeProvider writes resolved token values into a <style> block, so toggling data-color-scheme by hand
// leaves every --v2-* variable at its previous value. Switch themes through the Storybook global instead.
for (const [theme, background] of [
  ["light", "rgb(255, 255, 255)"],
  ["dark", "rgb(36, 36, 36)"],
] as const) {
  story(`raises the docked composer only in dark mode (${theme})`, async ({ mount }) => {
    const component = await mount("opencode-composer-flow--empty-draft", { globals: { theme } })
    await expect(component.locator('[data-component="composer"]')).toHaveCSS("background-color", background)
  })
}

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

story("shows thinking on composer hover or when a non-default variant is selected", async ({ mount, page }) => {
  const component = await mount("opencode-composer-flow--model-and-variant")
  const composer = component.locator('[data-component="composer"]')
  const input = composer.getByRole("textbox", { name: "Prompt", exact: true })
  const control = composer.getByRole("button", { name: "Choose model variant" })

  await component.getByRole("status").click()
  await page.mouse.move(0, 0)
  await expect(control).toHaveText("balanced")
  await expect(control).toHaveCSS("opacity", "1")

  await control.click()
  await page.getByRole("menuitemradio", { name: "default", exact: true }).click()
  await component.getByRole("status").click()
  await expect(control).toHaveText("default")
  await expect(control).toHaveCSS("opacity", "0")
  await expect(control).toHaveCSS("pointer-events", "none")

  await input.hover()
  await expect(control).toHaveCSS("opacity", "1")
  await expect(control).toHaveCSS("pointer-events", "auto")
  await input.click()
  await page.mouse.move(0, 0)
  await expect(input).toBeFocused()
  await expect(control).toHaveCSS("opacity", "0")

  await input.hover()
  await control.click()
  const high = page.getByRole("menuitemradio", { name: "high" })
  await expect(high).toBeVisible()
  await page.mouse.move(0, 0)
  await expect(control).toHaveAttribute("aria-expanded", "true")
  await expect(control).toHaveCSS("opacity", "1")
  await expect(high).toBeVisible()
  await high.click()
  await component.getByRole("status").click()
  await expect(control).toHaveText("high")
  await expect(control).toHaveCSS("opacity", "1")

  await control.click()
  await page.getByRole("menuitemradio", { name: "default", exact: true }).click()
  await component.getByRole("status").click()
  await expect(control).toHaveCSS("opacity", "0")
})

story("keeps default thinking accessible by keyboard without composer hover", async ({ mount, page }) => {
  const component = await mount("opencode-composer-flow--model-and-variant")
  const input = component.getByRole("textbox", { name: "Prompt", exact: true })
  const control = component.getByRole("button", { name: "Choose model variant" })

  await control.click()
  await page.getByRole("menuitemradio", { name: "default", exact: true }).click()
  await input.click()
  await page.mouse.move(0, 0)
  await expect(control).toHaveCSS("opacity", "0")

  // Tab through Add, Agent, and Model to the visually hidden thinking trigger.
  for (let count = 0; count < 4; count++) await page.keyboard.press("Tab")
  await expect(control).toBeFocused()
  await expect(control).toHaveCSS("opacity", "1")
  await page.keyboard.press("Enter")
  await expect(control).toHaveAttribute("aria-expanded", "true")
  await expect(page.getByRole("menuitemradio", { name: "default", exact: true })).toBeFocused()
  await expect(control).toHaveCSS("opacity", "1")
  await page.keyboard.press("Escape")
  await expect(control).toHaveAttribute("aria-expanded", "false")
  await expect(control).toBeFocused()
  await expect(control).toHaveCSS("opacity", "1")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("menuitemradio", { name: "default", exact: true })).toBeFocused()
  await page.keyboard.press("End")
  await expect(page.getByRole("menuitemradio", { name: "high", exact: true })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(control).toHaveText("high")
  await expect(control).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("menuitemradio", { name: "default", exact: true })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(control).toHaveText("default")
  await expect(control).toBeFocused()
  await expect(control).toHaveCSS("opacity", "1")
  await page.keyboard.press("Tab")
  await expect(control).not.toBeFocused()
  await expect(control).toHaveCSS("opacity", "0")
})
