import type { Locator } from "@playwright/test"
import type { MotionKnob } from "@opencode/ui/motion-tuning"
import { expect, sourceURL, story } from "../../stories/playwright/story"

story("resizes the dock to fit different answer counts", async ({ mount }) => {
  const component = await mount("app-current-session-surface--question-answer-counts")
  const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
  const next = question.getByRole("button", { name: "Next", exact: true })
  await expect(question.getByRole("radio", { name: /Focused/ })).toBeFocused()
  await expect(next).toBeEnabled()

  const height = () => question.evaluate((element) => element.getBoundingClientRect().height)
  const initial = await height()
  await next.click()
  await expect.poll(height).toBeGreaterThan(initial)
  await expect(question.getByRole("checkbox", { name: "Diagnostics", exact: true })).toBeVisible()

  const expanded = await height()
  const back = question.getByRole("button", { name: "Back", exact: true })
  await expect(back).toBeEnabled()
  await back.click()
  await expect.poll(height).toBeLessThan(expanded)
  await expect(question.getByRole("radio", { name: /Focused/ })).toBeVisible()
})

story("selects single answers and toggles multiple answers with number keys", async ({ mount }) => {
  const component = await mount("app-current-session-surface--question-request")
  const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
  const focused = question.getByRole("radio", { name: /Focused/ })
  const wide = question.getByRole("radio", { name: /Wide/ })
  const customRadio = question.getByRole("radio", { name: "Type your own answer…", exact: true })
  const input = question.getByRole("textbox", { name: "Type your own answer…", exact: true })
  const next = question.getByRole("button", { name: "Next", exact: true })
  await expect(focused).toBeFocused()

  await focused.press("2")
  await expect(wide).toBeChecked()
  await expect(focused).not.toBeChecked()
  await expect(wide).toBeFocused()
  await next.press("1")
  await expect(focused).toBeChecked()
  await expect(wide).not.toBeChecked()
  await focused.press("3")
  await expect(customRadio).toBeChecked()
  await expect(input).toBeFocused()
  await expect(focused).not.toBeChecked()
  await expect(wide).not.toBeChecked()
  await input.press("Escape")
  await expect(customRadio).toBeFocused()
  await customRadio.press("2")
  await expect(wide).toBeChecked()
  await expect(customRadio).not.toBeChecked()

  await next.click()
  const files = question.getByRole("checkbox", { name: "Changed files", exact: true })
  const terminal = question.getByRole("checkbox", { name: "Terminal", exact: true })
  const customCheckbox = question.getByRole("checkbox", { name: "Type your own answer…", exact: true })
  await expect(files).toBeFocused()
  await files.press("1")
  await expect(files).toBeChecked()
  await files.press("2")
  await expect(terminal).toBeChecked()
  await expect(files).toBeChecked()
  await terminal.press("2")
  await expect(terminal).not.toBeChecked()
  await expect(files).toBeChecked()

  await terminal.press("4")
  await expect(customCheckbox).toBeChecked()
  await expect(input).toBeFocused()
  await expect(files).toBeChecked()
  await expect(terminal).not.toBeChecked()
  await input.press("Escape")
  await expect(customCheckbox).toBeFocused()
  await customCheckbox.press("4")
  await expect(customCheckbox).not.toBeChecked()
  await expect(files).toBeChecked()
  await expect(terminal).not.toBeChecked()
})

story("moves only the highlight with Up and Down and marks it with Space", async ({ mount, page }) => {
  const component = await mount("app-current-session-surface--question-request")
  const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
  const focused = question.getByRole("radio", { name: /Focused/ })
  const wide = question.getByRole("radio", { name: /Wide/ })
  const custom = question.getByRole("radio", { name: "Type your own answer…", exact: true })
  const input = question.getByRole("textbox", { name: "Type your own answer…", exact: true })
  const highlight = question.locator('[data-slot="question-highlight"]')
  const clip = () => highlight.evaluate((element) => element.style.clipPath)
  await expect(focused).toBeFocused()
  await expect(focused).not.toBeChecked()
  const first = await clip()

  await page.keyboard.press("ArrowDown")
  await expect(wide).toBeFocused()
  await expect(wide).not.toBeChecked()
  await expect(focused).not.toBeChecked()
  await expect(wide).toHaveAttribute("tabindex", "0")
  await expect(focused).toHaveAttribute("tabindex", "-1")
  await expect.poll(clip).not.toBe(first)

  await page.keyboard.press("ArrowDown")
  await expect(custom).toBeFocused()
  await expect(custom).not.toBeChecked()
  await expect(input).not.toBeFocused()

  await page.keyboard.press("ArrowUp")
  await expect(wide).toBeFocused()
  await page.keyboard.press(" ")
  await expect(wide).toBeChecked()
  await expect(wide).toBeFocused()
  await expect(question.getByRole("button", { name: "Next", exact: true })).toBeVisible()

  await page.keyboard.press("Home")
  await expect(focused).toBeFocused()
  await expect(focused).not.toBeChecked()
  await expect(wide).toBeChecked()
})

