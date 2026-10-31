// Home with a large session index: 500, 5,000 or 10,000 root sessions across 12 folders, at 1440×900. Home always shows
// the newest 64, so what grows with the index is the work of handling it, not what is on screen.
import { bench, web } from "@strobe/bench"
import { eventSource } from "./fixtures/events"
import { mockHome } from "./fixtures/home"

const row = (sessionID: string) =>
  `[data-component="home-session-row-container"][data-session-id="${sessionID}"] [data-component="home-session-row"]`

const title = (sessionID: string) =>
  `[data-component="home-session-row-container"][data-session-id="${sessionID}"] [data-component="home-session-title"]`

export default bench({
  params: { sessions: [500, 5_000, 10_000] },

  targets: {
    web: web({
      viewport: { width: 1440, height: 900 },
      async prepare({ params, playwright, url }) {
        const server = new URL(url).origin
        const source = await eventSource(playwright.page, server)
        const home = await mockHome(playwright.page, { server, count: params.sessions })

        return { home, source, updates: 0 }
      },
    }),
  },

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
