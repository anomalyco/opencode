import { describe, expect, test } from "bun:test"
import path from "path"
import { SessionFallback } from "../../src/session/fallback"
import { Instance } from "../../src/project/instance"

const projectRoot = path.join(__dirname, "../..")

describe("SessionFallback.buildModelList", () => {
  const primary = { providerID: "p1", modelID: "m1" }

  test("returns array with only primary when no fallbacks", () => {
    expect(SessionFallback.buildModelList(primary)).toEqual([primary])
    expect(SessionFallback.buildModelList(primary, [])).toEqual([primary])
    expect(SessionFallback.buildModelList(primary, undefined)).toEqual([primary])
  })

  test("returns primary followed by fallbacks", () => {
    const fb1 = { providerID: "p2", modelID: "m2" }
    const fb2 = { providerID: "p3", modelID: "m3" }
    expect(SessionFallback.buildModelList(primary, [fb1, fb2])).toEqual([primary, fb1, fb2])
  })

  test("deduplicates when primary appears in fallbacks", () => {
    const fb1 = { providerID: "p2", modelID: "m2" }
    expect(SessionFallback.buildModelList(primary, [fb1, primary])).toEqual([primary, fb1])
  })

  test("deduplicates within fallbacks", () => {
    const fb1 = { providerID: "p2", modelID: "m2" }
    expect(SessionFallback.buildModelList(primary, [fb1, fb1, fb1])).toEqual([primary, fb1])
  })

  test("preserves first-occurrence order after deduplication", () => {
    const fb1 = { providerID: "p2", modelID: "m2" }
    const fb2 = { providerID: "p3", modelID: "m3" }
    expect(SessionFallback.buildModelList(primary, [fb1, fb2, fb1, primary])).toEqual([primary, fb1, fb2])
  })

  test("all duplicates collapse to single model", () => {
    expect(SessionFallback.buildModelList(primary, [primary, primary])).toEqual([primary])
  })
})

describe("SessionFallback.nextIndex", () => {
  test("cycles to next index", () => {
    expect(SessionFallback.nextIndex(0, 4, 0)).toBe(1)
  })

  test("wraps around at end of list", () => {
    expect(SessionFallback.nextIndex(3, 4, 0)).toBeUndefined()
  })

  test("returns undefined when all models tried (full cycle)", () => {
    expect(SessionFallback.nextIndex(0, 3, 1)).toBeUndefined()
  })

  test("cycles correctly with non-zero start", () => {
    expect(SessionFallback.nextIndex(2, 4, 2)).toBe(3)
    expect(SessionFallback.nextIndex(3, 4, 2)).toBe(0)
    expect(SessionFallback.nextIndex(0, 4, 2)).toBe(1)
    expect(SessionFallback.nextIndex(1, 4, 2)).toBeUndefined()
  })

  test("returns undefined for single model list", () => {
    expect(SessionFallback.nextIndex(0, 1, 0)).toBeUndefined()
  })

  test("cycles all models with two-model list", () => {
    expect(SessionFallback.nextIndex(0, 2, 0)).toBe(1)
    expect(SessionFallback.nextIndex(1, 2, 0)).toBeUndefined()
  })

  test("treats out-of-bounds startIndex as 0", () => {
    // startIndex === total
    expect(SessionFallback.nextIndex(0, 3, 3)).toBe(1)
    expect(SessionFallback.nextIndex(1, 3, 3)).toBe(2)
    expect(SessionFallback.nextIndex(2, 3, 3)).toBeUndefined()

    // startIndex > total
    expect(SessionFallback.nextIndex(0, 3, 10)).toBe(1)
    expect(SessionFallback.nextIndex(2, 3, 10)).toBeUndefined()
  })
})

describe("SessionFallback.recordSuccess / getStartIndex", () => {
  test("defaults to 0 when no record exists", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        expect(SessionFallback.getStartIndex("unknown-session", "unknown-agent")).toBe(0)
      },
    })
  })

  test("remembers the last successful model index", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        SessionFallback.recordSuccess("s1", "agent1", 2)
        expect(SessionFallback.getStartIndex("s1", "agent1")).toBe(2)
      },
    })
  })

  test("updates on subsequent successes", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        SessionFallback.recordSuccess("s2", "agent2", 1)
        expect(SessionFallback.getStartIndex("s2", "agent2")).toBe(1)

        SessionFallback.recordSuccess("s2", "agent2", 3)
        expect(SessionFallback.getStartIndex("s2", "agent2")).toBe(3)
      },
    })
  })

  test("tracks different session/agent combinations independently", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        SessionFallback.recordSuccess("s3", "agentA", 1)
        SessionFallback.recordSuccess("s3", "agentB", 2)
        SessionFallback.recordSuccess("s4", "agentA", 3)

        expect(SessionFallback.getStartIndex("s3", "agentA")).toBe(1)
        expect(SessionFallback.getStartIndex("s3", "agentB")).toBe(2)
        expect(SessionFallback.getStartIndex("s4", "agentA")).toBe(3)
      },
    })
  })
})

