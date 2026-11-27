import type { Locator } from "@playwright/test"
import { expect, story } from "../../stories/playwright/story"

story("answer cards allow text selection without changing answers", async ({ mount, page }) => {
  const component = await mount("app-current-session-surface--question-request")

  const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')

  const wide = question.getByRole("radio", { name: /Wide/ })

  await expect(question.getByRole("radio", { name: /Focused/ })).toBeFocused()
  await page.evaluate(() => document.fonts.ready.then(() => undefined))

  const drag = async (text: Locator) => {
    await text.scrollIntoViewIfNeeded()

    const box = await text.boundingBox()

    expect(box).not.toBeNull()
    await page.mouse.move(box!.x + 1, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(box!.x + box!.width - 1, box!.y + box!.height / 2, { steps: 12 })
    await page.mouse.up()
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim())).toBe(await text.innerText())
  }

  for (const slot of ["option-label", "option-description"]) {
    await drag(wide.locator(`[data-slot="${slot}"] bdi`))
    await expect(wide).not.toBeChecked()
  }

  await wide.locator('[data-slot="option-description"] bdi').click({ modifiers: ["Shift"] })
  await expect(wide).not.toBeChecked()
  await wide.click({ position: { x: 4, y: 4 } })
  await expect(wide).toBeChecked()
  await question.getByRole("radio", { name: /Focused/ }).click()
  await drag(wide.locator('[data-slot="option-description"] bdi'))
  await expect(wide).not.toBeChecked()

  const mark = await wide.locator('[data-slot="question-option-check"]').boundingBox()

  expect(mark).not.toBeNull()
  await page.mouse.move(mark!.x + mark!.width / 2, mark!.y + mark!.height / 2)
  await page.mouse.down()
  await page.mouse.move(mark!.x + mark!.width / 2 + 1, mark!.y + mark!.height / 2)
  await page.mouse.up()
  await expect(wide).toBeChecked()
  await question.getByRole("button", { name: "Next", exact: true }).click()

  const files = question.getByRole("checkbox", { name: "Changed files", exact: true })

  await expect(files).toBeFocused()
  await files.click()
  await expect(files).toBeChecked()
  await drag(files.locator('[data-slot="option-label"] bdi'))
  await expect(files).toBeChecked()
  await files.click({ position: { x: 4, y: 4 } })
  await expect(files).not.toBeChecked()
})

story("question text links URLs", async ({ mount }) => {
  const component = await mount("session-question-switch--link-prompt")
  const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
  const url = "https://www.npmjs.com/auth/cli/2ff15723-dfa2-4eec-addd-53cb3ff7597f"
  const link = question.locator('[data-slot="question-text"]').getByRole("link", { name: url, exact: true })

  await expect(link).toHaveAttribute("href", url)
  await expect(link).toHaveAttribute("target", "_blank")
})

story("MCP elicitation message and field descriptions link URLs", async ({ mount }) => {
  const component = await mount("app-current-session-surface--mcp-elicitation-request")
  const dock = component.locator('[data-component="dock-prompt"][data-kind="question"]')

  for (const url of ["https://example.com/releases/v2.4.0", "https://example.com/docs/release-notes"])
    await expect(dock.getByRole("link", { name: url, exact: true })).toHaveAttribute("href", url)
})

