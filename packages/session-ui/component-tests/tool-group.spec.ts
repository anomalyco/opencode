import { expect, story } from "../../storybook/playwright/story"

story("keeps ordered thoughts inside a thinking block as tools append", async ({ mount }) => {
  const root = await mount("current-tool-group--mixed-reasoning")
  const group = root.locator('[data-component="collapsed-tool-group"]')
  const trigger = group.locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')
  const first = group.locator('[data-timeline-part-id="reasoning_first"]')
  const second = group.locator('[data-timeline-part-id="reasoning_second"]')
  await expect(group).toHaveAttribute("data-thinking", "true")
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(trigger.locator('[data-slot="basic-tool-tool-title"]')).toContainText("Thought for")
  await expect(trigger.locator('[data-slot="basic-tool-tool-subtitle"][data-kind="steps"]')).toHaveText("4 steps")
  await expect(group.locator('[data-slot="context-tool-group-item"]')).toHaveText([
    /Read.*group\.ts/,
    /The renderer groups adjacent tools/,
    /Skill.*opencode.*frontend-design/,
    /Keep these skill groups separate/,
    /Skill.*rtl-aware-development/,
  ])
  await expect(group.locator('[data-timeline-part-ids="reasoning_skill_first,reasoning_skill_second"]')).toBeVisible()
  await expect(first.locator('[data-slot="collapsible-trigger"]')).toHaveCount(0)
  await expect(second).toHaveAttribute("data-embedded", "true")
  await root.getByRole("button", { name: "Append follow-up read", exact: true }).click()
  await expect(trigger.locator('[data-slot="basic-tool-tool-subtitle"][data-kind="steps"]')).toHaveText("5 steps")
  await expect(group.locator('[data-slot="context-tool-group-item"]')).toHaveText([
    /Read.*group\.ts/,
    /The renderer groups adjacent tools/,
    /Skill.*opencode.*frontend-design/,
    /Keep these skill groups separate/,
    /Skill.*rtl-aware-development/,
    /Read.*group\.test\.ts/,
  ])
  await expect(
    first.getByText("The renderer groups adjacent tools. Check the relevant skills before changing it."),
  ).toBeVisible()
})

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

for (const width of [840, 390]) {
  story(`keeps grouped cards inside their trigger bounds at ${width}px`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 600 })
    const root = await mount("current-tool-group--mixed-tools")
    const group = root.locator('[data-component="collapsed-tool-group"]')
    const trigger = group.getByRole("button", { name: "Used 4 Shell, Read, Agent", exact: true })
    const header = group.locator('[data-component="context-tool-group-trigger"]')
    await expect(header.locator('[data-slot="basic-tool-tool-title"]')).toHaveText("Shell, Read, Agent")
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

story("compresses consecutive inspect tools into thinking chips", async ({ mount }) => {
  const root = await mount("current-tool-group--thinking-chips")
  const group = root.locator('[data-component="collapsed-tool-group"][data-thinking="true"]')
  const chips = group.locator('[data-component="thinking-tool-chip"]')
  await expect(group.locator('[data-component="thinking-tool-chips"]')).toHaveCount(2)
  await expect(chips).toHaveCount(5)
  await expect(chips.nth(0)).toContainText("Read")
  await expect(chips.nth(0)).toContainText("message-part.tsx")
  await expect(chips.nth(1)).toContainText("Grep")
  await expect(chips.nth(1)).toContainText("ReasoningPart")
  await expect(chips.nth(2)).toContainText("Glob")
  await expect(chips.nth(2)).toContainText("**/*.test.ts")
  await expect(group.locator('[data-timeline-part-id="chip_grep_failed"]')).toBeVisible()
  await expect(group.locator('[data-slot="thinking-detail"]')).toHaveCount(0)
  await chips.nth(1).click()
  await expect(chips.nth(1)).toHaveAttribute("aria-expanded", "true")
  const detail = group.locator('[data-slot="thinking-detail"][data-timeline-part-id="chip_grep"]')
  await expect(detail).toBeVisible()
  await expect(detail.locator('[data-slot="collapsible-trigger"]')).toHaveCount(0)
  await expect(detail.locator('[data-component="tool-output"]')).toBeVisible()
  await chips.nth(1).click()
  await expect(chips.nth(1)).toHaveAttribute("aria-expanded", "false")
})

story("renders remaining thinking tools as task rows", async ({ mount }) => {
  const root = await mount("current-tool-group--thinking-tasks")
  const group = root.locator('[data-component="collapsed-tool-group"][data-thinking="true"]')
  const rows = group.locator('[data-component="thinking-task-row"]')
  await expect(group.locator('[data-component="thinking-tool-chip"]')).toHaveCount(2)
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0).locator('[data-slot="thinking-task-row-trigger"]')).toContainText("Skill")
  await expect(rows.nth(0).locator('[data-slot="thinking-task-row-trigger"]')).toContainText("frontend-design")
  await expect(rows.nth(1).locator('[data-slot="thinking-task-row-trigger"]')).toContainText("Shell")
  await expect(rows.nth(1).locator('[data-slot="thinking-task-row-trigger"]')).toContainText("bun test")
  await expect(rows.nth(2).locator('[data-slot="thinking-task-row-trigger"]')).toContainText("Edit")
  await expect(rows.nth(2).locator('[data-slot="thinking-task-row-trigger"]')).toContainText("thinking-state.tsx")
  await expect(group.locator('[data-slot="thinking-detail"]')).toHaveCount(0)
  await rows.nth(1).locator('[data-slot="thinking-task-row-trigger"]').click()
  await expect(group.locator('[data-slot="thinking-detail"] [data-slot="bash-result"]')).toContainText("200 pass")
  await expect(group.locator('[data-slot="thinking-detail"] [data-slot="collapsible-trigger"]')).toHaveCount(0)
})
