import type { CDPSession, Page } from "@playwright/test"
import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import { benchmark, expect } from "../benchmark"
import { mockOpenCodeServer } from "../../utils/mock-server"
import { expectSessionTitle } from "../../utils/waits"
import { fixture } from "./session-timeline-stress.fixture"
import { messages } from "./session-tab-switch.fixture"
import { installStressSessionTabs, installTimelineSettings, stressSessionHref } from "./timeline-test-helpers"
import { measureSessionSwitch, waitForStableTimeline } from "./session-tab-switch-probe"

const keep = { ...fixture.sessions[0], id: "ses_release_keep", title: "Renderer review keep" }
const closable = Array.from({ length: 6 }, (_, index) => ({
  ...fixture.sessions[0],
  id: `ses_release_${index}`,
  title: `Renderer review ${index}`,
}))
const sessions = [keep, ...closable]
// A normal first page per session. Every message ID, tool ID, and text part carries its own
// session ID, so retained strings in a heap snapshot can be attributed to one closed session.
const pages = Object.fromEntries(
  sessions.map((session) => [
    session.id,
    messages[fixture.targetID].slice(-20).map((message) => rebrand(message, session.id)),
  ]),
)
const workload = {
  sessions: sessions.length,
  closed: closable.length,
  messagesPerPage: 20,
  payloadBytes: Buffer.byteLength(JSON.stringify({ data: pages[keep.id].toReversed(), cursor: {} })),
  partsPerPage: pages[keep.id].reduce(
    (count, message) => count + (message.type === "assistant" ? message.content.length : 1),
    0,
  ),
  events: 0,
}

benchmark.use({ viewport: { width: 1440, height: 900 }, video: "off", trace: "off", serviceWorkers: "block" })

benchmark(
  "session close release: close visited tabs, then reopen one from Home",
  async ({ page, report }, testInfo) => {
    benchmark.setTimeout(180_000)
    const reads: string[] = []
    const inboxReads: string[] = []
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
    await mockOpenCodeServer(page, {
      ...fixture,
      sessions,
      pageMessages: (id) => ({ items: pages[id] ?? [] }),
      onMessages: ({ sessionID, phase }) => {
        if (phase === "start") reads.push(sessionID)
      },
    })
    await installTimelineSettings(page)
    await installStressSessionTabs(page, { sessionIDs: sessions.map((session) => session.id) })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("HeapProfiler.enable")
    await page.goto(stressSessionHref(keep.id))
    await expectSessionTitle(page, keep.title)
    await expectReadyPage(page, keep.id)
    // Visit every closable tab so its transcript and inbox are actually loaded, then return.
    for (const session of closable) {
      await selectTab(page, session.id, session.title)
    }
    await selectTab(page, keep.id, keep.title)
    expect(reads).toEqual(sessions.map((session) => session.id))
    const memory = process.env.OPENCODE_PERFORMANCE_MEMORY === "1"
    const before = memory ? await retainedStrings(cdp, sessions) : undefined
    for (const session of closable) {
      const tab = page
        .locator("[data-titlebar-tab-slot]")
        .filter({ has: page.locator(`a[href="${stressSessionHref(session.id)}"]`) })
      await tab.getByRole("button", { name: "Close tab", exact: true }).click()
      await expect(tab).toHaveCount(0)
    }
    await expect(page.locator("[data-titlebar-tab-slot]")).toHaveCount(1)
    await expectSessionTitle(page, keep.title)
    await expectReadyPage(page, keep.id)
    // Same visible state as before the visits: one open tab showing its ready transcript.
    const after = memory ? await retainedStrings(cdp, sessions) : undefined
    const target = closable[0]
    const row = `[data-component="home-session-row-container"][data-session-id="${target.id}"] [data-component="home-session-row"]`
    await page.getByRole("button", { name: "Home", exact: true }).click()
    await expect(page.locator(row)).toBeVisible()
    const readsBefore = reads.length
    const inboxBefore = inboxReads.length
    const result = await measureSessionSwitch(page, {
      destinationIDs: pages[target.id].map((message) => message.id),
      sourceIDs: pages[keep.id].map((message) => message.id),
      lastID: pages[target.id].at(-2)!.id,
      requiredPartID: `${pages[target.id].at(-1)!.id}:text:0`,
      href: stressSessionHref(target.id),
      triggerSelector: row,
      switch: async () => {
        await page.locator(row).click()
        await expectSessionTitle(page, target.title)
      },
    })
    await expectReadyPage(page, target.id)
    expect(result.firstCorrectObservedMs).not.toBeNull()
    expect(mutations).toEqual([])
    expect(errors).toEqual([])
    report(
      {
        visitedReads: readsBefore,
        reopenReads: reads.length - readsBefore,
        reopenInboxReads: inboxReads.length - inboxBefore,
        retainedBeforeClose: before,
        retainedAfterClose: after,
        ...result,
      },
      {
        ...workload,
        gc: memory ? "forced retention; timing diagnostic only" : "natural; clean timing",
        transport: "playwright-route",
        browser: page.context().browser()!.version(),
        scope: "production app renderer; not total desktop RAM",
      },
    )
    if (testInfo.repeatEachIndex === 0) await page.screenshot({ path: testInfo.outputPath("destination.png") })
    await cdp.detach()
  },
)

