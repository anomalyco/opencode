// The review pane on a large change: 100 or 10,000 changed files of 100 changed lines each (400 KB or 40 MB of
// patches), 100 files to a folder, at 1366×768.
import { bench, web } from "@strobe/bench"
import { scalingDiffs, scalingRows } from "./fixtures/diffs"
import { openReview, review } from "./fixtures/review"
import { mockTimelineSession, serveDiffs, timeline } from "./fixtures/timeline"

export default bench({
  params: { files: [100, 10_000] },

  targets: {
    web: web({
      viewport: { width: 1366, height: 768 },
      async prepare({ params, playwright, url }) {
        const session = await mockTimelineSession(playwright.page, { server: new URL(url).origin, historyTurns: 0 })
        // The app asks for the changes only when the pane opens.
        await serveDiffs(playwright.page, scalingDiffs(params.files))

        return session
      },
      url: ({ prepared }) => prepared.path,
    }),
  },

  async setup({ case: name, page }) {
    await page.waitFor(timeline, { timeout: 60_000 })

    if (name !== "open review") await openReview(page)
    await page.idle()
  },

  cases: {
    // To the whole tree and the first file's diff on screen.
    "open review": {
      primary: "main.work",
      metrics: ["run.duration", "frames.interval.max"],
      async run({ page, params }) {
        await page.press(review.shortcut, { until: review.tree(scalingRows(params.files)), timeout: 120_000 })
        await page.waitFor(review.file, { text: "file-00000.ts" })
        await page.waitFor(review.line)
        await page.idle()
      },
      async reset({ page, prepared }) {
        await page.goto(prepared.path, { until: timeline, timeout: 60_000 })
        await page.idle()
      },
    },

    // Typing a file name into the filter until one file is left.
    "filter files": {
      primary: "main.work",
      metrics: ["interaction.p95"],
      run: ({ page }) => page.type(review.filter, "file-00042", { delay: 50, until: review.tree(1) }),
      async reset({ page, params }) {
        await page.press("ControlOrMeta+a")
        await page.press("Backspace", { until: review.tree(scalingRows(params.files)) })
        await page.idle()
      },
    },

    // Three files ahead, each to its diff on screen.
    "next file": {
      primary: "main.work",
      metrics: ["interaction.p95"],
      async run({ page }) {
        for (const file of ["file-00001.ts", "file-00002.ts", "file-00003.ts"]) {
          await page.click(review.next)
          await page.waitFor(review.file, { text: file })
          await page.waitFor(review.line)
        }

        await page.idle()
      },
      async reset({ page }) {
        for (let step = 0; step < 3; step++) await page.click(review.previous)
        await page.waitFor(review.file, { text: "file-00000.ts" })
        await page.idle()
      },
    },
  },
})
