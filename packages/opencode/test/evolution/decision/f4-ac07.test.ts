import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"

describe("TG-AC07 — DecisionProposalSchema binding to generateObject", () => {
  const engineSrc = readFileSync(
    new URL("../../../src/evolution/decision/engine.ts", import.meta.url),
    "utf-8",
  )

  test("generateObject is called with { schema: DecisionProposalSchema, ... }", () => {
    const match = engineSrc.match(/generateObject\(\{\s*schema:\s*DecisionProposalSchema[,}\s]/)
    expect(match).not.toBeNull()
  })

  test("DecisionProposalSchema is imported", () => {
    const importMatch = engineSrc.match(/DecisionProposalSchema/)
    expect(importMatch).not.toBeNull()
  })
})
