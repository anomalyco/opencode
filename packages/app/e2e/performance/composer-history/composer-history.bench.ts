import { benchmark, expect } from "../benchmark"

benchmark.use({ traceScope: "page" })
for (const shape of ["text", "unique", "repeated"]) {
  benchmark(`composer global history: ${shape}, cold and warm mounts`, async ({ page, report }, testInfo) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.goto(`/?shape=${shape}`)
    const button = page.getByRole("button", { name: "Mount empty composer", exact: true })
    const input = page.getByRole("textbox", { name: "Prompt", exact: true })
    const samples = []
    for (const cache of ["cold", "warm"]) {
      await expect(button).toBeEnabled()
      const mountStarted = performance.now()
      await button.click()
      await expect(page.getByTestId("history-ready")).toHaveText("ready")
      await expect(input).toBeEditable()
      await expect(input).toBeEmpty()
      const result = JSON.parse((await page.getByTestId("history-result").textContent())!)
      expect(result.documents).toBe(2)
      expect(result.historyReadyMs).toBeGreaterThan(0)
      const start = performance.now()
      await input.press("ArrowUp")
      await expect(input).toContainText("Review the retry policy in src/network/request-0.ts.")
      const images = page.getByRole("img", { name: "request-0.png", exact: true })
      await expect(images).toHaveCount(shape === "text" ? 0 : 1)
      if (shape !== "text")
        await expect
          .poll(() => images.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 1440))
          .toBe(true)
      samples.push({
        cache,
        ...result,
        recallObservedMs: performance.now() - start,
        mountRecallObservedMs: performance.now() - mountStarted,
      })
    }
    expect(errors).toEqual([])
    report(
      { samples },
      {
        browser: page.context().browser()!.version(),
        scope: "production composer editor/history, browser IndexedDB; no native IPC",
      },
    )
    if (testInfo.repeatEachIndex === 0) await page.screenshot({ path: testInfo.outputPath(`${shape}.png`) })
  })
}
