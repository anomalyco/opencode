import { expect, story } from "../../stories/playwright/story"

story.describe("message actions menu", () => {
  story.use({ timezoneId: "UTC" })

  story(
    "opens from a chevron in the bubble with the send time and the actions the message can take",
    async ({ mount, page }) => {
      const timeline = await mount("current-prompt-message--pending")
      const chevron = timeline.locator('[data-slot="user-message-menu"]')
      const more = timeline.getByRole("button", { name: "More actions", exact: true })
      const fork = page.getByRole("menuitem", { name: "Fork from here", exact: true })
      const copy = page.getByRole("menuitem", { name: "Copy message", exact: true })
      const revert = page.getByRole("menuitem", { name: "Revert to here", exact: true })
      const remove = page.getByRole("menuitem", { name: "Delete", exact: true })

      // The meta line keeps agent and model; the time lives in the menu.
      await expect(timeline.locator('[data-slot="user-message-meta"] time')).toHaveCount(0)

      const bubble = timeline.locator('[data-slot="user-message-text"]')
      await timeline.getByLabel("Delivery state").selectOption("delivered")
      await page.mouse.move(0, 0)
      await expect(chevron).toHaveCSS("opacity", "0")
      await bubble.hover()
      await expect(chevron).toHaveCSS("opacity", "1")
      await more.click()
      const menu = page.getByRole("menu")
      await expect(menu.locator("time")).toHaveText("Jan 1, 2025, 12:00 AM")
      await expect(fork).toBeEnabled()
      await expect(copy).toBeEnabled()
      await expect(revert).toBeEnabled()
      // An open menu keeps its chevron in view after the pointer leaves the message.
      await page.mouse.move(0, 0)
      await expect(chevron).toHaveCSS("opacity", "1")
      await page.keyboard.press("Escape")
      await expect(menu).toBeHidden()
      // The menu hands focus back without a ring, so the chevron hides once the pointer is away.
      await expect(more).toBeFocused()
      await expect(chevron).toHaveCSS("opacity", "0")

      // A pending steer is queued or deleted rather than reverted, and has no history to fork; a message without text has
      // nothing to copy.
      await timeline.getByLabel("Delivery state").selectOption("steering")
      await timeline.getByLabel("Prompt text", { exact: true }).uncheck()
      // Without a bubble, the chevron sits in the footer and shows while the message is hovered.
      await timeline.locator('[data-component="user-message"]').hover()
      await more.click()
      await expect(page.getByRole("menuitem", { name: "Move to queue", exact: true })).toBeEnabled()
      await expect(fork).toHaveCount(0)
      await expect(copy).toHaveAttribute("aria-disabled", "true")
      await expect(revert).toHaveCount(0)
      await expect(remove).toBeEnabled()
      await page.keyboard.press("Escape")

      await timeline.getByLabel("Prompt text", { exact: true }).check()
      await timeline.getByLabel("Delivery state").selectOption("delivered")
      await page.evaluate(() => document.fonts.ready.then(() => undefined))

      for (const width of [1000, 390]) {
        await page.setViewportSize({ width, height: 844 })
        await bubble.hover()
        const box = await bubble.boundingBox()
        const trigger = await more.boundingBox()
        const lineHeight = await bubble.evaluate((element) => parseFloat(getComputedStyle(element).lineHeight))

        if (!box || !trigger) throw new Error("Message geometry is unavailable")
        // Pinned to the bubble's top trailing corner, centered on its first line, as far from the side as from the top.
        expect(Math.abs(box.y + 8 + lineHeight / 2 - trigger.y - trigger.height / 2)).toBeLessThan(1)
        expect(Math.abs(box.x + box.width - trigger.x - trigger.width - (trigger.y - box.y))).toBeLessThan(1)
      }
    },
  )

  story("opens upward, 4px from the chevron, with its trailing edge on the chevron's", async ({ mount, page }) => {
    const timeline = await mount("current-session-timeline-rows--prompt-runs")
    await timeline.getByRole("button", { name: "Send next", exact: true }).click()
    const message = timeline.locator('[data-component="user-message"]').first()
    await message.locator('[data-slot="user-message-text"]').hover()
    const more = message.getByRole("button", { name: "More actions", exact: true })
    // An open menu hides the rest of the page from the accessibility tree, so measure the trigger first.
    const trigger = await more.boundingBox()
    await more.click()
    const menu = page.locator('[data-component="menu-v2-content"]')
    await expect(menu).toBeVisible()
    const box = await menu.boundingBox()

    if (!trigger || !box) throw new Error("Menu geometry is unavailable")
    expect(Math.abs(trigger.y - box.y - box.height - 4)).toBeLessThan(1)
    expect(Math.abs(trigger.x + trigger.width - box.x - box.width)).toBeLessThan(1)
  })
})

