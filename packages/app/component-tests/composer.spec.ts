import { expect, story } from "../../stories/playwright/story"

story("cycles full prompts with plain arrows without opening the picker", async ({ mount, page }) => {
  const component = await mount("opencode-composer-flow--prompt-history")
  const input = component.getByRole("textbox", { name: "Prompt", exact: true })
  const options = component.getByRole("option")
  const composer = component.locator('[data-component="composer"]')
  const content = component.locator('[data-slot="composer-content"]')
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  const height = await composer.evaluate((element) => element.getBoundingClientRect().height)

  await input.press("ArrowUp")
  await expect(input).toHaveText("Explain the latest changes")
  await expect(input).toBeFocused()
  await expect(options).toHaveCount(0)
  await expect(content).toHaveCSS("mask-image", "none")
  await input.press("ArrowUp")
  await expect(input).toHaveText("Review the composer layout\nKeep keyboard navigation accessible")
  await expect(component.getByRole("img", { name: "layout.png", exact: true })).toBeVisible()
  await expect(component.getByText("Keep the search separate from the draft", { exact: true })).toBeVisible()
  await expect
    .poll(() => composer.evaluate((element) => element.getBoundingClientRect().height))
    .toBeGreaterThan(height)
  await expect(options).toHaveCount(0)
  await input.press("ArrowUp")
  await expect(input).toHaveText("Run the focused tests")
  await input.press("ArrowUp")
  await expect(input).toHaveText("Run the focused tests")
  await input.press("ArrowDown")
  await expect(input).toHaveText("Review the composer layout\nKeep keyboard navigation accessible")
  await input.press("ArrowDown")
  await expect(input).toHaveText("Explain the latest changes")
  await input.press("ArrowDown")
  await expect(input).toBeEmpty()
  await expect(composer).toHaveCSS("height", `${height}px`)

  // A new cycle saves and restores an empty-text draft's attachments and comments.
  await input.press("ArrowUp")
  await input.press("ArrowUp")
  await expect(input).toHaveText("Review the composer layout\nKeep keyboard navigation accessible")
  await input.fill("")
  await input.press("ArrowUp")
  await expect(input).toHaveText("Explain the latest changes")
  await expect(component.getByRole("img", { name: "layout.png", exact: true })).toHaveCount(0)
  await input.press("ArrowDown")
  await expect(input).toBeEmpty()
  await expect(component.getByRole("img", { name: "layout.png", exact: true })).toBeVisible()
  await expect(component.getByText("Keep the search separate from the draft", { exact: true })).toBeVisible()

  await input.press("ArrowUp")
  await input.press("ArrowUp")
  await expect(input).toHaveText("Review the composer layout\nKeep keyboard navigation accessible")
  await input.press("ArrowRight")
  await input.press("Shift+ArrowUp")
  await expect(options).toHaveCount(0)
  await expect.poll(() => input.evaluate(() => window.getSelection()?.toString())).toBe("R")
  await input.press("ArrowRight")
  await input.pressSequentially("!")
  await expect(input).toHaveText("R!eview the composer layout\nKeep keyboard navigation accessible")
  await input.press("ArrowUp")
  await expect(input).toHaveText("R!eview the composer layout\nKeep keyboard navigation accessible")

  await input.fill("")
  await input.press("ArrowUp")
  await expect(input).toHaveText("Explain the latest changes")
  await input.press("Enter")
  await expect(input).toBeEmpty()
  await expect(component.getByRole("status")).toHaveText("Submitted: Explain the latest changes")
  await input.press("ArrowUp")
  await expect(input).toHaveText("Explain the latest changes")
  await expect(options).toHaveCount(0)

  await input.fill("!")
  await expect(input).toBeEmpty()
  await input.press("ArrowUp")
  await expect(input).toHaveText("bun typecheck")
  await expect(options).toHaveCount(0)
  await input.press("ArrowDown")
  await expect(input).toBeEmpty()
  await input.press("ArrowUp")
  await input.press("Enter")
  await expect(component.getByRole("status")).toHaveText("Submitted: bun typecheck")
})