async function selectTab(page: Page, id: string, title: string) {
  await page.locator(`[data-slot="titlebar-tabs"] a[href="${stressSessionHref(id)}"]`).click()
  await expectSessionTitle(page, title)
  await expectReadyPage(page, id)
}

async function expectReadyPage(page: Page, id: string) {
  await waitForStableTimeline(page, pages[id].at(-2)!.id)
  await expect(
    page.locator(`[data-timeline-part-id="${pages[id].at(-1)!.id}:text:0"] [data-component="markdown"]`),
  ).toHaveAttribute("data-markdown-ready", "")
}

function rebrand(message: SessionMessageInfo, id: string): SessionMessageInfo {
  const swap = (value: string) => value.replaceAll(fixture.targetID, id)
  if (message.type === "assistant")
    return {
      ...message,
      id: swap(message.id),
      content: message.content.map((part) => {
        if (part.type === "text") return { ...part, text: swap(part.text) }
        if (part.type === "tool") return { ...part, id: swap(part.id) }
        return part
      }),
    }
  if (message.type === "user") return { ...message, id: swap(message.id), text: swap(message.text) }
  return { ...message, id: swap(message.id) }
}

type HeapSnapshot = {
  snapshot: { meta: { node_fields: string[]; node_types: (string[] | string)[] } }
  nodes: number[]
  strings: string[]
}

// Forced GC plus a heap snapshot: count live string objects that mention each session ID and
// sum their sizes. Message IDs, tool IDs, and answer text all carry the ID, so this attributes
// retained transcript strings per session wherever they live (store, index, caches).
async function retainedStrings(cdp: CDPSession, targets: { id: string }[]) {
  await cdp.send("HeapProfiler.collectGarbage")
  const heap = await cdp.send("Runtime.getHeapUsage")
  const chunks: string[] = []
  const collect = (event: { chunk: string }) => chunks.push(event.chunk)
  cdp.on("HeapProfiler.addHeapSnapshotChunk", collect)
  await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false })
  cdp.off("HeapProfiler.addHeapSnapshotChunk", collect)
  const snapshot = JSON.parse(chunks.join("")) as HeapSnapshot
  const fields = snapshot.snapshot.meta.node_fields
  const types = snapshot.snapshot.meta.node_types[fields.indexOf("type")]
  if (!Array.isArray(types)) throw new Error("Unexpected heap snapshot node types")
  const stringTypes = new Set(["string", "concatenated string", "sliced string"].map((name) => types.indexOf(name)))
  const typeAt = fields.indexOf("type")
  const nameAt = fields.indexOf("name")
  const sizeAt = fields.indexOf("self_size")
  const strings = Object.fromEntries(
    targets.map((target) => [target.id, { nodes: 0, bytes: 0, largest: { bytes: 0, preview: "" } }]),
  )
  for (let offset = 0; offset < snapshot.nodes.length; offset += fields.length) {
    if (!stringTypes.has(snapshot.nodes[offset + typeAt])) continue
    const value = snapshot.strings[snapshot.nodes[offset + nameAt]]
    const size = snapshot.nodes[offset + sizeAt]
    for (const target of targets) {
      if (!value.includes(target.id)) continue
      const entry = strings[target.id]
      entry.nodes += 1
      entry.bytes += size
      // The largest survivor identifies which owner still holds transcript text after a close.
      if (size > entry.largest.bytes) entry.largest = { bytes: size, preview: value.slice(0, 96) }
    }
  }
  return { heapUsedBytes: heap.usedSize, strings }
}