story("shows the highlight only for hover or the arrow keys, never for a click", async ({ mount, page }) => {
  const component = await mount("app-current-session-surface--question-request")
  const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
  const focused = question.getByRole("radio", { name: /Focused/ })
  const wide = question.getByRole("radio", { name: /Wide/ })
  const highlight = question.locator('[data-slot="question-highlight"]')
  const clip = () => highlight.evaluate((element) => element.style.clipPath)
  await expect(focused).toBeFocused()
  await expect(highlight).toBeHidden()

  await wide.dispatchEvent("click")
  await expect(wide).toBeChecked()
  await expect(highlight).toBeHidden()

  await page.keyboard.press("1")
  await expect(highlight).toBeHidden()

  await wide.hover()
  await expect(highlight).toBeVisible()
  await page.keyboard.press(" ")
  await page.mouse.move(0, 0)
  await expect(highlight).toBeHidden()

  await wide.hover()
  await expect(highlight).toBeVisible()
  const hovered = await clip()
  await expect.poll(() => highlight.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0s")

  await wide.click()
  await expect(wide).toBeChecked()
  await expect(highlight).toBeVisible()
  expect(await clip()).toBe(hovered)

  await page.mouse.move(0, 0)
  await expect(highlight).toBeHidden()

  await focused.click()
  await page.mouse.move(0, 0)
  await expect(focused).toBeChecked()
  await expect(highlight).toBeHidden()

  await page.keyboard.press("ArrowDown")
  await expect(highlight).toBeVisible()
  await page.mouse.move(0, 0)
  await expect(highlight).toBeVisible()

  await focused.hover()
  await page.mouse.move(0, 0)
  await expect(highlight).toBeHidden()
})

story("Enter picks the highlighted answer and moves on", async ({ mount, page }) => {
  const component = await mount("app-current-session-surface--question-request")
  const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
  const focused = question.getByRole("radio", { name: /Focused/ })
  const wide = question.getByRole("radio", { name: /Wide/ })
  const files = question.getByRole("checkbox", { name: "Changed files", exact: true })
  const terminal = question.getByRole("checkbox", { name: "Terminal", exact: true })
  await expect(focused).toBeFocused()

  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")
  await expect(files).toBeFocused()
  await expect(files).not.toBeChecked()
  await expect(question.getByRole("button", { name: "Submit", exact: true })).toBeVisible()

  await page.keyboard.press("ArrowLeft")
  await expect(wide).toBeFocused()
  await expect(wide).toBeChecked()
  await expect(focused).not.toBeChecked()
  await page.keyboard.press("ArrowRight")

  await page.keyboard.press("ArrowDown")
  await page.keyboard.press(" ")
  await expect(terminal).toBeChecked()
  await expect(files).not.toBeChecked()
  await page.keyboard.press("Enter")
  await expect(question).toBeHidden()
})

story("typing on the highlighted custom answer starts it", async ({ mount, page }) => {
  const component = await mount("app-current-session-surface--question-request")
  const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
  const focused = question.getByRole("radio", { name: /Focused/ })
  const custom = question.getByRole("radio", { name: "Type your own answer…", exact: true })
  const input = question.getByRole("textbox", { name: "Type your own answer…", exact: true })
  await expect(focused).toBeFocused()
  await focused.press("1")
  await expect(focused).toBeChecked()

  await page.keyboard.press("End")
  await expect(custom).toBeFocused()
  await expect(custom).not.toBeChecked()
  await page.keyboard.press("S")
  await expect(input).toBeFocused()
  await expect(custom).toBeChecked()
  await expect(focused).not.toBeChecked()
  await page.keyboard.type("plit")
  await expect(input).toHaveValue("Split")

  await page.keyboard.press("Enter")
  await expect(question.getByRole("checkbox", { name: "Changed files", exact: true })).toBeFocused()
  await page.keyboard.press("ArrowLeft")
  await expect(custom).toBeChecked()
  await expect(input).toHaveValue("Split")
})

story("switches questions with Left and Right outside the text field", async ({ mount, page }) => {
  const component = await mount("app-current-session-surface--question-request")
  const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
  const focused = question.getByRole("radio", { name: /Focused/ })
  const files = question.getByRole("checkbox", { name: "Changed files", exact: true })
  const submit = question.getByRole("button", { name: "Submit", exact: true })
  const wide = question.getByRole("radio", { name: /Wide/ })
  await expect(focused).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press(" ")
  await expect(wide).toBeChecked()

  await page.keyboard.press("ArrowRight")
  await expect(files).toBeFocused()
  await expect(submit).toBeVisible()
  await page.keyboard.press("ArrowRight")
  await expect(submit).toBeVisible()
  await expect(files).toBeFocused()

  await page.keyboard.press("ArrowLeft")
  await expect(wide).toBeFocused()
  await expect(wide).toBeChecked()

  const input = question.getByRole("textbox", { name: "Type your own answer…", exact: true })
  await input.focus()
  await input.fill("ab")
  await page.keyboard.press("ArrowLeft")
  await expect(input).toBeFocused()
  await expect(focused).toBeVisible()
})

// Presses each key after waiting its number of frames, and samples every frame until the switch is at rest: how visible
// the copies of the question text and of the answers are together, how many outgoing copies there are, how the live
// question text is moved, scaled and blurred, how far the count's last digit is rolled (in digit heights, down
// positive), where the progress row's bar is, and the footer: how visible Back is and whether a click at its middle
// reaches it, how visible the Next and Submit faces are, how visible the fainter of their two words is, and how wide
// the button they share shows. It also keeps the header's text and, for the count's last digit, each digit drawn and
// how visible it is.
const play = (question: Locator, keys: { key: string; after?: number }[]) =>
  question.evaluate(async (root, keys) => {
    const opacity = (el: Element) => {
      let value = 1

      for (let node: Element | null = el; node && node !== root; node = node.parentElement)
        value *= Number(getComputedStyle(node).opacity)

      return value
    }

    const shown = (slot: string) =>
      [...root.querySelectorAll(`[data-slot="${slot}"]`)].reduce((sum, el) => sum + opacity(el), 0)

    const live = () => root.querySelector('[data-slot="question-details"]:not([data-ghost])')

    const mask = () =>
      ["question-details-frame", "question-options"].some((slot) =>
        (root.querySelector<HTMLElement>(`[data-slot="${slot}"]`)?.style.maskImage ?? "").includes("to right"),
      )

    const glyphs = () =>
      [
        ...root.querySelectorAll<HTMLElement>(
          '[data-component="rolling-number"] [data-slot="rolling-number-digit"]:last-child [data-slot="rolling-number-glyph"]',
        ),
      ].flatMap((el) => {
        const text = el.dataset.leaving ?? el.textContent ?? ""

        return text === "" ? [] : [{ text, shown: opacity(el) }]
      })

    const roll = () => {
      const glyph = root.querySelector(
        '[data-component="rolling-number"] [data-slot="rolling-number-digit"]:last-child [data-slot="rolling-number-glyph"]:not([data-leaving])',
      )

      if (!(glyph instanceof HTMLElement)) return 0

      return (
        new DOMMatrix(getComputedStyle(glyph).transform === "none" ? undefined : getComputedStyle(glyph).transform)
          .m42 / glyph.getBoundingClientRect().height
      )
    }

    const bar = () => {
      const current = root.querySelector('[data-slot="question-progress-current"]')

      return current ? current.getBoundingClientRect().left : 0
    }

    const back = root.querySelector<HTMLElement>('[data-slot="question-footer-back"]')!
    const faces = [...root.querySelectorAll<HTMLElement>('[data-slot="question-advance-face"]')]

    const hit = () => {
      const box = back.getBoundingClientRect()

      return back.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2))
    }

    // The faces are cut back from their start edge with `inset(top right bottom left)`.
    const width = () =>
      Math.max(
        ...faces.map((face) => {
          if (opacity(face) < 0.01 || getComputedStyle(face).visibility === "hidden") return 0
          const inset = /inset\(([^)]*)\)/.exec(face.style.clipPath)?.[1]?.split(/\s+/).map(parseFloat) ?? []

          return face.getBoundingClientRect().width - (inset[1] ?? 0) - (inset[3] ?? 0)
        }),
      )

    // `click:N` clicks the Nth progress dash, `next` clicks the Next or Submit button in use, and `mod+Enter` presses the
    // submit shortcut.
    const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform)

    const press = (key: string) => {
      if (key === "next")
        return root
          .querySelector<HTMLElement>('[data-slot="question-advance-face"][data-active="true"] button')
          ?.click()

      if (key === "mod+Enter")
        return (document.activeElement ?? root).dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true }),
        )

      const dash = /^click:(\d+)$/.exec(key)?.[1]

      if (dash)
        return root.querySelectorAll<HTMLElement>('[data-slot="question-progress-segment"]')[Number(dash)]?.click()

      return (document.activeElement ?? root).dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      )
    }

    const frames: {
      text: number
      answers: number
      ghosts: number
      x: number
      scale: number
      blur: boolean
      mask: boolean
      digit: number
      bar: number
      back: number
      hit: boolean
      next: number
      submit: number
      width: number
      words: number
      highlights: number
      footer: boolean
      animations: number
      title: string
      glyphs: { text: string; shown: number }[]
    }[] = []

    const queue = [...keys]
    let wait = 0
    let still = 0

    await new Promise<void>((resolve) => {
      const tick = () => {
        while (queue.length > 0 && wait <= 0) {
          const next = queue.shift()!
          press(next.key)
          wait = queue[0]?.after ?? 0
        }

        wait--
        const el = live()
        const style = el ? getComputedStyle(el) : undefined
        const matrix = new DOMMatrix(style?.transform === "none" ? undefined : style?.transform)

        const frame = {
          text: shown("question-details"),
          answers: shown("question-options-list"),
          ghosts: root.querySelectorAll("[data-ghost]").length,
          x: matrix.m41,
          scale: matrix.m11,
          blur: (style?.filter ?? "none") !== "none",
          mask: mask(),
          digit: roll(),
          bar: bar(),
          back: getComputedStyle(back).visibility === "hidden" ? 0 : opacity(back),
          hit: hit(),
          next: getComputedStyle(faces[0]!).visibility === "hidden" ? 0 : opacity(faces[0]!),
          submit: getComputedStyle(faces[1]!).visibility === "hidden" ? 0 : opacity(faces[1]!),
          width: width(),
          words: Math.min(
            ...faces.map((face) =>
              getComputedStyle(face).visibility === "hidden"
                ? 0
                : opacity(face.querySelector('[data-slot="question-advance-label"]')!),
            ),
          ),
          highlights: root.querySelectorAll('[data-slot="question-highlight"]').length,
          footer: !!back.getAttribute("style") || faces.some((face) => !!face.getAttribute("style")),
          animations: document.getAnimations().length,
          title: root.querySelector('[data-slot="question-header-title"]')?.textContent ?? "",
          glyphs: glyphs(),
        }

        frames.push(frame)

        const resting =
          queue.length === 0 &&
          frame.ghosts === 0 &&
          style?.transform === "none" &&
          !frame.blur &&
          !frame.mask &&
          frame.digit === 0 &&
          !frame.footer &&
          frame.bar === frames.at(-2)?.bar

        still = resting ? still + 1 : 0

        if (still >= 3 || frames.length >= 240) return resolve()
        requestAnimationFrame(tick)
      }

      requestAnimationFrame(tick)
    })

    return frames
  }, keys)

