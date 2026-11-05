// The composer giving way to request docks and back, under a 20-turn session: a permission request morphs the
// composer into its dock, an MCP elicitation grows in above it and closes, and the answered permission morphs back
// to the composer. Every frame of the four flights steps the docks' springs and writes their styles.
import { bench, web } from "@hona/strobe"
import { cached } from "./fixtures/mock"
import { composer, mockTimelineSession, requestDocks, timeline } from "./fixtures/timeline"

const permission = '[data-component="dock-prompt"][data-kind="permission"]'

// The elicitation dock shares the question dock's frame.
const elicitation = '[data-component="dock-prompt"][data-kind="question"]'

export default bench({
  targets: {
    web: web({
      expect: { title: "OpenCode" },
      viewport: { width: 1366, height: 768 },
      prepare: ({ playwright, mock, url }) =>
        mockTimelineSession(cached(playwright.page, mock), {
          server: new URL(url).origin,
          historyTurns: 20,
          stream: true,
        }),
      url: ({ prepared }) => prepared.path,
    }),
  },

  async setup({ page }) {
    await page.waitFor(timeline, { timeout: 60_000 })
    await page.waitFor(composer)
    await page.idle()
  },

  teardown: ({ prepared }) => prepared.source?.stop(),

  cases: {
    // Each step waits for the page to settle, so the run spans every frame of all four flights.
    "open and close request docks": {
      primary: "main.work",
      metrics: ["main.script", "main.style", "main.layout", "frames.dropped.pct", "frames.interval.p95"],
      async run({ page, prepared }) {
        const round = requestDocks()
        prepared.source!.send([round.asked])
        await page.waitFor(permission)
        await page.idle()
        prepared.source!.send([round.elicited])
        await page.waitFor(elicitation)
        await page.idle()
        prepared.source!.send([round.cancelled])
        await page.idle()
        prepared.source!.send([round.replied])
        await page.waitFor(composer)
        await page.idle()
      },
    },
  },
})