story("shows a run's meta line while the pointer is anywhere in the run, gaps included", async ({ mount, page }) => {
  const timeline = await mount("current-session-timeline-rows--prompt-runs")
  const send = timeline.getByRole("button", { name: "Send next", exact: true })
  await send.click()
  await send.click()
  const bubbles = timeline.locator('[data-slot="user-message-text"]')
  await expect(bubbles).toHaveCount(3)

  const footer = timeline
    .locator('[data-component="user-message"]')
    .last()
    .locator('[data-slot="user-message-copy-wrapper"]')

  await page.mouse.move(0, 0)
  await expect(footer).toHaveCSS("opacity", "0")
  await bubbles.first().hover()
  await expect(footer).toHaveCSS("opacity", "1")

  // The 4px gap between two bubbles belongs to the run, so crossing it keeps the line.
  const above = await bubbles.nth(0).boundingBox()
  const below = await bubbles.nth(1).boundingBox()

  if (!above || !below) throw new Error("Run geometry is unavailable")
  await page.mouse.move(below.x + below.width / 2, (above.y + above.height + below.y) / 2)
  await expect(footer).toHaveCSS("opacity", "1")
  await page.mouse.move(0, 0)
  await expect(footer).toHaveCSS("opacity", "0")
})

story("names the newest prompt's revert Undo and earlier ones Revert to here", async ({ mount, page }) => {
  const timeline = await mount("current-session-timeline-rows--prompt-runs")
  await timeline.getByRole("button", { name: "Send next", exact: true }).click()
  const messages = timeline.locator('[data-component="user-message"]')
  await expect(messages).toHaveCount(2)

  for (const [index, label] of [
    [1, "Undo"],
    [0, "Revert to here"],
  ] as const) {
    await messages.nth(index).locator('[data-slot="user-message-text"]').hover()
    await messages.nth(index).getByRole("button", { name: "More actions", exact: true }).click()
    await expect(page.getByRole("menuitem", { name: label, exact: true })).toBeVisible()
    await expect(page.getByRole("menuitem", { name: index ? "Revert to here" : "Undo", exact: true })).toHaveCount(0)
    await page.keyboard.press("Escape")
  }
})