story(
  "previews history in the composer, accepts without sending, and cancels back to the original draft",
  async ({ mount, page }) => {
    const component = await mount("opencode-composer-flow--prompt-history")
    const input = component.getByRole("textbox", { name: "Prompt", exact: true })
    const search = component.getByRole("combobox", { name: "Prompt history", exact: true })
    const options = component.getByRole("option")
    const composer = component.locator('[data-component="composer"]')
    const content = component.locator('[data-slot="composer-content"]')
    const viewport = component.locator('[data-component="composer-scroll"]')
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    const height = await composer.evaluate((element) => element.getBoundingClientRect().height)

    await input.press("Shift+ArrowUp")
    await expect(input).toBeFocused()
    await expect(search).toHaveCount(0)
    await expect(input).toHaveText("Explain the latest changes")
    await expect(composer).toHaveCSS("height", `${height}px`)
    const menu = await component.locator('[data-component="composer-suggestions"]').boundingBox()

    if (!menu) throw new Error("Missing history menu")
    await expect(options).toHaveText([
      "Run the focused tests",
      "Review the composer layout Keep keyboard navigation accessible",
      "Explain the latest changes",
    ])
    await expect(component.getByRole("option", { selected: true })).toHaveText("Explain the latest changes")
    await input.press("ArrowUp")
    await expect(component.getByRole("option", { selected: true })).toHaveText(
      "Review the composer layout Keep keyboard navigation accessible",
    )
    await expect(input).toHaveText("Review the composer layout\nKeep keyboard navigation accessible")
    await expect(composer).toHaveCSS("height", `${height}px`)
    await expect
      .poll(() => component.locator('[data-slot="composer-content"]').evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0)
    await expect(input).toBeInViewport()
    await expect
      .poll(() =>
        input.evaluate(
          (element) =>
            element.getBoundingClientRect().top -
            element.closest('[data-slot="composer-content"]')!.getBoundingClientRect().top,
        ),
      )
      .toBe(0)
    await expect(content).not.toHaveCSS("mask-image", "none")
    await expect(viewport).toHaveCSS("mask-image", "none")
    await expect(content).toHaveCSS("--composer-fade-bottom", "16px")
    await content.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await expect(content).toHaveCSS("--composer-fade-bottom", "0px")
    await expect
      .poll(async () => (await component.locator('[data-component="composer-suggestions"]').boundingBox())?.y)
      .toBe(menu.y)
    await expect(component.getByRole("img", { name: "layout.png", exact: true })).toBeVisible()
    await expect(component.getByText("Keep the search separate from the draft", { exact: true })).toBeVisible()
    await input.press("ArrowUp")
    await expect(input).toHaveText("Run the focused tests")
    await expect(composer).toHaveCSS("height", `${height}px`)
    await input.press("ArrowUp")
    await expect(input).toHaveText("Run the focused tests")
    await input.press("ArrowDown")
    await expect(input).toHaveText("Review the composer layout\nKeep keyboard navigation accessible")
    await input.press("ControlOrMeta+f")
    await expect(search).toBeFocused()
    await search.fill("ACCESSIBLE")
    await expect(composer).toHaveCSS("height", `${height}px`)
    await search.press("Escape")
    await expect(input).toBeFocused()
    await expect(composer).toHaveCSS("height", `${height}px`)
    await expect
      .poll(() =>
        component
          .locator('[data-slot="composer-content"]')
          .evaluate((element) => element.scrollHeight > element.clientHeight),
      )
      .toBe(true)
    await input.press("Enter")
    await expect(options).toHaveCount(0)
    await expect(content).toHaveCSS("mask-image", "none")
    await expect(viewport).not.toHaveCSS("mask-image", "none")
    await expect(content).toHaveCSS("--composer-fade-bottom", "0px")
    await expect(input).toBeFocused()
    await expect(input).toHaveText("Review the composer layout\nKeep keyboard navigation accessible")
    await expect(component.getByRole("status")).toHaveText("Ready")
    await expect
      .poll(() => composer.evaluate((element) => element.getBoundingClientRect().height))
      .toBeGreaterThan(height)

    // History must not intercept navigation in a populated multiline editor.
    await input.press("ControlOrMeta+Home")
    await input.press("ArrowUp")
    await expect(search).toHaveCount(0)
    await expect(input).toHaveText("Review the composer layout\nKeep keyboard navigation accessible")

    // An empty-text draft can still have attachments and comments. Previewing must not lose them on cancel.
    await input.fill("")
    const restoredHeight = await composer.evaluate((element) => element.getBoundingClientRect().height)
    await input.press("Shift+ArrowUp")
    await expect(input).toHaveText("Explain the latest changes")
    await expect(component.getByRole("img", { name: "layout.png", exact: true })).toHaveCount(0)
    await expect(composer).toHaveCSS("height", `${restoredHeight}px`)
    await input.press("Escape")
    await expect(options).toHaveCount(0)
    await expect(input).toBeFocused()
    await expect(input).toBeEmpty()
    await expect(composer).toHaveCSS("height", `${restoredHeight}px`)
    await expect(component.getByRole("img", { name: "layout.png", exact: true })).toBeVisible()
    await expect(component.getByText("Keep the search separate from the draft", { exact: true })).toBeVisible()
  },
)