// The dock's motion is off unless its knob is on, so these turn it on before the dock loads.
story.describe("with the question dock's motion on", () => {
  story.beforeEach(({ page }) =>
    page.addInitScript(() => localStorage.setItem("opencode.motion.v2", JSON.stringify({ "question.motion": 1 }))),
  )

  story("keeps a question on screen while switching", async ({ mount }) => {
    const component = await mount("app-current-session-surface--question-request")
    const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
    await expect(question.getByRole("radio", { name: /Focused/ })).toBeFocused()

    const forward = await play(question, [{ key: "ArrowRight" }])
    await expect(question.getByRole("checkbox", { name: "Changed files", exact: true })).toBeVisible()
    const backward = await play(question, [{ key: "ArrowLeft" }])
    await expect(question.getByRole("radio", { name: /Focused/ })).toBeVisible()
    await expect(question.locator("[data-ghost]")).toHaveCount(0)

    for (const frames of [forward, backward]) {
      expect(frames.length).toBeLessThan(240)
      expect(Math.min(...frames.map((frame) => frame.text))).toBeGreaterThanOrEqual(0.9)
      expect(Math.min(...frames.map((frame) => frame.answers))).toBeGreaterThanOrEqual(0.9)
      expect(frames.at(-1)).toMatchObject({ x: 0, scale: 1, blur: false })
    }

    expect(Math.min(...forward.map((frame) => frame.scale))).toBeLessThan(1)
    expect(forward.some((frame) => frame.blur)).toBe(true)
  })

  story("switches questions without a second answer highlight", async ({ mount, page }) => {
    const component = await mount("session-question-switch--question-series")
    const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
    const highlight = question.locator('[data-slot="question-highlight"]')
    await expect(question.getByRole("radio").first()).toBeFocused()
    await page.keyboard.press("ArrowDown")
    await expect(highlight).toBeVisible()

    // The leaving copy of the answers carries no highlight, so only the new question's answer is ever highlighted.
    const frames = await play(question, [{ key: "ArrowRight" }])
    expect(frames.some((frame) => frame.ghosts > 0)).toBe(true)
    expect(frames.every((frame) => frame.highlights === 1)).toBe(true)
  })

  story("keeps one outgoing copy and a visible question through rapid switches", async ({ mount }) => {
    const component = await mount("session-question-switch--question-series")
    const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
    const options = question.locator('[data-slot="question-options"]')
    await expect(question.getByRole("radio").first()).toBeFocused()
    // From the middle question, so every run can go two either way and comes back.
    await play(question, [{ key: "ArrowRight" }, { key: "ArrowRight", after: 30 }])

    const runs = [
      ["ArrowRight", "ArrowLeft"],
      ["ArrowLeft", "ArrowRight"],
      ["ArrowRight", "ArrowRight", "ArrowLeft", "ArrowLeft"],
      ["ArrowLeft", "ArrowLeft", "ArrowRight", "ArrowRight"],
    ]

    for (const run of runs)
      for (const after of [0, 1, 2, 4]) {
        const frames = await play(
          question,
          run.map((key) => ({ key, after })),
        )

        const label = `${run.join(" ")} every ${after} frames`
        expect(frames.length, label).toBeLessThan(240)
        expect(Math.min(...frames.map((frame) => frame.text)), label).toBeGreaterThanOrEqual(0.5)
        expect(Math.min(...frames.map((frame) => frame.answers)), label).toBeGreaterThanOrEqual(0.5)
        expect(Math.max(...frames.map((frame) => frame.ghosts)), label).toBeLessThanOrEqual(2)
        await expect(question.locator("[data-ghost]")).toHaveCount(0)
        expect(await options.evaluate((el) => el.scrollLeft), label).toBe(0)
      }
  })

  story("rolls the question count up going on and down going back", async ({ mount }) => {
    const component = await mount("session-question-switch--question-series")
    const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
    const title = question.locator('[data-slot="question-header-title"]')
    await expect(question.getByRole("radio").first()).toBeFocused()
    await expect(title).toHaveText("1 of 5 questions")

    // The new digit comes up from below going on, and down from above going back.
    const forward = await play(question, [{ key: "ArrowRight" }])
    await expect(title).toHaveText("2 of 5 questions")
    const backward = await play(question, [{ key: "ArrowLeft" }])
    await expect(title).toHaveText("1 of 5 questions")

    expect(Math.max(...forward.map((frame) => frame.digit))).toBeGreaterThan(0.2)
    expect(Math.min(...forward.map((frame) => frame.digit))).toBeGreaterThanOrEqual(0)
    expect(Math.min(...backward.map((frame) => frame.digit))).toBeLessThan(-0.2)
    expect(Math.max(...backward.map((frame) => frame.digit))).toBeLessThanOrEqual(0)

    for (const frames of [forward, backward]) expect(frames.at(-1)?.digit).toBe(0)
    await expect(question.locator('[data-slot="rolling-number-glyph"][data-leaving]')).toHaveAttribute(
      "data-leaving",
      "",
    )
  })

  story("takes Next clicks and the submit shortcut while the footer is still moving", async ({ mount }) => {
    const component = await mount("session-question-switch--question-series")
    const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
    const title = question.locator('[data-slot="question-header-title"]')
    await expect(question.getByRole("radio").first()).toBeFocused()

    // Two Next clicks and two submit shortcuts, two frames apart, each landing while Back is still fading in.
    const frames = await play(question, [
      { key: "next" },
      { key: "next", after: 2 },
      { key: "mod+Enter", after: 2 },
      { key: "mod+Enter", after: 2 },
    ])

    expect([2, 4, 6].every((index) => frames[index - 1]?.footer)).toBe(true)
    await expect(question.getByRole("button", { name: "Submit", exact: true })).toBeVisible()
    await expect(title).toHaveText("5 of 5 questions")
  })

  story("rolls the count on from where it is when it changes again mid-roll", async ({ mount }) => {
    const component = await mount("session-question-switch--question-series")
    const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
    const title = question.locator('[data-slot="question-header-title"]')
    await expect(question.getByRole("radio").first()).toBeFocused()

    // 1 → 2 → 3 and 1 → 2 → 1, the second change a few frames into the first roll.
    for (const [second, end] of [
      ["ArrowRight", "3"],
      ["ArrowLeft", "1"],
    ] as const)
      for (const after of [1, 2, 4]) {
        const frames = await play(question, [{ key: "ArrowRight" }, { key: second, after }])
        const label = `1 → 2 → ${end} after ${after} frames`

        const shown = (frame: (typeof frames)[number], text: string) =>
          frame.glyphs.filter((glyph) => glyph.text === text).reduce((sum, glyph) => sum + glyph.shown, 0)

        // The digits drawn always add up to at least one whole digit, and the header's text never doubles a digit.
        expect(
          Math.min(...frames.map((frame) => frame.glyphs.reduce((sum, glyph) => sum + glyph.shown, 0))),
          label,
        ).toBeGreaterThanOrEqual(0.95)
        expect(
          frames.every((frame) => /^\d of 5 questions$/.test(frame.title.replace(/\s+/g, " ").trim())),
          label,
        ).toBe(true)

        // A 2 that had barely appeared goes back out and never crosses the middle. The frame sampled right after the
        // second key shows the digits where the change found them; going back always sends the 2 out.
        const at = shown(frames[after]!, "2")

        if (second === "ArrowLeft" || at < 0.45)
          expect(Math.max(...frames.slice(after).map((frame) => shown(frame, "2"))), label).toBeLessThanOrEqual(
            at + 0.02,
          )
        expect(frames.at(-1)?.glyphs, label).toEqual([{ text: end, shown: 1 }])
        await expect(title).toHaveText(`${end} of 5 questions`)
        await play(question, [{ key: "click:0" }])
      }
  })

  // Where the bar sits against each dash, from the inline start of the progress row.
  const dashes = (question: Locator) =>
    question.evaluate((root) => ({
      dashes: [...root.querySelectorAll('[data-slot="question-progress-bar"]')].map(
        (el) => el.getBoundingClientRect().left,
      ),
      bar: root.querySelector('[data-slot="question-progress-current"]')!.getBoundingClientRect().left,
    }))

  for (const dir of ["ltr", "rtl"] as const)
    story(`slides the progress bar straight to a clicked dash (${dir})`, async ({ mount, page }) => {
      const component = await mount("session-question-switch--question-series")
      const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
      await expect(question.getByRole("radio").first()).toBeFocused()
      await page.evaluate((dir) => document.documentElement.setAttribute("dir", dir), dir)

      const start = await dashes(question)
      expect(start.bar).toBeCloseTo(start.dashes[0]!, 0)

      // Jumping from the first question to the fourth slides the one bar across the dashes in between, one way only.
      const frames = await play(question, [{ key: "click:3" }])
      const end = await dashes(question)
      const bars = frames.map((frame) => frame.bar)
      const way = Math.sign(end.dashes[3]! - end.dashes[0]!)
      expect(end.bar).toBeCloseTo(end.dashes[3]!, 0)
      expect(bars.at(-1)).toBeCloseTo(end.dashes[3]!, 0)
      expect(bars.some((x) => way * (x - end.dashes[0]!) > 1 && way * (x - end.dashes[3]!) < -1)).toBe(true)
      expect(bars.slice(1).every((x, i) => way * (x - bars[i]!) >= -0.01)).toBe(true)
      await expect(question.locator('[data-slot="question-header-title"]')).toHaveText("4 of 5 questions")

      // In RTL the dashes run from the right, so the bar moves left.
      expect(way).toBe(dir === "rtl" ? -1 : 1)
    })

  story("swaps questions, the count and the progress bar at once under reduced motion", async ({ mount, page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    const component = await mount("session-question-switch--question-series")
    const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
    await expect(question.getByRole("radio").first()).toBeFocused()

    const frames = await play(question, [{ key: "ArrowRight" }])
    expect(frames.every((frame) => frame.ghosts === 0 && frame.x === 0 && frame.scale === 1 && !frame.blur)).toBe(true)
    expect(Math.min(...frames.map((frame) => frame.text))).toBe(1)
    expect(frames.every((frame) => frame.digit === 0)).toBe(true)
    expect(new Set(frames.map((frame) => Math.round(frame.bar))).size).toBe(1)
    expect(frames.every((frame) => frame.back === 1 && !frame.footer)).toBe(true)
    await expect(question.locator('[data-slot="question-header-title"]')).toHaveText("2 of 5 questions")

    const last = await play(question, [{ key: "click:4" }])
    expect(last.every((frame) => frame.next === 0 && frame.submit === 1 && !frame.footer)).toBe(true)
  })

  // Rises, or falls, all the way from one end to the other through values in between, never turning back.
  const glides = (values: number[], from: number, to: number) => {
    const way = Math.sign(to - from)
    expect(values.at(0)! * way).toBeLessThan(to * way)
    expect(values.at(-1)).toBeCloseTo(to, 2)
    expect(
      values.some(
        (value) => way * (value - from) > 0.02 * way * (to - from) && way * (to - value) > 0.02 * way * (to - from),
      ),
    ).toBe(true)
    expect(values.slice(1).every((value, i) => way * (value - values[i]!) >= -0.01)).toBe(true)
  }

  story("fades Back in and out and turns Next into Submit with the switch", async ({ mount }) => {
    const component = await mount("session-question-switch--question-series")
    const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
    const back = question.locator('[data-slot="question-footer-back"]')
    await expect(question.getByRole("radio").first()).toBeFocused()
    await expect(question.getByRole("button", { name: "Back", exact: true })).toHaveCount(0)

    // Going on from the first question, Back comes in and can be clicked at once, while Next stays where it is.
    const nextBox = await question.getByRole("button", { name: "Next", exact: true }).boundingBox()
    const arrive = await play(question, [{ key: "ArrowRight" }])
    glides(
      arrive.map((frame) => frame.back),
      0,
      1,
    )
    expect(arrive.every((frame) => frame.hit && frame.next === 1 && frame.submit === 0)).toBe(true)
    expect(await question.getByRole("button", { name: "Next", exact: true }).boundingBox()).toMatchObject({
      x: nextBox!.x,
      width: nextBox!.width,
    })

    // On to the last question, Next fades into Submit while the button's edge sweeps to Submit's width.
    await play(question, [{ key: "click:3" }])

    const widths = await question.evaluate((root) =>
      [...root.querySelectorAll<HTMLElement>('[data-slot="question-advance-face"]')].map(
        (face) => face.getBoundingClientRect().width,
      ),
    )

    const submit = await play(question, [{ key: "ArrowRight" }])
    glides(
      submit.map((frame) => frame.next),
      1,
      0,
    )
    glides(
      submit.map((frame) => frame.submit),
      0,
      1,
    )
    glides(
      submit.map((frame) => frame.width),
      widths[0]!,
      widths[1]!,
    )
    expect(submit.some((frame) => frame.next > 0.1 && frame.submit > 0.1)).toBe(true)
    // The buttons overlap, but the words "Next" and "Submit" are never both legible at once.
    expect(Math.max(...submit.map((frame) => frame.words))).toBeLessThan(0.25)
    expect(submit.every((frame) => frame.back === 1)).toBe(true)

    // Back to the first question, Back goes, and cannot be clicked from the moment it starts to.
    const leave = await play(question, [{ key: "click:0" }])
    glides(
      leave.map((frame) => frame.back),
      1,
      0,
    )
    expect(leave.some((frame) => frame.hit)).toBe(false)
    expect(leave.at(-1)).toMatchObject({ next: 1, submit: 0, footer: false })
    await expect(back).toHaveAttribute("inert", "")
  })

  story("stops a switch where it is when the knob turns off", async ({ mount }) => {
    const component = await mount("session-question-switch--question-series")
    const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
    await expect(question.getByRole("radio").first()).toBeFocused()

    const frames = await question.evaluate(
      async (root, tuning) => {
        const { motionTuning } = await import(tuning)
        const knob = motionTuning.list().find((item: MotionKnob) => item.id === "question.motion")
        const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))

        const sample = () => ({
          animations: document.getAnimations().length,
          heights: [...root.querySelectorAll<HTMLElement>("*")].filter((el) => el.style.height).length,
          ghosts: root.querySelectorAll("[data-ghost]").length,
        })

        document.activeElement!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
        )
        await frame()
        await frame()
        const moving = sample()
        motionTuning.set(knob, false)
        await frame()
        await frame()

        return { moving, after: sample() }
      },
      sourceURL(new URL("../../ui/src/motion-tuning.ts", import.meta.url)),
    )

    expect(frames.moving.heights + frames.moving.ghosts).toBeGreaterThan(0)
    expect(frames.after).toEqual({ animations: 0, heights: 0, ghosts: 0 })
  })
})

