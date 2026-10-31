// Switching between two open session tabs of 200 long markdown exchanges each (headings, tables, task lists and four
// highlighted code fences per answer), loaded in full, at 1440×900.
//
// Set OPENCODE_PERF_SESSION to a session export (`opencode export <id>`) to add two cases on your own session.
import { readFileSync } from "node:fs"
import type { SessionMessageInfo } from "@opencode/client/promise"
import type { Page } from "@playwright/test"
import { bench, web, type Case } from "@strobe/bench"
import { pageMessagesFrom, sessionHref } from "../e2e/utils/app"
import { expected, messages } from "../e2e/utils/markdown-sessions"
import { mockOpenCodeServer, type MockSession } from "../e2e/utils/mock-server"
import { fixture, installTimelineSettings } from "../e2e/utils/session-fixture"
import { reviewDiffs } from "./fixtures/diffs"
import { openReview, review } from "./fixtures/review"
import { installTabs } from "./fixtures/tabs"

// The last answer, formatted and on screen: what a person waits for after clicking a tab. A cold timeline stays
// hidden (`visibility: hidden`) until it has measured itself at the tail, and strobe waits for what is visible.
const ready = (answerID: string) =>
  `[data-timeline-part-id="${answerID}"] [data-component="markdown"][data-markdown-ready]`

const tab = (href: string) => `[data-slot="titlebar-tabs"] a[href="${href}"]`

const composer = '[data-component="composer-editor"]'

type SessionExport = {
  info: MockSession & { projectID: string; location: { directory: string } }
  messages: SessionMessageInfo[]
}

const exportFile = process.env.OPENCODE_PERF_SESSION

// SAFETY: `opencode export` writes this shape; a file that is not an export fails the first block's load.
const exported = exportFile ? (JSON.parse(readFileSync(exportFile, "utf8")) as SessionExport) : undefined

// The destination was rendered before and is cached: switching back and forth.
const warm: Case<{}> = {
  primary: "main.work",
  metrics: ["run.duration", "interaction.p50"],
  run: ({ page, prepared }) => page.click(tab(prepared.target), { until: prepared.targetReady }),
  async reset({ page, prepared }) {
    await page.click(tab(prepared.source), { until: prepared.sourceReady })
    await page.idle()
  },
}

// The destination was never rendered in this document: a fresh load before every switch.
const cold: Case<{}> = {
  ...warm,
  async reset({ case: name, page, prepared }) {
    await page.goto(prepared.source, { until: prepared.sourceReady, timeout: 60_000 })

    if (name.includes("review open")) await openReview(page)
    // Off the tab strip: a pointer resting on a tab for 100 ms prefetches its transcript, and the switch is no longer cold.
    await page.click(composer)
    await page.idle()
  },
}

const cases = {
  // Click to formatted answer lands on whole frames (about 40 or 47 ms at 165 Hz), too coarse to decide on; the
  // main-thread work a switch costs is continuous.
  "switch tab": warm,
  // The review pane open on 72 changed files beside both timelines.
  "switch tab with review open": warm,
  // The destination was laid out before the review pane narrowed the timeline, so it lays out again.
  "switch tab after review resized it": {
    ...warm,
    async reset({ page, prepared }) {
      await page.click(tab(prepared.source), { until: prepared.sourceReady })
      await page.click(review.toggle)
      await page.idle()
      await page.click(tab(prepared.target), { until: prepared.targetReady })
      await page.click(tab(prepared.source), { until: prepared.sourceReady })
      await openReview(page)
      await page.idle()
    },
  },
  "open an unvisited tab": cold,
  "open an unvisited tab with review open": cold,
  // 1,200 models in the catalog. With `--probes memory --repeat 10`: does memory grow from switch to switch?
  "switch tab with a large model catalog": warm,
}

export default bench({
  targets: {
    web: web({
      viewport: { width: 1440, height: 900 },
      async prepare({ case: name, playwright, url }) {
        const server = new URL(url).origin

        if (exported && name.endsWith("your session")) return mockExport(playwright.page, server, exported)
        await mockOpenCodeServer(playwright.page, {
          server,
          sessions: fixture.sessions,
          provider: name.includes("model catalog") ? catalog(1_200) : fixture.provider,
          directory: fixture.directory,
          project: fixture.project,
          vcsDiff: name.includes("review") ? reviewDiffs() : undefined,
          pageMessages: (sessionID) => ({ items: messages[sessionID] ?? [] }),
        })
        await installTimelineSettings(playwright.page)
        await installTabs(playwright.page, {
          server,
          directory: fixture.directory,
          sessions: [fixture.sourceID, fixture.targetID],
        })

        return {
          source: sessionHref(fixture.sourceID, server),
          target: sessionHref(fixture.targetID, server),
          sourceReady: ready(expected[fixture.sourceID].answerID),
          targetReady: ready(expected[fixture.targetID].answerID),
        }
      },
      url: ({ prepared }) => prepared.source,
    }),
  },

  async setup({ case: name, page, prepared }) {
    await page.waitFor(prepared.sourceReady, { timeout: 60_000 })

    if (name.includes("review open")) await openReview(page)

    if (!name.startsWith("open")) {
      await page.click(tab(prepared.target), { until: prepared.targetReady, timeout: 60_000 })
      await page.click(tab(prepared.source), { until: prepared.sourceReady })
    }

    if (name.includes("resized")) await openReview(page)
    await page.idle()
  },

  cases: exported ? { ...cases, "open your session": cold, "switch to your session": warm } : cases,
})

function catalog(models: number) {
  const provider = fixture.provider.all[0]

  return {
    ...fixture.provider,
    all: [
      {
        ...provider,
        models: {
          ...provider.models,
          ...Object.fromEntries(
            Array.from({ length: models - 1 }, (_, index) => [
              `catalog-model-${index}`,
              {
                id: `catalog-model-${index}`,
                name: `Catalog model ${index}`,
                cost: { input: 1, output: 2 },
                limit: { context: 200_000, output: 8192 },
                variants: { high: { reasoningEffort: "high" } },
              },
            ]),
          ),
        },
      },
    ],
  }
}

// The export beside a one-message source session, paginated as the server does.
async function mockExport(page: Page, server: string, session: NonNullable<typeof exported>) {
  const directory = session.info.location.directory
  const source = { ...session.info, id: "ses_perf_source", title: "Benchmark source" }

  const answer = session.messages.findLast(
    (message) =>
      message.type === "assistant" && message.content.some((part) => part.type === "text" && part.text.trim()),
  )

  await mockOpenCodeServer(page, {
    server,
    directory,
    project: {
      id: session.info.projectID,
      worktree: directory,
      vcs: "git",
      name: "session",
      time: { created: 1, updated: 1 },
      sandboxes: [],
    },
    provider: fixture.provider,
    sessions: [session.info, source],
    pageMessages: pageMessagesFrom({
      [session.info.id]: session.messages,
      [source.id]: [{ id: "msg_perf_source", type: "user", text: "Benchmark source", time: { created: 1 } }],
    }),
  })
  await installTabs(page, { server, directory, sessions: [source.id, session.info.id] })

  return {
    source: sessionHref(source.id, server),
    target: sessionHref(session.info.id, server),
    sourceReady: '[data-slot="user-message-text"]',
    targetReady: answer ? ready(`${answer.id}:text:0`) : `[data-message-id="${session.messages.at(-1)?.id}"]`,
  }
}
