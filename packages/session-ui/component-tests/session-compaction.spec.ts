import { expect, story } from "../../stories/playwright/story"

const rows = "current-session-timeline-rows"

story("shows a running automatic compaction as one Compacting divider", async ({ mount }) => {
  const timeline = await mount(`${rows}--compaction-in-progress`)
  const message = timeline.locator('[data-component="session-compaction-message"]')
  const divider = message.locator('[data-slot="session-compaction-divider"]')

  await expect(message).toHaveAttribute("data-quiet", "")
  // Already running when the history loads, so it shows at once rather than waiting out the grace.
  await expect(message).not.toHaveAttribute("data-enter")
  await expect(divider).toHaveAttribute("data-state", "running")
  await expect(divider).toBeDisabled()
  await expect(divider).toHaveAttribute("aria-busy", "true")
  await expect(divider).toHaveAccessibleName("Compacting")
  await expect(divider).not.toHaveAttribute("aria-expanded")
  await expect(message.locator('[data-slot="session-compaction-running"]')).toHaveCSS("opacity", "1")
  await expect(message).not.toContainText("Session compaction started")
  await expect(message).not.toContainText("Restore compaction output")
  await expect(message.locator('[data-component="text-part"]')).toHaveCount(0)
})

story("opens a finished automatic compaction's summary from its divider", async ({ mount, page }) => {
  const timeline = await mount(`${rows}--compaction-and-continuation`)
  const message = timeline.locator('[data-component="session-compaction-message"]')
  const divider = message.locator('[data-slot="session-compaction-divider"]')
  const summary = message.locator('[data-slot="session-compaction-summary"]')

  // The stem Compacting and Compacted share, then the ending that differs.
  const colors = () =>
    message.locator('[data-slot="session-compaction-label"]').evaluate((label) =>
      [label.firstElementChild, label.querySelector('[data-slot="session-compaction-done"]')].map((part) => {
        if (!part) throw new Error("Expected the label's stem and ending")

        return getComputedStyle(part).color
      }),
    )

  // Loaded with the history, so it is already there rather than fading in.
  await expect(message).not.toHaveAttribute("data-enter")
  await expect(divider).toHaveAttribute("data-state", "done")
  await expect(message.locator('[data-slot="session-compaction-done"]')).toHaveCSS("opacity", "1")
  await expect(divider).toHaveAccessibleName("Compacted")
  await expect(divider).toHaveAttribute("aria-expanded", "false")
  await expect(divider).not.toHaveAttribute("aria-controls")
  await expect(summary).toHaveCount(0)
  const [rest] = await colors()

  // Hovering lights the whole word, not only the ending.
  await divider.hover()
  await expect.poll(async () => (await colors())[0]).not.toBe(rest)
  await expect.poll(async () => new Set(await colors()).size).toBe(1)

  await divider.click()
  await expect(divider).toHaveAttribute("aria-expanded", "true")
  await expect(summary).toContainText("The Session timeline now consumes current nested assistant content.")
  await expect(summary).toContainText("11.9K in · 508 out")
  await expect(divider).toHaveAttribute("aria-controls", (await summary.getAttribute("id")) ?? "")
  // An open divider keeps the whole word lit once the pointer leaves.
  await page.mouse.move(0, 0)
  await expect.poll(async () => (await colors())[0]).not.toBe(rest)
  await expect.poll(async () => new Set(await colors()).size).toBe(1)

  await divider.click()
  await expect(divider).toHaveAttribute("aria-expanded", "false")
  await expect(divider).not.toHaveAttribute("aria-controls")
  await expect(summary).toHaveCount(0)
})

story("fades in an instant automatic compaction as Compacted", async ({ mount }) => {
  const timeline = await mount(`${rows}--compaction-replay`, { args: { run: "instant" } })
  const message = timeline.locator('[data-component="session-compaction-message"]')
  const divider = message.locator('[data-slot="session-compaction-divider"]')

  await expect(message).toHaveAttribute("data-enter", "now")
  await expect(divider).toHaveAttribute("data-state", "done")
  await expect(divider).toHaveCSS("animation-name", "session-compaction-enter")
  await expect(divider).toHaveAccessibleName("Compacted")
  await expect(message.locator('[data-slot="session-compaction-light"]').first()).toBeHidden()
})