story("switches questions, folds and submits on the same frame with the dock's motion off", async ({ mount, page }) => {
  const component = await mount("session-question-switch--question-series")
  const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
  const title = question.locator('[data-slot="question-header-title"]')
  await expect(question.getByRole("radio").first()).toBeFocused()
  await expect(question.locator('[data-component="rolling-number"]')).toHaveCount(0)
  await expect(question.locator('[data-slot="question-progress-track"]')).toHaveCount(0)

  // From the frame of the key on, the next question is at rest: no outgoing copy, nothing moved, faded or blurred,
  // and no animation or transition running anywhere on the page.
  for (const [key, count] of [
    ["ArrowRight", "2 of 5 questions"],
    ["click:3", "4 of 5 questions"],
    ["ArrowRight", "5 of 5 questions"],
  ] as const) {
    const frames = await play(question, [{ key }])
    expect(frames.length, key).toBeLessThanOrEqual(4)
    expect(
      frames.every(
        (frame) =>
          frame.ghosts === 0 &&
          frame.x === 0 &&
          frame.scale === 1 &&
          !frame.blur &&
          !frame.mask &&
          frame.text === 1 &&
          frame.answers === 1 &&
          frame.back === 1 &&
          !frame.footer &&
          frame.animations === 0,
      ),
      key,
    ).toBe(true)
    await expect(title).toHaveText(count)
  }

  // Minimizing and restoring fold the answers away and back at once.
  const fold = (label: string) =>
    question.evaluate(async (root, label) => {
      const options = root.querySelector<HTMLElement>('[data-slot="question-options"]')!
      const list = root.querySelector<HTMLElement>('[data-slot="question-options-list"]')!

      const sample = () => ({
        height: Math.round(options.getBoundingClientRect().height),
        list: Math.round(list.getBoundingClientRect().height),
        hidden: getComputedStyle(options).visibility === "hidden",
        animations: document.getAnimations().length,
      })

      root.querySelector<HTMLElement>(`button[aria-label="${label}"]`)!.click()
      const frames = [sample()]

      for (let i = 0; i < 3; i++) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
        frames.push(sample())
      }

      return frames
    }, label)

  // The last question's answers may be cut to the dock's height, so they come back to the height they rest at.
  const resting = await question
    .locator('[data-slot="question-options"]')
    .evaluate((el) => Math.round(el.getBoundingClientRect().height))

  const folded = await fold("Minimize question")
  expect(folded.every((frame) => frame.height === 0 && frame.hidden && frame.animations === 0)).toBe(true)
  const restored = await fold("Restore question")
  expect(
    restored.every((frame) => frame.height > 0 && frame.height === resting && !frame.hidden && frame.animations === 0),
  ).toBe(true)

  // Submitting swaps the dock for the composer on one frame, with no closing flight.
  const submitted = await page.evaluate(async () => {
    const dock = () => document.querySelector('[data-component="dock-prompt"][data-kind="question"]')
    const moving = () => !!document.querySelector("[data-moving]")
    document.querySelector<HTMLElement>('[data-slot="question-advance-face"][data-active="true"] button')!.click()

    for (let i = 0; i < 120 && dock() && !moving(); i++) await new Promise((resolve) => requestAnimationFrame(resolve))
    const frames = []

    for (let i = 0; i < 3; i++) {
      frames.push({ dock: !!dock(), moving: moving(), animations: document.getAnimations().length })
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }

    return frames
  })

  expect(submitted).toEqual(Array(3).fill({ dock: false, moving: false, animations: 0 }))
})

