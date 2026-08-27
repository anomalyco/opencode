import { expect, story } from "../../storybook/playwright/story"

for (const reasoningDefaultOpen of [false, true]) {
  story(
    `keeps ordered thoughts and tool-only counts with reasoning ${reasoningDefaultOpen ? "expanded" : "collapsed"}`,
    async ({ mount }) => {
      const root = await mount("current-tool-group--mixed-reasoning", { args: { reasoningDefaultOpen } })
      const group = root.locator('[data-component="collapsed-tool-group"]')
      const used = group.getByRole("button", { name: "Used Read, Skill", exact: true })
      const first = group.locator('[data-timeline-part-id="reasoning_first"]')
      const second = group.locator('[data-timeline-part-id="reasoning_second"]')
      await expect(used).toHaveAttribute("aria-expanded", "true")
      await expect(group.locator('[data-component="tag"]')).toHaveText("4")
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
      await expect(group.locator('[data-component="tag"]')).toHaveText("5")
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
  await expect(group.getByRole("button", { name: "Used Shell, Read, Agent", exact: true })).toBeVisible()
  await expect(group.locator('[data-component="tag"]')).toHaveText("4")
  await expect(group.locator('[data-component="task-tool-title"]')).toHaveText(["General", "Explore"])
})

for (const width of [840, 390]) {
  story(`keeps grouped cards inside their trigger bounds at ${width}px`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 600 })
    const root = await mount("current-tool-group--mixed-tools")
    const group = root.locator('[data-component="collapsed-tool-group"]')
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
