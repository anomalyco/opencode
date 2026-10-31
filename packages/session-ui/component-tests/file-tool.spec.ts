import { expect, story } from "../../stories/playwright/story"

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

story("renders error diagnostics on timeline write results while filtering warnings", async ({ mount }) => {
  const root = await mount("current-session-file-changes--changing-files", {
    args: { scenario: "diagnostics" },
    globals: { direction: "rtl" },
  })

  const item = root.locator('[data-timeline-part-id="prt_write_diagnostics"] [data-slot="accordion-item"]')
  const trigger = item.getByRole("button", { name: /probe\.go/ })
  const diagnostics = item.locator('[data-component="diagnostics"]')

  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await expect(diagnostics).toBeVisible()
  await expect(diagnostics.locator('[data-slot="diagnostic-location"]')).toHaveAttribute("dir", "ltr")
  await expect(diagnostics.locator('[data-slot="diagnostic-location"]')).toHaveText("[6:14]")
  await expect(diagnostics.locator('[data-slot="diagnostic-message"]')).toHaveAttribute("dir", "auto")
  await expect(diagnostics.locator('[data-slot="diagnostic-message"]')).toHaveText("cannot use string as int")
  await expect(root.getByText("x declared and not used")).toHaveCount(0)

  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(item.getByRole("region")).toBeVisible()
  await expect(diagnostics).toBeVisible()
})

story("matches edit diagnostics across absolute input paths and replaces stale snapshots", async ({ mount }) => {
  const root = await mount("current-session-file-changes--changing-files", {
    args: { scenario: "diagnosticsEdit" },
  })

  const item = root.locator('[data-scope="apply-patch"] [data-slot="accordion-item"]')

  await expect(item).toHaveCount(1)
  await expect(item.locator('[data-component="diagnostics"]')).toContainText("[1:14]")
  await expect(item.locator('[data-component="diagnostics"]')).toContainText("type mismatch after edit")

  await root.getByRole("button", { name: "Apply fix edit" }).click()
  await expect(item.locator('[data-component="diagnostics"]')).toHaveCount(0)
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