story("toggles checkboxes with Space on key down and moves focus with arrows", async ({ mount, page }) => {
  const component = await mount("app-current-session-surface--question-request")
  const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
  await question.getByRole("button", { name: "Next", exact: true }).click()
  const files = question.getByRole("checkbox", { name: "Changed files", exact: true })
  const terminal = question.getByRole("checkbox", { name: "Terminal", exact: true })
  await expect(files).toBeFocused()

  await page.keyboard.down(" ")
  await expect(files).toBeChecked()
  await page.keyboard.down(" ")
  await page.keyboard.up(" ")
  await expect(files).toBeChecked()

  await page.keyboard.press("ArrowDown")
  await expect(terminal).toBeFocused()
  await expect(terminal).not.toBeChecked()
  await page.keyboard.press(" ")
  await expect(terminal).toBeChecked()
  await page.keyboard.press(" ")
  await expect(terminal).not.toBeChecked()
  await expect(files).toBeChecked()
})

story("ignores modified, out-of-range, and repeated number shortcuts", async ({ mount, page }) => {
  const component = await mount("app-current-session-surface--question-request")
  const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
  const focused = question.getByRole("radio", { name: /Focused/ })
  const wide = question.getByRole("radio", { name: /Wide/ })
  await expect(focused).toBeFocused()
  await focused.press("1")
  await focused.press("9")
  await focused.press("Alt+2")
  await expect(focused).toBeChecked()
  await expect(wide).not.toBeChecked()

  await question.getByRole("button", { name: "Next", exact: true }).click()
  const terminal = question.getByRole("checkbox", { name: "Terminal", exact: true })
  await expect(question.getByRole("checkbox", { name: "Changed files", exact: true })).toBeFocused()
  await page.keyboard.down("2")
  await expect(terminal).toBeChecked()
  await page.keyboard.down("2")
  await expect(terminal).toBeChecked()
  await page.keyboard.up("2")
})

