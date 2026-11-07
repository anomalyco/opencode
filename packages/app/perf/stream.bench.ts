// A reply streaming into a long session: 160 markdown deltas (bold text, tables, code fences) at 40 a second, from a
// server that never waits for the renderer. Per-delta cost that grows with the reply or the history shows up here.
import { bench, web, type Case, type Page } from "@hona/strobe"
import { reviewDiffs } from "./fixtures/diffs"
import { cached } from "./fixtures/mock"
import { openReview } from "./fixtures/review"
import { mockTimelineSession, reply, streamedReply, timeline } from "./fixtures/timeline"

const { start, deltas } = streamedReply(160)

const withFind = "stream with Find open"

const find = '[data-component="timeline-search-bar"] input'

// A phrase only the reply's last delta holds, so Find stays on the reply while every delta rescans the transcript.
// One input event: typed key by key, its prefixes would match the history and seek the timeline away from the reply.
async function openFind(page: Page) {
  await page.press("ControlOrMeta+f", { until: find })
  await page.eval(() => {
    const input = document.querySelector<HTMLInputElement>('[data-component="timeline-search-bar"] input')!
    input.value = "benchmark-complete"
    input.dispatchEvent(new InputEvent("input", { bubbles: true }))
  })
  await page.waitFor('[data-slot="timeline-search-count"]', { text: "0/0" })
}

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

    if (name === withFind) await openFind(page)
    await page.idle()
  },
}

export default bench({
  targets: {
    web: web({
      expect: { title: "OpenCode" },
      viewport: { width: 1366, height: 768 },
      prepare: (ctx) =>
        mockTimelineSession(cached(ctx), {
          server: new URL(ctx.url).origin,
          historyTurns: ctx.case === "stream into a tool-heavy history" ? 320 : 120,
          toolHeavy: ctx.case === "stream into a tool-heavy history",
          busy: true,
          stream: true,
          vcsDiff: ctx.case === "stream with review open" ? reviewDiffs() : undefined,
        }),
      url: ({ prepared }) => prepared.path,
    }),
  },

  async setup({ case: name, page }) {
    await page.waitFor(timeline, { timeout: 60_000 })

    if (name === "stream with review open") await openReview(page)

    if (name === withFind) await openFind(page)

    // Its animations never stop, and with the attribution probes on a slow machine their frames can run long enough
    // that the page never counts as idle.
    if (name === "wait on a running session") return page.wait(2000)
    await page.idle()
  },

  teardown: ({ prepared }) => prepared.source?.stop(),

  cases: {
    // 120 turns: 242 messages, 248 KB of history.
    "stream a reply": stream,
    // 320 turns with six file reads in every answer: 2,392 parts, 2.6 MB of history.
    "stream into a tool-heavy history": stream,
    // The review pane open beside the timeline on 72 changed files.
    "stream with review open": stream,
    // Find open on a phrase that only the last delta holds: each delta rescans the 120-turn transcript for it.
    [withFind]: stream,
    // Five seconds of a running session between deltas: the tab's spinner and the Working shimmer animate, and nothing
    // else changes. Animation the compositor runs costs the page's main thread nothing.
    "wait on a running session": {
      primary: "main.work",
      metrics: ["main.style", "cpu.renderer", "cpu.gpu", "frames.presented.count"],
      run: ({ page }) => page.wait(5000),
    },
  },
})