story(
  "uses the original question cards by default and submits selected and custom answers",
  async ({ mount, page }) => {
    const component = await mount("app-current-session-surface--question-request")
    const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
    const focused = question.getByRole("radio", { name: /Focused/ })
    const wide = question.getByRole("radio", { name: /Wide/ })
    await expect(focused).toBeFocused()
    const shortcuts = question.locator('[data-slot="question-option-shortcut"] [data-slot="keybind-v2-label"]')
    await expect(shortcuts).toHaveText(["1", "2", "3"])
    await expect(question.getByText("Select one answer", { exact: true })).toBeVisible()
    await page.keyboard.press("ArrowRight")
    await expect(wide).toBeFocused()
    await page.keyboard.press(" ")
    await expect(wide).toBeChecked()
    await expect(shortcuts).toHaveText(["1", "2", "3"])
    await expect(focused).not.toBeChecked()

    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    const next = question.getByRole("button", { name: "Next", exact: true })
    const width = await next.evaluate((button) => button.getBoundingClientRect().width)
    await next.click()
    const files = question.getByRole("checkbox", { name: "Changed files", exact: true })
    const terminal = question.getByRole("checkbox", { name: "Terminal", exact: true })
    const input = question.getByRole("textbox", { name: "Type your own answer…", exact: true })
    const custom = question.getByRole("checkbox", { name: "Type your own answer…", exact: true })
    await expect(files).toBeFocused()
    const submit = question.getByRole("button", { name: "Submit", exact: true })
    expect(await submit.evaluate((button) => button.getBoundingClientRect().width)).toBe(width)
    await expect(shortcuts).toHaveText(["1", "2", "3", "4"])
    await page.keyboard.down(" ")
    await page.keyboard.down(" ")
    await page.keyboard.up(" ")
    await terminal.click()
    await expect(files).toBeChecked()
    await expect(terminal).toBeChecked()
    await expect(shortcuts).toHaveText(["1", "2", "3", "4"])
    await terminal.click()
    await expect(terminal).not.toBeChecked()
    await terminal.click()
    await input.fill("Diagnostics")
    await expect(custom).toBeChecked()
    await expect(input).toHaveValue("Diagnostics")
    await question.getByRole("button", { name: "Back", exact: true }).click()
    await expect(wide).toBeChecked()
    await next.click()
    await expect(files).toBeChecked()
    await expect(terminal).toBeChecked()
    await expect(custom).toBeChecked()
    await submit.click()
    await expect(question).toBeHidden()
  },
)

story("keeps classic long answer lists inside the panel and scrolls them", async ({ mount, page }) => {
  const component = await mount("session-question-switch--long-list")
  const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
  const first = question.getByRole("checkbox", { name: /All typography/ })
  await expect(first).toBeFocused()
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await expect
    .poll(() =>
      question.evaluate((root) => {
        const options = root.querySelector<HTMLElement>('[data-slot="question-options"]')!
        const box = root.getBoundingClientRect()

        return { fits: box.top >= 0 && box.bottom <= innerHeight, scrolls: options.scrollHeight > options.clientHeight }
      }),
    )
    .toEqual({ fits: true, scrolls: true })

  await first.press("End")
  await expect(question.getByRole("textbox", { name: "Type your own answer…", exact: true })).toBeFocused()
  await expect(question.locator('[data-slot="question-option"][data-custom="true"]')).toBeInViewport({ ratio: 1 })
  await question.getByRole("button", { name: "Next", exact: true }).click()
  await expect(question.getByRole("radio", { name: "One pull request", exact: true })).toBeFocused()
})

story(
  "classic arrow keys land in the custom answer's field and Up from its start leaves it",
  async ({ mount, page }) => {
    const component = await mount("app-current-session-surface--question-request")
    const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
    const focused = question.getByRole("radio", { name: /Focused/ })
    const wide = question.getByRole("radio", { name: /Wide/ })
    const custom = question.getByRole("radio", { name: "Type your own answer…", exact: true })
    const input = question.getByRole("textbox", { name: "Type your own answer…", exact: true })
    await expect(focused).toBeFocused()
    await page.keyboard.press("1")
    await expect(focused).toBeChecked()

    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await expect(input).toBeFocused()
    await expect(custom).not.toBeChecked()
    await expect(focused).toBeChecked()

    await page.keyboard.press("ArrowUp")
    await expect(wide).toBeFocused()
    await expect(focused).toBeChecked()

    await page.keyboard.press("End")
    await expect(input).toBeFocused()
    await page.keyboard.type("S")
    await expect(custom).toBeChecked()
    await expect(focused).not.toBeChecked()

    await page.keyboard.press("ArrowUp")
    await expect(input).toBeFocused()
    await page.keyboard.press("ArrowUp")
    await expect(wide).toBeFocused()
    await expect(custom).toBeChecked()
  },
)