story("types digits into the custom answer without selecting numbered options", async ({ mount }) => {
  const component = await mount("app-current-session-surface--question-request")
  const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
  const focused = question.getByRole("radio", { name: /Focused/ })
  const custom = question.getByRole("radio", { name: "Type your own answer…", exact: true })
  const input = question.getByRole("textbox", { name: "Type your own answer…", exact: true })
  await expect(focused).toBeFocused()
  await focused.press("3")
  await expect(input).toBeFocused()
  await input.press("1")
  await input.press("2")
  await input.press("3")
  await expect(input).toHaveValue("123")
  await expect(custom).toBeChecked()
  await expect(focused).not.toBeChecked()
  await expect(question.getByRole("radio", { name: /Wide/ })).not.toBeChecked()
})

story("leaves Enter and Escape to an IME composition in the custom answer", async ({ mount }) => {
  const component = await mount("app-current-session-surface--question-request")
  const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
  const toggle = question.getByRole("radio", { name: "Type your own answer…", exact: true })
  const input = question.getByRole("textbox", { name: "Type your own answer…", exact: true })
  await input.focus()
  await input.fill("にほん")

  const compose = (key: string, keyCode: number) =>
    input.evaluate(
      (element, init) =>
        element.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true })),
      { key, keyCode, isComposing: keyCode !== 229 },
    )

  await compose("Enter", 13)
  await compose("Escape", 27)
  await compose("Enter", 229)
  await compose("Escape", 229)
  await expect(input).toBeFocused()
  await expect(input).toHaveValue("にほん")
  await expect(question).toBeVisible()
  await input.press("Escape")
  await expect(toggle).toBeFocused()
  await expect(question).toBeVisible()
})

story("shows question navigation shortcuts in buttons and tooltips", async ({ mount, page }) => {
  const component = await mount("app-current-session-surface--question-request")
  const mac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform))
  const shortcut = mac ? "⌘⏎" : "Ctrl+⏎"
  const next = component.getByRole("button", { name: "Next", exact: true })
  await expect(next.locator('[data-slot="question-submit-shortcut"]')).toBeVisible()
  await expect(next.locator('[data-slot="question-submit-shortcut"]')).toHaveText(shortcut)
  await expect(next).toHaveAttribute("aria-keyshortcuts", "Meta+Enter Control+Enter")
  await next.hover()
  await expect(page.getByRole("tooltip")).toContainText("Next")
  await expect(page.getByRole("tooltip")).toContainText(shortcut)
  await next.press(mac ? "Meta+Enter" : "Control+Enter")
  const submit = component.getByRole("button", { name: "Submit", exact: true })
  await expect(submit.locator('[data-slot="question-submit-shortcut"]')).toBeVisible()
  await expect(submit.locator('[data-slot="question-submit-shortcut"]')).toHaveText(shortcut)
  await expect(submit).toHaveAttribute("aria-keyshortcuts", "Meta+Enter Control+Enter")
  // Pressing the button closes its tooltip until the pointer comes back to it.
  await page.mouse.move(0, 0)
  await submit.hover()
  await expect(page.getByRole("tooltip")).toContainText("Submit")
  await expect(page.getByRole("tooltip")).toContainText(shortcut)
  const back = component.getByRole("button", { name: "Back", exact: true })
  await expect(back).toHaveText("Back")
  await expect(back).toHaveAttribute("aria-keyshortcuts", mac ? "Meta+[" : "Alt+ArrowLeft")
  await back.hover()
  // Moving straight from Submit opens Back's tooltip while Submit's is still fading out.
  await expect(page.getByRole("tooltip", { name: /Back/ })).toContainText(mac ? "⌘[" : "Alt+←")
  await back.press(mac ? "Meta+[" : "Alt+ArrowLeft")
  await expect(next).toBeVisible()
})

