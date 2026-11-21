// The review pane on a large change: 1 to 10,000 changed files of 100 changed lines each (4 KB to 40 MB of patches),
// 100 files to a folder, at 1366×768.
import { bench, web } from "@hona/strobe"
import { scalingDiffs, scalingRows } from "./fixtures/diffs"
import { cached } from "./fixtures/mock"
import { openReview, review } from "./fixtures/review"
import { keepStartStorage, saveStartStorage } from "./fixtures/storage"
import { mockTimelineSession, serveDiffs, timeline } from "./fixtures/timeline"

export default bench({
  // 100 and 10,000 by default; `--params all` adds the rest of the curve.
  params: { files: { run: [100, 10_000], more: [1, 10, 1_000] } },

  // Whether setup opens the pane: cases that start with it open share a launch.
  setupKey: (ctx) => (ctx.case === "open review" ? "closed" : "open"),

  targets: {
    web: web({
      expect: { title: "OpenCode" },
      viewport: { width: 1366, height: 768 },
      async prepare(ctx) {
        const { params, url } = ctx
        const page = cached(ctx)
        await keepStartStorage(page)
        const session = await mockTimelineSession(page, { server: new URL(url).origin, historyTurns: 0 })
        // The app asks for the changes only when the pane opens.
        await serveDiffs(page, scalingDiffs(params.files))

        return session
      },
      url: ({ prepared }) => prepared.path,
    }),
  },

  async setup({ setupKey, page }) {
    await page.waitFor(timeline, { timeout: 60_000 })

    if (setupKey === "open") await openReview(page)
    await page.idle()
    // A reload keeps the review open (the app saves its layout on pagehide), so every run starts from this storage.
    await saveStartStorage(page)
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

    // Closing the side panel and opening it again, each flight until it lands: every frame of the edge panel's motion.
    "close and reopen review": {
      primary: "main.work",
      metrics: ["run.duration", "frames.dropped.pct"],
      async run({ page }) {
        await page.click(review.toggle)
        await page.idle()
        await page.click(review.toggle, { until: review.file })
        await page.idle()
      },
      async reset({ page }) {
        await openReview(page)
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
