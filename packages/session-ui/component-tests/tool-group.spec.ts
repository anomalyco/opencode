import type { Locator } from "@playwright/test"
import { expect, story } from "../../storybook/playwright/story"

// The digits drawn inside the count's clipped width, left to right. Each slot shows whichever visible glyph lines up
// with it, so a slot mid-roll reads "_", and the spare leading zero outside the width is skipped.
const shown = (count: Locator) =>
  count.locator('[data-slot="animated-number-value"]').evaluate((value) => {
    const clip = value.getBoundingClientRect()

    return Array.from(value.querySelectorAll('[data-slot="animated-number-digit"]'), (slot) => ({
      slot,
      rect: slot.getBoundingClientRect(),
    }))
      .filter((item) => item.rect.left >= clip.left - 0.5 && item.rect.right <= clip.right + 0.5)
      .toSorted((a, b) => a.rect.left - b.rect.left)
      .map(
        (item) =>
          Array.from(item.slot.querySelectorAll("[data-digit]"))
            .find(
              (glyph) =>
                getComputedStyle(glyph).visibility === "visible" &&
                Math.abs(glyph.getBoundingClientRect().top - item.rect.top) < 0.5,
            )
            ?.getAttribute("data-digit") ?? "_",
      )
      .join("")
  })

for (const reasoningDefaultOpen of [false, true]) {
  story(
    `keeps ordered thoughts and tool-only counts with reasoning ${reasoningDefaultOpen ? "expanded" : "collapsed"}`,
    async ({ mount }) => {
      const root = await mount("current-tool-group--mixed-reasoning", { args: { reasoningDefaultOpen } })
      const group = root.locator('[data-component="collapsed-tool-group"]')
      const used = group.getByRole("button", { name: /^Used \d+ Read, Skill$/ })
      const first = group.locator('[data-timeline-part-id="reasoning_first"]')
      const second = group.locator('[data-timeline-part-id="reasoning_second"]')
      await expect(used).toHaveAttribute("aria-expanded", "true")
      await expect(used).toHaveAccessibleName("Used 4 Read, Skill")
      await expect(group.locator('[data-component="context-tool-group-trigger"]')).toHaveAttribute(
        "aria-label",
        "Used 4 Read, Skill",
      )
      await expect(group.locator('[data-slot="context-tool-group-item"]')).toHaveText([
        /Read.*group\.ts/,
        /Thought/,
        /Loaded.*opencode.*frontend-design.*skills/,
        /Thought/,
        /Loaded.*rtl-aware-development.*skill/,
      ])
      await expect(
        group.locator('[data-timeline-part-ids="reasoning_skill_first,reasoning_skill_second"]'),
      ).toBeVisible()
      await expect(first.getByRole("button", { name: "Thought", exact: true })).toHaveAttribute(
        "aria-expanded",
        String(reasoningDefaultOpen),
      )
      await expect(second.getByRole("button", { name: "Thought", exact: true })).toHaveAttribute(
        "aria-expanded",
        String(reasoningDefaultOpen),
      )
      await first.getByRole("button", { name: "Thought", exact: true }).click()
      await root.getByRole("button", { name: "Append follow-up read", exact: true }).click()
      await expect(used).toHaveAccessibleName("Used 5 Read, Skill")
      await expect(group.locator('[data-component="context-tool-group-trigger"]')).toHaveAttribute(
        "aria-label",
        "Used 5 Read, Skill",
      )
      await expect(group.locator('[data-slot="context-tool-group-item"]')).toHaveText([
        /Read.*group\.ts/,
        /Thought/,
        /Loaded.*opencode.*frontend-design.*skills/,
        /Thought/,
        /Loaded.*rtl-aware-development.*skill/,
        /Read.*group\.test\.ts/,
      ])
      await expect(first.getByRole("button", { name: "Thought", exact: true })).toHaveAttribute(
        "aria-expanded",
        String(!reasoningDefaultOpen),
      )
      await expect(second.getByRole("button", { name: "Thought", exact: true })).toHaveAttribute(
        "aria-expanded",
        String(reasoningDefaultOpen),
      )

      if (reasoningDefaultOpen) {
        await expect(
          first.getByText("The renderer groups adjacent tools. Check the relevant skills before changing it."),
        ).toBeHidden()

        return
      }

      await expect(
        first.getByText("The renderer groups adjacent tools. Check the relevant skills before changing it."),
      ).toBeVisible()
    },
  )
}

