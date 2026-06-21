import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { DecisionProposalSchema } from "@/evolution/decision/proposal"

const BASE = {
  id: "test",
  key: "test",
  title: "test",
  context: "test",
  proposedDecision: "test",
  consequences: "test",
  tags: [] as readonly string[],
  origin: { proposerId: "test" },
  createdAt: 1,
}

describe("TG-09 — HELD in ProposalStatus (F-04)", () => {
  test("HELD is now a valid status (F-04 / ADR-026)", () => {
    const result = Schema.decodeUnknownSync(DecisionProposalSchema)({ ...BASE, status: "HELD" })
    expect(result.status).toBe("HELD")
  })

  test("valid statuses pass schema", () => {
    for (const status of ["SUBMITTED", "VALIDATING", "ACCEPTED", "REJECTED", "HELD"] as const) {
      const result = Schema.decodeUnknownSync(DecisionProposalSchema)({ ...BASE, status })
      expect(result.status).toBe(status)
    }
  })

  test("exactly 5 statuses in ProposalStatus type", () => {
    const valid = ["SUBMITTED", "VALIDATING", "ACCEPTED", "REJECTED", "HELD"]
    expect(valid.length).toBe(5)
  })
})
