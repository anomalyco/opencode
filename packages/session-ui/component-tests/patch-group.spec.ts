import { expect, story } from "../../storybook/playwright/story"

for (const tool of ["patch", "edit", "write", "mixed"]) {
  story(`merges follow-up ${tool} calls into one stack with a distinct file count`, async ({ mount }, info) => {
    const root = await mount("current-tool-group--patch-follow-ups", { args: { tool } })
    const group = root.locator('[data-component="collapsed-tool-group"]')
    const patches = group.locator('[data-component="apply-patch-tool"]')
    await expect(patches).toHaveCount(1)
    await expect(patches.getByText("2 files", { exact: true })).toBeVisible()
    await expect(
      patches.getByLabel(tool === "mixed" ? "Edit" : `${tool[0].toUpperCase()}${tool.slice(1)}`, { exact: true }),
    ).toBeVisible()
    const first = patches.locator('[data-scope="apply-patch"] button').filter({ hasText: "a.ts" })
    await first.click()
    await expect(first).toHaveAttribute("aria-expanded", "true")
    await root.getByRole("button", { name: "Start follow-up patch" }).click()
    await expect(group).toHaveAttribute(
      "data-timeline-part-ids",
      tool === "patch" ? "patch_shell,patch_first,patch_next" : "patch_shell,first_0,first_1,next_0,next_1",
    )
    await expect(patches).toHaveCount(1)
    await expect(patches.getByText("2 files", { exact: true })).toBeVisible()
    await root.getByRole("button", { name: "Finish follow-up patch" }).click()
    await expect(patches).toHaveCount(1)
    await expect(patches.getByText("3 files", { exact: true })).toBeVisible()
    await expect(patches.locator('[data-slot="apply-patch-filename"]')).toHaveText(["a.ts", "b.ts", "c.ts"])
    await expect(first).toHaveAttribute("aria-expanded", "true")
    await expect(patches.locator('[data-component="file"]')).toHaveCount(2)
    await expect(patches.locator('[data-component="file"]').nth(0)).toBeVisible()
    await expect(patches.locator('[data-component="file"]').nth(1)).toBeVisible()
    await expect(patches.locator('[data-component="apply-patch-file-diff"]')).toHaveCount(2)
    await group.screenshot({ path: info.outputPath("merged.png") })
  })

  for (const separator of ["shell", "error", "reasoning"]) {
    story(`does not merge ${tool} calls across an intervening ${separator}`, async ({ mount }) => {
      const root = await mount("current-tool-group--patch-follow-ups", { args: { separator, tool } })
      await expect(root.locator("[data-file-tool]")).toHaveAttribute("data-file-tool", tool)
      await expect(root.locator("[data-file-separator]")).toHaveAttribute("data-file-separator", separator)
      await root.getByRole("button", { name: "Finish follow-up patch" }).click()
      const group = root.locator('[data-component="collapsed-tool-group"]')
      await expect(group.locator('[data-component="apply-patch-tool"]')).toHaveCount(2)
      await expect(group.locator('[data-slot="apply-patch-filename"]')).toHaveText(["a.ts", "b.ts", "a.ts", "c.ts"])
      if (separator === "error") await expect(group.locator('[data-kind="tool-error-card"]')).toBeVisible()
    })
  }
}

story("does not retain patch files in the wrong batch when thoughts are shown", async ({ mount }) => {
  const root = await mount("current-tool-group--patch-follow-ups", { args: { separator: "reasoning" } })
  await root.getByRole("button", { name: "Hide thoughts", exact: true }).click()
  await root.getByRole("button", { name: "Finish follow-up patch" }).click()
  const group = root.locator('[data-component="collapsed-tool-group"]')
  await expect(group.locator('[data-component="apply-patch-tool"]')).toHaveCount(1)
  await expect(group.locator('[data-slot="apply-patch-filename"]')).toHaveText(["a.ts", "b.ts", "c.ts"])
  await root.getByRole("button", { name: "Show thoughts", exact: true }).click()
  await expect(group.locator('[data-component="apply-patch-tool"]')).toHaveCount(2)
  await expect(group.locator('[data-slot="apply-patch-filename"]')).toHaveText(["a.ts", "b.ts", "a.ts", "c.ts"])
})

for (const placement of ["separate", "grouped"]) {
  story(
    `preserves mixed file disclosures through append and split in ${placement} timeline rows`,
    async ({ mount, page }) => {
      await page.setViewportSize({ width: placement === "grouped" ? 390 : 1280, height: 900 })
      const root = await mount("current-tool-group--patch-follow-ups", {
        args: { tool: "mixed", placement, separator: "reasoning" },
      })
      const timeline = root.locator('[data-component="session-timeline"]')
      if (placement === "grouped") await timeline.getByRole("button", { name: /^Used / }).click()
      const stacks = timeline.locator('[data-component="apply-patch-tool"]')
      const first = stacks.first().locator('[data-scope="apply-patch"] button').filter({ hasText: "a.ts" })
      await expect(stacks).toHaveCount(1)
      if (placement === "grouped") await first.click()
      await expect(first).toHaveAttribute("aria-expanded", "true")
      await root.getByRole("button", { name: "Hide thoughts", exact: true }).click()
      await root.getByRole("button", { name: "Finish follow-up patch" }).click()
      await expect(stacks).toHaveCount(1)
      await expect(stacks.locator('[data-slot="apply-patch-filename"]')).toHaveText(["a.ts", "b.ts", "c.ts"])
      await expect(first).toHaveAttribute("aria-expanded", "true")
      await root.getByRole("button", { name: "Show thoughts", exact: true }).click()
      await expect(stacks).toHaveCount(2)
      await expect(stacks.locator('[data-slot="apply-patch-filename"]')).toHaveText(["a.ts", "b.ts", "a.ts", "c.ts"])
      await expect(first).toHaveAttribute("aria-expanded", "true")
      const second = stacks.nth(1).locator('[data-scope="apply-patch"] button').filter({ hasText: "a.ts" })
      await expect(second).toHaveAttribute("aria-expanded", "false")
    },
  )
}
