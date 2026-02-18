import { describe, expect, test, beforeEach } from "bun:test"
import { TransitionPhaseTool } from "../../src/tool/transition-phase"
import { DebugPhase } from "../../src/session/debug-phase"

const ctx = {
  sessionID: "test-session",
  messageID: "msg-1",
  agent: "debug",
  abort: AbortSignal.any([]),
  callID: "call-1",
  messages: [] as any[],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.transitionPhase", () => {
  beforeEach(() => {
    DebugPhase.clear("test-session")
    DebugPhase.create("test-session")
  })

  test("successful transition from PLANNING to CODING", async () => {
    const tool = await TransitionPhaseTool.init()
    const result = await tool.execute(
      { to: "CODING", reason: "Plan is ready" },
      ctx,
    )

    expect(result.title).toBe("Phase: CODING")
    expect(result.output).toContain("CODING")
    expect(result.output).toContain("Plan is ready")
    expect(result.metadata.phase).toBe("CODING")
    expect(result.metadata.step).toBe(0)
  })

  test("failed transition from PLANNING to DEBUGGING", async () => {
    const tool = await TransitionPhaseTool.init()
    const result = await tool.execute(
      { to: "DEBUGGING", reason: "Skip ahead" },
      ctx,
    )

    expect(result.title).toBe("Transition Failed")
    expect(result.output).toContain("Cannot transition")
    expect(result.output).toContain("PLANNING")
    expect(result.output).toContain("DEBUGGING")
    expect(result.metadata.error).toBe(true)
  })

  test("parameter 'to' must be a valid phase name", async () => {
    const tool = await TransitionPhaseTool.init()
    try {
      await tool.execute(
        { to: "INVALID_PHASE" as any, reason: "bad phase" },
        ctx,
      )
      // Should have thrown due to zod validation
      expect(true).toBe(false)
    } catch (e: any) {
      expect(e).toBeInstanceOf(Error)
      expect(e.message).toContain("invalid")
    }
  })

  test("step increments when cycling from CONFIRMING back to PLANNING", async () => {
    const tool = await TransitionPhaseTool.init()

    // Walk through the full cycle: PLANNING -> CODING -> BREAKPOINTING -> DEBUGGING -> EXPLAINING -> CONFIRMING -> PLANNING
    await tool.execute({ to: "CODING", reason: "step 1" }, ctx)
    await tool.execute({ to: "BREAKPOINTING", reason: "step 2" }, ctx)
    await tool.execute({ to: "DEBUGGING", reason: "step 3" }, ctx)
    await tool.execute({ to: "EXPLAINING", reason: "step 4" }, ctx)
    await tool.execute({ to: "CONFIRMING", reason: "step 5" }, ctx)

    const result = await tool.execute({ to: "PLANNING", reason: "next cycle" }, ctx)

    expect(result.metadata.phase).toBe("PLANNING")
    expect(result.metadata.step).toBe(1)
  })

  test("output includes available tools for the new phase", async () => {
    const tool = await TransitionPhaseTool.init()
    const result = await tool.execute(
      { to: "CODING", reason: "ready to code" },
      ctx,
    )

    expect(result.output).toContain("Available tools:")
    expect(result.output).toContain("edit")
    expect(result.output).toContain("write")
    expect(result.output).toContain("bash")
  })
})
