// A long session at normal speed: scroll its history, type in the composer, stream a reply.
// Run with strobe: `strobe bench packages/app/perf/timeline.bench.ts --base <ref> --head <dir>`.
import { bench, web } from "@strobe/bench"
import {
  buildInitialStreamEvent,
  buildStreamDeltaEvents,
  mockTimelineSession,
  textPartID,
} from "../e2e/performance/timeline/session-timeline-benchmark.fixture"

const timeline = ".scroll-view__viewport:has([data-timeline-row])"
const composer = '[data-component="composer-editor"]'
const reply = `[data-timeline-part-id="${textPartID}"]`
const deltas = 40

export default bench({
  targets: {
    web: web({
      viewport: { width: 1366, height: 768 },
      prepare: ({ playwright, url }) =>
        mockTimelineSession(playwright.page, { historyTurns: 120, eventBatch: 1, server: new URL(url).origin }),
      url: ({ prepared }) => prepared.path,
    }),
  },

  async setup({ page }) {
    await page.waitFor(timeline, { timeout: 60_000 })
    await page.waitFor(composer)
    await page.idle()
  },

  cases: {
    "scroll history": {
      primary: "main.busy",
      async run({ page, phase }) {
        await phase("up", () => page.scroll(timeline, { by: -4000, speed: 3000 }))
        await phase("down", () => page.scroll(timeline, { by: 4000, speed: 3000 }))
      },
      reset: ({ page }) => page.idle(),
    },

    "type in composer": {
      primary: "interaction.p95",
      run: ({ page }) => page.type(composer, "Refactor the timeline so rows mount lazily", { delay: 80 }),
      async reset({ page }) {
        await page.press("ControlOrMeta+a")
        await page.press("Backspace")
        await page.idle()
      },
    },

    "stream a reply": {
      primary: "main.busy",
      async run({ page, prepared }) {
        prepared.transport.enqueue([...buildInitialStreamEvent(deltas), ...buildStreamDeltaEvents(deltas)])
        await page.waitFor(reply, { text: "benchmark-complete", timeout: 60_000 })
      },
      async reset({ page, prepared }) {
        await page.goto(prepared.path, { until: timeline, timeout: 60_000 })
        await page.idle()
      },
    },
  },
})