story("searches history on demand, returns to browsing, and keeps shell history separate", async ({ mount, page }) => {
  const component = await mount("opencode-composer-flow--prompt-history")
  const input = component.getByRole("textbox", { name: "Prompt", exact: true })
  const search = component.getByRole("combobox", { name: "Prompt history", exact: true })

  await input.press("Shift+ArrowUp")
  await input.press("ControlOrMeta+f")
  await expect(search).toBeFocused()
  await search.fill("ACCESSIBLE")
  await expect(component.getByRole("option")).toHaveCount(1)
  await expect(input).toHaveText("Review the composer layout\nKeep keyboard navigation accessible")
  await expect(search).toBeFocused()
  await search.press("Escape")
  await expect(search).toHaveCount(0)
  await expect(input).toBeFocused()
  await expect(component.getByRole("option")).toHaveCount(3)
  await input.press("Escape")
  await expect(component.getByRole("option")).toHaveCount(0)
  await expect(input).toBeEmpty()

  await input.press("Shift+ArrowUp")
  await component.getByRole("button", { name: /^Search/ }).click()
  await expect(search).toBeFocused()
  await search.fill("no matching prompt")
  await expect(component.getByRole("option")).toHaveCount(0)
  await expect(component.getByText("No matching items", { exact: true })).toBeVisible()
  await search.press("ArrowUp")
  await search.press("Enter")
  await expect(search).toHaveValue("no matching prompt")
  await expect(input).toHaveText("Explain the latest changes")
  await search.fill("tests")
  await expect(input).toHaveText("Run the focused tests")
  await expect(search).toBeFocused()
  await search.press("Enter")
  await expect(search).toHaveCount(0)
  await expect(input).toBeFocused()
  await expect(component.getByRole("status")).toHaveText("Ready")

  await input.fill("")
  await input.press("Shift+ArrowUp")
  await component.getByRole("option", { name: "Run the focused tests", exact: true }).click()
  await expect(input).toHaveText("Run the focused tests")
  await expect(input).toBeFocused()
  await expect(component.getByRole("status")).toHaveText("Ready")

  await page.mouse.move(0, 0)
  await input.fill("")
  await input.press("Shift+ArrowUp")
  await expect(input).toHaveText("Explain the latest changes")
  await expect(component.getByRole("option")).toHaveCount(3)
  await expect(input).toBeFocused()
  await input.press("Shift+Digit1")
  await expect(component.getByRole("option")).toHaveCount(0)
  await expect(input).toHaveText("Explain the latest changes!")

  await input.fill("!")
  await expect(input).toBeEmpty()
  await input.press("Shift+ArrowUp")
  await expect(input).toHaveText("bun typecheck")
  await expect(component.getByRole("option")).toHaveText(["bun typecheck"])
  await input.press("Escape")
  await expect(input).toBeFocused()
  await expect(input).toBeEmpty()
  await input.press("Shift+ArrowUp")
  await input.press("Enter")
  await expect(input).toHaveText("bun typecheck")
  await expect(component.getByRole("status")).toHaveText("Ready")
})

