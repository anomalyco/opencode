import { benchmark, expect } from "../benchmark"
import type { OpenCodeEvent } from "@opencode-ai/client/promise"
import { mockOpenCodeServer } from "../../utils/mock-server"
import { installSseTransport } from "../../utils/sse-transport"
import { expectSessionTitle } from "../../utils/waits"
import { fixture } from "./session-timeline-stress.fixture"
import { createLocationCatalog } from "./location-catalog.fixture"
import { installTimelineSettings, stressSessionHref } from "./timeline-test-helpers"

const counts = (process.env.LOCATION_CATALOG_DIRECTORIES ?? "5,15,30").split(",").map(Number)
const modelCount = Number(process.env.LOCATION_CATALOG_MODELS ?? 1200)
const memory = process.env.LOCATION_CATALOG_MEMORY !== "0"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const catalogPaths = [
  "/api/model",
  "/api/provider",
  "/api/agent",
  "/api/command",
  "/api/skill",
  "/api/integration",
  "/api/mcp",
  "/api/mcp/resource",
  "/api/reference",
]
// Four exchanges per workspace: the transcript is not the subject of this workload.
const transcript = fixture.messages[fixture.sourceID].slice(0, 8)
const homeSearch = '[data-component="home-session-search"]'
const composerModel = '[data-action="composer-model"]'

type Request = { path: string; directory: string | null }
type CatalogWindow = Window & { __catalogReads?: { pending: number; completed: number } }

benchmark.use({ viewport: { width: 1440, height: 900 }, video: "off", trace: "off", serviceWorkers: "block" })

