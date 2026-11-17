import { describe, expect, test } from "bun:test"
import { evaluateRetention, type RetentionArtifacts } from "../../bench/retention"
import type { HiddenCase } from "../../bench/runner"

const hidden: HiddenCase = {
  id: "BX",
  expectsRollover: true,
  facts: [
    { kind: "objective", text: "migrate the deploy script to bun" },
    { kind: "decision", text: "keep rsync instead of scp" },
    { kind: "user_correction", text: "never deploy straight to production; staging first" },
    { kind: "open_item", text: "staging server credentials missing" },
  ],
  mustNotAppear: ["x1200 lines of stack traces"],
  requiresRuntimeEvidence: false,
}

const artifacts = (over: Partial<RetentionArtifacts> = {}): RetentionArtifacts => ({
  records: [
    { id: "r1", type: "objective", text: "Migrate the deploy script from bash to bun." },
    { id: "r2", type: "decision", text: "Keep rsync; drop scp." },
    { id: "r3", type: "user_correction", text: "Never deploy straight to production; staging first, production after staging." },
    { id: "r4", type: "open_item", text: "Staging server credentials still missing." },
  ],
  invalidated: [],
  renderText: "<rollover_context epoch='0'>objective: migrate the deploy script to bun</rollover_context>",
  ...over,
})

describe("evaluateRetention", () => {
  test("perfect match → precision/recall/F1 = 1, no flags", () => {
    const s = evaluateRetention(hidden, artifacts())
    expect(s.recall).toBe(1)
    expect(s.f1).toBe(1)
    expect(s.criticalOmissions).toEqual([])
    expect(s.wrongInvalidations).toEqual([])
    expect(s.falseClaims).toEqual([])
  })

  test("missed user_correction → critical flag and recall < 1", () => {
    const s = evaluateRetention(hidden, artifacts({
      records: artifacts().records.filter((r) => r.type !== "user_correction"),
    }))
    expect(s.criticalOmissions.length).toBe(1)
    expect(s.criticalOmissions[0]).toContain("staging first")
    expect(s.recall).toBeLessThan(1)
    expect(s.f1).toBeLessThan(1)
  })

  test("wrong invalidation: fact only in invalidated records → flagged", () => {
    const s = evaluateRetention(hidden, artifacts({
      records: artifacts().records.filter((r) => r.id !== "r2"),
      invalidated: [{ id: "r2", type: "decision", text: "Keep rsync; drop scp." }],
    }))
    expect(s.wrongInvalidations.length).toBe(1)
    expect(s.wrongInvalidations[0]).toContain("rsync")
    expect(s.recall).toBeLessThan(1)
  })

  test("render substring retains a fact missing from records", () => {
    const s = evaluateRetention(hidden, artifacts({
      records: artifacts().records.filter((r) => r.type !== "objective"),
    }))
    const obj = s.scored.find((f) => f.kind === "objective")!
    expect(obj.retained).toBe(true)
    expect(obj.via).toBe("render")
  })

  test("falseClaims: mustNotAppear found in render → flagged", () => {
    const s = evaluateRetention(hidden, artifacts({
      renderText: "<rollover_context>log said x1200 lines of stack traces and more</rollover_context>",
    }))
    expect(s.falseClaims.length).toBe(1)
    expect(s.falseClaims[0]).toContain("x1200")
  })

  test("open_item absent from active records → unresolvedOpenItems flag", () => {
    const s = evaluateRetention(hidden, artifacts({
      records: artifacts().records.filter((r) => r.type !== "open_item"),
    }))
    expect(s.unresolvedOpenItems.length).toBe(1)
    expect(s.unresolvedOpenItems[0]).toContain("credentials")
  })

  test("unrelated records drag precision below 1", () => {
    const s = evaluateRetention(hidden, artifacts({
      records: [...artifacts().records, { id: "r9", type: "objective", text: "something completely different about kubernetes ingress controllers" }],
    }))
    expect(s.precision).not.toBeNull()
    expect(s.precision!).toBeLessThan(1)
    expect(s.recall).toBe(1)
  })

  test("no records and no render → recall 0, precision null", () => {
    const s = evaluateRetention(hidden, artifacts({ records: [], invalidated: [], renderText: null }))
    expect(s.recall).toBe(0)
    expect(s.precision).toBeNull()
    expect(s.f1).toBeNull()
  })
})
