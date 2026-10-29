import { expect, story } from "../../stories/playwright/story"

story.describe("message timestamp", () => {
  story.use({ timezoneId: "UTC" })

  story("shows the full creation date, time, and time zone on hover and focus", async ({ mount, page }) => {
    const timeline = await mount("current-prompt-message--pending")
    const timestamp = timeline.locator('[data-slot="user-message-meta-tail"]')
    await expect(timestamp.locator("time")).toHaveText("Jan 1, 2025")
    await timeline.getByLabel("Delivery state").selectOption("delivered")
    const message = timeline.locator('[data-component="user-message"]')
    await message.hover()
    await expect(timestamp).toHaveCSS("opacity", "1")
    await page.clock.install()
    await page.clock.pauseAt(new Date(Date.now() + 1000))
    await timestamp.locator("time").hover()
    const tooltip = page.getByRole("tooltip")
    await page.clock.runFor(799)
    await expect(tooltip).toBeHidden()
    await page.clock.runFor(1)
    await expect(tooltip).toHaveText("Wednesday, January 1, 2025 at 12:00:00 AM UTC")
    await page.clock.resume()
    await page.mouse.move(0, 0)
    await expect(tooltip).toBeHidden()
    await expect(timestamp).toHaveCSS("opacity", "0")
    await timestamp.locator('[data-component="tooltip-v2-trigger"]').focus()
    await expect(tooltip).toBeVisible()

    await page.evaluate(() => document.fonts.ready.then(() => undefined))

    for (const width of [1000, 390]) {
      await page.setViewportSize({ width, height: 844 })
      const bubble = await timeline.locator('[data-slot="user-message-text"]').boundingBox()
      const time = await timestamp.boundingBox()
      const footer = await timeline.locator('[data-slot="user-message-copy-wrapper"]').boundingBox()
      const message = await timeline.locator('[data-component="user-message"]').boundingBox()

      if (!bubble || !time || !footer || !message) throw new Error("Message geometry is unavailable")
      expect(Math.abs(bubble.x + bubble.width - message.x - message.width)).toBeLessThan(1)
      expect(footer.y).toBeGreaterThanOrEqual(bubble.y + bubble.height)
      expect(footer.x + footer.width).toBeLessThanOrEqual(bubble.x + bubble.width + 1)
      expect(time.x).toBeGreaterThanOrEqual(footer.x)
      expect(time.x + time.width).toBeLessThanOrEqual(footer.x + footer.width)
      expect(Math.abs(time.y + time.height / 2 - footer.y - footer.height / 2)).toBeLessThan(1)
    }
  })
})

story("drops a pending footer at once on delivery with and without hover", async ({ mount, page }) => {
  const timeline = await mount("current-prompt-message--pending")
  const message = timeline.locator('[data-component="user-message"]')
  const footer = timeline.locator('[data-slot="user-message-copy-wrapper"]')
  const timestamp = timeline.locator('[data-slot="user-message-meta-tail"]')
  const pending = timeline.locator('[data-slot="user-message-transition"]:has([data-slot="user-message-pending"])')

  await page.mouse.move(0, 0)
  await expect(footer).toHaveCSS("height", "20px")
  await expect(footer).toHaveCSS("margin-top", "4px")
  await expect(timestamp).toHaveCSS("opacity", "0")

  for (const hover of [true, false]) {
    await timeline.getByLabel("Delivery state").selectOption("steering")
    await expect(footer).toHaveCSS("opacity", "1")
    await expect(pending).toHaveCSS("opacity", "1")
    const before = await pending.boundingBox()

    if (!before) throw new Error("Pending footer geometry is unavailable")

    if (hover) await message.hover()

    if (!hover) await page.mouse.move(0, 0)
    // Pending stands in for the unsent time, so the actions follow the labels without a gap held for it.
    await expect(timestamp).toBeHidden()
    const label = await timeline.locator('[data-slot="user-message-meta-item"]').last().boundingBox()
    const actions = await timeline.locator('[data-slot="user-message-actions"]').boundingBox()

    if (!label || !actions) throw new Error("Pending footer geometry is unavailable")
    expect(actions.x - label.x - label.width).toBeLessThanOrEqual(9)
    await timeline.getByLabel("Delivery state").selectOption("delivered")

    // The first frame after delivery already shows the delivered footer: nothing shrinks or fades out.
    const after = await message.evaluate((element) => {
      const pending = element.querySelector(
        '[data-slot="user-message-transition"]:has([data-slot="user-message-pending"])',
      )!

      const footer = element.querySelector('[data-slot="user-message-copy-wrapper"]')!

      return {
        animations: [...pending.getAnimations(), ...footer.getAnimations()].length,
        width: pending.getBoundingClientRect().width,
        opacity: Number(getComputedStyle(pending).opacity),
        footer: Number(getComputedStyle(footer).opacity),
      }
    })

    expect(after).toEqual({ animations: 0, width: 0, opacity: 0, footer: hover ? 1 : 0 })
    expect(before.width).toBeGreaterThan(0)

    await expect(pending).toBeHidden()
    await expect(footer).toHaveCSS("opacity", hover ? "1" : "0")
    await expect(timestamp).toHaveCSS("opacity", hover ? "1" : "0")
  }

  await page.emulateMedia({ reducedMotion: "reduce" })
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce")
  await timeline.getByLabel("Delivery state").selectOption("steering")
  await timeline.getByLabel("Delivery state").selectOption("delivered")
  await expect(footer).toHaveCSS("transition-duration", "0s")
  await expect(pending).toBeHidden()
  await expect(footer).toHaveCSS("opacity", "0")
})

