import { createServer, type ServerResponse } from "node:http"
import type { OpenCodeEvent } from "@opencode-ai/client/promise"
import { benchmark, benchmarkDiagnostics, expect } from "../benchmark"
import {
  buildInitialStreamEvent,
  buildStreamDeltaEvents,
  setupTimelineBenchmark,
  textPartID,
} from "./session-timeline-benchmark.fixture"

type Probe = { calls: number; entries: number; ms: number }
type Measurement = { frames: number[]; started: number; ready: number; rowReplacements: number; stop: () => void }
declare global {
  interface Window {
    __timelineProjectionProbe?: Probe
    __projectionMeasurement: Measurement
  }
}

benchmark.use({ traceScope: "interaction" })

for (const scenario of [
  { historyTurns: 40, historyShape: "mixed" },
  { historyTurns: 320, historyShape: "mixed" },
  { historyTurns: 320, historyShape: "tool-heavy" },
] as const) {
  benchmark(`text projection ${scenario.historyTurns} ${scenario.historyShape}`, async ({ page, report }) => {
    benchmark.setTimeout(120_000)
    const responses = new Set<ServerResponse>()
    const source = createServer((request, response) => {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "access-control-allow-origin": "*",
        "cache-control": "no-cache",
      })
      response.write(
        `data: ${JSON.stringify({ id: "evt_projection_connected", type: "server.connected", data: {} })}\n\n`,
      )
      responses.add(response)
      request.on("close", () => responses.delete(response))
    })
    await new Promise<void>((resolve) => source.listen(0, "127.0.0.1", resolve))
    const address = source.address()
    if (!address || typeof address === "string") throw new Error("Missing fixture SSE address")
    let timer: ReturnType<typeof setInterval> | undefined
    const send = (events: OpenCodeEvent[]) =>
      responses.forEach((response) => events.forEach((event) => response.write(`data: ${JSON.stringify(event)}\n\n`)))
    try {
      await page.addInitScript(
        ({ url, counters }) => {
          Object.assign(window, { __testSseTransport: true })
          if (counters) window.__timelineProjectionProbe = { calls: 0, entries: 0, ms: 0 }
          const fetch = window.fetch.bind(window)
          const intercept = (input: RequestInfo | URL, init?: RequestInit) => {
            const request = new Request(input, init)
            return fetch(
              new URL(request.url).pathname === "/api/event" ? new Request(url, { signal: request.signal }) : request,
            )
          }
          Object.defineProperty(window, "fetch", { configurable: true, writable: true, value: intercept })
        },
        { url: `http://127.0.0.1:${address.port}`, counters: process.env.PROJECTION_COUNTERS === "1" },
      )
      const initialStarted = performance.now()
      const fixture = await setupTimelineBenchmark(page, { ...scenario, busy: true, eventBatch: 1 })
      await expect.poll(() => responses.size).toBe(1)
      const deltas = buildStreamDeltaEvents(160)
      send(buildInitialStreamEvent(160))
      await expect(fixture.text).toContainText("Implementation plan")
      await expect(fixture.text.locator('[data-component="markdown"]')).toHaveAttribute("data-markdown-ready", "")
      const initialReadyMs = performance.now() - initialStarted
      await fixture.scrollToBottom()
      await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible()
      await benchmarkDiagnostics(page).startTrace()
      await page.evaluate(
        ({ partID, counters }) => {
          const part = document.querySelector(`[data-timeline-part-id="${partID}"]`)
          const row = part?.closest("[data-timeline-key]")
          if (!row) throw new Error("Missing active row")
          if (counters) {
            if (!window.__timelineProjectionProbe?.calls)
              throw new Error("Projection instrumentation did not observe initial construction")
            window.__timelineProjectionProbe = { calls: 0, entries: 0, ms: 0 }
          }
          const measurement: Measurement = {
            frames: [],
            started: performance.now(),
            ready: 0,
            rowReplacements: 0,
            stop: () => {},
          }
          window.__projectionMeasurement = measurement
          let previous: number | undefined
          let frame = 0
          let current = row
          const sample = (now: number) => {
            if (previous !== undefined) measurement.frames.push(now - previous)
            previous = now
            const next = document.querySelector(`[data-timeline-part-id="${partID}"]`)?.closest("[data-timeline-key]")
            if (next && next !== current) {
              measurement.rowReplacements++
              current = next
            }
            const markdown = next?.querySelector('[data-component="markdown"][data-markdown-ready]')
            if (markdown?.textContent?.includes("benchmark-complete")) {
              measurement.ready = performance.now() - measurement.started
              return
            }
            frame = requestAnimationFrame(sample)
          }
          measurement.stop = () => cancelAnimationFrame(frame)
          frame = requestAnimationFrame(sample)
        },
        { partID: textPartID, counters: process.env.PROJECTION_COUNTERS === "1" },
      )
      const emitted: number[] = []
      const started = performance.now()
      // The source clock runs in Node, never waiting for a renderer acknowledgement.
      await new Promise<void>((resolve) => {
        timer = setInterval(() => {
          const event = deltas[emitted.length]
          if (!event) throw new Error("Unexpected source overrun")
          send([event])
          emitted.push(performance.now() - started)
          if (emitted.length !== deltas.length) return
          clearInterval(timer)
          resolve()
        }, 25)
      })
      await expect(fixture.text).toContainText("benchmark-complete")
      await expect(fixture.text.locator('[data-component="markdown"]')).toHaveAttribute("data-markdown-ready", "")
      await page.waitForFunction(() => window.__projectionMeasurement.ready > 0)
      const metrics = await page.evaluate(() => {
        const data = window.__projectionMeasurement
        data.stop()
        return {
          frames: data.frames,
          readyMs: data.ready,
          rowReplacements: data.rowReplacements,
          projection: window.__timelineProjectionProbe ?? null,
        }
      })
      expect(emitted).toHaveLength(160)
      expect(metrics.frames.length).toBeGreaterThan(0)
      await benchmarkDiagnostics(page).stop()
      report(
        { ...metrics, initialReadyMs, emitted },
        {
          ...scenario,
          ...fixture.workload,
          deltaBytes: Buffer.byteLength(JSON.stringify(deltas)),
          counters: process.env.PROJECTION_COUNTERS === "1",
          intervalMs: 25,
          deltas: 160,
          viewport: "1366x768",
          revision: process.env.PROJECTION_REVISION,
        },
      )
      if (process.env.PROJECTION_SCREENSHOT)
        await page.screenshot({
          path: `${process.env.PROJECTION_SCREENSHOT}-${scenario.historyTurns}-${scenario.historyShape}.png`,
        })
    } finally {
      clearInterval(timer)
      source.closeAllConnections()
      await new Promise<void>((resolve, reject) => source.close((error) => (error ? reject(error) : resolve())))
    }
  })
}
