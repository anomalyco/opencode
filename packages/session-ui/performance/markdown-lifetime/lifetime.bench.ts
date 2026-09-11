import { benchmark, expect } from "../../../app/e2e/performance/benchmark"

for (const scenario of ["mounted", "leave", "shared"]) {
  benchmark(`completed Markdown: ${scenario}`, async ({ page, report }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.goto(`/?scenario=${scenario}`)
    await page.getByRole("button", { name: "Admit answer" }).click()
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled()
    const session = await page.context().newCDPSession(page)
    await session.send("Performance.enable")
    const before = await session.send("Performance.getMetrics")
    await page.getByRole("button", { name: "Continue", exact: true }).click()
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true")
    await expect(page.locator("body")).toHaveAttribute("data-settled", "true")
    const after = await session.send("Performance.getMetrics")
    const stats = await page.evaluate(() => Reflect.get(window, "markdownLifetime"))
    // The frozen initial baseline used a byte label for this character count.
    stats.cacheChars ??= stats.cacheBytes
    delete stats.cacheBytes
    expect(stats.requests).toBe(1)
    expect(stats.responses).toBe(1)
    expect(stats.ready).toBeGreaterThan(stats.released)
    expect(stats.settled).toBeGreaterThan(stats.released)
    expect(errors).toEqual([])
    if (scenario === "leave") {
      await expect(page.locator("#survivor")).toHaveCount(0)
      await expect(page.getByRole("heading", { name: "Current destination" })).toBeVisible()
      if (process.env.MARKDOWN_ASSERT_DISPOSAL === "1") expect(stats.cacheChars).toBe(0)
    } else {
      await expect(page.locator("#survivor pre code")).toHaveCount(stats.fences)
      await expect(page.locator("#survivor")).toContainText("Review complete.")
      expect(stats.cacheChars).toBeGreaterThan(0)
      if (scenario === "shared") await expect(page.locator("#departing")).toHaveCount(0)
    }
    const value = (data: typeof after, name: string) => data.metrics.find((item) => item.name === name)!.value
    const retained = process.env.MARKDOWN_RETAINED === "1"
    if (retained) await session.send("HeapProfiler.collectGarbage")
    const heap = await session.send("Runtime.getHeapUsage")
    report(
      {
        ...stats,
        readyMs: stats.ready - stats.released,
        settledMs: stats.settled - stats.released,
        taskMs: (value(after, "TaskDuration") - value(before, "TaskDuration")) * 1000,
        scriptMs: (value(after, "ScriptDuration") - value(before, "ScriptDuration")) * 1000,
        usedHeapBytes: heap.usedSize,
      },
      { scenario, retained, build: process.env.MARKDOWN_BUILD_DIR, revision: process.env.MARKDOWN_REVISION },
    )
    if (process.env.MARKDOWN_SCREENSHOT)
      await page.screenshot({ path: `${process.env.MARKDOWN_SCREENSHOT}/${scenario}.png` })
    await session.detach()
  })
}
