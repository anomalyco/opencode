import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { Tool } from "@/tool/tool"
import { PlanCreateTool } from "../../src/tool/loop-plan-create"
import { PhaseDefineTool } from "../../src/tool/loop-phase-define"
import { VerifyQualityTool } from "../../src/tool/loop-verify-quality"
import { LoopSummaryTool } from "../../src/tool/loop-summary"
import { LoopCompleteTool } from "../../src/tool/loop-complete"
import { LoopState } from "../../src/tool/loop-state"
import { LoopOrchestrator } from "../../src/tool/loop-orchestrator"
import { SessionID, MessageID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"
import { testInstanceStoreLayer } from "../fixture/fixture"

const toolLayer = Layer.mergeAll(
  Agent.defaultLayer,
  Truncate.defaultLayer,
  LoopState.defaultLayer,
  LoopOrchestrator.defaultLayer,
)
const it = testEffect(Layer.mergeAll(toolLayer, testInstanceStoreLayer))

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "loop",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const init = Effect.fn("LoopToolTest.init")(function* () {
  const info = yield* PlanCreateTool
  return yield* info.init()
})

const initPhase = Effect.fn("LoopToolTest.initPhase")(function* () {
  const info = yield* PhaseDefineTool
  return yield* info.init()
})

const initVerify = Effect.fn("LoopToolTest.initVerify")(function* () {
  const info = yield* VerifyQualityTool
  return yield* info.init()
})

const initSummary = Effect.fn("LoopToolTest.initSummary")(function* () {
  const info = yield* LoopSummaryTool
  return yield* info.init()
})

const initComplete = Effect.fn("LoopToolTest.initComplete")(function* () {
  const info = yield* LoopCompleteTool
  return yield* info.init()
})

const run = Effect.fn("LoopToolTest.run")(
  function* (
    args: Tool.InferParameters<typeof PlanCreateTool>,
    next: Tool.Context = ctx,
  ) {
    const tool = yield* init()
    return yield* tool.execute(args, next)
  },
)

const runPhase = Effect.fn("LoopToolTest.runPhase")(
  function* (
    args: Tool.InferParameters<typeof PhaseDefineTool>,
    next: Tool.Context = ctx,
  ) {
    const tool = yield* initPhase()
    return yield* tool.execute(args, next)
  },
)

const runVerify = Effect.fn("LoopToolTest.runVerify")(
  function* (
    args: Tool.InferParameters<typeof VerifyQualityTool>,
    next: Tool.Context = ctx,
  ) {
    const tool = yield* initVerify()
    return yield* tool.execute(args, next)
  },
)

const runSummary = Effect.fn("LoopToolTest.runSummary")(
  function* (
    args: Tool.InferParameters<typeof LoopSummaryTool>,
    next: Tool.Context = ctx,
  ) {
    const tool = yield* initSummary()
    return yield* tool.execute(args, next)
  },
)

const runComplete = Effect.fn("LoopToolTest.runComplete")(
  function* (
    args: Tool.InferParameters<typeof LoopCompleteTool>,
    next: Tool.Context = ctx,
  ) {
    const tool = yield* initComplete()
    return yield* tool.execute(args, next)
  },
)

const reset = () =>
  Effect.gen(function* () {
    const loop = yield* LoopState.Service
    yield* loop.reset()
  })

describe("plan_create tool", () => {
  it.instance("creates a plan with valid phases", () =>
    Effect.gen(function* () {
      yield* reset()
      const result = yield* run({
        description: "Build a login system",
        phases: [
          { id: "auth", title: "Authentication", scope: "Implement login flow", acceptanceCriteria: ["Users can log in"] },
          { id: "ui", title: "UI Components", scope: "Build the login UI", acceptanceCriteria: ["UI is responsive"] },
        ],
      })
      expect(result.title).toBe("Plan created")
      expect(result.metadata.phases).toEqual(["auth", "ui"])
      expect(result.output).toContain("Build a login system")
      expect(result.output).toContain("Phase 1")
      expect(result.output).toContain("Phase 2")
    }),
  )

  it.instance("rejects duplicate plan", () =>
    Effect.gen(function* () {
      yield* reset()
      yield* run({
        description: "First plan",
        phases: [{ id: "p1", title: "Phase 1", scope: "First", acceptanceCriteria: ["OK"] }],
      })
      const result = yield* run({
        description: "Second plan",
        phases: [{ id: "p1", title: "Phase 1", scope: "Second", acceptanceCriteria: ["OK"] }],
      })
      expect(result.title).toBe("Plan already exists")
    }),
  )

  it.instance("rejects empty phases", () =>
    Effect.gen(function* () {
      yield* reset()
      const result = yield* run({
        description: "Empty plan",
        phases: [],
      })
      expect(result.title).toBe("Invalid plan")
    }),
  )

  it.instance("rejects more than 10 phases", () =>
    Effect.gen(function* () {
      yield* reset()
      const result = yield* run({
        description: "Too many phases",
        phases: Array.from({ length: 11 }, (_, i) => ({
          id: `p${i}`,
          title: `Phase ${i}`,
          scope: `Scope ${i}`,
          acceptanceCriteria: [`AC ${i}`],
        })),
      })
      expect(result.title).toBe("Too many phases")
    }),
  )

  it.instance("rejects duplicate phase IDs", () =>
    Effect.gen(function* () {
      yield* reset()
      const result = yield* run({
        description: "Duplicate IDs",
        phases: [
          { id: "same", title: "Phase 1", scope: "First", acceptanceCriteria: ["OK"] },
          { id: "same", title: "Phase 2", scope: "Second", acceptanceCriteria: ["OK"] },
        ],
      })
      expect(result.title).toBe("Duplicate phase IDs")
    }),
  )
})

describe("phase_define tool", () => {
  it.instance("requires existing plan", () =>
    Effect.gen(function* () {
      yield* reset()
      const result = yield* runPhase({ phaseId: "nonexistent" })
      expect(result.title).toBe("No plan")
    }),
  )

  it.instance("updates phase spec", () =>
    Effect.gen(function* () {
      yield* reset()
      yield* run({
        description: "Test",
        phases: [{ id: "p1", title: "Phase 1", scope: "Old scope", acceptanceCriteria: ["AC1"] }],
      })
      const result = yield* runPhase({ phaseId: "p1", spec: "New scope" })
      expect(result.title).toBe("Phase updated")
      expect(result.metadata.phaseId).toBe("p1")
    }),
  )

  it.instance("rejects nonexistent phase", () =>
    Effect.gen(function* () {
      yield* reset()
      yield* run({
        description: "Test",
        phases: [{ id: "p1", title: "Phase 1", scope: "Scope", acceptanceCriteria: ["AC1"] }],
      })
      const result = yield* runPhase({ phaseId: "p999" })
      expect(result.title).toBe("Phase not found")
    }),
  )
})

describe("verify_quality tool", () => {
  it.instance("requires existing plan", () =>
    Effect.gen(function* () {
      yield* reset()
      const result = yield* runVerify({ phaseId: "p1", checks: ["lint"] })
      expect(result.title).toBe("No plan")
    }),
  )

  it.instance("passes all checks and marks phase completed", () =>
    Effect.gen(function* () {
      yield* reset()
      yield* run({
        description: "Test",
        phases: [{ id: "p1", title: "Phase 1", scope: "Scope", acceptanceCriteria: ["AC1"] }],
      })
      const result = yield* runVerify({ phaseId: "p1", checks: ["scope", "contract"] })
      expect(result.title).toBe("Quality passed")
      expect(result.output).toContain("PASSED")
      expect(result.output).toContain("scope")
      expect(result.output).toContain("contract")
    }),
  )

  it.instance("checks contract flag when contract is defined", () =>
    Effect.gen(function* () {
      yield* reset()
      yield* run({
        description: "Test",
        phases: [{
          id: "p1",
          title: "Phase 1",
          scope: "Scope",
          acceptanceCriteria: ["AC1"],
          interfaceContract: "export function foo(): void",
        }],
      })
      const result = yield* runVerify({ phaseId: "p1", checks: ["contract"] })
      expect(result.title).toBe("Quality passed")
      expect(result.output).toContain("Interface contract is defined")
    }),
  )

  it.instance("advances currentPhaseIndex on pass", () =>
    Effect.gen(function* () {
      yield* reset()
      yield* run({
        description: "Two phases",
        phases: [
          { id: "p1", title: "Phase 1", scope: "First", acceptanceCriteria: ["AC1"] },
          { id: "p2", title: "Phase 2", scope: "Second", acceptanceCriteria: ["AC2"] },
        ],
      })
      yield* runVerify({ phaseId: "p1", checks: ["scope"] })
      const summary = yield* runSummary({ detail: "brief" })
      expect(summary.output).toContain("Phase 2")
    }),
  )
})

describe("loop_summary tool", () => {
  it.instance("shows idle state when no plan exists", () =>
    Effect.gen(function* () {
      yield* reset()
      const result = yield* runSummary({ detail: "brief" })
      expect(result.title).toBe("No active loop")
    }),
  )

  it.instance("shows progress after plan creation", () =>
    Effect.gen(function* () {
      yield* reset()
      yield* run({
        description: "Test plan",
        phases: [
          { id: "p1", title: "Phase 1", scope: "First", acceptanceCriteria: ["AC1"] },
          { id: "p2", title: "Phase 2", scope: "Second", acceptanceCriteria: ["AC2"] },
          { id: "p3", title: "Phase 3", scope: "Third", acceptanceCriteria: ["AC3"] },
        ],
      })
      const result = yield* runSummary({ detail: "full" })
      expect(result.output).toContain("0/3")
      expect(result.output).toContain("Phase 1")
      expect(result.output).toContain("Phase 2")
      expect(result.output).toContain("Phase 3")
      expect(result.metadata.progress).toBe(0)
    }),
  )

  it.instance("shows 100% when all phases complete", () =>
    Effect.gen(function* () {
      yield* reset()
      yield* run({
        description: "Single phase",
        phases: [{ id: "p1", title: "Phase 1", scope: "Only one", acceptanceCriteria: ["AC1"] }],
      })
      yield* runVerify({ phaseId: "p1", checks: ["scope"] })
      const result = yield* runSummary({ detail: "brief" })
      expect(result.metadata.progress).toBe(100)
      expect(result.output).toContain("1/1")
    }),
  )
})

describe("loop_complete tool", () => {
  it.instance("requires active loop", () =>
    Effect.gen(function* () {
      yield* reset()
      const result = yield* runComplete({ status: "success", finalSummary: "All done" })
      expect(result.title).toBe("No active loop")
    }),
  )

  it.instance("generates success report", () =>
    Effect.gen(function* () {
      yield* reset()
      yield* run({
        description: "Test",
        phases: [{ id: "p1", title: "Phase 1", scope: "Scope", acceptanceCriteria: ["AC1"] }],
      })
      yield* runVerify({ phaseId: "p1", checks: ["lint"] })
      const result = yield* runComplete({ status: "success", finalSummary: "All phases completed" })
      expect(result.title).toBe("Loop success")
      expect(result.output).toContain("Loop Complete")
      expect(result.output).toContain("All phases completed successfully")
    }),
  )

  it.instance("generates partial report", () =>
    Effect.gen(function* () {
      yield* reset()
      yield* run({
        description: "Test",
        phases: [{ id: "p1", title: "Phase 1", scope: "Scope", acceptanceCriteria: ["AC1"] }],
      })
      const result = yield* runComplete({ status: "partial", finalSummary: "Phase 1 not done" })
      expect(result.title).toBe("Loop partial")
      expect(result.output).toContain("Some phases were not completed")
    }),
  )

  it.instance("resets state after completion", () =>
    Effect.gen(function* () {
      yield* reset()
      yield* run({
        description: "Test",
        phases: [{ id: "p1", title: "Phase 1", scope: "Scope", acceptanceCriteria: ["AC1"] }],
      })
      yield* runComplete({ status: "success", finalSummary: "Done" })
      const summary = yield* runSummary({ detail: "brief" })
      expect(summary.title).toBe("No active loop")
    }),
  )
})

describe("loop_orchestrator stuck detection", () => {
  it.instance("detects stuck after three identical tool calls", () =>
    Effect.gen(function* () {
      yield* reset()
      yield* run({
        description: "Test",
        phases: [{ id: "p1", title: "Phase 1", scope: "Scope", acceptanceCriteria: ["AC1"] }],
      })

      const orchestrator = yield* LoopOrchestrator.Service
      yield* orchestrator.start()
      yield* orchestrator.startPhase("p1")

      const notStuck = yield* orchestrator.isStuck("p1")
      expect(notStuck).toBe(false)

      yield* orchestrator.recordToolCall("p1", "read")
      yield* orchestrator.recordToolCall("p1", "read")
      const stillNotStuck = yield* orchestrator.isStuck("p1")
      expect(stillNotStuck).toBe(false)

      yield* orchestrator.recordToolCall("p1", "read")
      const stuck = yield* orchestrator.isStuck("p1").pipe(Effect.catch(() => Effect.succeed(true)))
      expect(stuck).toBe(true)
    }),
  )

  it.instance("does not flag stuck for different tool calls", () =>
    Effect.gen(function* () {
      yield* reset()
      yield* run({
        description: "Test",
        phases: [{ id: "p1", title: "Phase 1", scope: "Scope", acceptanceCriteria: ["AC1"] }],
      })

      const orchestrator = yield* LoopOrchestrator.Service
      yield* orchestrator.start()
      yield* orchestrator.startPhase("p1")

      yield* orchestrator.recordToolCall("p1", "read")
      yield* orchestrator.recordToolCall("p1", "write")
      yield* orchestrator.recordToolCall("p1", "read")
      const stuck = yield* orchestrator.isStuck("p1").pipe(Effect.catch(() => Effect.succeed(true)))
      expect(stuck).toBe(false)
    }),
  )

  it.instance("isolates stuck detection per phase", () =>
    Effect.gen(function* () {
      yield* reset()
      yield* run({
        description: "Test",
        phases: [
          { id: "p1", title: "Phase 1", scope: "Scope", acceptanceCriteria: ["AC1"] },
          { id: "p2", title: "Phase 2", scope: "Scope", acceptanceCriteria: ["AC2"] },
        ],
      })

      const orchestrator = yield* LoopOrchestrator.Service
      yield* orchestrator.start()
      yield* orchestrator.startPhase("p1")

      yield* orchestrator.recordToolCall("p1", "read")
      yield* orchestrator.recordToolCall("p1", "read")
      yield* orchestrator.recordToolCall("p1", "read")
      yield* orchestrator.recordToolCall("p2", "read")

      const p2Stuck = yield* orchestrator.isStuck("p2").pipe(Effect.catch(() => Effect.succeed(true)))
      expect(p2Stuck).toBe(false)
    }),
  )

  it.instance("metrics reports stuck when phase is stuck", () =>
    Effect.gen(function* () {
      yield* reset()
      yield* run({
        description: "Test",
        phases: [{ id: "p1", title: "Phase 1", scope: "Scope", acceptanceCriteria: ["AC1"] }],
      })

      const orchestrator = yield* LoopOrchestrator.Service
      yield* orchestrator.start()
      yield* orchestrator.startPhase("p1")

      yield* orchestrator.recordToolCall("p1", "read")
      yield* orchestrator.recordToolCall("p1", "read")
      yield* orchestrator.recordToolCall("p1", "read")

      const metrics = yield* orchestrator.metrics()
      expect(metrics.stuck).toBe(true)
    }),
  )

  it.instance("reset clears stuck detection", () =>
    Effect.gen(function* () {
      yield* reset()
      yield* run({
        description: "Test",
        phases: [{ id: "p1", title: "Phase 1", scope: "Scope", acceptanceCriteria: ["AC1"] }],
      })

      const orchestrator = yield* LoopOrchestrator.Service
      yield* orchestrator.start()
      yield* orchestrator.startPhase("p1")

      yield* orchestrator.recordToolCall("p1", "read")
      yield* orchestrator.recordToolCall("p1", "read")
      yield* orchestrator.recordToolCall("p1", "read")

      yield* orchestrator.reset()
      const notStuck = yield* orchestrator.isStuck("p1")
      expect(notStuck).toBe(false)
    }),
  )
})

describe("plan_create with phase_define then verify_quality", () => {
  it.instance("full cycle: plan -> define -> verify -> summary -> complete", () =>
    Effect.gen(function* () {
      yield* reset()

      const plan = yield* run({
        description: "Refactor auth module",
        phases: [
          { id: "extract", title: "Extract interface", scope: "Extract Auth interface", acceptanceCriteria: ["Interface extracted"] },
          { id: "impl", title: "Implement new auth", scope: "Implement the new auth class", acceptanceCriteria: ["Tests pass"] },
        ],
      })
      expect(plan.title).toBe("Plan created")

      const updated = yield* runPhase({
        phaseId: "extract",
        spec: "Extract Auth interface with login/logout methods",
      })
      expect(updated.title).toBe("Phase updated")

      const quality = yield* runVerify({ phaseId: "extract", checks: ["scope", "contract"] })
      expect(quality.title).toBe("Quality passed")

      const summary = yield* runSummary({ detail: "brief" })
      expect(summary.output).toContain("50%")

      const complete = yield* runComplete({ status: "success", finalSummary: "All refactored" })
      expect(complete.title).toBe("Loop success")
    }),
  )
})
