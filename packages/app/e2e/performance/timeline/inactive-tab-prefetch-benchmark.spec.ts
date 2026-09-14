import { benchmark, expect } from "../benchmark"
import { mockOpenCodeServer } from "../../utils/mock-server"
import { expectSessionTitle } from "../../utils/waits"
import { fixture } from "./session-timeline-stress.fixture"
import { messages } from "./session-tab-switch.fixture"
import { installStressSessionTabs, stressSessionHref } from "./timeline-test-helpers"
import { measureSessionSwitch, waitForStableTimeline } from "./session-tab-switch-probe"

const sessions = Array.from({ length: 8 }, (_, index) => ({
  ...fixture.sessions[0],
  id: `ses_prefetch_${index}`,
  title: `Renderer review ${index}`,
}))
// A normal first page, not the full-history response used by the tab-switch benchmark.
const pages = Object.fromEntries(
  sessions.map((session) => [
    session.id,
    messages[fixture.targetID].slice(-20).map((message) => ({ ...message, id: `${message.id}_${session.id}` })),
  ]),
)
const workload = {
  sessions: sessions.length,
  messagesPerPage: 20,
  payloadBytes: Object.fromEntries(
    sessions.map((session) => [
      session.id,
      Buffer.byteLength(JSON.stringify({ data: pages[session.id].toReversed(), cursor: {} })),
    ]),
  ),
  partsPerPage: pages[sessions[0].id].reduce(
    (count, message) => count + (message.type === "assistant" ? message.content.length : 1),
    0,
  ),
  events: 0,
}
type ProbeWindow = Window & { __prefetchBodies?: Record<string, number> }

benchmark.use({ viewport: { width: 1440, height: 900 }, video: "off", trace: "off", serviceWorkers: "block" })

for (const close of [false, true]) {
  benchmark(
    `inactive tab prefetch: ${close ? "close before response" : "activate after restore"}`,
    async ({ page, report }, testInfo) => {
      const gate = Promise.withResolvers<void>()
      const reads: string[] = []
      const inboxReads: string[] = []
      const pending = new Set<string>()
      const concurrency = { peak: 0 }
      const mutations: string[] = []
      const errors: string[] = []
      page.on("pageerror", (error) => errors.push(error.message))
      page.on("response", (response) => {
        if (new URL(response.url()).pathname.startsWith("/api/") && !response.ok())
          errors.push(`HTTP ${response.status()}: ${response.url()}`)
      })
      page.on("request", (request) => {
        const path = new URL(request.url()).pathname
        if (request.method() === "DELETE" || /\/(interrupt|prompt)$/.test(path)) mutations.push(request.url())
        const inbox = path.match(/^\/api\/session\/([^/]+)\/inbox$/)
        if (request.method() === "GET" && inbox) inboxReads.push(inbox[1])
      })
      await page.addInitScript(() => {
        const host = window as ProbeWindow
        host.__prefetchBodies = {}
        const text = Response.prototype.text
        Response.prototype.text = async function () {
          const body = await text.call(this)
          if (this.url) {
            const path = new URL(this.url).pathname
            host.__prefetchBodies![path] = (host.__prefetchBodies![path] ?? 0) + 1
          }
          return body
        }
      })
      await mockOpenCodeServer(page, {
        ...fixture,
        sessions,
        pageMessages: (id) => ({ items: pages[id] ?? [] }),
        beforeMessagesResponse: ({ sessionID }) => (sessionID === sessions[0].id ? Promise.resolve() : gate.promise),
        onMessages: ({ sessionID, phase }) => {
          if (phase === "end") return void pending.delete(sessionID)
          reads.push(sessionID)
          pending.add(sessionID)
          concurrency.peak = Math.max(concurrency.peak, pending.size)
        },
      })
      await installStressSessionTabs(page, { sessionIDs: sessions.map((session) => session.id) })
      const cdp = await page.context().newCDPSession(page)
      await cdp.send("Performance.enable")
      await page.goto(stressSessionHref(sessions[0].id))
      await expectSessionTitle(page, sessions[0].title)
      await waitForStableTimeline(page, pages[sessions[0].id].at(-2)!.id)
      // Every inactive tab's scheduled attention request must finish. This gates on the
      // same production callback as prefetch, without a sleep or waiting for a removed read.
      await page.waitForFunction(
        (ids) => ids.every((id) => (window as ProbeWindow).__prefetchBodies![`/api/session/${id}/form`] > 0),
        sessions.slice(1).map((session) => session.id),
      )
      const speculativeReads = reads.filter((id) => id !== sessions[0].id)
      const speculativeInboxReads = inboxReads.filter((id) => id !== sessions[0].id).length
      const closed = sessions.at(-1)!
      if (close) {
        const tab = page
          .locator("[data-titlebar-tab-slot]")
          .filter({ has: page.locator(`a[href="${stressSessionHref(closed.id)}"]`) })
        await tab.getByRole("button", { name: "Close tab", exact: true }).click()
        await expect(tab).toHaveCount(0)
      }
      gate.resolve()
      await page.waitForFunction(
        (ids) => ids.every((id) => (window as ProbeWindow).__prefetchBodies![`/api/session/${id}/message`] > 0),
        reads,
      )
      await expectSessionTitle(page, sessions[0].title)
      const heap =
        process.env.OPENCODE_PERFORMANCE_MEMORY === "1"
          ? await cdp.send("HeapProfiler.collectGarbage").then(() => cdp.send("Runtime.getHeapUsage"))
          : undefined
      const task =
        (await cdp.send("Performance.getMetrics")).metrics.find((metric) => metric.name === "TaskDuration")!.value *
        1000
      const before = reads.length
      const target = sessions[1]
      const result = await measureSessionSwitch(page, {
        destinationIDs: pages[target.id].map((message) => message.id),
        sourceIDs: pages[sessions[0].id].map((message) => message.id),
        lastID: pages[target.id].at(-2)!.id,
        requiredPartID: `${pages[target.id].at(-1)!.id}:text:0`,
        href: stressSessionHref(target.id),
        switch: async () => {
          await page.locator(`[data-slot="titlebar-tabs"] a[href="${stressSessionHref(target.id)}"]`).click()
          await expectSessionTitle(page, target.title)
        },
      })
      await expect(
        page.locator(`[data-timeline-part-id="${pages[target.id].at(-1)!.id}:text:0"] [data-component="markdown"]`),
      ).toHaveAttribute("data-markdown-ready", "")
      expect(result.firstCorrectObservedMs).not.toBeNull()
      expect(mutations).toEqual([])
      expect(errors).toEqual([])
      report(
        {
          speculativeReads: speculativeReads.length,
          speculativeInboxReads,
          speculativePayloadBytes: speculativeReads.reduce((bytes, id) => bytes + workload.payloadBytes[id], 0),
          peakMessageRequests: concurrency.peak,
          closedSessionReads: close ? reads.filter((id) => id === closed.id).length : undefined,
          activationReads: reads.length - before,
          startupTaskMs: task,
          retainedHeap: heap,
          ...result,
        },
        {
          ...workload,
          close,
          gc: heap ? "forced retention; timing diagnostic only" : "natural; clean timing",
          transport: "playwright-route",
          browser: page.context().browser()!.version(),
          scope: "production app renderer; not total desktop RAM",
        },
      )
      if (testInfo.repeatEachIndex === 0) await page.screenshot({ path: testInfo.outputPath("destination.png") })
      await cdp.detach()
    },
  )
}
