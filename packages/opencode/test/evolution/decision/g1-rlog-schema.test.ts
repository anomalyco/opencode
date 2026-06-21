import { describe, expect, test } from "bun:test"
import { Schema, Option } from "effect"
import { ReconciliationLogSchema } from "@/evolution/decision/reconciliation-log"

describe("TG-RLOG-SCHEMA — ReconciliationLog schema validation", () => {
  const decode = Schema.decodeUnknownOption(ReconciliationLogSchema)

  const baseParticipants = [
    { agentId: "agent-a", capabilities: ["proposal"], contributionType: "proposal", confidenceScore: 0.85, selected: true },
    { agentId: "agent-b", capabilities: ["risk-analysis"], contributionType: "risk-analysis", confidenceScore: 0.2, selected: false },
  ]

  const validLog = {
    sessionId: "sess-001",
    contextHash: "abc123def456",
    candidates: [
      { agentId: "agent-a", reasoningStrength: "high", confidenceScore: 0.85, selected: true },
      { agentId: "agent-b", reasoningStrength: "low", confidenceScore: 0.2, selected: false, rejectionReason: "low confidence" },
    ],
    participants: baseParticipants,
    selectedCandidateAgentId: "agent-a",
    selectionReason: "HIGHEST_CONFIDENCE",
    outcome: "PROPOSAL_SUBMITTED",
    submissionStatus: "SUBMITTED" as const,
    proposalId: "prop-001",
    createdAt: 1718000000000,
  }

  test("valid PROPOSAL_SUBMITTED decodes successfully", () => {
    const result = decode(validLog)
    expect(Option.isSome(result)).toBe(true)
  })

  test("PROPOSAL_SUBMITTED with submissionStatus PENDING (pre-submit)", () => {
    const pending = { ...validLog, submissionStatus: "PENDING" as const, proposalId: undefined }
    const result = decode(pending)
    expect(Option.isSome(result)).toBe(true)
  })

  test("valid BELOW_THRESHOLD with null selectedCandidateAgentId", () => {
    const belowThreshold = {
      sessionId: "sess-001",
      contextHash: "abc123def456",
      candidates: [
        { agentId: "agent-a", reasoningStrength: "low", confidenceScore: 0.2, selected: false, rejectionReason: "below threshold" },
      ],
      participants: [{ agentId: "agent-a", capabilities: ["proposal"], contributionType: "proposal", confidenceScore: 0.2, selected: false }],
      selectedCandidateAgentId: null,
      selectionReason: "BELOW_THRESHOLD",
      outcome: "BELOW_THRESHOLD",
      createdAt: 1718000000000,
    }
    const result = decode(belowThreshold)
    expect(Option.isSome(result)).toBe(true)
  })

  test("valid NO_CANDIDATES outcome (system error, not business)", () => {
    const noCandidates = {
      sessionId: "sess-001",
      contextHash: "abc123def456",
      candidates: [],
      participants: [],
      selectedCandidateAgentId: null,
      selectionReason: "NO_CANDIDATES",
      outcome: "NO_CANDIDATES",
      createdAt: 1718000000000,
    }
    const result = decode(noCandidates)
    expect(Option.isSome(result)).toBe(true)
  })

  test("missing required field (sessionId) fails", () => {
    const { sessionId: _, ...missing } = validLog
    const result = decode(missing)
    expect(Option.isNone(result)).toBe(true)
  })

  test("invalid outcome fails", () => {
    const bad = { ...validLog, outcome: "ALL_REJECTED" }
    const result = decode(bad)
    expect(Option.isNone(result)).toBe(true)
  })

  test("invalid selectionReason fails", () => {
    const bad = { ...validLog, selectionReason: "ALL_BELOW_THRESHOLD" }
    const result = decode(bad)
    expect(Option.isNone(result)).toBe(true)
  })

  test("invalid submissionStatus fails", () => {
    const bad = { ...validLog, submissionStatus: "COMPLETED" }
    const result = decode(bad)
    expect(Option.isNone(result)).toBe(true)
  })

  test("invalid reasoningStrength fails", () => {
    const bad = {
      ...validLog,
      candidates: [{ ...validLog.candidates[0], reasoningStrength: "very_high" }],
    }
    const result = decode(bad)
    expect(Option.isNone(result)).toBe(true)
  })

  test("candidate with non-boolean selected fails", () => {
    const bad = {
      ...validLog,
      candidates: [{ ...validLog.candidates[0], selected: "yes" }],
    }
    const result = decode(bad)
    expect(Option.isNone(result)).toBe(true)
  })
})
