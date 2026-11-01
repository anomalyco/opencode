// One long diff in the review pane: `src/routes.ts` as a full-context patch of 1,559 lines (60 KB), highlighted in a
// worker, or 15,599 lines (603 KB), past the size above which the viewer renders plain text. At 1366×768.
import { bench, web, type Case } from "@hona/strobe-bench"
import { reviewDiffs, routesDiff } from "./fixtures/diffs"
import { cached } from "./fixtures/mock"
import { openReview, review } from "./fixtures/review"
import { mockTimelineSession, serveDiffs, timeline } from "./fixtures/timeline"

// The pane opening on the diff, in a fresh document each run.
const open: Case<{}> = {
  primary: "main.work",
  metrics: ["run.duration"],
  async run({ page }) {
    await page.press(review.shortcut, { until: review.line, timeout: 60_000 })
    await page.idle()
  },
  async reset({ page, prepared }) {
    await page.goto(prepared.path, { until: timeline, timeout: 60_000 })
    await page.idle()
  },
}

export default bench({
  targets: {
    web: web({
      viewport: { width: 1366, height: 768 },
      async prepare({ case: name, playwright, mock, url }) {
        const page = cached(playwright.page, mock)
        const session = await mockTimelineSession(page, { server: new URL(url).origin, historyTurns: 0 })
        await serveDiffs(page, changes(name))

        return session
      },
      url: ({ prepared }) => prepared.path,
    }),
  },

  async setup({ case: name, page }) {
    await page.waitFor(timeline, { timeout: 60_000 })

    // The long diff rendered once, then the pane moved to another file.
    if (name === "return to a long diff") {
      await openReview(page)
      await page.click(review.next)
      await page.waitFor(review.file, { text: "routes.ts" })
      await page.waitFor(review.line)
      await page.click(review.previous)
      await page.waitFor(review.file, { text: "generated-000.ts" })
    }

    await page.idle()
  },

  cases: {
    "open a long diff": open,
    "open a huge diff": open,

    // Back to a diff the viewer highlighted before: the worker's cache should answer.
    "return to a long diff": {
      primary: "main.work",
      metrics: ["run.duration"],
      async run({ page }) {
        await page.click(review.next)
        await page.waitFor(review.file, { text: "routes.ts" })
        await page.waitFor(review.line)
        await page.idle()
      },
      async reset({ page }) {
        await page.click(review.previous)
        await page.waitFor(review.file, { text: "generated-000.ts" })
        await page.idle()
      },
    },
  },
})

/** The workspace's changes for a case: the huge diff alone, a small file before the long one, or the long one alone. */
function changes(name: string) {
  if (name === "open a huge diff") return [routesDiff(1_200)]

  if (name === "return to a long diff") return [reviewDiffs(1)[0], routesDiff(120)]

  return [routesDiff(120)]
}
