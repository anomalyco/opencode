// A reply streaming into a long session: 160 markdown deltas (bold text, tables, code fences) at 40 a second, from a
// server that never waits for the renderer. Per-delta cost that grows with the reply or the history shows up here.
import { bench, web, type Case } from "@strobe/bench"
import { reviewDiffs } from "./fixtures/diffs"
import { openReview } from "./fixtures/review"
import { mockTimelineSession, reply, streamedReply, timeline } from "./fixtures/timeline"

const { start, deltas } = streamedReply(160)

const stream: Case<{}> = {
  primary: "main.work",
  metrics: ["frames.interval.p95", "frames.dropped.pct", "main.script", "main.layout", "main.style"],
  async run({ page, prepared }) {
    prepared.source.send(start)
    await Promise.all([
      prepared.source.stream(deltas, 25),
      page.waitFor(reply, { text: "benchmark-complete", timeout: 60_000 }),
    ])
  },
  // A fresh document without the streamed reply.
  async reset({ case: name, page, prepared }) {
    await page.goto(prepared.path, { until: timeline, timeout: 60_000 })

    if (name === "stream with review open") await openReview(page)
    await page.idle()
  },
}

export default bench({
  targets: {
    web: web({
      viewport: { width: 1366, height: 768 },
      prepare: ({ case: name, playwright, url }) =>
        mockTimelineSession(playwright.page, {
          server: new URL(url).origin,
          historyTurns: name === "stream into a tool-heavy history" ? 320 : 120,
          toolHeavy: name === "stream into a tool-heavy history",
          busy: true,
          stream: true,
          vcsDiff: name === "stream with review open" ? reviewDiffs() : undefined,
        }),
      url: ({ prepared }) => prepared.path,
    }),
  },

  async setup({ case: name, page }) {
    await page.waitFor(timeline, { timeout: 60_000 })

    if (name === "stream with review open") await openReview(page)
    await page.idle()
  },

  cases: {
    // 120 turns: 242 messages, 248 KB of history.
    "stream a reply": stream,
    // 320 turns with six file reads in every answer: 2,392 parts, 2.6 MB of history.
    "stream into a tool-heavy history": stream,
    // The review pane open beside the timeline on 72 changed files.
    "stream with review open": stream,
  },
})