story("pins history search above the scrolling prompts", async ({ mount }) => {
  const component = await mount("opencode-composer-flow--prompt-history", { args: { many: true } })
  const input = component.getByRole("textbox", { name: "Prompt", exact: true })
  await input.press("Shift+ArrowUp")
  const menu = component.locator('[data-component="composer-suggestions"]')
  const search = menu.getByRole("button", { name: /^Search/ })
  const viewport = menu.locator("[data-scrollable]")
  await expect.poll(() => viewport.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)

  const clippedTop = () =>
    viewport.evaluate((element) => {
      const top = element.getBoundingClientRect().top

      return Array.from(element.querySelectorAll('[role="option"]')).some((row) => {
        const rect = row.getBoundingClientRect()

        return rect.top < top && rect.bottom > top
      })
    })

  await expect.poll(clippedTop).toBe(false)

  for (let index = 0; index < 12; index++) await input.press("ArrowUp")
  await expect(menu.getByRole("option", { selected: true })).toBeInViewport({ ratio: 1 })
  await expect.poll(clippedTop).toBe(false)
  await expect.poll(async () => (await search.boundingBox())!.y - (await viewport.boundingBox())!.y).toBeLessThan(0)
  const top = (await search.boundingBox())!.y

  await viewport.evaluate((element) => {
    element.scrollTop = 0
  })
  await expect(search).toBeInViewport()
  expect((await search.boundingBox())!.y).toBe(top)
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(search).toBeInViewport()
  expect((await search.boundingBox())!.y).toBe(top)
})

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
      // A late Inter swap resizes the delivery keybind and shifts the toolbar; measure after fonts settle.
      await page.evaluate(() => document.fonts.ready.then(() => undefined))

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
        // Below the mobile breakpoint the variant picker opens in a bottom drawer instead of a menu.
        await expect(
          width < 768
            ? page
                .getByRole("dialog", { name: "Choose model variant", exact: true })
                .getByRole("button", { name: "high", exact: true })
            : page.getByRole("menuitemradio", { name: "high", exact: true }),
        ).toBeVisible()
        await page.keyboard.press("Escape")
        await expect(variant).toBeFocused()
        await expect(submit).toBeInViewport()
        await expect(add).toBeInViewport()
        await add.click()
        await expect(page.getByRole("menuitem", { name: "Images and files" })).toBeVisible()
        await page.keyboard.press("Escape")
        await expect(add).toBeFocused()
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

story("keeps toolbar focus rings whole and keyboard-only", async ({ mount, page }) => {
  const component = await mount("opencode-composer-flow--toolbar-overflow", { args: { alternate: "none" } })
  const controls = component.locator('[data-slot="composer-controls"]')
  const agent = controls.getByRole("button", { name: "Choose agent" })
  const variant = controls.getByRole("button", { name: "Choose model variant" })
  await page.evaluate(() => document.fonts.ready.then(() => undefined))

  // Arriving from the keyboard on a control parked half under the edge scrolls all of it, ring included, into view.
  await controls.evaluate((element) => {
    const control = element.querySelector('[aria-label="Choose agent"]')!.getBoundingClientRect()
    element.scrollLeft = control.width / 2
  })
  await page.keyboard.press("Shift")
  await agent.focus()
  await expect(agent).toHaveCSS("outline-style", "solid")
  await expect(agent).toHaveCSS("outline-offset", "-2px")
  await expect.poll(() => controls.evaluate((element) => element.scrollLeft)).toBe(0)

  // A menu the pointer opened returns focus to its trigger without a ring, even when Escape closes it.
  await variant.click()
  await expect(page.getByRole("menuitemradio", { name: "high", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(variant).toBeFocused()
  await expect(variant).toHaveCSS("outline-style", "none")
})

story("grows suggestions while preserving visible timeline context", async ({ mount }) => {
  const component = await mount("opencode-composer-flow--constrained-command-suggestions")
  const boundary = component.locator('[data-slot="composer-suggestion-boundary-story"]')
  const suggestions = component.locator('[data-component="composer-suggestions"]')

  await expect(suggestions).toHaveCSS("max-height", "164px")
  await expect(suggestions).toHaveCSS("scroll-padding-bottom", "18px")
  await expect.poll(() => suggestions.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await expect
    .poll(async () => {
      const menu = await suggestions.boundingBox()

      const items = await suggestions.locator("[data-suggestion-id]").evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect()

          return { top: rect.top, bottom: rect.bottom }
        }),
      )

      if (!menu) return false
      const bottom = menu.y + menu.height

      return items.some((item) => item.top < bottom && item.bottom > bottom)
    })
    .toBe(true)

  await boundary.evaluate((element) => {
    element.style.height = "400px"
  })
  await expect(suggestions).toHaveCSS("max-height", "304px")
})

story("ignores a detached suggestion boundary", async ({ mount }) => {
  const component = await mount("opencode-composer-flow--detached-command-suggestion-boundary")
  await expect(component.locator('[data-component="composer-suggestions"]')).toHaveCSS("max-height", "304px")
})

// ThemeProvider writes resolved token values into a <style> block, so toggling data-color-scheme by hand
// leaves every --v2-* variable at its previous value. Switch themes through the theme global instead.
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
      await expect(component.getByAltText("screenshot.png")).toBeVisible()
      await expect(component.getByText("Keep the normal flow flat", { exact: true })).toBeVisible()
    }
  })
}

