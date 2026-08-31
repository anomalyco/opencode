import { describe, expect, it } from "bun:test"
import { computeInputAwareAttention, buildPersonalizationContext } from "../src/aggregator"
import { DEFAULT_USER_PROFILE } from "../src/profile"
import type { MemoryRecord } from "../src/memory"

describe("Aggregator Module (PPlug Input-Aware Engine)", () => {
  it("should calculate soft-attention weights across preferences", () => {
    const queryVec = new Float32Array([1, 0, 0])
    const pref1: MemoryRecord = {
      id: "1",
      userId: "u1",
      tier: "preference",
      category: "style",
      content: "Prefers functions",
      confidence: 1,
      accessCount: 1,
      embedding: new Float32Array([1, 0, 0]),
      createdAt: 0,
      updatedAt: 0,
    }
    const pref2: MemoryRecord = {
      id: "2",
      userId: "u1",
      tier: "preference",
      category: "db",
      content: "Prefers raw SQL",
      confidence: 1,
      accessCount: 1,
      embedding: new Float32Array([0, 1, 0]),
      createdAt: 0,
      updatedAt: 0,
    }

    const attention = computeInputAwareAttention(queryVec, [pref1, pref2], 0.5, 0.0)
    expect(attention.length).toBe(2)
    // The vector aligned with queryVec should receive a significantly higher attention weight
    expect(attention[0]?.weight).toBeGreaterThan(attention[1]?.weight ?? 0)
    expect((attention[0]?.weight ?? 0) + (attention[1]?.weight ?? 0)).toBeCloseTo(1.0, 5)
  })

  it("should assemble personalized steering context", () => {
    const context = buildPersonalizationContext({
      profile: DEFAULT_USER_PROFILE,
      memories: [
        {
          id: "1",
          userId: "u1",
          tier: "preference",
          category: "style",
          content: "Always use explicit return types",
          confidence: 1,
          accessCount: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    })

    expect(context).toContain("PERSONALIZED DEVELOPER CONTEXT (PPlug Engine)")
    expect(context).toContain("DEVELOPER PROFILE & CONVENTIONS:")
    expect(context).toContain("Always use explicit return types")
    expect(context).toContain("Repository rules (AGENTS.md) and explicit task requirements always take precedence")
  })
})
