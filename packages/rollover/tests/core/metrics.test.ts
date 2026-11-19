import { describe, expect, test } from "bun:test"
import { metricEvent, METRIC_EVENTS } from "../../src/core/metrics"

describe("metrics", () => {
  test("every event type in the spec table exists", () => {
    const expected = [
      "llm_call", "extraction_started", "extraction_completed", "extraction_failed",
      "consolidation_started", "consolidation_completed", "consolidation_failed",
      "swap", "swap_deferred", "cutoff_missing", "render_truncated", "rollover_error",
      "ledger_enriched",
    ] as const
    expect(METRIC_EVENTS).toEqual(expected)
  })

  test("event carries ev/ts/sessionId", () => {
    const ev = metricEvent("swap", "sid1", 2, { tokensBefore: 100 })
    expect(ev.ev).toBe("swap")
    expect(typeof ev.ts).toBe("number")
    expect(ev.sessionId).toBe("sid1")
    expect(ev.epoch).toBe(2)
    expect((ev as unknown as { tokensBefore: number }).tokensBefore).toBe(100)
  })

  test("epoch optional for non-swap events", () => {
    const ev = metricEvent("extraction_failed", "sid1", undefined, { detail: "bad json" })
    expect(ev.epoch).toBeUndefined()
    expect((ev as unknown as { detail: string }).detail).toBe("bad json")
  })
})
