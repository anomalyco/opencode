/**
 * Latency benchmark — SSE vs WS binary diff (COB-41)
 *
 * Measures end-to-end event delivery time for both transport paths:
 *   SSE:  GlobalBus.emit → /event (SSE stream) → client receipt
 *   WS:   WsHub.broadcast → /ws-event (WS binary frame) → client receipt
 *
 * Payloads: 100B (×1000), 10KB (×1000), 100KB (×200)
 * Reports: p50/p95/p99/max per transport+size
 * Validation: WS p99 < 5ms for small payloads (COB-37 spec target)
 *
 * Run: OPENCODE_BENCH=1 OPENCODE_WS_SYNC=1 bun test ./test/bench/ws-vs-sse.bench.test.ts --timeout 120000
 *
 * NOTE: Tests are skipped in standard CI (bun test --timeout 30000).
 * Set OPENCODE_BENCH=1 to run. Large payloads require --timeout 120000.
 */
import { tmpdir } from "os"
import { join } from "path"
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { encodeFrame, decodeFrame } from "../../src/util/frame"
import { WsHub } from "../../src/server/ws-hub"
import { GlobalBus } from "../../src/bus/global"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePayload(sizeBytes: number): string {
  return "x".repeat(sizeBytes)
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]!
}

interface BenchResult {
  transport: string
  payloadLabel: string
  payloadBytes: number
  iterations: number
  p50: number
  p95: number
  p99: number
  max: number
  min: number
  mean: number
}

function summarize(
  transport: string,
  payloadLabel: string,
  payloadBytes: number,
  latencies: number[],
): BenchResult {
  const sorted = [...latencies].sort((a, b) => a - b)
  const sum = sorted.reduce((a, b) => a + b, 0)
  return {
    transport,
    payloadLabel,
    payloadBytes,
    iterations: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1]!,
    min: sorted[0]!,
    mean: sum / sorted.length,
  }
}

/** Yield to the event loop between each event to measure true per-event latency */
function yieldMicrotask(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}

/** Parse SSE stream lines from a ReadableStream<Uint8Array> */
async function* readSSEEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += dec.decode(value, { stream: true })
      const parts = buffer.split("\n\n")
      buffer = parts.pop()!
      for (const part of parts) {
        for (const line of part.split("\n")) {
          if (line.startsWith("data:")) {
            yield line.slice(5).trim()
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// All benchmarks require OPENCODE_BENCH=1 — they test performance, not correctness,
// and their Validation gates depend on hardware speed that varies across CI runners.
const RUN_BENCH = process.env.OPENCODE_BENCH === "1"

if (!RUN_BENCH) {
  // eslint-disable-next-line no-console
  console.log("Skipping bench tests (set OPENCODE_BENCH=1 to run)")
}

const PAYLOADS: { label: string; bytes: number; iterations: number }[] = [
  { label: "small-100B", bytes: 100, iterations: 1000 },
  { label: "medium-10KB", bytes: 10_000, iterations: 1000 },
  { label: "large-100KB", bytes: 100_000, iterations: 200 },
]

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let server: ReturnType<typeof Bun.serve> | undefined
let baseUrl: string
const results: BenchResult[] = []

beforeAll(() => {
  if (!RUN_BENCH) return
  const { Hono } = require("hono") as typeof import("hono")
  const { streamSSE } = require("hono/streaming") as typeof import("hono/streaming")
  const { upgradeWebSocket } = require("hono/bun") as typeof import("hono/bun")
  const { websocket } = require("hono/bun") as { websocket: any }

  const app = new Hono()

  // SSE route — mirrors src/server/routes/event.ts via GlobalBus
  app.get("/event", async (c) => {
    c.header("X-Accel-Buffering", "no")
    c.header("X-Content-Type-Options", "nosniff")
    return streamSSE(c, async (stream) => {
      const done = { value: false }

      const listener = (msg: { directory?: string; payload: any }) => {
        if (!done.value) {
          stream.writeSSE({ data: JSON.stringify(msg.payload) }).catch(() => {})
        }
      }

      GlobalBus.on("event", listener)

      stream.onAbort(() => {
        done.value = true
        GlobalBus.off("event", listener)
      })

      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (done.value) {
            clearInterval(check)
            resolve()
          }
        }, 50)
      })
    })
  })

  // WS route — mirrors src/server/routes/ws-event.ts
  app.get(
    "/ws-event",
    upgradeWebSocket((_c) => {
      let remove: (() => void) | undefined
      return {
        onOpen(_event, socket) {
          const raw = socket.raw as import("bun").ServerWebSocket<unknown>
          remove = WsHub.add({ ws: raw })
        },
        onClose() {
          remove?.()
        },
        onError() {
          remove?.()
        },
      }
    }),
  )

  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: app.fetch,
    websocket,
  })
  baseUrl = `http://127.0.0.1:${server.port}`
})