story("fades in a compaction that ends inside the grace as Compacted only", async ({ mount, page }) => {
  await mount(`${rows}--compaction-replay`, { args: { run: "quick" } })

  // Sample the frame after it finishes: Compacting must already be gone rather than crossfading under Compacted.
  const ended = await page.evaluate(
    () =>
      new Promise<{ enter: string | null; animation: string; running: string; done: string }>((resolve) => {
        const sample = () => {
          const message = document.querySelector('[data-component="session-compaction-message"]')
          const divider = message?.querySelector('[data-slot="session-compaction-divider"]')

          if (!message || !divider || divider.getAttribute("data-state") !== "done")
            return requestAnimationFrame(sample)

          requestAnimationFrame(() =>
            resolve({
              enter: message.getAttribute("data-enter"),
              animation: getComputedStyle(divider).animationName,
              running: getComputedStyle(message.querySelector('[data-slot="session-compaction-running"]')!).opacity,
              done: getComputedStyle(message.querySelector('[data-slot="session-compaction-done"]')!).opacity,
            }),
          )
        }

        sample()
      }),
  )

  expect(ended).toEqual({ enter: "now", animation: "session-compaction-enter", running: "0", done: "1" })
})

story("warms the label only once the gathering light reaches it", async ({ mount }) => {
  const timeline = await mount(`${rows}--compaction-in-progress`)
  const message = timeline.locator('[data-component="session-compaction-message"]')

  // Hold the divider's animations at a point in their 3.2 s cycle and read the light and the label's glint there.
  const at = (progress: number) =>
    message.evaluate((root, progress) => {
      root.ownerDocument
        .getAnimations()
        .filter(
          (animation) => animation instanceof CSSAnimation && animation.animationName.startsWith("session-compaction-"),
        )
        .forEach((animation) => {
          animation.pause()
          animation.currentTime = progress * 3_200
        })

      const light = root.querySelector('[data-slot="session-compaction-light"]')
      const glint = root.querySelector('[data-slot="session-compaction-glint"]')

      if (!light || !glint) throw new Error("Expected the light and the glint")

      return [getComputedStyle(light, "::after").opacity, getComputedStyle(glint).opacity].map(Number)
    }, progress)

  const [travelling, arriving, landed, cooled] = await Promise.all(
    [0.3, 0.48, 0.57, 0.9].map((progress) => at(progress)),
  )

  expect(travelling).toEqual([1, 0])
  expect(arriving).toEqual([1, 0])
  expect(landed[0]).toBeLessThan(1)
  expect(landed[1]).toBeCloseTo(0.75, 2)
  expect(cooled).toEqual([0, 0])
})

story("splits a translated label between whole characters", async ({ mount }) => {
  // Bengali's two words part at a vowel sign, which draws a dotted circle when it is cut from its consonant.
  const timeline = await mount(`${rows}--compaction-and-continuation`, { globals: { locale: "bn" } })
  const message = timeline.locator('[data-component="session-compaction-message"]')

  await expect(message.locator('[data-slot="session-compaction-divider"]')).toHaveAccessibleName("সংকুচিত হয়েছে")
  await expect(message.locator('[data-slot="session-compaction-done"]')).toHaveText(/^\P{M}/u)
})

