import { test, expect } from "@playwright/test"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"

type Metrics = { active: boolean; frames: number[]; tasks: number[]; events: number[] }

declare global {
  interface Window {
    imageMetrics: Metrics
  }
}

for (const size of ["small", "large"]) {
  test(`paste ${size} images and keep typing`, async ({ page }, info) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.goto("/")
    const input = page.getByRole("textbox", { name: "Prompt", exact: true })
    await expect(input).toBeEditable()
    await page.evaluate(() => document.fonts.ready)
    await input.focus()
    await page.evaluate(() => {
      const metrics: Metrics = { frames: [], tasks: [], events: [], active: true }
      Object.assign(window, { imageMetrics: metrics })
      new PerformanceObserver((list) =>
        list.getEntries().forEach((entry) => metrics.tasks.push(entry.duration)),
      ).observe({ type: "longtask" })
      const eventOptions = { type: "event", durationThreshold: 16 }
      new PerformanceObserver((list) =>
        list.getEntries().forEach((entry) => metrics.events.push(entry.duration)),
      ).observe(eventOptions)
      let previous = performance.now()

      const frame = (now: number) => {
        metrics.frames.push(now - previous)
        previous = now

        if (metrics.active) requestAnimationFrame(frame)
      }

      requestAnimationFrame(frame)
    })
    const directory = process.env.OPENCODE_IMAGE_FIXTURES!

    const files = (size === "small" ? ["small.jpg"] : ["large.jpg", "medium.jpg", "medium2.jpg"]).map((name) =>
      join(directory, name),
    )

    const start = performance.now()
    await page.getByLabel("Clipboard fixtures").setInputFiles(files)
    const text = "Checking labels and dimensions while the original artwork remains attached. ".repeat(3)
    await input.pressSequentially(text, { delay: 12 })
    await expect(input).toHaveText(text.trimEnd())
    await expect(page.getByTestId("attachment-count")).toHaveText(String(files.length))
    const elapsed = performance.now() - start

    const result = await page.evaluate(() => {
      const metrics = window.imageMetrics
      metrics.active = false

      return {
        ...metrics,
        images: Array.from(
          document.querySelectorAll<HTMLImageElement>('[data-component="composer-attachments"] img'),
        ).map((image) => ({ width: image.naturalWidth, height: image.naturalHeight })),
      }
    })

    const sorted = result.frames.toSorted((a, b) => a - b)

    const report = {
      size,
      browser: page.context().browser()!.version(),
      elapsedMs: elapsed,
      characters: text.length,
      frameP95: sorted[Math.floor(sorted.length * 0.95)],
      frameMax: Math.max(...sorted),
      longTaskTotalMs: result.tasks.reduce((a, b) => a + b, 0),
      longTaskCount: result.tasks.length,
      eventMax: Math.max(0, ...result.events),
      errors,
      ...result,
    }

    await writeFile(info.outputPath("metrics.json"), JSON.stringify(report, null, 2))
    await page.screenshot({ path: info.outputPath("composer.png") })
    console.log(JSON.stringify({ ...report, frames: undefined, events: undefined }))
    await page.getByRole("button", { name: "Remove all images", exact: true }).click()
    await expect(page.getByTestId("attachment-count")).toHaveText("0")
    await input.pressSequentially(" Still editable.")
    await expect(input).toContainText("Still editable.")
    expect(errors).toEqual([])
  })
}
