import { expect, story } from "../../storybook/playwright/story"

const runs = [
  "index.tsx, main.ts, rpc.ts, model.ts, toolbar.tsx",
  "connection.ts limit=120, index.tsx, environment.tsx, env.d.ts",
  "index.tsx, button.tsx, toggle.ts, index.tsx",
  "context.tsx",
]

story("collapses each run of reads inside a Used group into one row", async ({ mount }) => {
  const root = await mount("current-read-group--used-group", { args: { width: "960" } })
  const group = root.locator('[data-component="collapsed-tool-group"]')
  await expect(group.getByRole("button", { name: "Used 65 Read, Shell", exact: true })).toBeVisible()
  const reads = group.locator('[data-component="read-tool-group"]')
  await expect(reads).toHaveCount(9)
  await expect(reads.locator('[data-slot="basic-tool-tool-subtitle"]').first()).toHaveText(runs[0]!)
  for (const [index, text] of runs.entries())
    await expect(reads.nth(index).locator('[data-slot="basic-tool-tool-subtitle"]')).toHaveText(text)
  await expect(reads.first().locator('[data-slot="read-tool-group-file"]')).toHaveCount(5)
  await expect(reads.nth(1).locator('[data-slot="read-tool-group-file"]').first()).toHaveAttribute(
    "data-timeline-part-id",
    "read_group_read_2_0",
  )
  await expect(group.locator('[data-slot="context-tool-group-item"]').nth(1)).toHaveText(/^Thought/)

  const thought = group.locator('[data-component="reasoning-part"]').first()
  const color = (locator: typeof thought, slot: string) =>
    locator
      .locator(`[data-slot="${slot}"]`)
      .first()
      .evaluate((node) => getComputedStyle(node).color)
  expect(await color(reads.first(), "basic-tool-tool-title")).toBe(await color(thought, "basic-tool-tool-title"))
  expect(await color(reads.first(), "basic-tool-tool-subtitle")).toBe(await color(thought, "basic-tool-tool-subtitle"))
  const box = await reads.first().boundingBox()
  expect(box?.height).toBe(28)
})

story("truncates long read rows and expands them in place", async ({ mount }) => {
  const root = await mount("current-read-group--used-group", { args: { width: "420" } })
  const reads = root.locator('[data-component="read-tool-group"]')
  await expect(reads.first()).not.toHaveAttribute("role", "button")
  const row = reads.filter({ hasText: "runner.ts" })
  const files = row.locator('[data-slot="basic-tool-tool-subtitle"]')
  await expect(row).toHaveAttribute("role", "button")
  await expect(row).toHaveAttribute("aria-expanded", "false")
  await expect(files).toHaveCSS("text-overflow", "ellipsis")
  const collapsed = (await row.boundingBox())!.height
  await row.click()
  await expect(row).toHaveAttribute("aria-expanded", "true")
  await expect(files).toHaveCSS("white-space", "normal")
  expect((await row.boundingBox())!.height).toBeGreaterThan(collapsed)
  expect(await files.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
  await row.press("Enter")
  await expect(row).toHaveAttribute("aria-expanded", "false")
  expect((await row.boundingBox())!.height).toBe(collapsed)
  await row.press(" ")
  await expect(row).toHaveAttribute("aria-expanded", "true")
})

story("merges adjacent reads when tools render outside a Used group", async ({ mount }) => {
  const root = await mount("current-read-group--without-used-group", { args: { width: "960" } })
  await expect(root.locator('[data-component="collapsed-tool-group"]')).toHaveCount(0)
  const reads = root.locator('[data-timeline-row="AssistantPart"] [data-component="read-tool-group"]')
  await expect(reads).toHaveCount(9)
  for (const [index, text] of runs.entries())
    await expect(reads.nth(index).locator('[data-slot="basic-tool-tool-subtitle"]')).toHaveText(text)
  await expect(root.locator('[data-component="reasoning-part"]')).toHaveCount(8)
})
