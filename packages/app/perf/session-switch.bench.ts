// Switch between two open session tabs of 200 long markdown exchanges each, with warm caches.
import { bench, web } from "@strobe/bench"
import { sessionHref } from "../e2e/utils/app"
import { expected, messages } from "../e2e/utils/markdown-sessions"
import { mockOpenCodeServer } from "../e2e/utils/mock-server"
import { fixture, installStressSessionTabs, installTimelineSettings } from "../e2e/utils/session-fixture"

// The last answer, fully formatted: what a person waits for after clicking a tab.
const ready = (sessionID: string) =>
  `[data-timeline-part-id="${expected[sessionID].answerID}"] [data-component="markdown"][data-markdown-ready]`

export default bench({
  targets: {
    web: web({
      viewport: { width: 1440, height: 900 },
      async prepare({ playwright, url }) {
        const server = new URL(url).origin
        await mockOpenCodeServer(playwright.page, {
          server,
          sessions: fixture.sessions,
          provider: fixture.provider,
          directory: fixture.directory,
          project: fixture.project,
          pageMessages: (sessionID) => ({ items: messages[sessionID] ?? [] }),
        })
        await installTimelineSettings(playwright.page)
        await installStressSessionTabs(playwright.page, { server })
        return {
          source: sessionHref(fixture.sourceID, server),
          target: sessionHref(fixture.targetID, server),
        }
      },
      url: ({ prepared }) => prepared.source,
    }),
  },

  async setup({ page }) {
    await page.waitFor(ready(fixture.sourceID), { timeout: 60_000 })
    await page.idle()
  },

  cases: {
    "switch tab": {
      // Click to formatted answer lands on whole frames (about 40 or 47 ms at 165 Hz), so its duration is too coarse
      // to decide on; the main-thread work the switch costs is continuous.
      primary: "main.work",
      metrics: ["run.duration", "interaction.p50"],
      run: ({ page, prepared }) =>
        page.click(`[data-slot="titlebar-tabs"] a[href="${prepared.target}"]`, { until: ready(fixture.targetID) }),
      async reset({ page, prepared }) {
        await page.click(`[data-slot="titlebar-tabs"] a[href="${prepared.source}"]`, { until: ready(fixture.sourceID) })
        await page.idle()
      },
    },
  },
})