story.describe("on a 393x852 mobile viewport", () => {
  story.use({ hasTouch: true, isMobile: true, viewport: { width: 393, height: 852 } })

  story("keeps navigation visible and scrolls long prompts and 12 options", async ({ mount, page }) => {
    const component = await mount("session-question-switch--long-prompt")
    expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(true)
    await page.evaluate(() => document.fonts.ready.then(() => undefined))

    const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
    const dismiss = question.getByRole("button", { name: "Dismiss", exact: true })
    const next = question.getByRole("button", { name: "Next", exact: true })
    await expect(dismiss).toBeInViewport({ ratio: 1 })
    await expect(next).toBeInViewport({ ratio: 1 })

    const twelfth = question.getByRole("radio", { name: /12\. Clean slate rebuild/ })
    await twelfth.scrollIntoViewIfNeeded()
    await expect(twelfth).toBeInViewport({ ratio: 1 })
    await twelfth.tap()
    await expect(twelfth).toBeChecked()
    await expect(next).toBeInViewport({ ratio: 1 })

    await next.tap()

    const back = question.getByRole("button", { name: "Back", exact: true })
    const submit = question.getByRole("button", { name: "Submit", exact: true })
    await expect(back).toBeInViewport({ ratio: 1 })
    await expect(submit).toBeInViewport({ ratio: 1 })

    const layout = await question.evaluate((root) => {
      const details = root.querySelector<HTMLElement>('[data-slot="question-details"]')!
      const options = root.querySelector<HTMLElement>('[data-slot="question-options"]')!
      const footer = root.querySelector<HTMLElement>('[data-slot="question-footer"]')!
      const detailsRect = details.getBoundingClientRect()
      const optionsRect = options.getBoundingClientRect()
      const footerRect = footer.getBoundingClientRect()

      details.scrollTop = details.scrollHeight
      const scrolledPrompt = details.scrollTop > 0

      return {
        promptScrollHeight: details.scrollHeight,
        promptClientHeight: details.clientHeight,
        scrolledPrompt,
        optionsHeight: optionsRect.height,
        optionsBelowPrompt: optionsRect.top >= detailsRect.bottom - 0.5,
        footerBelowOptions: footerRect.top >= optionsRect.bottom - 9.5,
        dockFitsViewport: root.getBoundingClientRect().bottom <= innerHeight + 0.5,
      }
    })

    expect(layout.promptScrollHeight).toBeGreaterThan(852)
    expect(layout.promptClientHeight).toBeGreaterThan(48)
    expect(layout.promptScrollHeight).toBeGreaterThan(layout.promptClientHeight)
    expect(layout.scrolledPrompt).toBe(true)
    expect(layout.optionsHeight).toBeGreaterThan(80)
    expect(layout.optionsBelowPrompt).toBe(true)
    expect(layout.footerBelowOptions).toBe(true)
    expect(layout.dockFitsViewport).toBe(true)

    const lastOption = question.getByRole("radio", { name: /Export a diagnostic bundle/ })
    await lastOption.scrollIntoViewIfNeeded()
    await expect(lastOption).toBeInViewport({ ratio: 1 })
    await lastOption.tap()
    await expect(lastOption).toBeChecked()
    await expect(submit).toBeInViewport({ ratio: 1 })

    await submit.tap()
    await expect(question).toBeHidden()
  })
})

story(
  "minimizes and restores classic questions immediately for reduced motion and keyboard actions",
  async ({ mount, page }) => {
    const component = await mount("app-current-session-surface--question-request")
    const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
    await expect(question.getByRole("radio", { name: /Focused/ })).toBeFocused()
    await question.getByRole("button", { name: "Minimize question", exact: true }).press("Enter")
    expect(
      await question
        .locator('[data-slot="question-options"]')
        .evaluate((options) => options.getBoundingClientRect().height),
    ).toBe(0)
    await question.getByRole("button", { name: "Restore question", exact: true }).press("Enter")
    await expect(question.getByRole("radio", { name: /Focused/ })).toBeFocused()

    await page.emulateMedia({ reducedMotion: "reduce" })
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce")
    await question.getByRole("radio", { name: /Focused/ }).click()

    const heights = await question.evaluate((root) => {
      const options = root.querySelector<HTMLElement>('[data-slot="question-options"]')!
      const before = options.getBoundingClientRect().height
      root.querySelector<HTMLButtonElement>('button[aria-label="Minimize question"]')!.click()
      const minimized = options.getBoundingClientRect().height
      root.querySelector<HTMLButtonElement>('button[aria-label="Restore question"]')!.click()

      return { before, minimized, restored: options.getBoundingClientRect().height }
    })

    expect(heights.before).toBeGreaterThan(0)
    expect(heights.minimized).toBe(0)
    expect(heights.restored).toBe(heights.before)
  },
)