story("keeps the space where a translated label splits", async ({ mount, page }) => {
  // Hindi's two phrases part after a space, which a label split into boxes drops unless it keeps its white space.
  const timeline = await mount(`${rows}--compaction-and-continuation`, { globals: { locale: "hi" } })
  const label = timeline.locator('[data-slot="session-compaction-label"]')
  await expect(timeline.locator('[data-slot="session-compaction-divider"]')).toHaveAccessibleName("संक्षिप्त किया गया")
  await page.evaluate(() => document.fonts.ready.then(() => undefined))

  // The label's two parts against the same phrase set as one run of text beside it.
  const [split, whole] = await label.evaluate((element) => {
    const stem = element.firstElementChild
    const ending = element.querySelector('[data-slot="session-compaction-done"]')
    const copy = element.cloneNode(false)

    if (!stem || !ending || !(copy instanceof HTMLElement)) throw new Error("Expected the label's stem and ending")
    copy.textContent = element.closest("button")?.getAttribute("aria-label") ?? ""
    element.after(copy)

    const widths = [
      stem.getBoundingClientRect().width + ending.getBoundingClientRect().width,
      copy.getBoundingClientRect().width,
    ]

    copy.remove()

    return widths
  })

  expect(whole).toBeGreaterThan(0)
  expect(Math.abs(split - whole)).toBeLessThan(1)
})

story("keeps the full record for a manual compaction", async ({ mount }) => {
  const timeline = await mount(`${rows}--compaction-manual`)
  const message = timeline.locator('[data-component="session-compaction-message"]')

  await expect(message).not.toHaveAttribute("data-quiet")
  await expect(message).toContainText("Session compaction started")
  await expect(message).toContainText("The Session timeline now consumes current nested assistant content.")
  await expect(message).toContainText("Session compacted · 11.9K in · 508 out")
})

story("keeps the full record for a failed automatic compaction", async ({ mount }) => {
  const timeline = await mount(`${rows}--compaction-failed`)
  const message = timeline.locator('[data-component="session-compaction-message"]')

  await expect(message).not.toHaveAttribute("data-quiet")
  await expect(message).toContainText("Session compaction started")
  await expect(message).toContainText("Session compaction failed")
  await expect(message.locator('[data-component="card"]')).toContainText(
    "The provider rejected the compaction request.",
  )
})

story("keeps the divider's box while an automatic compaction runs and finishes", async ({ mount, page }) => {
  const timeline = await mount(`${rows}--conversation`, { args: { scenario: "compaction" } })
  const message = timeline.locator('[data-component="session-compaction-message"]')
  const label = message.locator('[data-slot="session-compaction-label"]')
  const stem = label.locator("span").first()

  // The story's turn above gains its footer when the Session goes idle, so measure the divider against itself.
  const box = async () => {
    const [outer, text, start] = await Promise.all([message.boundingBox(), label.boundingBox(), stem.boundingBox()])

    if (!outer || !text || !start) throw new Error("Expected the compaction divider to be laid out")

    return {
      width: outer.width,
      height: outer.height,
      label: [text.x - outer.x, text.y - outer.y, text.width],
      stem: [start.x - outer.x, start.width],
    }
  }

  await expect(message.locator('[data-slot="session-compaction-divider"]')).toHaveAttribute("data-state", "running")
  const running = await box()

  await page.getByRole("button", { name: "Stream summary" }).click()
  await expect(message).not.toContainText("Streamed implementation details.")
  expect(await box()).toEqual(running)

  await page.getByRole("button", { name: "Complete summary" }).click()
  await expect(message.locator('[data-slot="session-compaction-divider"]')).toHaveAttribute("data-state", "done")
  expect(await box()).toEqual(running)
})

story("holds the lines still under reduced motion", async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  const timeline = await mount(`${rows}--compaction-in-progress`)
  const message = timeline.locator('[data-component="session-compaction-message"]')
  const line = message.locator('[data-slot="session-compaction-line"]').first()

  await expect(message.locator('[data-slot="session-compaction-light"]').first()).toBeHidden()
  await expect(message.locator('[data-slot="session-compaction-glint"]')).toBeHidden()
  await expect.poll(() => line.evaluate((element) => getComputedStyle(element, "::before").opacity)).toBe("1")
  await expect(message.locator('[data-slot="session-compaction-running"]')).toHaveCSS("opacity", "1")
})
