import type { Page } from "@playwright/test"
import type { OpenCodeEvent, SessionMessageInfo } from "@opencode/client/promise"
import { benchmark, expect } from "../benchmark"
import { mockOpenCodeServer } from "../../utils/mock-server"
import { expectSessionTitle } from "../../utils/waits"
import { fixture, installStressSessionTabs } from "../../utils/session-fixture"
import { SERVER, sessionHref } from "../../utils/app"

// Parallel sessions on one server: every session streams deltas at the same time, so the
// renderer pays the per-event cost of the whole fan-out, not of one session.
const sessionCount = Number(process.env.PARALLEL_SESSIONS ?? 8)

const deltasPerSession = Number(process.env.PARALLEL_DELTAS ?? 200)

// Deltas for the visible session; 0 isolates the fan-out from the visible render.
const activeDeltas = Number(process.env.PARALLEL_ACTIVE_DELTAS ?? deltasPerSession)

// Sessions spread over this many directories; each directory owns one child store.
const directoryCount = Number(process.env.PARALLEL_DIRECTORIES ?? 1)

const completionMarker = "parallel-complete"

const directoryFor = (index: number) =>
  directoryCount <= 1 ? fixture.directory : `${fixture.directory}/ws-${index % directoryCount}`

const sessions = Array.from({ length: sessionCount }, (_, index) => ({
  ...fixture.sessions[0],
  id: `ses_parallel_${index}`,
  slug: `parallel-${index}`,
  title: `Parallel session ${index}`,
  directory: directoryFor(index),
}))

const assistantMessageID = (sessionID: string) => `msg_assistant_${sessionID}`

const textPartID = (sessionID: string) => `${assistantMessageID(sessionID)}:text:0`

function history(sessionID: string): SessionMessageInfo[] {
  return [
    {
      id: `msg_user_${sessionID}`,
      type: "user",
      time: { created: 1700000000000 },
      text: "Stream a long answer.",
    },
    {
      id: assistantMessageID(sessionID),
      type: "assistant",
      time: { created: 1700000001000 },
      model: { id: "claude-opus-4-6", providerID: "opencode", variant: "max" },
      agent: "build",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      finish: "stop",
      content: [{ type: "text", text: "Streaming" }],
    },
  ]
}

function deltaEvent(sessionID: string, directory: string, index: number, delta: string): OpenCodeEvent {
  return {
    id: `evt_parallel_${sessionID}_${index}`,
    created: 1700000002000 + index,
    type: "session.text.delta",
    data: { sessionID, assistantMessageID: assistantMessageID(sessionID), ordinal: 0, delta },
    location: { directory },
  } as OpenCodeEvent
}

// Round-robin, so the burst interleaves sessions the way a busy server delivers them.
// The payloads cross `page.evaluate`, so they stay opaque to the type checker.
function buildBurst(): unknown[] {
  const events: unknown[] = []

  for (let index = 0; index < deltasPerSession; index++) {
    for (const session of sessions) {
      if (session === sessions[0] && index >= activeDeltas) continue
      events.push(deltaEvent(session.id, session.directory, index, `chunk ${index} `))
    }
  }

  // The last event lands in the active session, so its rendered text proves the whole
  // batch was applied before the probe stops the clock.
  events.push(deltaEvent(sessions[0]!.id, sessions[0]!.directory, deltasPerSession, ` ${completionMarker}`))

  return events
}

type ParallelProbeState = {
  started: number
  completed: number
  longTasks: number[]
  frames: number[]
  running: boolean
  cleanup: () => void
  start: (payloads: readonly unknown[]) => void
}

type ParallelProbeWindow = Window & {
  __parallelSessionProbe?: ParallelProbeState
  __mockServerStreams?: Record<string, { push: (payloads: readonly unknown[]) => void }>
}

benchmark.use({
  viewport: { width: 1440, height: 900 },
  video: "off",
  trace: "off",
  traceScope: "interaction",
  serviceWorkers: "block",
})

const title = `parallel sessions: ${sessionCount} sessions x ${deltasPerSession} deltas over ${directoryCount} directories`

