import { describe, expect, test } from "bun:test"
import {
  bestModel,
  capacityFromProbe,
  estimateRequiredCtx,
  freeSlots,
  parentCapacity,
  type Probe,
} from "../../src/local/placement"
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

describe("placement result serializability", () => {
  // Regression: pick() once returned {...placement, release} — one object with
  // a function on it. task.ts put that object into part metadata, and
  // Session.updatePart structuredClone()s every part event, so any placed
  // subagent died with DataCloneError ("The object can not be cloned") while
  // inherit-parent spawns kept working. The data half must clone; the merged
  // shape must remain a known-toxic example.
  test("placement data half survives structuredClone; merged shape does not", () => {
    const result = { placement: { providerID: "host", modelID: "m" }, release: () => {} }
    expect(() => structuredClone({ model: result.placement })).not.toThrow()
    expect(() => structuredClone({ model: result })).toThrow()
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

describe("bestModel resident-model tier (skein rule: loaded > preferred > any)", () => {
  const requiredCtx = 9_000

  test("an eligible resident model beats swapping to the parent's own model", () => {
    const p = probe(
      [
        fitModel("resident", { fit_level: "good", max_safe_ctx: 32_768, est_tokens_per_sec: 40 }),
        fitModel("parentm", { fit_level: "perfect", max_safe_ctx: 32_768, est_tokens_per_sec: 400 }),
      ],
      "resident",
    )
    const result = bestModel({ probe: p, info: info("resident", "parentm"), parentModelID: "parentm", requiredCtx })
    expect(result?.modelID as string | undefined).toBe("resident")
  })

  test("with nothing resident, the parent's model is preferred over a better fit", () => {
    const p = probe([
      fitModel("parentm", { fit_level: "good", max_safe_ctx: 32_768 }),
      fitModel("other", { fit_level: "perfect", max_safe_ctx: 32_768 }),
    ])
    const result = bestModel({ probe: p, info: info("parentm", "other"), parentModelID: "parentm", requiredCtx })
    expect(result?.modelID as string | undefined).toBe("parentm")
  })

  test("residency never overrides vetting — an unlisted resident model loses to an allowed cold one", () => {
    const p = probe(
      [
        fitModel("resident", { fit_level: "perfect", max_safe_ctx: 32_768 }),
        fitModel("vetted", { fit_level: "good", max_safe_ctx: 32_768 }),
      ],
      "resident",
    )
    const result = bestModel({
      probe: p,
      info: info("resident", "vetted"),
      parentModelID: "cloud",
      requiredCtx,
      allowedModels: ["vetted"],
    })
    expect(result?.modelID as string | undefined).toBe("vetted")
  })
})

// Regression guard for the reported session hang: a subagent was dispatched to
// the parent's own single-slot provider whenever placement found no idle peer,
// where it queued behind its parent and never returned.
describe("parent capacity gate", () => {
  test("busy single-slot parent reports no-slot", () => {
    const busy = { ...probe([]), hardware: hw({ slots_total: 1, in_flight: 1, busy: true }) }
    expect(capacityFromProbe(busy, 0)).toBe("no-slot")
  })

  test("idle parent reports free", () => {
    expect(capacityFromProbe(probe([]), 0)).toBe("free")
  })

  test("a reservation consumes the only slot", () => {
    expect(capacityFromProbe(probe([]), 1)).toBe("no-slot")
  })

  test("unprobeable parent is unknown — blocks inheritance to avoid hangs", () => {
    // A probe failure means we cannot confirm the parent has a free slot.
    // Inheriting would risk queuing behind it on a single-slot server.
    // task.ts treats "unknown" the same as "no-slot" for this reason.
    expect(capacityFromProbe(undefined, 0)).toBe("unknown")
  })

  test("cloud parent is always free — no slot model, no queue", async () => {
    const cloud = { id: "anthropic", models: {} } as unknown as Provider.Info
    const got = await parentCapacity({
      parent: { providerID: "anthropic" as never, modelID: "m" as never },
      providers: { anthropic: cloud },
    })
    expect(got).toBe("free")
  })

  test("unknown parent provider blocks inheritance", async () => {
    const got = await parentCapacity({
      parent: { providerID: "ghost" as never, modelID: "m" as never },
      providers: {},
    })
    expect(got).toBe("unknown")
    // task.ts checks `capacity !== "free"` — unknown blocks inheritance.
  })
})

describe("bestModel host-paced placement (hybrid GPU + system RAM)", () => {
  const requiredCtx = 9_000

  // Measured on z4: the same host serves a full-GPU model at 70 tok/s and a
  // cpu-bound-hybrid one at 0.81 tok/s. Both report ready, and the hybrid
  // model scored fit_level "tight" — so residency alone used to hand a
  // subagent the ~90x slower model.
  test("a resident host-paced model loses to a non-resident GPU model", () => {
    const p = probe(
      [
        fitModel("hybrid", {
          fit_level: "tight",
          max_safe_ctx: 26_050,
          est_tokens_per_sec: 1,
          placement: { mode: "hybrid", perf_class: "cpu-bound-hybrid" },
        }),
        fitModel("gpu", { fit_level: "good", max_safe_ctx: 32_768, est_tokens_per_sec: 70 }),
      ],
      "hybrid", // the slow one is the resident one
    )
    const result = bestModel({ probe: p, info: info("hybrid", "gpu"), parentModelID: "cloud", requiredCtx })
    expect(result?.modelID as string | undefined).toBe("gpu")
  })

  // Degrade preference, not availability: a model that only runs hybrid is
  // the only way to run that model at all.
  test("a host-paced model is still chosen when it is the only candidate", () => {
    const p = probe([
      fitModel("hybrid", {
        fit_level: "tight",
        max_safe_ctx: 26_050,
        placement: { mode: "hybrid", perf_class: "cpu-bound-hybrid" },
      }),
    ])
    const result = bestModel({ probe: p, info: info("hybrid"), parentModelID: "cloud", requiredCtx })
    expect(result?.modelID as string | undefined).toBe("hybrid")
  })

  // fast-hybrid keeps most weights on the card and is not bandwidth-paced,
  // so it must not be penalised.
  test("a fast-hybrid placement is not penalised", () => {
    const p = probe([
      fitModel("fast", {
        fit_level: "good",
        max_safe_ctx: 32_768,
        est_tokens_per_sec: 50,
        placement: { mode: "hybrid", perf_class: "fast-hybrid" },
      }),
      fitModel("plain", { fit_level: "good", max_safe_ctx: 32_768, est_tokens_per_sec: 10 }),
    ])
    const result = bestModel({ probe: p, info: info("fast", "plain"), parentModelID: "cloud", requiredCtx })
    expect(result?.modelID as string | undefined).toBe("fast")
  })

  // Models with no placement data at all (an older llama-skein) behave
  // exactly as before.
  test("absent placement data changes nothing", () => {
    const p = probe(
      [
        fitModel("resident", { fit_level: "good", max_safe_ctx: 32_768, est_tokens_per_sec: 40 }),
        fitModel("faster", { fit_level: "perfect", max_safe_ctx: 32_768, est_tokens_per_sec: 400 }),
      ],
      "resident",
    )
    const result = bestModel({ probe: p, info: info("resident", "faster"), parentModelID: "cloud", requiredCtx })
    expect(result?.modelID as string | undefined).toBe("resident")
  })
})
