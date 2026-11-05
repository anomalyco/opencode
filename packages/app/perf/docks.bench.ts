// The composer giving way to request docks and back, under a 20-turn session: a permission request morphs the
// composer into its dock, an MCP elicitation grows in above it and closes, and the answered permission morphs back
// to the composer. Every frame of the four flights steps the docks' springs and writes their styles.
import { bench, web } from "@hona/strobe"
import type { OpenCodeEvent } from "@opencode/client/promise"
import { cached } from "./fixtures/mock"
import { composer, mockTimelineSession, timeline } from "./fixtures/timeline"

// The session `mockTimelineSession` serves.
const sessionID = "ses_timeline_state_regression"

const location = { directory: "C:/OpenCode/TimelineStateRegression" }

const permission = '[data-component="dock-prompt"][data-kind="permission"]'

// The elicitation dock shares the question dock's frame.
const elicitation = '[data-component="dock-prompt"][data-kind="question"]'

let round = 0

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
        const events = requestDocks()
        prepared.source!.send([events.asked])
        await page.waitFor(permission)
        await page.idle()
        prepared.source!.send([events.elicited])
        await page.waitFor(elicitation)
        await page.idle()
        prepared.source!.send([events.cancelled])
        await page.idle()
        prepared.source!.send([events.replied])
        await page.waitFor(composer)
        await page.idle()
      },
    },
  },
})

// One round of request docks, with fresh IDs so the client never takes an event for a repeat.
function requestDocks() {
  round++
  const permission = `per_docks_bench_${round}`
  const form = `frm_docks_bench_${round}`
  const envelope = (step: number) => ({
    id: `evt_docks_bench_${round}_${step}`,
    created: 1700000003000 + round,
    location,
  })

  return {
    asked: {
      ...envelope(0),
      type: "permission.asked",
      data: { id: permission, sessionID, action: "shell", resources: ["bun test"], metadata: {} },
    } satisfies Extract<OpenCodeEvent, { type: "permission.asked" }>,
    elicited: {
      ...envelope(1),
      type: "form.created",
      data: {
        form: {
          id: form,
          sessionID,
          title: "Input",
          metadata: { kind: "mcp-elicitation" },
          fields: [{ key: "answer", type: "string", title: "Continue?" }],
        },
      },
    } satisfies Extract<OpenCodeEvent, { type: "form.created" }>,
    cancelled: {
      ...envelope(2),
      type: "form.cancelled",
      data: { sessionID, id: form },
    } satisfies Extract<OpenCodeEvent, { type: "form.cancelled" }>,
    replied: {
      ...envelope(3),
      type: "permission.replied",
      data: { sessionID, requestID: permission, reply: "once" },
    } satisfies Extract<OpenCodeEvent, { type: "permission.replied" }>,
  }
}
