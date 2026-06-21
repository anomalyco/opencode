import { describe, expect, test } from "bun:test"
import type { MemorySource } from "@/evolution/brain/memory"
import type { MemoryEntry } from "@/evolution/brain/memory"

describe("G4 — MemorySource field", () => {
  const entry: MemoryEntry = {
    id: "1",
    type: "lesson",
    content: "test",
    tags: [],
    created: 0,
    updated: 0,
  }

  test("optional source field is undefined by default", () => {
    expect(entry.source).toBeUndefined()
  })

  test("human source shape", () => {
    const source: MemorySource = { type: "human", userId: "user-1" }
    expect(source.type).toBe("human")
    expect(source.userId).toBe("user-1")
  })

  test("agent source shape", () => {
    const source: MemorySource = { type: "agent", agentId: "risk-analyst" }
    expect(source.type).toBe("agent")
    expect(source.agentId).toBe("risk-analyst")
  })

  test("system source shape", () => {
    const source: MemorySource = { type: "system", reason: "compaction" }
    expect(source.type).toBe("system")
    expect(source.reason).toBe("compaction")
  })

  test("llm source shape", () => {
    const source: MemorySource = { type: "llm", modelId: "gpt-4", sessionId: "s1" }
    expect(source.type).toBe("llm")
    expect(source.modelId).toBe("gpt-4")
    expect(source.sessionId).toBe("s1")
  })

  test("MemoryEntry accepts source", () => {
    const withSource: MemoryEntry = { ...entry, source: { type: "human", userId: "u1" } }
    expect(withSource.source?.type).toBe("human")
  })

  test("MemoryEntry accepts confidence", () => {
    const withConf: MemoryEntry = { ...entry, confidence: 0.8 }
    expect(withConf.confidence).toBe(0.8)
  })

  test("confidence defaults to undefined (backward compat)", () => {
    expect(entry.confidence).toBeUndefined()
  })
})
