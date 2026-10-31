// A long assistant reply streaming into a 120-turn session: 240 markdown deltas (tables, code fences, bold) at 80 per
// second. Per-delta markdown cost that grows with the reply shows up here, not in a short reply.
import { bench, web } from "@strobe/bench"
import {
  buildInitialStreamEvent,
  buildStreamDeltaEvents,
  mockTimelineSession,
  textPartID,
} from "../e2e/performance/timeline/session-timeline-benchmark.fixture"

const timeline = ".scroll-view__viewport:has([data-timeline-row])"
const reply = `[data-timeline-part-id="${textPartID}"]`
const deltas = 240

export default bench({
  targets: {
    web: web({
      viewport: { width: 1366, height: 768 },
      prepare: ({ playwright, url }) =>
        mockTimelineSession(playwright.page, { historyTurns: 120, eventBatch: 4, server: new URL(url).origin }),
      url: ({ prepared }) => prepared.path,
    }),
  },

  async setup({ page }) {
    await page.waitFor(timeline, { timeout: 60_000 })
    await page.idle()
  },

  cases: {
    "stream a long reply": {
      primary: "main.work",
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