for (const pending of [false, true].filter(
  (value) => !process.env.LOCATION_CATALOG_PENDING || Number(process.env.LOCATION_CATALOG_PENDING) === Number(value),
)) {
  for (const count of counts) {
    benchmark(
      `location catalogs: ${pending ? "close before first response" : "visit and close"} ${count} workspaces`,
      async ({ page, report }, testInfo) => {
        benchmark.setTimeout(300_000)
        const catalog = createLocationCatalog(modelCount)
        const directories = Array.from(
          { length: count },
          (_, index) => `C:/OpenCode/Workspace-${String(index).padStart(2, "0")}`,
        )
        const now = Date.now()
        const sessions = directories.map((directory, index) => ({
          ...fixture.sessions[0],
          id: `ses_catalog_${String(index).padStart(2, "0")}`,
          directory,
          title: `Workspace ${index} review`,
          time: { created: now - index * 60_000, updated: now - index * 60_000 },
        }))
        // Its session.created echo orders one deterministic read after event-driven catalog refreshes.
        const marker = { ...fixture.sessions[0], id: "ses_catalog_marker", title: "Event marker" }
        const pages = Object.fromEntries(
          sessions.map((session) => [
            session.id,
            transcript.map((message) => ({ ...message, id: `${message.id}_${session.id}` })),
          ]),
        )
        const requests: Request[] = []
        const inflight = new Set<string>()
        const errors: string[] = []
        const bytes: Record<string, number> = {}
        page.on("pageerror", (error) => errors.push(error.message))
        page.on("request", (request) => {
          const url = new URL(request.url())
          if (!url.pathname.startsWith("/api/")) return
          requests.push({ path: url.pathname, directory: url.searchParams.get("location[directory]") })
          if (url.pathname !== "/api/event") inflight.add(request.url())
        })
        page.on("requestfinished", (request) => inflight.delete(request.url()))
        page.on("requestfailed", (request) => inflight.delete(request.url()))
        page.on("response", (response) => {
          const url = new URL(response.url())
          if (!url.pathname.startsWith("/api/")) return
          if (!response.ok()) errors.push(`HTTP ${response.status()}: ${response.url()}`)
          if (url.searchParams.get("location[directory]") !== directories[0] || !catalogPaths.includes(url.pathname))
            return
          if (bytes[url.pathname] !== undefined) return
          bytes[url.pathname] = 0
          void response
            .body()
            .then((body) => {
              bytes[url.pathname] = body.byteLength
            })
            .catch(() => undefined)
        })

        const gate = Promise.withResolvers<void>()
        if (!pending) gate.resolve()
        await page.addInitScript(
          ({ paths, server }) => {
            const reads = { pending: 0, completed: 0 }
            ;(window as CatalogWindow).__catalogReads = reads
            const watched = (url: string) =>
              !!url && new URL(url).origin === server && paths.includes(new URL(url).pathname)
            const fetch = window.fetch.bind(window)
            Object.defineProperty(window, "fetch", {
              configurable: true,
              writable: true,
              value: (input: RequestInfo | URL, init?: RequestInit) => {
                if (watched(input instanceof Request ? input.url : String(input))) reads.pending++
                return fetch(input, init)
              },
            })
            const text = Response.prototype.text
            Response.prototype.text = async function () {
              const body = await text.call(this)
              if (watched(this.url)) {
                reads.pending--
                reads.completed++
              }
              return body
            }
          },
          { paths: catalogPaths, server },
        )
        const transport = await installSseTransport(page, { server })
        await mockOpenCodeServer(page, {
          directory: fixture.directory,
          directories,
          project: fixture.project,
          provider: catalog.provider,
          agents: catalog.agents,
          commands: catalog.commands,
          skills: catalog.skills,
          sessions: [...sessions, marker],
          pageMessages: (id) => ({ items: pages[id] ?? [] }),
        })
        await page.route("**/api/**", async (route) => {
          const url = new URL(route.request().url())
          if (
            pending &&
            catalogPaths.includes(url.pathname) &&
            directories.includes(url.searchParams.get("location[directory]") ?? "")
          )
            await gate.promise
          await route.fallback()
        })
        page.on("close", () => gate.resolve())
        await installTimelineSettings(page)
        await page.addInitScript(
          ({ directories, sessionIDs, server }) => {
            localStorage.setItem(
              "opencode.global.dat:server",
              JSON.stringify({
                projects: { local: directories.map((worktree) => ({ worktree, expanded: false })) },
                lastProject: {},
              }),
            )
            localStorage.setItem(
              "opencode.window.browser.dat:tabs",
              JSON.stringify(sessionIDs.map((sessionId) => ({ type: "session", server, sessionId }))),
            )
          },
          { directories, sessionIDs: sessions.map((session) => session.id), server },
        )
        const cdp = await page.context().newCDPSession(page)
        // GC is an explicit retained-heap measurement between phases, not a readiness wait.
        const retainedHeap = async () => {
          if (!memory) return undefined
          await cdp.send("HeapProfiler.collectGarbage")
          return (await cdp.send("Runtime.getHeapUsage")).usedSize
        }
        const tab = (id: string) => page.locator(`[data-slot="titlebar-tabs"] a[href="${stressSessionHref(id)}"]`)
        const catalogRequests = (from: number) =>
          requests.slice(from).filter((request) => catalogPaths.includes(request.path))
        const summarize = (list: Request[]) => ({
          requests: list.length,
          directories: [...new Set(list.map((request) => request.directory || "<default>"))].toSorted(),
          byPath: Object.fromEntries(
            catalogPaths.map((path) => [path, list.filter((request) => request.path === path).length]),
          ),
        })

        await page.goto("/")
        await expect(page.locator(homeSearch)).toBeVisible()
        for (const session of sessions) await expect(tab(session.id)).toContainText(session.title)
        const heapStart = await retainedHeap()

        // Visit every workspace once from its restored tab.
        const visits = []
        for (const session of sessions) {
          const from = requests.length
          const started = performance.now()
          await tab(session.id).click()
          await expectSessionTitle(page, session.title)
          if (pending) {
            await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeEditable()
            await expect
              .poll(() =>
                catalogRequests(from)
                  .filter((request) => request.directory === session.directory)
                  .map((request) => request.path)
                  .toSorted(),
              )
              .toEqual(catalogPaths.toSorted())
          } else {
            await expect(page.locator(composerModel)).toContainText("Claude Opus 4.6")
          }
          visits.push({ ms: performance.now() - started, catalogRequests: catalogRequests(from).length })
        }

        // Switching back to an open tab must not reload its catalogs in either build.
        const warmFrom = requests.length
        await tab(sessions[0]!.id).click()
        await expectSessionTitle(page, sessions[0]!.title)
        if (!pending) await expect(page.locator(composerModel)).toContainText("Claude Opus 4.6")
        const warmSwitch = summarize(catalogRequests(warmFrom))
        const heapOpen = await retainedHeap()

        // Close every tab; the last close lands on Home.
        for (const session of sessions) {
          const slot = page
            .locator("[data-titlebar-tab-slot]")
            .filter({ has: page.locator(`a[href="${stressSessionHref(session.id)}"]`) })
          await slot.getByRole("button", { name: "Close tab", exact: true }).click()
          await expect(slot).toHaveCount(0)
        }
        await expect(page).toHaveURL("/")
        await expect(page.locator(homeSearch)).toBeVisible()
        const heapClosed = await retainedHeap()

        // A credential switch refreshes the model and provider catalogs the client still retains.
        const credentialFrom = requests.length
        const markerRead = page.waitForRequest(
          (request) => new URL(request.url()).pathname === `/api/session/${marker.id}`,
        )
        await transport.burst([
          {
            id: "evt_catalog_credential",
            created: now,
            type: "credential.switched",
            data: { integrationID: "opencode", credentialID: "credential" },
          },
          {
            id: "evt_catalog_marker",
            created: now,
            type: "session.created",
            durable: { aggregateID: marker.id, seq: 1, version: 1 },
            data: {
              sessionID: marker.id,
              projectID: fixture.project.id,
              location: { directory: fixture.directory },
              slug: "event-marker",
              version: "dev",
            },
          },
        ] satisfies OpenCodeEvent[])
        await markerRead
        const readsAtRelease = catalogRequests(0).length
        gate.resolve()
        // The browser probe retains counters only, never response bodies or catalog objects.
        // Waiting for decoded bodies and no pending catalog reads also covers event refreshes
        // queued behind the gated first loads. Home remains the actual owning UI throughout.
        await page.waitForFunction((minimum) => {
          const reads = (window as CatalogWindow).__catalogReads
          return reads && reads.completed >= minimum && reads.pending === 0
        }, readsAtRelease)
        await expect(page.locator(homeSearch)).toBeVisible()
        await expect(page.locator('[data-slot="titlebar-tabs"] a[data-titlebar-tab-link]')).toHaveCount(0)
        const credentialRefresh = summarize(catalogRequests(credentialFrom))
        const heapRefreshed = await retainedHeap()

        // Reopen a closed workspace from Home.
        const revisit = sessions[0]!
        const revisitFrom = requests.length
        const revisitStarted = performance.now()
        await page
          .locator(`[data-component="home-session-row-container"][data-session-id="${revisit.id}"]`)
          .locator('[data-component="home-session-row"]')
          .click()
        await expectSessionTitle(page, revisit.title)
        await expect(page.locator(composerModel)).toContainText("Claude Opus 4.6")
        const revisitMs = performance.now() - revisitStarted
        const revisitRequests = summarize(catalogRequests(revisitFrom))

        // Reconnect refreshes the catalogs of the workspace on screen.
        const connection = await transport.waitForConnection()
        const reconnectFrom = requests.length
        const reconnected = transport.waitForConnection({ after: connection.id })
        await transport.close()
        await reconnected
        await expect
          .poll(
            () =>
              catalogRequests(reconnectFrom).some(
                (request) => request.path === "/api/model" && request.directory === revisit.directory,
              ) && inflight.size === 0,
          )
          .toBe(true)
        const reconnectRequests = summarize(catalogRequests(reconnectFrom))
        await expect(page.locator(composerModel)).toContainText("Claude Opus 4.6")

        expect(errors).toEqual([])
        expect(visits).toHaveLength(count)
        report(
          {
            heap: { start: heapStart, open: heapOpen, closed: heapClosed, refreshed: heapRefreshed },
            retainedAfterCloseBytes:
              heapClosed === undefined || heapStart === undefined ? undefined : heapClosed - heapStart,
            retainedAfterRefreshBytes:
              heapRefreshed === undefined || heapStart === undefined ? undefined : heapRefreshed - heapStart,
            visitCatalogRequests: visits.reduce((total, visit) => total + visit.catalogRequests, 0),
            visitMs: visits.map((visit) => Math.round(visit.ms)),
            warmSwitch,
            credentialRefresh,
            revisit: { ...revisitRequests, ms: Math.round(revisitMs) },
            reconnect: reconnectRequests,
            lateCatalogRequests:
              catalogRequests(0).length - readsAtRelease - revisitRequests.requests - reconnectRequests.requests,
          },
          {
            directories: count,
            pendingFirstResponse: pending,
            models: modelCount,
            agents: catalog.agents.length,
            commands: catalog.commands.length,
            skills: catalog.skills.length,
            responseBytes: bytes,
            transport: "playwright-route",
            gc: memory ? "explicit between phases; timing diagnostic only" : "natural; no forced GC",
            scope: "production app renderer main isolate; not total desktop RAM",
            browser: page.context().browser()!.version(),
          },
        )
        if (testInfo.repeatEachIndex === 0) await page.screenshot({ path: testInfo.outputPath("revisit.png") })
        await cdp.detach()
      },
    )
  }
}