story.describe("touch attachments", () => {
  story.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

  story("keeps attachment remove buttons visible without hover", async ({ mount, page }) => {
    const component = await mount("opencode-composer-flow--mixed-attachments")
    expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(true)

    const remove = component.getByRole("button", { name: "Remove attachment", exact: true })
    await expect(remove).not.toHaveCount(0)

    for (const button of await remove.all()) await expect(button).toHaveCSS("opacity", "1")

    const count = await remove.count()
    await remove.first().tap()
    await expect(remove).toHaveCount(count - 1)
  })
})

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
  await page
    .getByRole("dialog", { name: "Select model", exact: true })
    .getByRole("combobox", { name: "Search models", exact: true })
    .press("Escape")
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

story.describe("mobile variant drawer", () => {
  story.use({ viewport: { width: 360, height: 720 } })

  // Guards patches/@corvu%2Fdrawer@0.2.4.patch. The drawer starts its opening transition two frames after it opens.
  // Dismissing it before then used to slide it open anyway, and dismissing it in that frame left it closing off screen
  // for good, holding focus and disabling pointer input on the page. Playwright input cannot target those frames, so
  // the page dismisses it.
  for (const moment of ["before", "as"] as const) {
    story(`closes and restores focus when dismissed ${moment} it starts opening`, async ({ mount, page }) => {
      const component = await mount("opencode-composer-flow--model-and-variant")
      const variant = component.getByRole("button", { name: "Choose model variant" })
      const drawer = page.getByRole("dialog", { name: "Choose model variant", exact: true })
      const high = drawer.getByRole("button", { name: "high", exact: true })

      // Load the lazy drawer first so the dismissal below races only the drawer's own transition.
      await variant.click()
      await expect(high).toBeInViewport()
      const content = await drawer.elementHandle()

      if (!content) throw new Error("Missing variant drawer")
      await page.keyboard.press("Escape")
      await expect(drawer).toBeHidden()
      await expect(variant).toBeFocused()

      await variant.evaluate(
        (trigger: HTMLElement, race) =>
          new Promise<void>((resolve) => {
            const dismiss = () => {
              document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
              resolve()
            }

            // Mutation records arrive before the browser renders the opening transition's first frame.
            const observer = new MutationObserver(() => {
              if (!race.content.hasAttribute("data-opening")) return
              observer.disconnect()
              dismiss()
            })

            if (race.moment === "as") observer.observe(race.content, { attributeFilter: ["data-opening"] })
            trigger.click()

            if (race.moment === "before") dismiss()
          }),
        { content, moment },
      )
      await expect(drawer).toBeHidden()
      await expect(variant).toBeFocused()
      await expect(page.locator("body")).not.toHaveCSS("pointer-events", "none")

      await variant.click()
      await expect(high).toBeInViewport()
    })
  }
})
