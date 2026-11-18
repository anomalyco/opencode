// How long a prompt takes to leave the window: from Enter until its request reaches the server, in a 20-turn session.
// Nothing here waits on a server, so the time is the composer's own: its submit machine, what the plugins prepare for
// the session's next step, the selection's commit and the request it builds. At 1366x768.
import { bench, web } from "@hona/strobe"
import { cached } from "./fixtures/mock"
import { composer, mockTimelineSession, timeline } from "./fixtures/timeline"

// The runs waiting for their request to reach the server: one at a time.
const waiting: (() => void)[] = []

const arrived = () => new Promise<void>((resolve) => void waiting.push(resolve))

export default bench({
  targets: {
    web: web({
      expect: { title: "OpenCode" },
      viewport: { width: 1366, height: 768 },
      prepare: (ctx) =>
        mockTimelineSession(cached(ctx), {
          server: new URL(ctx.url).origin,
          historyTurns: 20,
          onPrompt: () => waiting.splice(0).forEach((resolve) => resolve()),
        }),
      url: ({ prepared }) => prepared.path,
    }),
  },

  async setup({ page }) {
    await page.waitFor(timeline, { timeout: 60_000 })
    await page.waitFor(composer)
    await page.click(composer)
    await page.idle()
  },

  cases: {
    // Typing is not the send: the phase runs from the Enter key to the request's arrival. Each run adds one prompt to
    // the session, as a person's next message does.
    "send a prompt": {
      primary: "phase.send",
      metrics: ["main.work", "net.requests{/api/session/*/prompt}"],
      resetCheck: false,
      async run({ page, phase }) {
        await page.type(composer, "Tighten the error message.", { burst: true })
        const request = arrived()

        await phase("send", async () => {
          await page.press("Enter")
          await request
        })
        await page.idle()
      },
    },
  },
})