story.describe("New question UI", () => {
  const mountComposer = async (mount: (id: string) => Promise<Locator>) => {
    const component = await mount("session-question-switch--composer-answer")
    const dock = component.locator('[data-component="session-question-dock"][data-composer]')

    return {
      component,
      list: dock.getByRole("listbox"),
      field: dock.getByRole("textbox", { name: "Type your answer…", exact: true }),
      option: (name: string | RegExp) => dock.getByRole("option", { name }),
      dock,
    }
  }

  story("moves through the answers in the list and types in the field", async ({ mount, page }) => {
    const { component, dock, list, field, option } = await mountComposer(mount)

    const highlighted = async (name: string | RegExp) => {
      await expect(list).toBeFocused()
      await expect(list).toHaveAttribute("aria-activedescendant", (await option(name).getAttribute("id"))!)
    }

    await highlighted(/Focused/)
    await page.keyboard.press("ArrowUp")
    await highlighted(/Wide/)
    await page.keyboard.press("ArrowDown")
    await expect(field).toBeFocused()
    await expect(list).not.toHaveAttribute("aria-activedescendant")
    await page.keyboard.press("ArrowUp")
    await highlighted(/Wide/)
    await page.keyboard.press("Space")
    await expect(option(/Wide/)).toHaveAttribute("aria-selected", "true")

    await page.keyboard.press("Enter")
    await highlighted("Changed files")
    await page.keyboard.press("Space")

    const terminal = await option("Terminal").boundingBox()

    await page.mouse.move(terminal!.x + 40, terminal!.y + 10)
    await page.mouse.move(terminal!.x + 60, terminal!.y + 12)
    await highlighted("Terminal")
    await page.keyboard.press("Space")
    await expect(option("Changed files")).toHaveAttribute("aria-selected", "true")
    await expect(option("Terminal")).toHaveAttribute("aria-selected", "true")

    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await expect(field).toBeFocused()
    await page.keyboard.type("Notes")
    await expect(field).toHaveValue("Notes")

    await dock.getByRole("button", { name: "Questions 6", exact: true }).click()
    await expect(field).toBeFocused()
    await page.keyboard.type("Nothing to review yet")
    await page.keyboard.press("Enter")
    await expect(component.locator("output")).toHaveText(
      'Answered locally: {"layout":"wide","details":["files","terminal","Notes"],"empty":"Nothing to review yet"}',
    )
  })

  story("picks with numbers in the list and types numbers in the field", async ({ mount, page }) => {
    const { list, field, option } = await mountComposer(mount)

    await expect(list).toBeFocused()
    await page.keyboard.press("a")
    await expect(list).toBeFocused()
    await expect(field).toHaveValue("")
    await page.keyboard.press("2")
    await expect(option(/Wide/)).toHaveAttribute("aria-selected", "true")

    await page.keyboard.press("ArrowDown")
    await expect(field).toBeFocused()
    await page.keyboard.type("2 columns")
    await expect(field).toHaveValue("2 columns")
  })

  story("returns Up from the first line of a typed answer to the answers", async ({ mount, page }) => {
    const { list, field, option } = await mountComposer(mount)

    await field.click()
    await page.keyboard.type("First line")
    await page.keyboard.press("Shift+Enter")
    await page.keyboard.type("Second line")
    await page.keyboard.press("ArrowUp")
    await expect(field).toBeFocused()
    await page.keyboard.press("ArrowUp")
    await expect(list).toBeFocused()
    await expect(list).toHaveAttribute("aria-activedescendant", (await option(/Wide/).getAttribute("id"))!)
  })

  story("dismisses with Escape and gives focus back to the chat draft", async ({ mount, page }) => {
    const { component, list } = await mountComposer(mount)

    await expect(list).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(component.locator("output")).toHaveText("Dismissed the question locally")
    await expect(component.locator('[data-component="composer-editor"]')).toBeFocused()
  })
})