story("keeps the custom answer input and dock geometry stable while editing", async ({ mount }) => {
  const component = await mount("app-current-session-surface--question-request")
  const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
  const row = question.locator('[data-slot="question-option"][data-custom="true"]')
  const input = question.getByRole("textbox", { name: "Type your own answer…", exact: true })
  const toggle = question.getByRole("radio", { name: "Type your own answer…", exact: true })
  await expect(question.getByRole("radio", { name: /Focused/ })).toBeFocused()
  await expect(input).toBeEditable()
  await expect(input).toHaveValue("")
  const node = await input.evaluateHandle((element) => element)
  const height = () => question.evaluate((element) => element.getBoundingClientRect().height)
  const initial = await height()
  const draft = "A custom answer long enough to wrap if the editor becomes multiline instead of staying single-line"

  const predefined = question.getByRole("radio", { name: /Focused/ })
  await predefined.click()
  await input.focus()
  await expect(input).toBeFocused()
  await expect(predefined).toBeChecked()
  await expect(toggle).not.toBeChecked()
  await row.click({ position: { x: 4, y: 4 } })
  await expect(toggle).toBeChecked()
  await expect(input).toBeFocused()
  await expect(input).toHaveValue("")
  await expect(predefined).not.toBeChecked()
  await input.fill(draft)
  await expect(input).toHaveValue(draft)
  await expect(toggle).toBeChecked()
  await expect(predefined).not.toBeChecked()
  await expect.poll(height).toBe(initial)
  await input.press("Escape")
  await expect(toggle).toBeFocused()
  await expect(input).toHaveValue(draft)
  await row.click({ position: { x: 30, y: 20 } })
  await expect(input).toBeFocused()
  await expect(input).toHaveValue(draft)
  await expect
    .poll(() => input.evaluate((element, original) => element === original && original.isConnected, node))
    .toBe(true)
  await node.dispose()
})

story("marks one-answer questions with round keys and many-answer questions with square keys", async ({ mount }) => {
  const component = await mount("app-current-session-surface--question-request")
  const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
  const keys = question.locator('[data-slot="question-option-key"]')
  const focused = question.getByRole("radio", { name: /Focused/ })
  await expect(focused).toBeFocused()
  await expect(keys).toHaveText(["1", "2", "3"])
  await expect(keys.first()).toBeVisible()
  await expect(keys.first()).toHaveAttribute("data-type", "radio")
  await expect(question.getByText("Pick any", { exact: true })).toHaveCount(0)
  await focused.press("1")
  await expect(focused.locator('[data-slot="question-option-key"]')).toHaveAttribute("data-picked", "true")

  await question.getByRole("button", { name: "Next", exact: true }).click()
  const files = question.getByRole("checkbox", { name: "Changed files", exact: true })
  await expect(files).toBeFocused()
  await expect(keys.first()).toHaveAttribute("data-type", "checkbox")
  await expect(question.getByText("Pick any", { exact: true })).toBeVisible()
})

story("toggles a lone many-answer question and sends it with Enter", async ({ mount, page }) => {
  const component = await mount("app-current-session-surface--question-multi-select")
  const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
  const files = question.getByRole("checkbox", { name: "Changed files", exact: true })
  const terminal = question.getByRole("checkbox", { name: "Terminal", exact: true })
  await expect(files).toBeFocused()
  await expect(question.getByText("Pick any", { exact: true })).toBeVisible()
  await expect(question.locator('[data-slot="question-option-key"][data-type="radio"]')).toHaveCount(0)

  await page.keyboard.press(" ")
  await page.keyboard.press("2")
  await expect(files).toBeChecked()
  await expect(terminal).toBeChecked()
  await expect(terminal.locator('[data-slot="question-option-key"]')).toHaveAttribute("data-picked", "true")
  await page.keyboard.press("Enter")
  await expect(question).toBeHidden()
})

const longList = async (mount: (id: string) => Promise<Locator>) => {
  const component = await mount("session-question-switch--long-list")
  const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
  await expect(question.getByRole("checkbox").first()).toBeFocused()
  // The answers box has opened to its first height once it stops changing.
  const box = () => question.evaluate((root) => Math.round(root.getBoundingClientRect().height))
  await expect.poll(async () => (await box()) === (await box())).toBe(true)

  return question
}

const fit = (question: Locator) =>
  question.evaluate((root) => {
    const options = root.querySelector<HTMLElement>('[data-slot="question-options"]')!

    const timeline = document.querySelector('[data-slot="session-timeline-scroll"] > .scroll-view__viewport')
    const box = root.getBoundingClientRect()

    return {
      height: box.height,
      // The whole dock, footer included, sits between the top of the timeline and the foot of the window.
      within: box.top >= (timeline?.getBoundingClientRect().top ?? 0) - 0.5 && box.bottom <= innerHeight + 0.5,
      scrolls: options.scrollHeight > options.clientHeight + 1,
      top: options.scrollTop,
    }
  })

// Whether the whole of an answer's row shows, clear of the feathered edges.
const clear = (row: Locator) =>
  row.evaluate((input) => {
    const row = input.closest<HTMLElement>('[data-slot="question-option"]')!
    const box = input.closest<HTMLElement>('[data-slot="question-options"]')!.getBoundingClientRect()
    const at = row.getBoundingClientRect()

    return at.top >= box.top + 20 - 0.5 && at.bottom <= box.bottom - 20 + 0.5
  })

