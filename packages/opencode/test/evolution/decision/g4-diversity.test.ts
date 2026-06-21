import { describe, expect, test } from "bun:test"
import { computeDiversity } from "@/evolution/decision/diversity"

describe("G4 — Diversity Index (EDI)", () => {
  test("identical proposals → EDI = 0, warning = true", () => {
    const r = computeDiversity([
      { agentId: "a", text: "use Effect for async" },
      { agentId: "b", text: "use Effect for async" },
    ])
    expect(r.edi).toBe(0)
    expect(r.falseConsensusWarning).toBe(true)
  })

  test("three identical proposals → EDI = 0", () => {
    const r = computeDiversity([
      { agentId: "a", text: "use Effect for async" },
      { agentId: "b", text: "use Effect for async" },
      { agentId: "c", text: "use Effect for async" },
    ])
    expect(r.edi).toBe(0)
  })

  test("completely different proposals → EDI close to 1, warning = false", () => {
    const r = computeDiversity([
      { agentId: "a", text: "use Effect for async" },
      { agentId: "b", text: "write REST API Express" },
    ])
    expect(r.edi).toBeGreaterThan(0.5)
    expect(r.falseConsensusWarning).toBe(false)
  })

  test("single proposal → EDI = 1 (degenerate)", () => {
    const r = computeDiversity([{ agentId: "a", text: "use Effect" }])
    expect(r.edi).toBe(1)
    expect(r.falseConsensusWarning).toBe(false)
  })

  test("pairwiseSimilarity includes self-similarity = 1", () => {
    const r = computeDiversity([
      { agentId: "a", text: "hello world" },
      { agentId: "b", text: "foo bar" },
    ])
    expect(r.pairwiseSimilarity.get("a")?.get("a")).toBe(1)
    expect(r.pairwiseSimilarity.get("b")?.get("b")).toBe(1)
  })

  test("perAgentUniqueness is 1 for single agent", () => {
    const r = computeDiversity([{ agentId: "a", text: "test" }])
    expect(r.perAgentUniqueness.get("a")).toBe(1)
  })

  test("all-empty text → EDI = 0 (both identical, Jaccard=1)", () => {
    const r = computeDiversity([
      { agentId: "a", text: "" },
      { agentId: "b", text: "" },
    ])
    expect(r.edi).toBe(0)
  })
})
