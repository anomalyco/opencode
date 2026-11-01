// Home with a large session index: 500 to 20,000 root sessions across 12 folders, at 1440×900. Home always shows
// the newest 64, so what grows with the index is the work of handling it, not what is on screen.
import { bench, web } from "@hona/strobe-bench"
import { eventSource } from "./fixtures/events"
import { mockHome } from "./fixtures/home"
import { cached } from "./fixtures/mock"

const row = (sessionID: string) =>
  `[data-component="home-session-row-container"][data-session-id="${sessionID}"] [data-component="home-session-row"]`

const title = (sessionID: string) =>
  `[data-component="home-session-row-container"][data-session-id="${sessionID}"] [data-component="home-session-title"]`

export default bench({
  // 500 and 10,000 by default; `--params all` adds the rest of the curve.
  params: { sessions: { run: [500, 10_000], more: [1_000, 5_000, 20_000] } },

  targets: {
    web: web({
      viewport: { width: 1440, height: 900 },
      async prepare({ params, playwright, mock, url }) {
        const server = new URL(url).origin
        const page = cached(playwright.page, mock)
        const source = await eventSource(page, server)
        const home = await mockHome(page, { server, count: params.sessions })

        return { home, source, updates: 0 }
      },
    }),
  },

  teardown: ({ prepared }) => prepared.source.stop(),

  async setup({ page, prepared }) {
    await page.waitFor(row(prepared.home.lastShown.id), { timeout: 60_000 })
    await page.idle()
  },

  cases: {
    // To the 64th row on screen: once the last row Home shows is there, every row is.
    "load home": {
      primary: "main.work",
      metrics: ["run.duration"],
      run: ({ page, prepared }) => page.goto("/", { until: row(prepared.home.lastShown.id), timeout: 60_000 }),
    },

    // 20 runs finishing in the newest session: each bumps its title and time on the server and tells the app,
    // which reads the session again and merges it into the index.
    "update a session in the background": {
      primary: "main.work",
      async run({ page, prepared }) {
        const session = prepared.home.newest

        for (let index = 0; index < 20; index++) {
          prepared.updates++
          session.title = `Background update ${prepared.updates}`
          session.time.updated += 1_000
          session.time.idle = session.time.updated
          prepared.source.send([
            {
              id: `evt_perf_home_${prepared.updates}`,
              created: Date.now(),
              type: "session.execution.succeeded",
              data: { sessionID: session.id },
            },
          ])
          await page.waitFor(title(session.id), { text: session.title })
        }
      },
    },
  },
})
