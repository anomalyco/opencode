import { expect, story } from "../../storybook/playwright/story"

story("keeps grouped file choices when the Used group reopens", async ({ mount }) => {
  const root = await mount("current-session-research-agents--agent-research", { args: { scenario: "workflow" } })
  const group = root.locator('[data-component="collapsed-tool-group"]').filter({ hasText: "Patch" })
  const disclosure = group.getByRole("button", { name: /^Used \d+ .*Edit.*Write.*Patch$/ })
  await disclosure.click()
  const files = group.locator(
    '[data-timeline-part-ids="tool_family_edit,tool_family_write,tool_family_write_extra,tool_family_patch"] [data-slot="accordion-item"]',
  )
  await expect(files).toHaveCount(3)
  for (const file of await files.all()) {
    const trigger = file.locator('[data-slot="accordion-trigger"]')
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
    await expect(file.locator('[data-component="file"]')).toHaveCount(0)
    await trigger.click()
    await expect(file.getByRole("region")).toBeVisible()
  }
  await disclosure.click()
  await disclosure.click()
  await expect(files).toHaveCount(3)
  for (const file of await files.all()) {
    await expect(file.locator('[data-slot="accordion-trigger"]')).toHaveAttribute("aria-expanded", "true")
    await expect(file.getByRole("region")).toBeVisible()
  }
})

for (const tool of ["edit", "write"]) {
  story(`${tool} preserves input fallback and disclosure through completion`, async ({ mount }) => {
    const root = await mount("current-session-file-changes--file-tool-fallbacks", { args: { tool } })
    const file = root.getByRole("button", { name: /example\.ts/ })
    await expect(file).toHaveAttribute("aria-expanded", "false")
    await file.click()
    await expect(root.locator('[data-component="file"]')).toContainText(tool === "edit" ? "after" : "written")
    await root.getByRole("button", { name: "Complete file tool" }).click()
    await expect(root.getByText("Example diagnostic")).toBeVisible()
    await expect(file).toHaveAttribute("aria-expanded", "true")
    await file.click()
    await expect(file).toHaveAttribute("aria-expanded", "false")
    await expect(root.getByText("Example diagnostic")).toBeVisible()
  })
}

// Product regression from 010cd6131e: an empty write renders no file row. Remove `fail` once it is fixed.
story.fail("empty writes still show a file row", async ({ mount }) => {
  const root = await mount("current-session-file-changes--file-tool-fallbacks", {
    args: { tool: "write", empty: true },
  })
  await root.getByRole("button", { name: "Complete file tool" }).click()
  const file = root.getByRole("button", { name: /example\.ts/ })
  await expect(file).toHaveAttribute("aria-expanded", "false")
  await file.click()
  await expect(file).toHaveAttribute("aria-expanded", "true")
  await expect(root.locator('[data-component="file"]')).toBeAttached()
  await expect(file).toBeVisible()
})
