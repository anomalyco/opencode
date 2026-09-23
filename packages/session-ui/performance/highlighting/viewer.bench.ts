import { benchmark, expect } from "../../../app/e2e/performance/benchmark"
import { readFile } from "node:fs/promises"
import path from "node:path"
import type {} from "./viewer"

for (const large of [false, true]) {
  benchmark(large ? "large file" : "normalized diff remount", async ({ page, browser, report }, info) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.goto(large ? "/?large" : "/")
    await page.waitForFunction(() => !!window.highlighting)
    const cold = await page.evaluate(() => window.highlighting.mount(1))
    await expect(page.locator('[data-line="11"][data-line-type="change-addition"]')).toContainText("status: 201")
    await page.evaluate(() => window.highlighting.unmount())
    const remount = await page.evaluate(() => window.highlighting.mount(1))
    await page.evaluate(() => window.highlighting.unmount())
    const changed = await page.evaluate(() => window.highlighting.mount(2))
    await expect(page.locator('[data-line="11"][data-line-type="change-addition"]')).toContainText("status: 202")
    const complete = await page.evaluate(() => {
      const contents = window.highlighting.contents()!
      return contents.before === window.highlighting.input.before && contents.after === window.highlighting.input.after[1]
    })
    expect(complete).toBe(true)
    expect(errors).toEqual([])
    const retention = await (async () => {
      if (!process.env.HIGHLIGHT_RETENTION) return
      await page.evaluate(() => window.highlighting.unmount())
      const session = await page.context().newCDPSession(page)
      await session.send("HeapProfiler.collectGarbage")
      const heap = await session.send("Runtime.getHeapUsage")
      await session.detach()
      return heap
    })()
    report({ cold, remount, changed, retention }, {
      browser: browser.version(),
      dimensions: await page.evaluate(() => window.highlighting.dimensions),
      build: JSON.parse(await readFile(path.join(process.env.HIGHLIGHT_BUNDLE!, "build.json"), "utf8")),
    })
    if (process.env.HIGHLIGHT_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.HIGHLIGHT_SCREENSHOTS, `${large ? "large" : "diff"}-${info.repeatEachIndex}.png`) })
  })
}