afterAll(async () => {
  if (!RUN_BENCH) return
  server?.stop(true)

  // Print console summary table
  console.log("\n╔══════════════════════════════════════════════════════════════════════════╗")
  console.log("║              SSE vs WS Latency Benchmark Results (COB-41)              ║")
  console.log("╠═══════════╦═══════════════╦════════╦════════╦════════╦════════╦═════════╣")
  console.log("║ Transport ║ Payload       ║  p50   ║  p95   ║  p99   ║  max   ║  mean   ║")
  console.log("╠═══════════╬═══════════════╬════════╬════════╬════════╬════════╬═════════╣")
  for (const r of results) {
    const t = r.transport.padEnd(9)
    const p = r.payloadLabel.padEnd(13)
    const fmt = (v: number) => `${v.toFixed(2)}ms`.padStart(7)
    console.log(
      `║ ${t} ║ ${p} ║${fmt(r.p50)} ║${fmt(r.p95)} ║${fmt(r.p99)} ║${fmt(r.max)} ║${fmt(r.mean)} ║`,
    )
  }
  console.log("╚═══════════╩═══════════════╩════════╩════════╩════════╩════════╩═════════╝")

  // Write JSON results to temp dir (or BENCH_OUTPUT if set)
  const outPath = process.env.BENCH_OUTPUT ?? join(tmpdir(), "ws-vs-sse-results.json")
  await Bun.write(outPath, JSON.stringify({ date: new Date().toISOString(), results }, null, 2))
  console.log(`\nResults written to ${outPath}`)
})

// ---------------------------------------------------------------------------
// SSE benchmark — uses fetch streaming (Bun has no EventSource)
// ---------------------------------------------------------------------------

describe.skipIf(!RUN_BENCH)("SSE latency", () => {
  for (const { label, bytes, iterations } of PAYLOADS) {
    test(
      `SSE ${label} (${iterations} events)`,
      async () => {
        const payload = makePayload(bytes)
        const latencies: number[] = []
        const controller = new AbortController()

        // Start consuming SSE stream; resolve streamReady on first SSE event
        let signalReady: () => void
        const streamReady = new Promise<void>((r) => { signalReady = r })

        const consumePromise = (async () => {
          const resp = await fetch(`${baseUrl}/event`, { signal: controller.signal })
          if (!resp.body) throw new Error("No response body")
          let first = true
          for await (const data of readSSEEvents(resp.body)) {
            // Signal readiness on the very first SSE frame (any type)
            if (first) { first = false; signalReady!() }
            try {
              const parsed = JSON.parse(data)
              if (parsed.type !== "bench.ping") continue
              const sent = parsed.properties?.ts as number
              if (typeof sent === "number") {
                latencies.push(performance.now() - sent)
                if (latencies.length >= iterations) return
              }
            } catch {}
          }
        })()

        // Poll-emit ready events until the SSE stream is consuming
        const readyInterval = setInterval(() => {
          GlobalBus.emit("event", {
            payload: { type: "bench.ready", properties: {} },
          })
        }, 10)
        await streamReady
        clearInterval(readyInterval)

        // Emit events with yields to measure per-event latency
        for (let i = 0; i < iterations; i++) {
          GlobalBus.emit("event", {
            payload: {
              type: "bench.ping",
              properties: { ts: performance.now(), data: payload },
            },
          })
          // Yield every 100 events to let stream flush
          if (i % 100 === 99) await yieldMicrotask()
        }

        await Promise.race([
          consumePromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`SSE ${label} timed out`)), 55_000),
          ),
        ])
        controller.abort()

        expect(latencies.length).toBe(iterations)
        const result = summarize("SSE", label, bytes, latencies)
        results.push(result)
        console.log(
          `  SSE ${label}: p50=${result.p50.toFixed(2)}ms p95=${result.p95.toFixed(2)}ms p99=${result.p99.toFixed(2)}ms max=${result.max.toFixed(2)}ms`,
        )
      },
      60_000,
    )
  }
})

