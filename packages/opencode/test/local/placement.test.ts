import { describe, expect, test } from "bun:test"
import { bestModel, estimateRequiredCtx, freeSlots, type Probe } from "../../src/local/placement"
import type { Provider } from "../../src/provider/provider"
import type { ModelFit, ResourceSnapshot } from "../../src/local/llama-skein/gen/types.gen"

function hw(inference?: ResourceSnapshot["inference"], loadedID?: string): ResourceSnapshot {
  return { inference, loaded_model: loadedID ? { id: loadedID } : undefined } as ResourceSnapshot
}

function fitModel(model: string, over: Partial<ModelFit>): ModelFit {
  return { model, fit_level: "good", max_safe_ctx: 0, ...over } as ModelFit
}

function info(...models: string[]): Provider.Info {
  return {
    id: "host",
    models: Object.fromEntries(models.map((m) => [m, { id: m, capabilities: { toolcall: true } }])),
  } as unknown as Provider.Info
}

function probe(models: ModelFit[], loadedID?: string): Probe {
  return {
    providerID: "host" as Probe["providerID"],
    hardware: hw({ slots_total: 1, in_flight: 0, busy: false }, loadedID),
    fit: { models } as Probe["fit"],
  }
}

describe("estimateRequiredCtx", () => {
  test("baseline overhead with no prompt", () => {
    expect(estimateRequiredCtx()).toBe(8_192)
  })
  test("adds ~1 token per 4 prompt chars", () => {
    expect(estimateRequiredCtx("x".repeat(4_000))).toBe(8_192 + 1_000)
  })
})

describe("freeSlots", () => {
  test("single idle slot is free", () => {
    expect(freeSlots(hw({ slots_total: 1, in_flight: 0, busy: false }), 0)).toBe(1)
  })
  test("single busy slot is not free", () => {
    expect(freeSlots(hw({ slots_total: 1, in_flight: 1, busy: true }), 0)).toBe(0)
  })
  test("a reservation consumes the last slot (TOCTOU guard)", () => {
    expect(freeSlots(hw({ slots_total: 1, in_flight: 0, busy: false }), 1)).toBe(0)
  })
  test("multi-slot accounts for in-flight and reservations", () => {
    expect(freeSlots(hw({ slots_total: 4, in_flight: 1, busy: false }), 1)).toBe(2)
  })
  test("older host without slot telemetry infers one slot from busyness", () => {
    expect(freeSlots(hw(undefined), 0)).toBe(1)
    expect(freeSlots(hw(undefined), 1)).toBe(0)
  })
})

describe("bestModel context-adequacy filter", () => {
  const requiredCtx = 9_000

  test("excludes a tiny-ctx model even when it is resident, perfect-fit, and fastest (the m5 bias)", () => {
    // tiny: everything the old scorer rewarded — resident, perfect VRAM fit,
    // fastest — but max_safe_ctx 0. big: merely 'good' and slower, but usable.
    const p = probe(
      [
        fitModel("tiny", { fit_level: "perfect", max_safe_ctx: 0, est_tokens_per_sec: 400 }),
        fitModel("big", { fit_level: "good", max_safe_ctx: 26_050, est_tokens_per_sec: 40 }),
      ],
      "tiny",
    )
    const result = bestModel({ probe: p, info: info("tiny", "big"), parentModelID: "cloud", requiredCtx })
    expect(result?.modelID as string | undefined).toBe("big")
  })

  test("returns null when no model's usable context fits the prompt", () => {
    const p = probe([
      fitModel("tiny", { fit_level: "perfect", max_safe_ctx: 0 }),
      fitModel("small", { fit_level: "good", max_safe_ctx: 4_096 }),
    ])
    expect(bestModel({ probe: p, info: info("tiny", "small"), parentModelID: "cloud", requiredCtx })).toBeNull()
  })

  test("selects an adequate model when one exists", () => {
    const p = probe([fitModel("big", { fit_level: "tight", max_safe_ctx: 32_768 })])
    expect(bestModel({ probe: p, info: info("big"), parentModelID: "cloud", requiredCtx })?.modelID as string).toBe(
      "big",
    )
  })
})