benchmark(title, async ({ page, report }) => {
  benchmark.setTimeout(120_000)
  const errors: string[] = []
  const prefetched = new Set<string>()
  const directories = new Set<string>()
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("request", (request) => {
    const url = new URL(request.url())
    const match = url.pathname.match(/^\/api\/session\/([^/]+)\/form$/)

    if (match) prefetched.add(match[1]!)
    const directory = url.searchParams.get("location[directory]")

    if (directory) directories.add(directory)
  })
  await mockOpenCodeServer(page, {
    ...fixture,
    sessions,
    pageMessages: (id) => ({ items: history(id) }),
  })
  await installStressSessionTabs(page, { sessionIDs: sessions.map((session) => session.id) })
  await page.goto(sessionHref(sessions[0]!.id))
  await expectSessionTitle(page, sessions[0]!.title)

  // Visit every tab once so each session's transcript is loaded, then return to the first.
  for (const session of sessions.slice(1)) {
    await page.locator(`[data-slot="titlebar-tabs"] a[href="${sessionHref(session.id)}"]`).click()
    await expectSessionTitle(page, session.title)
  }

  await page.locator(`[data-slot="titlebar-tabs"] a[href="${sessionHref(sessions[0]!.id)}"]`).click()
  await expectSessionTitle(page, sessions[0]!.title)
  // Inactive tabs prefetch attention, metadata, and the inbox on a timer; the burst must
  // not race that work.
  await expect.poll(() => sessions.slice(1).every((session) => prefetched.has(session.id))).toBe(true)
  await expect(page.locator(`[data-timeline-part-id="${textPartID(sessions[0]!.id)}"]`)).toBeVisible()

  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Performance.enable")
  const taskBefore = await taskDurationMs(cdp)
  await installParallelProbe(page, {
    server: SERVER,
    textPartID: textPartID(sessions[0]!.id),
    marker: completionMarker,
  })
  const events = buildBurst()
  await page.evaluate((payloads) => {
    ;(window as ParallelProbeWindow).__parallelSessionProbe!.start(payloads)
  }, events)
  await page.waitForFunction(() => (window as ParallelProbeWindow).__parallelSessionProbe!.completed > 0)
  const taskAfter = await taskDurationMs(cdp)
  const metrics = await collectParallelProbe(page)

  expect(metrics.elapsedMs).toBeGreaterThan(0)
  expect(metrics.frameCount).toBeGreaterThan(0)
  expect(errors).toEqual([])
  report(
    { ...metrics, taskMs: taskAfter - taskBefore, events: events.length },
    {
      sessions: sessionCount,
      deltasPerSession,
      activeDeltas,
      events: events.length,
      directories: directories.size,
      directoryCount,
      transport: "playwright-route",
      browser: page.context().browser()!.version(),
      scope: "production app renderer; every session streaming",
    },
  )
  await cdp.detach()
})

async function taskDurationMs(cdp: Awaited<ReturnType<Awaited<ReturnType<Page["context"]>>["newCDPSession"]>>) {
  const metrics = await cdp.send("Performance.getMetrics")

  return metrics.metrics.find((metric) => metric.name === "TaskDuration")!.value * 1000
}

async function installParallelProbe(page: Page, input: { server: string; textPartID: string; marker: string }) {
  await page.evaluate(({ server, textPartID, marker }) => {
    const host = window as ParallelProbeWindow
    const state: ParallelProbeState = {
      started: 0,
      completed: 0,
      longTasks: [],
      frames: [],
      running: false,
      cleanup: () => {},
      start: () => {},
    }
    const longTasks = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.longTasks.push(entry.duration)
    })
    longTasks.observe({ type: "longtask", buffered: false })
    // The streaming row can remount, so watch the document and re-query the part.
    const mutations = new MutationObserver(() => {
      if (state.completed) return
      const part = document.querySelector<HTMLElement>(`[data-timeline-part-id="${textPartID}"]`)

      if (part?.textContent?.includes(marker)) state.completed = performance.now()
    })
    mutations.observe(document.body, { subtree: true, characterData: true, childList: true })
    let previous = 0
    const sample = (now: number) => {
      if (!state.running) return
      if (previous) state.frames.push(now - previous)
      previous = now
      requestAnimationFrame(sample)
    }
    state.start = (payloads) => {
      const stream = host.__mockServerStreams?.[server]

      if (!stream) throw new Error(`missing mock event stream for ${server}`)
      state.started = performance.now()
      state.running = true
      requestAnimationFrame(sample)
      stream.push(payloads)
    }
    state.cleanup = () => {
      longTasks.disconnect()
      mutations.disconnect()
      state.running = false
    }
    host.__parallelSessionProbe = state
  }, input)
}

async function collectParallelProbe(page: Page) {
  return page.evaluate(() => {
    const state = (window as ParallelProbeWindow).__parallelSessionProbe

    if (!state) throw new Error("missing parallel session probe")
    state.cleanup()
    const sorted = state.frames.slice().sort((a, b) => a - b)
    const percentile = (value: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))] ?? null

    return {
      elapsedMs: state.completed - state.started,
      longTaskMs: state.longTasks.reduce((sum, duration) => sum + duration, 0),
      longTaskCount: state.longTasks.length,
      frameCount: sorted.length,
      frameGapP50Ms: percentile(0.5),
      frameGapP95Ms: percentile(0.95),
      frameGapMaxMs: sorted.at(-1) ?? null,
    }
  })
}
