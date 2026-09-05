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

  it("verifies resolveReflectionModelOverride precedence (metadata > flag > config > fallback)", async () => {
    const { resolveReflectionModelOverride } = await import("@/session/prompt")
    const { Option } = await import("effect")

    const flagsWithFlag = { experimentalReflectionModel: Option.some("openai/gpt-4o") } as any
    const flagsEmpty = { experimentalReflectionModel: Option.none() } as any

    const sessionWithMeta = {
      id: "ses_1",
      metadata: { reflection_model: "anthropic/claude-3-7-sonnet" },
    } as any

    const sessionEmptyMeta = {
      id: "ses_2",
      metadata: {},
    } as any

    const configWithRef = { reflection_model: "xai/grok-4.20" } as any
    const configEmpty = {} as any

    // 1. Session metadata takes highest precedence
    expect(resolveReflectionModelOverride(sessionWithMeta, configWithRef, flagsWithFlag)).toEqual({
      providerID: "anthropic",
      modelID: "claude-3-7-sonnet",
    })

    // 2. Flags take precedence when session metadata is absent
    expect(resolveReflectionModelOverride(sessionEmptyMeta, configWithRef, flagsWithFlag)).toEqual({
      providerID: "openai",
      modelID: "gpt-4o",
    })

    // 3. Config takes precedence when metadata and flag are absent
    expect(resolveReflectionModelOverride(sessionEmptyMeta, configWithRef, flagsEmpty)).toEqual({
      providerID: "xai",
      modelID: "grok-4.20",
    })

    // 4. Returns undefined (fallback to session model) when none set
    expect(resolveReflectionModelOverride(sessionEmptyMeta, configEmpty, flagsEmpty)).toBeUndefined()
  })
})