story("marks pending metadata without badging delivered, starting, or queued prompts", async ({ mount, page }) => {
  const timeline = await mount("current-prompt-message--pending")
  const indicator = timeline.locator('[data-slot="user-message-meta"] [data-slot="user-message-pending"]')
  const text = timeline.locator('[data-slot="user-message-text"]')

  for (const status of ["steering", "stranded", "starting", "queued", "delivered"]) {
    await timeline.getByLabel("Delivery state").selectOption(status)
    const pending = status === "steering" || status === "stranded"

    if (pending) await expect(indicator).toBeVisible()

    if (!pending) await expect(indicator).toBeHidden()

    const colors = await timeline.evaluate((element, pending) => {
      const probe = document.createElement("span")
      probe.style.color = `var(--v2-text-text-${pending ? "muted" : "base"})`
      probe.style.backgroundColor = `var(--v2-background-bg-layer-${pending ? "01" : "02"})`
      element.append(probe)
      const result = { color: getComputedStyle(probe).color, background: getComputedStyle(probe).backgroundColor }
      probe.remove()

      return result
    }, pending)

    await expect(text).toHaveCSS("color", colors.color)
    await expect(text).toHaveCSS("background-color", colors.background)
  }

  await timeline.locator('[data-component="user-message"]').hover()
  await expect(timeline.locator('[data-slot="user-message-meta-item"]')).toHaveText([
    "Build",
    "Claude Sonnet 4",
    "Balanced",
  ])
  await expect(timeline.locator('[data-slot="user-message-meta-item"][data-variant]')).toHaveCSS("opacity", "0.66")
  const separator = timeline.locator('[data-slot="user-message-meta-label"] [data-slot="user-message-meta-separator"]')
  await expect(separator).toHaveText("\u00B7")
  await expect(separator).toHaveCSS("opacity", "0.66")
  await expect(timeline.locator('[data-slot="user-message-meta-label"]')).toHaveCSS("gap", "4px")

  await timeline.getByLabel("Delivery state").selectOption("steering")
  await timeline.getByLabel("Voice message", { exact: true }).check()
  const voice = timeline.getByRole("img", { name: "Voice", exact: true })
  await expect(voice).toBeVisible()
  await expect(indicator).toBeVisible()
  await expect(indicator).toHaveAttribute("aria-hidden", "true")

  await expect(voice.locator("use")).toHaveAttribute("href", "#opencode-v2-icon-outline-wave-audio")
  await expect(indicator.locator("use")).toHaveAttribute("href", "#opencode-v2-icon-outline-steer")

  const icon = await indicator.locator("svg").boundingBox()
  const label = await timeline.locator('[data-slot="user-message-meta"]').boundingBox()

  if (!icon || !label) throw new Error("Pending metadata geometry is unavailable")
  expect(Math.abs(icon.y + icon.height / 2 - label.y - label.height / 2)).toBeLessThan(0.5)

  await expect(voice).toHaveCSS("width", "20px")
  await expect(voice).toHaveCSS("height", "20px")
  await expect(voice.locator('[data-slot="icon-svg"]')).toHaveCSS("width", "14px")
  await expect(voice.locator('[data-slot="icon-svg"]')).toHaveCSS("height", "14px")

  const faint = await indicator.evaluate((element) => {
    const probe = document.createElement("span")
    probe.style.color = "var(--v2-icon-icon-faint)"
    element.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()

    return color
  })

  await expect(indicator).toHaveCSS("color", faint)
  await expect(timeline.locator('[data-slot="user-message-meta"]')).toHaveText(/^Pending/)
  await timeline.getByLabel("Grouped prompts", { exact: true }).check()
  await expect(timeline.locator('[data-run-folded] [data-slot="user-message-copy-wrapper"]')).toBeHidden()
  await expect(
    timeline.locator('[data-component="user-message"]:not([data-run-folded]) [data-slot="user-message-pending"]'),
  ).toBeVisible()
  await expect(timeline.getByRole("img", { name: "Pending", exact: true })).toHaveCount(0)
  await timeline.getByLabel("Grouped prompts", { exact: true }).uncheck()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(indicator).toBeVisible()
  await expect(timeline.locator('[data-slot="user-message-meta-item"]')).toHaveCount(0)
  await timeline.getByLabel("Prompt text", { exact: true }).uncheck()
  await expect(timeline.getByText("notes.json", { exact: true })).toBeVisible()
  await expect(indicator).toBeVisible()
  await timeline.getByRole("button", { name: "Move to queue", exact: true }).click()
  await expect(indicator).toBeHidden()
})

