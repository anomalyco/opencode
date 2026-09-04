import { describe, expect, it } from "bun:test"
import { ReflectionState } from "@opencode-ai/core/session/runner/reflection-state"
import { SessionID } from "@/session/schema"

describe("V1 Prompt Reasoning Hooks", () => {
  it("verifies ReflectionState steer consumption and direction confirmation", () => {
    const sessionID = SessionID.make("ses_v1_test_hooks")
    ReflectionState.clearDirection(sessionID)
    expect(ReflectionState.get(sessionID).directionConfirmed).toBe(false)

    ReflectionState.addSteer(sessionID, "Steer instruction 1")
    expect(ReflectionState.consumeSteerGuidanceText(sessionID)).toContain("Steer instruction 1")
    expect(ReflectionState.consumeSteerGuidanceText(sessionID)).toBeUndefined()

    ReflectionState.addHypothesis(sessionID, { description: "Hypothesis A", probability: 0.9, evidence: [] })
    const refText = ReflectionState.getReflectionText(sessionID)
    expect(refText).toContain("Hypothesis A")
    expect(refText).toContain("90%")
  })
})
