import { benchmark, expect } from "../benchmark"

for (const scenario of ["complete", "partial", "chained", "multi", "direct"]) {
  benchmark(`patch groups ${scenario}`, async ({ page, report }, info) => {
    await page.goto(`/?scenario=${scenario}`)
    await expect(page.getByRole("button", { name: "Mount tools", exact: true })).toBeEnabled()
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.fonts.check('13px "Inter"'))).toBe(true)
    const shape = await page.evaluate(() => {
      const { grouping, ...shape } = window.patchBenchmark
      performance.clearMarks()
      return shape
    })
    const mount = async () => {
      await page.getByRole("button", { name: "Mount tools", exact: true }).click()
      await expect(page.locator('[data-slot="apply-patch-filename"]')).toHaveCount(shape.files)
      await expect(page.locator('[data-component="file"]')).toHaveCount(0)
      return Number(await page.getByTestId("mount-ms").textContent())
    }
    const cold = await mount()
    const counters = await page.evaluate(() =>
      Object.fromEntries(
        ["patchFileGroups", "normalize", "completePatchContents", "diffLines"].map((name) => [
          name,
          performance.getEntriesByName(`patch-counter:${name}`).length,
        ]),
      ),
    )
    await page.getByRole("button", { name: "Unmount tools", exact: true }).click()
    await expect(page.locator('[data-component="apply-patch-tool"]')).toHaveCount(0)
    await page.evaluate(() => performance.clearMarks())
    const warm = await mount()
    const warmCounters = await page.evaluate(() =>
      Object.fromEntries(
        ["patchFileGroups", "normalize", "completePatchContents", "diffLines"].map((name) => [
          name,
          performance.getEntriesByName(`patch-counter:${name}`).length,
        ]),
      ),
    )
    const file = page.locator('[data-scope="apply-patch"] button').filter({ hasText: "edit.ts" })
    await expect(file).toHaveAttribute("aria-expanded", "false")
    await file.click()
    await expect(file).toHaveAttribute("aria-expanded", "true")
    await expect(page.getByTestId("rendered")).not.toHaveText("0")
    await expect(page.locator('[data-component="file"]')).toBeVisible()
    const expansion = Number(await page.getByTestId("rendered").textContent())
    const grouping = await page.evaluate(() => ({
      collapsed: window.patchBenchmark.grouping(false),
      expanded: window.patchBenchmark.grouping(true),
    }))
    expect(grouping.collapsed.groups).toBe(shape.files)
    report(
      { cold, warm, expansion, grouping, counters, warmCounters },
      { scenario, ...shape, scope: "production tool components" },
    )
    if (process.env.PATCH_SCREENSHOTS === "1") {
      await page.screenshot({ path: info.outputPath(`${scenario}-expanded.png`) })
      await file.click()
      await expect(file).toHaveAttribute("aria-expanded", "false")
      await page
        .locator('[data-component="apply-patch-tool"]')
        .screenshot({ path: info.outputPath(`${scenario}-collapsed.png`) })
    }
  })
}
