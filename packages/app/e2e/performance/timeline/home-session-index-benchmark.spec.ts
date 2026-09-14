import type { CDPSession, Page } from "@playwright/test"
import { benchmark, expect } from "../benchmark"
import { mockOpenCodeServer } from "../../utils/mock-server"
import { APP_READY_TIMEOUT } from "../../utils/waits"
import { fixture as stress } from "./session-timeline-stress.fixture"
import { createHomeIndexFixture, type HomeIndexFixture } from "./home-session-index.fixture"

// Home fetches the root-session index on mount. These cases hold the visible
// output constant (newest 64 rows, same order) while the index size grows, so
// bytes, main-thread work, time to actionable rows, and retained heap can be
// attributed to index handling rather than to what the user sees.
const sizes = (process.env.HOME_INDEX_SIZES ?? "500,5000,10000").split(",").map(Number)
const churnSize = Number(process.env.HOME_INDEX_CHURN_SIZE ?? 10_000)
const updates = Number(process.env.HOME_INDEX_UPDATES ?? 20)
// Forced GC changes timing; retention runs stay separate from clean timing runs.
const memory = process.env.OPENCODE_PERFORMANCE_MEMORY === "1"

const rowContainer = '[data-component="home-session-row-container"]'
const row = '[data-component="home-session-row"]'

type Probe = {
  expected: number
  rows?: number
  frame?: number
  pending: Record<string, string>
  titles: Record<string, number>
}

type ProbeWindow = Window & {
  __homeIndexProbe?: Probe
  __mockServerStream?: { push: (payloads: unknown[]) => void }
}

// Interaction-scoped tracing keeps the page-lifetime Chrome trace off unless a
// scenario starts one; service workers stay out of the renderer measurement.
benchmark.use({
  viewport: { width: 1440, height: 900 },
  video: "off",
  trace: "off",
  serviceWorkers: "block",
  traceScope: "interaction",
})

