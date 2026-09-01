import { describe, expect, it } from "bun:test"
import {
  rankMemories,
  formatMemoriesForContext,
  type MemoryRecord,
} from "../src/memory"
import similarity from "compute-cosine-similarity"

describe("Memory Module", () => {
  it("should calculate cosine similarity correctly using compute-cosine-similarity", () => {
    const v1 = [1, 0, 0]
    const v2 = [1, 0, 0]
    const v3 = [0, 1, 0]

    expect(similarity(v1, v2)).toBeCloseTo(1.0, 5)
    expect(similarity(v1, v3)).toBeCloseTo(0.0, 5)
  })

  it("should compute similarity on real numeric vectors", () => {
    const emb1 = [0.2, 0.8, 0.1, 0.5]
    const emb2 = [0.25, 0.78, 0.08, 0.49]
    const emb3 = [-0.8, 0.1, -0.5, 0.0]

    const simRelated = similarity(emb1, emb2) ?? 0
    const simUnrelated = similarity(emb1, emb3) ?? 0

    expect(simRelated).toBeGreaterThan(0.95)
    expect(simRelated).toBeGreaterThan(simUnrelated)
  })

  it("should rank memories by similarity and recency", () => {
    const now = Date.now()
    const queryVec = new Float32Array([1, 0, 0])

    const memories: MemoryRecord[] = [
      {
        id: "1",
        userId: "user_1",
        tier: "preference",
        category: "style",
        content: "Prefers plain functions",
        confidence: 1.0,
        accessCount: 5,
        embedding: new Float32Array([1, 0, 0]),
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "2",
        userId: "user_1",
        tier: "semantic",
        category: "db",
        content: "Uses PostgreSQL",
        confidence: 1.0,
        accessCount: 1,
        embedding: new Float32Array([0, 1, 0]),
        createdAt: now,
        updatedAt: now,
      },
    ]

    const ranked = rankMemories(memories, queryVec, { now, minSimilarity: 0.0 })
    expect(ranked.length).toBe(2)
    expect(ranked[0]?.item.id).toBe("1")
  })

  it("should format categorized memories into context sections", () => {
    const scored = [
      {
        item: {
          id: "1",
          userId: "user_1",
          tier: "preference" as const,
          category: "style",
          content: "Prefers explicit operations",
          confidence: 1.0,
          accessCount: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        score: 0.9,
        similarity: 0.9,
        temporalScore: 1.0,
      },
      {
        item: {
          id: "2",
          userId: "user_1",
          tier: "semantic" as const,
          category: "tech",
          content: "FastMCP server for tools",
          confidence: 1.0,
          accessCount: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        score: 0.8,
        similarity: 0.8,
        temporalScore: 1.0,
      },
    ]

    const formatted = formatMemoriesForContext(scored)
    expect(formatted).toContain("DEVELOPER PREFERENCES:")
    expect(formatted).toContain("Prefers explicit operations")
    expect(formatted).toContain("PROJECT CONVENTIONS & INVARIANTS:")
    expect(formatted).toContain("FastMCP server for tools")
  })
})