story("summarizes subagents as Agent while retaining their card titles", async ({ mount }) => {
  const root = await mount("current-tool-group--mixed-tools")
  const group = root.locator('[data-component="collapsed-tool-group"]')
  await expect(group.getByRole("button", { name: "Used 4 Shell, Read, Agent", exact: true })).toBeVisible()
  const header = group.locator('[data-component="context-tool-group-trigger"]')
  const prefix = header.locator('[data-slot="context-tool-group-prefix"]')
  const count = header.locator('[data-slot="context-tool-group-count"]')
  const title = header.locator('[data-slot="basic-tool-tool-title"]')
  await expect(prefix).toHaveText("Used")
  await expect(count).toHaveText("4")
  await expect(title).toHaveText("Shell, Read, Agent")
  await expect(title).toHaveCSS("white-space", "nowrap")
  await expect(title).toHaveCSS("text-overflow", "ellipsis")
  expect(await prefix.evaluate((node) => node.textContent)).toBe("Used")
  expect(await count.evaluate((node) => node.textContent)).toBe("4")
  expect(await prefix.locator("..").evaluate((node) => getComputedStyle(node).columnGap)).toBe("4px")
  expect(await title.locator("..").evaluate((node) => getComputedStyle(node).columnGap)).toBe("4px")
  expect(await count.evaluate((node) => getComputedStyle(node).fontVariantNumeric)).toBe("tabular-nums")

  const colors = await Promise.all(
    [prefix, count, title].map((part) => part.evaluate((node) => getComputedStyle(node).color)),
  )

  expect(colors[1]).toBe(colors[2])
  expect(colors[0]).not.toBe(colors[1])

  const gap = await group.evaluate((element) => {
    const title = element.querySelector('[data-component="context-tool-group-trigger"]')!.getBoundingClientRect()
    const arrow = element.querySelector('[data-slot="collapsible-arrow-icon"]')!.getBoundingClientRect()

    return arrow.left - title.right
  })

  expect(gap).toBeLessThanOrEqual(8)
  await expect(group.locator('[data-component="task-tool-title"]')).toHaveText(["General", "Explore"])
})

for (const direction of ["ltr", "rtl"]) {
  story(`reads and shows a two-digit count once, in order, in ${direction}`, async ({ mount, page }) => {
    const root = await mount("current-tool-group--sticky-header", { globals: { direction } })
    const count = root.locator('[data-component="context-tool-group-trigger"] [data-slot="context-tool-group-count"]')
    await expect(count).toHaveText("37")
    expect(await count.ariaSnapshot()).toBe('- text: "37"')
    // The clipped width follows the web font's metrics.
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    expect(await shown(count)).toBe("37")
  })
}

story("does not animate the count on mount or when its font changes", async ({ mount }) => {
  const root = await mount("current-tool-group--sticky-header")
  const count = root.locator('[data-component="context-tool-group-trigger"] [data-slot="context-tool-group-count"]')
  await expect(count).toHaveText("37")
  expect(await count.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0)

  // Like a late web font swap or a zoom change: the digit width changes without the count changing.
  await count.evaluate((element) => {
    element.style.fontSize = "20px"
  })
  expect(await count.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0)
})

story("settles count changes made while detached, without rolling", async ({ mount }) => {
  const root = await mount("current-tool-group--count-rollover")
  const count = root.locator('[data-component="context-tool-group-trigger"] [data-slot="context-tool-group-count"]')
  await expect(count).toHaveText("9")

  // A background session keeps adding tools while its cached timeline is detached.
  await root.getByRole("button", { name: "Detach" }).click()

  for (let added = 0; added < 12; added++) await root.getByRole("button", { name: "Add read" }).click()

  await root.getByRole("button", { name: "Attach" }).click()

  await expect(count).toHaveText("21")
  expect(await count.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0)
  await expect(count.locator('[data-animating="true"]')).toHaveCount(0)
  expect(await shown(count)).toBe("21")
})

story("keeps a digit rolling when the count changes again mid-roll", async ({ mount, page }) => {
  const root = await mount("current-tool-group--count-rollover")
  const count = root.locator('[data-component="context-tool-group-trigger"] [data-slot="context-tool-group-count"]')
  // A slow roll keeps the second change inside the first roll on a loaded machine.
  await page.addStyleTag({ content: ":root { --tool-motion-odometer-ms: 5000ms }" })
  await expect(count).toHaveText("9")

  await root.getByRole("button", { name: "Add read" }).click()
  await root.getByRole("button", { name: "Add read" }).click()
  await expect(count).toHaveText("11")
  // 9 -> 10 starts the tens digit rolling; 10 -> 11 leaves it unchanged, so it finishes its roll instead of jumping.
  await expect(count.locator('[data-animating="true"]')).toHaveCount(2)
})