const feathered = (question: Locator) =>
  question.locator('[data-slot="question-options"]').evaluate((options) => {
    const mask = options.style.maskImage

    // A gradient down the list may be written without its direction, which is the default.
    return { top: /linear-gradient\((to bottom, )?transparent/.test(mask), bottom: mask.includes("to top") }
  })

story("caps a long list of answers to the panel and scrolls them inside it", async ({ mount }) => {
  const question = await longList(mount)
  const rest = await fit(question)
  expect(rest.within).toBe(true)
  expect(rest.scrolls).toBe(true)
  await expect(question.getByRole("checkbox", { name: /Footer/ })).not.toBeInViewport()
})

story("scrolls the highlighted answer into view with the keys", async ({ mount, page }) => {
  const question = await longList(mount)
  const footer = question.getByRole("checkbox", { name: /Footer/ })

  await page.keyboard.press("End")
  await page.keyboard.press("ArrowUp")
  await expect(footer).toBeFocused()
  expect(await clear(footer)).toBe(true)

  await page.keyboard.press("Home")
  await expect(question.getByRole("checkbox").first()).toBeFocused()
  expect((await fit(question)).top).toBe(0)
})

story("feathers only the edges of the answers with more past them", async ({ mount }) => {
  const question = await longList(mount)

  // Scrolls to a share of the way down the list.
  const edges = (share: number) =>
    question.evaluate(async (root, share) => {
      const options = root.querySelector<HTMLElement>('[data-slot="question-options"]')!
      options.scrollTop = Math.round((options.scrollHeight - options.clientHeight) * share)
      await new Promise((done) => options.addEventListener("scroll", done, { once: true }))
      const mask = options.style.maskImage

      // A gradient down the list may be written without its direction, which is the default.
      return { top: /linear-gradient\((to bottom, )?transparent/.test(mask), bottom: mask.includes("to top") }
    }, share)

  expect(await edges(0.5)).toEqual({ top: true, bottom: true })
  expect(await edges(1)).toEqual({ top: true, bottom: false })
  expect(await edges(0)).toEqual({ top: false, bottom: true })
})

story("leaves a list that fits without feathered edges", async ({ mount }) => {
  const component = await mount("session-question-switch--question-series")
  const question = component.locator('[data-component="dock-prompt"][data-kind="question"]')
  await expect(question.getByRole("radio").first()).toBeFocused()
  await expect
    .poll(() => question.locator('[data-slot="question-options"]').evaluate((el) => el.style.maskImage))
    .toBe("")
})

story(
  "caps a long list to the panel in the app's layout, where the dock overflows a zero-height row",
  async ({ mount }) => {
    const question = await longList(mount)
    // As in the session screen, the composer region moves into a zero-height row at the foot of the panel and overflows
    // it upward, over the timeline.
    await question.evaluate((root) => {
      const dock = root.closest('[data-component="session-composer-dock"]')!
      const row = document.createElement("div")
      row.style.cssText =
        "position: relative; display: flex; flex-direction: column; justify-content: flex-end; height: 0"
      row.style.flexShrink = "0"
      dock.replaceWith(row)
      row.append(dock)
      dispatchEvent(new Event("resize"))
    })

    // Measured against the empty row, the cap would fall to its 240px minimum.
    await expect.poll(async () => (await fit(question)).height).toBeGreaterThan(400)
    const rest = await fit(question)
    expect(rest.within).toBe(true)
    expect(rest.scrolls).toBe(true)
  },
)

story("brings the picked answer back into view after switching questions", async ({ mount, page }) => {
  const question = await longList(mount)
  const footer = question.getByRole("checkbox", { name: /Footer/ })
  const title = question.locator('[data-slot="question-header-title"]')

  await page.keyboard.press("End")
  await page.keyboard.press("ArrowUp")
  await page.keyboard.press(" ")
  await expect(footer).toBeChecked()

  await page.keyboard.press("ArrowRight")
  await expect(title).toHaveText("2 of 2 questions")
  await page.keyboard.press("ArrowLeft")
  await expect(title).toHaveText("1 of 2 questions")
  await expect(footer).toBeFocused()
  expect(await clear(footer)).toBe(true)
})

story("sizes the answers box to each question with the dock's motion off", async ({ mount, page }) => {
  const question = await longList(mount)
  const options = question.locator('[data-slot="question-options"]')
  const rest = await fit(question)
  expect(rest.scrolls).toBe(true)
  expect(await feathered(question)).toEqual({ top: false, bottom: true })

  await page.keyboard.press("ArrowRight")
  await expect(question.getByRole("radio").first()).toBeFocused()
  await expect.poll(() => feathered(question)).toEqual({ top: false, bottom: false })
  expect(await options.evaluate((el) => el.style.height)).toBe("")
  expect((await fit(question)).scrolls).toBe(false)

  await page.keyboard.press("ArrowLeft")
  await expect(question.getByRole("checkbox").first()).toBeFocused()
  await expect.poll(() => feathered(question)).toEqual({ top: false, bottom: true })
  expect((await fit(question)).height).toBeCloseTo(rest.height, 0)
})

story.describe("a long list with the question dock's motion on", () => {
  story.beforeEach(({ page }) =>
    page.addInitScript(() => localStorage.setItem("opencode.motion.v2", JSON.stringify({ "question.motion": 1 }))),
  )

  story("restores a long list without growing past where it rests", async ({ mount }) => {
    const question = await longList(mount)
    const rest = await fit(question)
    await question.getByRole("button", { name: "Minimize question" }).click()
    await expect(question.getByRole("button", { name: "Restore question" })).toBeVisible()
    await expect
      .poll(() =>
        question.locator('[data-slot="question-options"]').evaluate((el) => el.getBoundingClientRect().height),
      )
      .toBe(0)

    const frames = await question.evaluate(async (root) => {
      const options = root.querySelector<HTMLElement>('[data-slot="question-options"]')!
      root.querySelector<HTMLElement>('[data-slot="question-header-actions"] > button:last-of-type')!.click()

      return Array.from({ length: 45 }).reduce<Promise<{ height: number; asked: number; given: number }[]>>(
        async (list) => {
          const frames = await list
          await new Promise((done) => requestAnimationFrame(done))

          return [
            ...frames,
            {
              height: root.getBoundingClientRect().height,
              asked: parseFloat(options.style.height) || 0,
              given: options.getBoundingClientRect().height,
            },
          ]
        },
        Promise.resolve([]),
      )
    })

    const heights = frames.map((frame) => frame.height)
    expect(heights.every((height, i) => i === 0 || height >= heights[i - 1]! - 0.5)).toBe(true)
    expect(Math.max(...heights)).toBeLessThanOrEqual(rest.height + 0.5)
    expect(heights.at(-1)).toBeCloseTo(rest.height, 0)
    // The answers box is never asked to open past the room it is given, which is what made it snap back at the end.
    expect(frames.every((frame) => frame.asked <= frame.given + 0.5)).toBe(true)
  })
})