// Moved from packages/app/e2e/regression/session-timeline-collapse-state.spec.ts
story("keeps a manually collapsed tool collapsed when later assistant content streams", async ({ mount }) => {
  const timeline = await mount("current-session-file-changes--changing-files", { args: { scenario: "streaming" } })
  const tool = timeline.locator('[data-timeline-part-id="tool_edit_status"]')
  const trigger = tool.locator('[data-scope="apply-patch"] button')
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  // SAFETY: the locator targets a rendered DOM element, which is always an HTMLElement in the story.
  await tool.evaluate((element) => ((element as HTMLElement).dataset.regressionMarker = "before-stream"))
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await timeline.getByRole("button", { name: "Stream sibling content" }).click()
  await expect(timeline.getByText("Streaming added a later assistant text part.", { exact: true })).toBeVisible()
  await expect(tool).toHaveAttribute("data-regression-marker", "before-stream")
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await expect(tool.locator("xpath=ancestor::*[@data-timeline-row]")).toHaveAttribute(
    "data-timeline-row",
    "AssistantPart",
  )
})

// Moved from packages/app/e2e/regression/session-timeline-projection.spec.ts
story("renders interruption independently when the turn is not compacted", async ({ mount }) => {
  const timeline = await mount("current-session-timeline-rows--conversation", { args: { scenario: "interruption" } })
  await expect(timeline.getByText("Interrupted", { exact: true })).toBeVisible()
  await expect(timeline.getByText("Before", { exact: true })).toBeVisible()
  await expect(timeline.getByText("After", { exact: true })).toBeVisible()

  const rows = await timeline
    .locator('[data-timeline-row="AssistantPart"], [data-timeline-row="TurnDivider"]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-timeline-row")))

  expect(rows).toEqual(["AssistantPart", "TurnDivider", "AssistantPart"])
})

// Moved from packages/app/e2e/regression/session-timeline-projection.spec.ts
story("renders aliased and long custom model notices", async ({ mount, page }) => {
  await page.setViewportSize({ width: 420, height: 700 })
  const timeline = await mount("current-session-timeline-rows--conversation", { args: { scenario: "models" } })
  const shortName = "GPT-5.4 nano"
  const longName = "Company Gateway Extra Long Context Model for Narrow Timeline Layouts"

  const short = timeline
    .locator('[data-slot="session-timeline-notice"]')
    .filter({ hasText: shortName })
    .filter({ hasText: "xhigh" })

  const long = timeline.locator('[data-slot="session-timeline-notice"]').filter({ hasText: longName })
  await expect(short).toBeVisible()
  await expect(short.getByText(`Switched to ${shortName}`, { exact: true })).toBeVisible()
  await expect(short.locator('[data-slot="session-timeline-notice-variant"]')).toHaveText("xhigh")
  await expect(timeline.getByText("fast-nano", { exact: true })).toHaveCount(0)
  await expect(short.locator('[data-component="provider-icon"]')).toBeVisible()

  const variantDefault = timeline
    .locator('[data-slot="session-timeline-notice"]')
    .filter({ hasText: "Switched variant to Default" })

  const variantHigh = timeline
    .locator('[data-slot="session-timeline-notice"]')
    .filter({ hasText: "Switched variant to high" })

  await expect(variantDefault.getByText("Switched variant to Default", { exact: true })).toBeVisible()
  await expect(variantHigh.getByText("Switched variant to high", { exact: true })).toBeVisible()
  await expect(variantDefault.locator('[data-slot="session-timeline-notice-variant"]')).toHaveCount(0)
  await expect(variantHigh.locator('[data-slot="session-timeline-notice-variant"]')).toHaveCount(0)
  await expect(long).toBeVisible()
  await expect(long.locator('[data-component="provider-icon"]')).toBeVisible()
  await expect(long.locator('[data-slot="session-timeline-notice-variant"]')).toHaveCount(0)
  await expect(long.locator("[title]")).toHaveAttribute("title", `Switched to ${longName}`)
  await expect.poll(() => long.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
})

// Moved from packages/app/e2e/regression/session-timeline-projection.spec.ts
story("renders user image, file attachment, file reference, and agent reference", async ({ mount }) => {
  const timeline = await mount("current-session-timeline-rows--conversation", { args: { scenario: "attachments" } })
  await expect(timeline.getByAltText("pixel.png")).toBeVisible()
  await expect(timeline.getByText("tsconfig.json")).toBeVisible()
  await expect(timeline.getByText("@src/a.ts", { exact: true })).toBeVisible()
  await expect(timeline.getByText("@explore", { exact: true })).toBeVisible()

  const accent = await timeline.evaluate((element) => {
    const probe = document.createElement("span")
    probe.style.color = "var(--v2-text-text-accent)"
    element.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()

    return color
  })

  for (const mention of await timeline.locator("[data-highlight]").all()) {
    await expect(mention).toHaveCSS("color", accent)
    await expect(mention).toHaveCSS("font-weight", "440")
  }

  for (const prefix of await timeline.locator('[data-slot="user-message-mention-prefix"]').all()) {
    await expect(prefix).toHaveCSS("color", accent)
  }

  const attachments = timeline.locator('[data-slot="user-message-attachments"]')
  const body = timeline.locator('[data-slot="user-message-body"]')
  const [attachmentsBox, bodyBox] = await Promise.all([attachments.boundingBox(), body.boundingBox()])
  expect(attachmentsBox).not.toBeNull()
  expect(bodyBox).not.toBeNull()
  expect(bodyBox!.y - (attachmentsBox!.y + attachmentsBox!.height)).toBe(8)
})

story("links URLs in user messages without swallowing punctuation or mentions", async ({ mount }) => {
  const timeline = await mount("current-session-timeline-rows--conversation", { args: { scenario: "links" } })
  const links = timeline.locator('[data-slot="user-message-text"] a[data-slot="user-message-link"]')
  await expect(links).toHaveCount(2)
  await expect(links.nth(0)).toHaveText("https://github.com/Hona/mesh")
  await expect(links.nth(0)).toHaveAttribute("href", "https://github.com/Hona/mesh")
  await expect(links.nth(0)).toHaveAttribute("target", "_blank")
  await expect(links.nth(0)).toHaveCSS("cursor", "pointer")
  await expect(links.nth(1)).toHaveText("https://opencode.ai/docs")
  await expect(timeline.getByText("@src/a.ts", { exact: true })).toBeVisible()
  await expect(timeline.locator('[data-slot="user-message-text"]')).toHaveText(
    "set it up on this pc https://github.com/Hona/mesh, then compare @src/a.ts with (https://opencode.ai/docs).",
  )
})