story("drops a pending footer at once on delivery with and without hover", async ({ mount, page }) => {
  const timeline = await mount("current-prompt-message--pending")
  const message = timeline.locator('[data-component="user-message"]')
  const footer = timeline.locator('[data-slot="user-message-copy-wrapper"]')
  const pending = timeline.locator('[data-slot="user-message-transition"]:has([data-slot="user-message-pending"])')

  await page.mouse.move(0, 0)
  await expect(footer).toHaveCSS("height", "20px")
  await expect(footer).toHaveCSS("margin-top", "8px")
  const bubble = timeline.locator('[data-slot="user-message-text"]')
  const labels = timeline.locator('[data-slot="user-message-meta-label"]')

  for (const hover of [true, false]) {
    await timeline.getByLabel("Delivery state").selectOption("steering")
    await expect(footer).toHaveCSS("opacity", "1")
    await expect(pending).toHaveCSS("opacity", "1")
    const before = await pending.boundingBox()

    if (!before) throw new Error("Pending footer geometry is unavailable")

    if (hover) await bubble.hover()

    if (!hover) await page.mouse.move(0, 0)
    // Pending closes the line, and the agent and model before it show only on hover.
    await expect(labels).toHaveCSS("opacity", hover ? "1" : "0")
    const line = await footer.boundingBox()

    if (!line) throw new Error("Pending footer geometry is unavailable")
    expect(Math.abs(before.x + before.width - line.x - line.width)).toBeLessThan(1)
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

  await text.hover()
  await expect(timeline.locator('[data-slot="user-message-meta-item"]')).toHaveText([
    "Build",
    "Claude Sonnet 4",
    "Balanced",
  ])
  const separator = timeline.locator('[data-slot="user-message-meta-label"] [data-slot="user-message-meta-separator"]')
  await expect(separator).toHaveText("\u00B7")
  await expect(timeline.locator('[data-slot="user-message-meta-label"]')).toHaveCSS("gap", "4px")

  // A steer reads agent · model · Pending. Pending stays in view; the agent and model show on hover, as on any message.
  await timeline.getByLabel("Delivery state").selectOption("steering")
  await expect(timeline.locator('[data-slot="user-message-meta"]')).toHaveText(
    /^Build\s*·\s*Claude Sonnet 4\s*Balanced\s*·\s*Pending$/,
    { useInnerText: true },
  )
  await expect(timeline.locator('[data-slot="user-message-meta-label"]')).toHaveCSS("opacity", "1")
  await page.mouse.move(0, 0)
  await expect(timeline.locator('[data-slot="user-message-meta-label"]')).toHaveCSS("opacity", "0")
  await expect(indicator).toBeVisible()
  await timeline.getByLabel("Voice message", { exact: true }).check()
  const voice = timeline.getByRole("img", { name: "Voice", exact: true })
  await expect(voice).toBeVisible()
  await expect(indicator).toBeVisible()
  // The faded bubble already marks a steer as waiting, so Pending is plain text with no icon.
  await expect(indicator).toHaveText("Pending")
  await expect(indicator.locator("svg")).toHaveCount(0)

  await expect(voice.locator("use")).toHaveAttribute("href", "#opencode-v2-icon-outline-wave-audio")
  await expect(voice).toHaveCSS("width", "20px")
  await expect(voice).toHaveCSS("height", "20px")
  await expect(voice.locator('[data-slot="icon-svg"]')).toHaveCSS("width", "14px")
  await expect(voice.locator('[data-slot="icon-svg"]')).toHaveCSS("height", "14px")

  await expect(timeline.locator('[data-slot="user-message-meta"]')).toHaveText(/Pending$/)
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
  // A steer without text offers its actions from a chevron in its footer.
  await timeline.locator('[data-component="user-message"]').hover()
  await timeline.getByRole("button", { name: "More actions", exact: true }).click()
  await page.getByRole("menuitem", { name: "Move to queue", exact: true }).click()
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

story("shows note selectors and keeps annotation subtitles with or without comments", async ({ mount, page }) => {
  const gallery = await mount("current-session-timeline-rows--note-attachments")

  const cases = [
    { name: "Named", heading: "button#save", secondary: "Browser annotation" },
    { name: "Unnamed", heading: "button.icon-only", secondary: "Browser annotation" },
    { name: "Legacy", heading: "Legacy element", secondary: "Legacy element" },
    { name: "Whitespace", heading: "Fallback element", secondary: "Fallback element" },
    { name: "Title only", heading: "button#save", secondary: "Original label" },
    { name: "Commented", heading: "Fix this", secondary: "Browser annotation" },
    { name: "RTL subtitle", heading: "button#save", secondary: "تعليق المتصفح" },
    { name: "RTL legacy", heading: "العنصر الأصلي", secondary: "العنصر الأصلي" },
    {
      name: "Long selector",
      heading: 'main > section.settings-panel > form > button[data-action="save-all-account-preferences"]',
      secondary: "Browser annotation",
    },
  ]

  await page.evaluate(() => document.fonts.ready.then(() => undefined))

  for (const item of cases) {
    const section = gallery.getByRole("region", { name: item.name, exact: true })
    const card = section.getByRole("button")
    const heading = card.locator('[data-slot="attachment-card-title"]')
    const label = card.locator('[data-slot="attachment-card-label"]')
    await expect(heading).toHaveText(item.heading)
    await expect(label).toHaveText(item.secondary)
  }

  const long = gallery.getByRole("region", { name: "Long selector", exact: true }).getByRole("button")
  await expect(long).toHaveCSS("width", "160px")
  await expect(long).toHaveCSS("height", "52px")
  await expect(long.locator('[data-slot="attachment-card-title"]')).toHaveCSS("white-space", "nowrap")
  await expect(long.locator('[data-slot="attachment-card-title"]')).toHaveCSS("text-overflow", "ellipsis")
  const rtl = gallery.getByRole("region", { name: "RTL subtitle", exact: true }).getByRole("button")
  const label = rtl.locator('[data-slot="attachment-card-label"]')
  await expect(label).toHaveCSS("white-space", "nowrap")
  await expect(label).toHaveCSS("text-overflow", "ellipsis")
  await expect(label).toHaveAttribute("dir", "ltr")
  await expect(label).toHaveCSS("unicode-bidi", "isolate")
  expect(
    await long
      .locator('[data-slot="attachment-card-title"]')
      .evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(true)

  const named = gallery.getByRole("region", { name: "Named", exact: true }).getByRole("button")
  await page.clock.install()
  await named.hover()
  await page.clock.runFor(1000)
  await expect(page.getByRole("tooltip")).toHaveText("button#save\nBrowser annotation")
  await long.hover()
  await page.clock.runFor(1000)
  await expect(page.getByRole("tooltip", { name: /^main > section/ })).toHaveText(
    'main > section.settings-panel > form > button[data-action="save-all-account-preferences"]\nBrowser annotation',
  )
  await page.clock.resume()
  await named.click()
  await expect(gallery.getByLabel("Selected attachment")).toHaveText("Named")
  await rtl.focus()
  await page.keyboard.press("Enter")
  await expect(gallery.getByLabel("Selected attachment")).toHaveText("RTL subtitle")
  await named.focus()
  await page.keyboard.press("Space")
  await expect(gallery.getByLabel("Selected attachment")).toHaveText("Named")
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
