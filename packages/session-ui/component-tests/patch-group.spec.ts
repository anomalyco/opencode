import { expect, story } from "../../storybook/playwright/story"

story("merges follow-up patches into one stack with a distinct file count", async ({ mount }, info) => {
  const root = await mount("current-tool-group--patch-follow-ups")
  const group = root.locator('[data-component="collapsed-tool-group"]')
  const patches = group.locator('[data-component="apply-patch-tool"]')
  await expect(patches).toHaveCount(1)
  await expect(patches.getByText("2 files", { exact: true })).toBeVisible()
  const first = patches.locator('[data-scope="apply-patch"] button').filter({ hasText: "a.ts" })
  await first.click()
  await expect(first).toHaveAttribute("aria-expanded", "true")
  await root.getByRole("button", { name: "Start follow-up patch" }).click()
  await expect(
    group.locator('[data-component="context-tool-group-trigger"] [data-slot="basic-tool-tool-title"]'),
  ).toHaveText("1 Shell, 2 Patch")
  await expect(patches).toHaveCount(1)
  await expect(patches.getByText("2 files", { exact: true })).toBeVisible()
  await root.getByRole("button", { name: "Finish follow-up patch" }).click()
  await expect(patches).toHaveCount(1)
  await expect(patches.getByText("3 files", { exact: true })).toBeVisible()
  await expect(patches.locator('[data-slot="apply-patch-filename"]')).toHaveText(["a.ts", "b.ts", "c.ts"])
  await expect(first).toHaveAttribute("aria-expanded", "true")
  await expect(patches.locator('[data-component="file"]')).toBeVisible()
  await group.screenshot({ path: info.outputPath("merged.png") })
})

for (const separator of ["shell", "error", "reasoning"]) {
  story(`does not merge patches across an intervening ${separator}`, async ({ mount }) => {
    const root = await mount("current-tool-group--patch-follow-ups", { args: { separator } })
    await root.getByRole("button", { name: "Finish follow-up patch" }).click()
    const group = root.locator('[data-component="collapsed-tool-group"]')
    await expect(group.locator('[data-component="apply-patch-tool"]')).toHaveCount(2)
    await expect(group.locator('[data-slot="apply-patch-filename"]')).toHaveText(["a.ts", "b.ts", "a.ts", "c.ts"])
    if (separator === "error") await expect(group.locator('[data-kind="tool-error-card"]')).toBeVisible()
  })
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
