import { describe, expect, test } from "bun:test"
import { KanbanBoard, Health, AlertRule } from "./monitor-schema"
import { deriveMood, nextQuip } from "./monitor-tabby"
import { createMonitorClient } from "./monitor-sdk"

describe("monitor/schema", () => {
  test("KanbanBoard parses", () => {
    const parsed = KanbanBoard.parse({
      view: "sessions",
      columns: { working: [], waiting: [], completed: [], error: [], abandoned: [] },
      generated_at: 1,
    })
    expect(parsed.view).toBe("sessions")
  })

  test("Health rejects out-of-range score", () => {
    expect(() =>
      Health.parse({
        score: 150,
        components: { success_rate: 0, cache_hit_rate: 0, error_rate: 0, heap_pct: 0 },
        window_sec: 300,
        generated_at: 1,
      }),
    ).toThrow()
  })

  test("AlertRule round-trip preserves condition", () => {
    const r = AlertRule.parse({
      id: "r1",
      project_id: "p1",
      name: "many errors",
      type: "event-pattern",
      condition: { type: "event-pattern", event_type: "message.updated", min_count: 3, window_sec: 60 },
      cooldown_sec: 300,
      enabled: true,
      time_created: 0,
      time_updated: 0,
    })
    expect(r.condition).toMatchObject({ type: "event-pattern", min_count: 3 })
  })
})

describe("monitor/tabby", () => {
  test("disconnected overrides everything", () => {
    expect(
      deriveMood({ active_sessions: 5, errored_sessions: 0, last_event_at: 1, last_error_at: null, connected: false }, 2),
    ).toBe("disconnected")
  })

  test("happy within 30s", () => {
    const now = 1_000_000
    expect(
      deriveMood({ active_sessions: 1, errored_sessions: 0, last_event_at: now - 5_000, last_error_at: null, connected: true }, now),
    ).toBe("happy")
  })

  test("quips are localised", () => {
    expect(nextQuip("worried", "en")).toBe("Heads up — there's an errored session.")
    expect(nextQuip("worried", "zh")).toBe("注意：有一个出错会话。")
  })
})

describe("monitor/sdk", () => {
  test("issues typed GET to /monitor/health", async () => {
    let requested = ""
    const client = createMonitorClient({
      baseUrl: "http://x.local",
      headers: undefined,
    })
    // Monkey-patch fetch for the duration of the call.
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requested = `${init?.method ?? "GET"} ${String(url)}`
      return new Response(
        JSON.stringify({
          score: 80,
          components: { success_rate: 90, cache_hit_rate: 70, error_rate: 5, heap_pct: 20 },
          window_sec: 300,
          generated_at: 1,
        }),
        { headers: { "content-type": "application/json" } },
      )
    }) as typeof fetch
    try {
      const health = await client.health()
      expect(health.score).toBe(80)
      expect(requested).toBe("GET http://x.local/monitor/health")
    } finally {
      globalThis.fetch = realFetch
    }
  })
})