benchmark.describe("performance: home session index", () => {
  for (const count of sizes) {
    benchmark(`loads home with ${count} root sessions`, async ({ page, report }, testInfo) => {
      benchmark.setTimeout(180_000)
      const fixture = createHomeIndexFixture({ count, now: Date.now() })
      const network = await setup(page, fixture)
      const cdp = await page.context().newCDPSession(page)
      await cdp.send("Performance.enable")

      await page.goto("/")
      const rows = page.locator(row)
      await expect(rows).toHaveCount(fixture.expected.visible, { timeout: APP_READY_TIMEOUT })
      const first = page.locator(rowContainer).filter({ hasText: fixture.expected.newestTitle })
      await expect(first).toHaveAttribute("data-session-id", fixture.expected.newestID)
      await expect(first.locator(row)).toBeEnabled()
      // Row order is part of the held-constant output: the DOM must list the
      // newest session first.
      await expect(page.locator(rowContainer).nth(0)).toHaveAttribute("data-session-id", fixture.expected.newestID)

      const probe = await readProbe(page)
      const metrics = await performanceMetrics(cdp)
      const retained = memory ? await retainedHeap(cdp) : undefined
      await network.settle()
      if (testInfo.repeatEachIndex === 0) {
        const path = testInfo.outputPath(`home-${count}.png`)
        await page.screenshot({ path })
        await testInfo.attach(`home-${count}`, { path, contentType: "image/png" })
      }
      report(
        {
          listRequests: network.list.requests,
          listBytes: network.list.bytes,
          rowsMs: probe.rows,
          frameMs: probe.frame,
          listEndMs: probe.listEnd,
          processMs: probe.rows - probe.listEnd,
          // ThreadTime is main-thread CPU time; ScriptDuration only covers
          // Blink-invoked callbacks, so promise continuations are missing from it.
          threadMs: metrics.ThreadTime * 1000,
          scriptMs: metrics.ScriptDuration * 1000,
          taskMs: metrics.TaskDuration * 1000,
          layoutMs: metrics.LayoutDuration * 1000,
          styleMs: metrics.RecalcStyleDuration * 1000,
          heapUsedMB: metrics.JSHeapUsedSize / 1_048_576,
          heapTotalMB: metrics.JSHeapTotalSize / 1_048_576,
          nodes: metrics.Nodes,
          ...(retained ? { retainedHeapMB: retained.usedSize / 1_048_576, retainedNodes: retained.nodes } : {}),
        },
        {
          sessions: count,
          directories: fixture.directories.length,
          fixtureVersion: fixture.version,
          fixtureListBytes: fixture.listBytes,
          visibleRows: fixture.expected.visible,
          gc: memory ? "explicit" : "none",
          scope: "renderer main isolate; not total desktop RAM",
        },
      )
      expect(probe.rows).toBeGreaterThan(0)
      await cdp.detach()
    })
  }

  benchmark(
    `applies ${updates} background session updates on home with ${churnSize} root sessions`,
    async ({ page, report }) => {
      benchmark.setTimeout(180_000)
      const fixture = createHomeIndexFixture({ count: churnSize, now: Date.now() })
      const target = fixture.sessions[fixture.sessions.length - 1]
      const network = await setup(page, fixture)
      const cdp = await page.context().newCDPSession(page)
      await cdp.send("Performance.enable")

      // Home prefetches the two newest sessions, which makes them locally known
      // and therefore part of every later index merge, like an open session.
      const prefetch = page.waitForResponse(
        (response) => response.request().method() === "GET" && response.url().includes(`/api/session/${target.id}`),
      )
      await page.goto("/")
      await expect(page.locator(row)).toHaveCount(fixture.expected.visible, { timeout: APP_READY_TIMEOUT })
      await prefetch
      const titleLocator = page.locator(
        `${rowContainer}[data-session-id="${target.id}"] [data-component="home-session-title"]`,
      )
      await expect(titleLocator).toHaveText(fixture.expected.newestTitle)

      const before = await performanceMetrics(cdp)
      const samples: number[] = []
      for (let index = 1; index <= updates; index++) {
        const title = `${fixture.expected.newestTitle} · update ${index}`
        // The completed run bumps the session's updated time and title on the
        // server; the client re-reads the session and re-merges the index.
        target.title = title
        target.time.updated += 1000
        target.time.idle = target.time.updated
        const pushed = await page.evaluate(
          ({ id, title, event }) => {
            const host = window as ProbeWindow
            if (!host.__homeIndexProbe || !host.__mockServerStream) throw new Error("Missing Home index probe")
            host.__homeIndexProbe.pending[id] = title
            host.__mockServerStream.push([event])
            return performance.now()
          },
          {
            id: target.id,
            title,
            event: {
              id: `evt_home_update_${index}`,
              created: Date.now(),
              type: "session.execution.succeeded",
              data: { sessionID: target.id },
            },
          },
        )
        await expect(titleLocator).toHaveText(title)
        const seen = await page.evaluate(({ title }) => (window as ProbeWindow).__homeIndexProbe?.titles[title], {
          title,
        })
        if (seen === undefined) throw new Error(`Probe did not observe title: ${title}`)
        samples.push(seen - pushed)
      }
      const after = await performanceMetrics(cdp)
      await network.settle()
      const sorted = samples.toSorted((a, b) => a - b)
      report(
        {
          updates,
          updateMs: sorted,
          updateMedianMs: median(sorted),
          updateP95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
          threadMs: (after.ThreadTime - before.ThreadTime) * 1000,
          scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
          taskMs: (after.TaskDuration - before.TaskDuration) * 1000,
          layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
          sessionReads: network.get.requests,
        },
        {
          sessions: churnSize,
          directories: fixture.directories.length,
          fixtureVersion: fixture.version,
          event: "session.execution.succeeded",
          scope: "renderer main isolate; latency from event push to row title update",
        },
      )
      expect(samples).toHaveLength(updates)
      await cdp.detach()
    },
  )
})