story("rolls the leading digit in and out when the count gains or loses a digit", async ({ mount }) => {
  const root = await mount("current-tool-group--count-rollover")
  const count = root.locator('[data-component="context-tool-group-trigger"] [data-slot="context-tool-group-count"]')
  const rolling = count.locator('[data-animating="true"]')
  await expect(count).toHaveText("9")

  await root.getByRole("button", { name: "Add read" }).click()
  // The tens digit rolls in from zero beside the ones digit instead of appearing.
  await expect(rolling).toHaveCount(2)
  expect(await count.ariaSnapshot()).toBe('- text: "10"')
  await expect(rolling).toHaveCount(0)

  await root.getByRole("button", { name: "Remove read" }).click()
  // The tens digit rolls back to zero before it leaves instead of vanishing.
  await expect(rolling).toHaveCount(2)
  expect(await count.ariaSnapshot()).toBe('- text: "9"')
  await expect(rolling).toHaveCount(0)
  await expect(count).toHaveText("9")
})

story("rolls the count and exposes only its current value while rolling", async ({ mount }) => {
  const root = await mount("current-tool-group--mixed-reasoning")
  const count = root.locator('[data-component="context-tool-group-trigger"] [data-slot="context-tool-group-count"]')
  await expect(count).toHaveText("4")
  await root.getByRole("button", { name: "Append follow-up read" }).click()
  await expect(count.locator('[data-animating="true"]')).toHaveCount(1)
  // One read mid-roll: a retrying assertion would pass once the strip hides again.
  expect(await count.ariaSnapshot()).toBe('- text: "5"')
  await expect(count).toHaveText("5")
})

for (const width of [840, 390]) {
  story(`keeps grouped cards inside their trigger bounds at ${width}px`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 600 })
    const root = await mount("current-tool-group--mixed-tools")
    const group = root.locator('[data-component="collapsed-tool-group"]')
    const trigger = group.getByRole("button", { name: "Used 4 Shell, Read, Agent", exact: true })
    const header = group.locator('[data-component="context-tool-group-trigger"]')
    await expect(header).toHaveAttribute("aria-label", "Used 4 Shell, Read, Agent")
    await expect(header.locator('[data-component="tag"]')).toHaveCount(0)
    await expect(trigger).toHaveAttribute("aria-expanded", "true")

    for (const action of ["click", "Enter", "Space"] as const) {
      if (action === "click") await trigger.click()

      if (action !== "click") await trigger.press(action)
      await expect(trigger).toHaveAttribute("aria-expanded", "false")
      await expect(group.locator('[data-component="context-tool-group-list"]')).toBeHidden()
      await expect(trigger).toBeFocused()

      if (action === "click") await trigger.click()

      if (action !== "click") await trigger.press(action)
      await expect(trigger).toHaveAttribute("aria-expanded", "true")
      await expect(group.locator('[data-component="context-tool-group-list"]')).toBeVisible()
      await expect(trigger).toBeFocused()
    }

    const cards = group.locator('[data-component="task-tool-surface"]')
    await expect(cards).toHaveCount(2)
    await expect
      .poll(() =>
        cards.evaluateAll((nodes) =>
          nodes.map((node) => {
            const card = node.getBoundingClientRect()
            const trigger = node.closest('[data-component="tool-trigger"]')!.getBoundingClientRect()
            const item = node.closest('[data-slot="context-tool-group-item"]')!.getBoundingClientRect()

            return (
              card.height === 36 &&
              card.top >= trigger.top &&
              card.bottom <= trigger.bottom &&
              card.top >= item.top &&
              card.bottom <= item.bottom
            )
          }),
        ),
      )
      .toEqual([true, true])
    const shell = group.locator('[data-timeline-part-id="group_shell"]')
    await expect(shell.locator('[data-slot="collapsible-trigger"]')).toHaveCSS("height", "28px")
    await shell.getByRole("button").click()
    await expect(shell.locator('[data-slot="bash-command"]')).toHaveText("printf 'group geometry'")
    await expect(shell.locator('[data-slot="bash-result"]')).toHaveText("group geometry")
    await expect
      .poll(() =>
        shell.evaluate((node) => {
          const card = node.querySelector('[data-component="bash-output"]')!.getBoundingClientRect()
          const item = node.closest('[data-slot="context-tool-group-item"]')!.getBoundingClientRect()

          return card.top >= item.top && card.bottom <= item.bottom
        }),
      )
      .toBe(true)
  })
}