describe("SessionFallback full cycle simulation", () => {
  test("request 1: primary fails, fb1 fails, fb2 succeeds → remembers 2", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const models = [
          { providerID: "p0", modelID: "m0" },
          { providerID: "p1", modelID: "m1" },
          { providerID: "p2", modelID: "m2" },
          { providerID: "p3", modelID: "m3" },
        ]
        const list = SessionFallback.buildModelList(models[0], models.slice(1))
        expect(list).toHaveLength(4)

        const startIndex = 0
        let current = startIndex

        // model 0 fails → try next
        const next1 = SessionFallback.nextIndex(current, list.length, startIndex)
        expect(next1).toBe(1)
        current = next1!

        // model 1 fails → try next
        const next2 = SessionFallback.nextIndex(current, list.length, startIndex)
        expect(next2).toBe(2)
        current = next2!

        // model 2 succeeds
        SessionFallback.recordSuccess("sim", "test", current)
        expect(SessionFallback.getStartIndex("sim", "test")).toBe(2)
      },
    })
  })

  test("all models fail → nextIndex returns undefined after full cycle", () => {
    const startIndex = 0
    let current = startIndex

    current = SessionFallback.nextIndex(current, 3, startIndex)!
    expect(current).toBe(1)

    current = SessionFallback.nextIndex(current, 3, startIndex)!
    expect(current).toBe(2)

    const result = SessionFallback.nextIndex(current, 3, startIndex)
    expect(result).toBeUndefined()
  })

  test("request 2: starts from remembered model, cycles remaining then wraps", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // Previous request remembered model 2
        SessionFallback.recordSuccess("r2", "agent", 2)
        const startIndex = SessionFallback.getStartIndex("r2", "agent")
        expect(startIndex).toBe(2)

        let current = startIndex

        // model 2 (remembered) fails → try 3
        const next1 = SessionFallback.nextIndex(current, 4, startIndex)
        expect(next1).toBe(3)
        current = next1!

        // model 3 fails → wrap to 0
        const next2 = SessionFallback.nextIndex(current, 4, startIndex)
        expect(next2).toBe(0)
        current = next2!

        // model 0 fails → try 1
        const next3 = SessionFallback.nextIndex(current, 4, startIndex)
        expect(next3).toBe(1)
        current = next3!

        // model 1 succeeds
        SessionFallback.recordSuccess("r2", "agent", current)
        expect(SessionFallback.getStartIndex("r2", "agent")).toBe(1)

        // all tried → undefined
        const next4 = SessionFallback.nextIndex(current, 4, startIndex)
        expect(next4).toBeUndefined()
      },
    })
  })

  test("remembered model unresolvable: caller resets startIndex to 0, full cycle available", () => {
    // Simulates processor.ts behavior: remembered model (index 2) fails to resolve,
    // caller resets both currentModelIndex and fallbackStartIndex to 0.
    // All 4 models should be reachable in the cycle.
    const startIndex = 0
    let current = startIndex

    // model 0 (primary) fails → try 1
    current = SessionFallback.nextIndex(current, 4, startIndex)!
    expect(current).toBe(1)

    // model 1 fails → try 2
    current = SessionFallback.nextIndex(current, 4, startIndex)!
    expect(current).toBe(2)

    // model 2 fails → try 3
    current = SessionFallback.nextIndex(current, 4, startIndex)!
    expect(current).toBe(3)

    // all tried → undefined
    const result = SessionFallback.nextIndex(current, 4, startIndex)
    expect(result).toBeUndefined()
  })

  test("recordSuccess can reset back to primary (index 0)", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        SessionFallback.recordSuccess("reset", "agent", 2)
        expect(SessionFallback.getStartIndex("reset", "agent")).toBe(2)

        // Primary recovered, record success at 0
        SessionFallback.recordSuccess("reset", "agent", 0)
        expect(SessionFallback.getStartIndex("reset", "agent")).toBe(0)
      },
    })
  })
})