// ---------------------------------------------------------------------------
// WS benchmark
// ---------------------------------------------------------------------------

describe.skipIf(!RUN_BENCH)("WS binary diff latency", () => {
  for (const { label, bytes, iterations } of PAYLOADS) {
    test(
      `WS ${label} (${iterations} events)`,
      async () => {
        const payload = makePayload(bytes)
        const latencies: number[] = []

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error(`WS ${label} timed out`)),
            60_000,
          )
          const ws = new WebSocket(`ws://127.0.0.1:${server!.port}/ws-event`)
          ws.binaryType = "arraybuffer"

          let sendIndex = 0
          let sending = false

          const sendBatch = () => {
            if (sending) return
            sending = true
            const batchEnd = Math.min(sendIndex + 100, iterations)
            for (let i = sendIndex; i < batchEnd; i++) {
              WsHub.broadcast({
                type: "bench.ping",
                properties: { ts: performance.now(), data: payload },
              })
            }
            sendIndex = batchEnd
            sending = false
            if (sendIndex < iterations) {
              setTimeout(sendBatch, 0)
            }
          }

          ws.onopen = () => {
            setTimeout(sendBatch, 50)
          }

          ws.onmessage = (msg) => {
            const now = performance.now()
            try {
              const frame =
                msg.data instanceof ArrayBuffer
                  ? new Uint8Array(msg.data)
                  : new Uint8Array((msg.data as any).buffer ?? msg.data)
              const decoded = decodeFrame(frame)
              if (decoded.type !== "bench.ping") return
              const sent = (decoded.properties as any)?.ts as number
              if (typeof sent === "number") {
                latencies.push(now - sent)
                if (latencies.length >= iterations) {
                  ws.close()
                  clearTimeout(timeout)
                  resolve()
                }
              }
            } catch {}
          }

          ws.onerror = (err) => {
            clearTimeout(timeout)
            reject(new Error(`WS error: ${err}`))
          }
        })

        expect(latencies.length).toBe(iterations)
        const result = summarize("WS", label, bytes, latencies)
        results.push(result)
        console.log(
          `  WS ${label}: p50=${result.p50.toFixed(2)}ms p95=${result.p95.toFixed(2)}ms p99=${result.p99.toFixed(2)}ms max=${result.max.toFixed(2)}ms`,
        )
      },
      60_000,
    )
  }
})

// ---------------------------------------------------------------------------
// Validation gate
// ---------------------------------------------------------------------------

describe.skipIf(!RUN_BENCH)("Validation", () => {
  test("WS p99 < 5ms for small payloads (COB-37 spec target)", () => {
    const wsSmall = results.find(
      (r) => r.transport === "WS" && r.payloadLabel === "small-100B",
    )
    expect(wsSmall).toBeDefined()
    console.log(
      `  WS small-100B: p99=${wsSmall!.p99.toFixed(2)}ms (limit: 5ms)`,
    )
    expect(wsSmall!.p99).toBeLessThan(5)
  })

  test("WS p99 < 10ms for medium payloads", () => {
    const wsMedium = results.find(
      (r) => r.transport === "WS" && r.payloadLabel === "medium-10KB",
    )
    expect(wsMedium).toBeDefined()
    console.log(
      `  WS medium-10KB: p99=${wsMedium!.p99.toFixed(2)}ms (limit: 10ms)`,
    )
    expect(wsMedium!.p99).toBeLessThan(10)
  })

  test("WS outperforms SSE for equivalent payloads", () => {
    for (const { label } of PAYLOADS) {
      const ws = results.find((r) => r.transport === "WS" && r.payloadLabel === label)
      const sse = results.find((r) => r.transport === "SSE" && r.payloadLabel === label)
      if (ws && sse) {
        console.log(
          `  ${label}: WS p50=${ws.p50.toFixed(2)}ms vs SSE p50=${sse.p50.toFixed(2)}ms`,
        )
        // WS should be faster than SSE at p50 for small/medium payloads.
        // Large payloads are serialization-bound so the difference is noise.
        if (!label.startsWith("large")) {
          expect(ws.p50).toBeLessThan(sse.p50)
        }
      }
    }
  })
})
