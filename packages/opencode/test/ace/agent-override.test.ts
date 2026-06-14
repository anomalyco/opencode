import { describe, expect, test } from "bun:test"
import { mergeAgentOverride, resolve, type AceConfig } from "@/ace/policy"

const base = {
  enabled: true,
  mode: "fixed-cap",
  limits: { toolCallsPerTurn: 30, spawnsPerSession: 5 },
  agents: {
    explore: { mode: "monitor", limits: { spawnsPerSession: 20 } },
    payments: { mode: "reject-escalate", maxSpawns: 1, message: "payments are strict" },
  },
} as unknown as AceConfig

describe("mergeAgentOverride", () => {
  test("returns base unchanged when no agent name", () => {
    expect(mergeAgentOverride(base, undefined)).toBe(base)
  })

  test("returns base unchanged when agent has no override", () => {
    expect(mergeAgentOverride(base, "build")).toBe(base)
  })

  test("applies a looser override (explore)", () => {
    const merged = mergeAgentOverride(base, "explore")!
    const p = resolve(merged)
    expect(p.mode).toBe("monitor")
    // overridden limit
    expect(p.limits.spawnsPerSession).toBe(20)
    // non-overridden limit inherited from base
    expect(p.limits.toolCallsPerTurn).toBe(30)
  })

  test("applies a stricter override (payments)", () => {
    const merged = mergeAgentOverride(base, "payments")!
    const p = resolve(merged)
    expect(p.mode).toBe("reject-escalate")
    // maxSpawns feeds spawnsPerSession in resolve()
    expect(p.limits.spawnsPerSession).toBe(1)
    expect(p.message).toBe("payments are strict")
  })

  test("does not mutate the base config", () => {
    mergeAgentOverride(base, "explore")
    expect((base as any).mode).toBe("fixed-cap")
    expect((base as any).limits.spawnsPerSession).toBe(5)
  })

  test("returns undefined config untouched", () => {
    expect(mergeAgentOverride(undefined, "explore")).toBeUndefined()
  })
})