async function setup(page: Page, fixture: HomeIndexFixture) {
  const primary = fixture.directories[0]
  await mockOpenCodeServer(page, {
    directory: primary.directory,
    project: {
      id: primary.projectID,
      worktree: primary.directory,
      vcs: "git",
      name: primary.name,
      time: { created: fixture.now - 400 * 86_400_000, updated: fixture.now },
      sandboxes: [],
    },
    sessions: fixture.sessions,
    pageMessages: () => ({ items: [] }),
    provider: stress.provider,
  })
  await page.addInitScript(
    ({ projects }) => {
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: projects.map((worktree, index) => ({ worktree, expanded: index === 0 })) },
          lastProject: { local: projects[0] },
        }),
      )
    },
    { projects: fixture.directories.filter((entry) => entry.project).map((entry) => entry.directory) },
  )
  await page.addInitScript(
    ({ expected }) => {
      const host = window as ProbeWindow
      const probe: Probe = { expected, pending: {}, titles: {} }
      host.__homeIndexProbe = probe
      const observer = new MutationObserver(() => {
        if (probe.rows === undefined) {
          const count = document.querySelectorAll('[data-component="home-session-row"]').length
          if (count >= probe.expected) {
            probe.rows = performance.now()
            requestAnimationFrame((time) => {
              probe.frame = time
            })
          }
        }
        for (const [id, title] of Object.entries(probe.pending)) {
          const element = document.querySelector(
            `[data-component="home-session-row-container"][data-session-id="${id}"] [data-component="home-session-title"]`,
          )
          if (element?.textContent !== title) continue
          probe.titles[title] = performance.now()
          delete probe.pending[id]
        }
      })
      // Init scripts run before <html> exists; the document node itself is always observable.
      observer.observe(document, { childList: true, subtree: true, characterData: true })
    },
    { expected: fixture.expected.visible },
  )
  const list = { requests: 0, bytes: 0 }
  const get = { requests: 0, bytes: 0 }
  const pending: Promise<void>[] = []
  page.on("response", (response) => {
    const request = response.request()
    if (request.method() !== "GET") return
    const url = new URL(response.url())
    const isList = url.pathname === "/api/session"
    const isGet = /^\/api\/session\/[^/]+$/.test(url.pathname)
    if (!isList && !isGet) return
    const bucket = isList ? list : get
    bucket.requests += 1
    pending.push(
      response
        .body()
        .then((body) => {
          bucket.bytes += body.byteLength
        })
        .catch(() => {}),
    )
  })
  return {
    list,
    get,
    settle: () => Promise.all(pending).then(() => {}),
  }
}

async function readProbe(page: Page) {
  const probe = await page.evaluate(() => {
    const host = window as ProbeWindow
    if (!host.__homeIndexProbe) throw new Error("Missing Home index probe")
    // Resource timing marks when the last index page finished arriving, so
    // rows - listEnd isolates parse, merge, and render from transfer and boot.
    const listEnd = Math.max(
      0,
      ...performance
        .getEntriesByType("resource")
        .filter((entry) => new URL(entry.name).pathname === "/api/session")
        .map((entry) => (entry as PerformanceResourceTiming).responseEnd),
    )
    return { rows: host.__homeIndexProbe.rows, frame: host.__homeIndexProbe.frame, listEnd }
  })
  if (probe.rows === undefined) throw new Error("Probe did not observe the expected Home rows")
  return { rows: probe.rows, frame: probe.frame, listEnd: probe.listEnd }
}

async function performanceMetrics(cdp: CDPSession) {
  const result = await cdp.send("Performance.getMetrics")
  return Object.fromEntries(result.metrics.map((metric) => [metric.name, metric.value])) as Record<string, number>
}

async function retainedHeap(cdp: CDPSession) {
  // GC is an explicit retained-heap measurement, not an application optimization or readiness wait.
  await cdp.send("HeapProfiler.collectGarbage")
  const heap = await cdp.send("Runtime.getHeapUsage")
  const dom = await cdp.send("Memory.getDOMCounters")
  return { usedSize: heap.usedSize, nodes: dom.nodes }
}

function median(sorted: number[]) {
  if (sorted.length === 0) return undefined
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}
