import { describe, expect, test } from "bun:test"
import { capacitySnapshot, DefaultFreshnessMs, unreachableSnapshot } from "../../src/local/capacity"
import type { ResourceSnapshot } from "../../src/local/llama-skein/gen/types.gen"

function hw(over: Partial<ResourceSnapshot>): ResourceSnapshot {
  return over as ResourceSnapshot
}

function gpus(utilization_pct: number) {
  return [{ utilization_pct }] as ResourceSnapshot["gpus"]
}

const AT = 1_000_000

function snap(hardware: ResourceSnapshot, now = AT) {
  return capacitySnapshot({ provider: "host", baseURL: "http://h:8080", hardware, probedAt: AT, now })
}

describe("exact queue telemetry beats utilisation", () => {
  // The regression this module exists for. z4, measured 2026-07-26: 85% GPU
  // utilisation with an empty queue and the model resident. A scheduler reading
  // utilisation skips a completely free 48GB host.
  test("z4: high GPU utilisation with an empty queue is free", () => {
    const s = snap(
      hw({
        gpus: gpus(85),
        inference: { busy: false, in_flight: 0, slots_total: 1 },
        loaded_model: { id: "qwen3.6-35b-a3b-q8-0" },
      }),
    )
    expect(s.signal).toBe("exact")
    expect(s.busy).toBe(false)
    expect(s.freeSlots).toBe(1)
    expect(s.loadedModel).toBe("qwen3.6-35b-a3b-q8-0")
  })

  test("rocky: a genuinely serving host is busy", () => {
    const s = snap(hw({ gpus: gpus(99), inference: { busy: true, in_flight: 1, slots_total: 1 } }))
    expect(s.signal).toBe("exact")
    expect(s.busy).toBe(true)
    expect(s.freeSlots).toBe(0)
  })

  test("proxmox: low utilisation and empty queue is free", () => {
    const s = snap(hw({ gpus: gpus(3), inference: { busy: false, in_flight: 0, slots_total: 1 } }))
    expect(s.freeSlots).toBe(1)
    expect(s.busy).toBe(false)
  })

  test("utilisation never overrides queue depth in either direction", () => {
    // Idle meters, full queue — still busy.
    const s = snap(hw({ gpus: gpus(0), inference: { busy: true, in_flight: 1, slots_total: 1 } }))
    expect(s.busy).toBe(true)
    expect(s.freeSlots).toBe(0)
  })
})

describe("multi-slot hosts", () => {
  test("reports partial capacity rather than a binary verdict", () => {
    const s = snap(hw({ inference: { busy: false, in_flight: 1, slots_total: 4 } }))
    expect(s.freeSlots).toBe(3)
    expect(s.slotsTotal).toBe(4)
    expect(s.inFlight).toBe(1)
  })

  test("a saturated multi-slot host is busy", () => {
    const s = snap(hw({ inference: { in_flight: 4, slots_total: 4 } }))
    expect(s.freeSlots).toBe(0)
    expect(s.busy).toBe(true)
  })

  test("free slots never go negative", () => {
    const s = snap(hw({ inference: { in_flight: 9, slots_total: 4 } }))
    expect(s.freeSlots).toBe(0)
  })
})

describe("inferred signal", () => {
  test("a host with no inference block is labelled inferred", () => {
    const s = snap(hw({ gpus: gpus(5) }))
    expect(s.signal).toBe("inferred")
    expect(s.busy).toBe(false)
    expect(s.freeSlots).toBe(1)
  })

  test("high utilisation with no queue telemetry is treated as busy", () => {
    const s = snap(hw({ gpus: gpus(85) }))
    expect(s.signal).toBe("inferred")
    expect(s.busy).toBe(true)
    expect(s.freeSlots).toBe(0)
  })

  test("falls back to CPU when no GPU is reported", () => {
    expect(snap(hw({ cpu: { util_avg_pct: 90 } as ResourceSnapshot["cpu"] })).busy).toBe(true)
    expect(snap(hw({ cpu: { util_avg_pct: 2 } as ResourceSnapshot["cpu"] })).busy).toBe(false)
  })
})

describe("freshness and reachability", () => {
  test("a recent probe is not stale", () => {
    expect(snap(hw({ inference: { in_flight: 0, slots_total: 1 } }), AT + 1_000).stale).toBe(false)
  })

  test("a probe older than the bound is stale but keeps its age", () => {
    const s = snap(hw({ inference: { in_flight: 0, slots_total: 1 } }), AT + DefaultFreshnessMs + 1)
    expect(s.stale).toBe(true)
    expect(s.ageMs).toBe(DefaultFreshnessMs + 1)
  })

  test("an unreachable host is not reported as idle", () => {
    const s = unreachableSnapshot({ provider: "host", baseURL: "http://h:8080", probedAt: AT, now: AT + 10 })
    expect(s.reachable).toBe(false)
    // The trap: absent must not read as zero in flight / one free slot.
    expect(s.inFlight).toBeUndefined()
    expect(s.freeSlots).toBeUndefined()
    expect(s.busy).toBeUndefined()
    expect(s.signal).toBeUndefined()
  })

  test("a reachable host is marked reachable", () => {
    expect(snap(hw({ inference: { in_flight: 0, slots_total: 1 } })).reachable).toBe(true)
  })
})
