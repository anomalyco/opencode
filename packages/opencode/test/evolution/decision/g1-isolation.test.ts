import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"

describe("TG-ISOLATION — Agent interface has no access to other agents' output", () => {
  const agentSrc = readFileSync(
    new URL("../../../src/evolution/decision/agent.ts", import.meta.url),
    "utf-8",
  )

  test("Agent.analyze() returns single ProposalCandidate, not array", () => {
    const returnMatch = agentSrc.match(/Effect\.Effect<ProposalCandidate/)
    expect(returnMatch).not.toBeNull()
    const arrayMatch = agentSrc.match(/Effect\.Effect<ProposalCandidate\[\]/)
    expect(arrayMatch).toBeNull()
  })

  test("AgentRegistry has no reference to CandidateSummary or ReconciliationLog", () => {
    expect(agentSrc).not.toContain("CandidateSummary")
    expect(agentSrc).not.toContain("ReconciliationLog")
  })
})
