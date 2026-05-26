import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PatentWorkflow } from "@/patent/workflow"

const layer = PatentWorkflow.defaultLayer

const it = testEffect(layer)

describe("PatentWorkflow", () => {
  it.instance("creates a draft workflow", () =>
    Effect.gen(function* () {
      const svc = yield* PatentWorkflow.Service
      const state = yield* svc.create("draft", "session-123")
      expect(state.sessionId).toBe("session-123")
      expect(state.workflowType).toBe("draft")
      expect(state.currentStep).toBe(0)
      expect(state.totalSteps).toBe(6)
      expect(state.status).toBe("running")
      expect(state.stepOutputs).toEqual({})
      expect(state.caseId).toBeNull()
    }),
  )

  it.instance("creates an OA workflow", () =>
    Effect.gen(function* () {
      const svc = yield* PatentWorkflow.Service
      const state = yield* svc.create("oa", "session-456")
      expect(state.sessionId).toBe("session-456")
      expect(state.workflowType).toBe("oa")
      expect(state.totalSteps).toBe(5)
    }),
  )

  it.instance("advances workflow step", () =>
    Effect.gen(function* () {
      const svc = yield* PatentWorkflow.Service
      const sessionId = "session-advance"
      yield* svc.create("draft", sessionId)
      const advanced = yield* svc.advance(sessionId, "preprocess", "output-data")
      expect(advanced.currentStep).toBe(1)
      expect(advanced.stepOutputs).toEqual({ preprocess: "output-data" })
      expect(advanced.status).toBe("running")
    }),
  )

  it.instance("completes workflow when all steps done", () =>
    Effect.gen(function* () {
      const svc = yield* PatentWorkflow.Service
      const sessionId = "session-complete"
      yield* svc.create("draft", sessionId)
      const steps = ["preprocess", "understand", "search", "specification", "claims", "integrate"]
      let state = yield* svc.create("draft", sessionId)
      for (const action of steps) {
        state = yield* svc.advance(sessionId, action, `${action}-output`)
      }
      expect(state.status).toBe("completed")
      expect(state.currentStep).toBe(6)
    }),
  )

  it.instance("gets workflow state", () =>
    Effect.gen(function* () {
      const svc = yield* PatentWorkflow.Service
      const sessionId = "session-get"
      yield* svc.create("draft", sessionId)
      const state = yield* svc.getState(sessionId)
      expect(state).not.toBeNull()
      expect(state?.sessionId).toBe(sessionId)
    }),
  )

  it.instance("returns null for non-existent session", () =>
    Effect.gen(function* () {
      const svc = yield* PatentWorkflow.Service
      const state = yield* svc.getState("non-existent")
      expect(state).toBeNull()
    }),
  )

  it.instance("gets current step definition", () =>
    Effect.gen(function* () {
      const svc = yield* PatentWorkflow.Service
      const sessionId = "session-step"
      const state = yield* svc.create("draft", sessionId)
      const step = yield* svc.getCurrentStep(state)
      expect(step).toEqual({
        name: "交底书预处理",
        action: "preprocess",
        description: "文档格式转换与图纸识别",
      })
    }),
  )

  it.instance("returns null when beyond last step", () =>
    Effect.gen(function* () {
      const svc = yield* PatentWorkflow.Service
      const sessionId = "session-beyond"
      yield* svc.create("draft", sessionId)
      yield* svc.advance(sessionId, "preprocess", "output")
      yield* svc.advance(sessionId, "understand", "output")
      yield* svc.advance(sessionId, "search", "output")
      yield* svc.advance(sessionId, "specification", "output")
      yield* svc.advance(sessionId, "claims", "output")
      yield* svc.advance(sessionId, "integrate", "output")
      const state = yield* svc.getState(sessionId)
      if (state) {
        const step = yield* svc.getCurrentStep(state)
        expect(step).toBeNull()
      }
    }),
  )

  it.instance("resets workflow state", () =>
    Effect.gen(function* () {
      const svc = yield* PatentWorkflow.Service
      const sessionId = "session-reset"
      yield* svc.create("draft", sessionId)
      yield* svc.advance(sessionId, "preprocess", "output")
      yield* svc.reset(sessionId)
      const state = yield* svc.getState(sessionId)
      expect(state).toBeNull()
    }),
  )

  it.instance("creates a creativity workflow", () =>
    Effect.gen(function* () {
      const svc = yield* PatentWorkflow.Service
      const state = yield* svc.create("creativity", "session-creativity")
      expect(state.workflowType).toBe("creativity")
      expect(state.totalSteps).toBe(5)
      expect(state.status).toBe("running")
    }),
  )

  it.instance("completes creativity workflow", () =>
    Effect.gen(function* () {
      const svc = yield* PatentWorkflow.Service
      const sessionId = "session-creativity-complete"
      const steps = ["understand", "search", "three_step", "effects", "conclude"]
      yield* svc.create("creativity", sessionId)
      let state: PatentWorkflow.WorkflowState | null = null
      for (const action of steps) {
        state = yield* svc.advance(sessionId, action, `${action}-output`)
      }
      expect(state!.status).toBe("completed")
      expect(state!.currentStep).toBe(5)
    }),
  )

  it.instance("creates a reexam workflow", () =>
    Effect.gen(function* () {
      const svc = yield* PatentWorkflow.Service
      const state = yield* svc.create("reexam", "session-reexam")
      expect(state.workflowType).toBe("reexam")
      expect(state.totalSteps).toBe(5)
    }),
  )

  it.instance("completes reexam workflow", () =>
    Effect.gen(function* () {
      const svc = yield* PatentWorkflow.Service
      const sessionId = "session-reexam-complete"
      const steps = ["confirm_rejection", "analyze", "evidence", "draft", "validate"]
      yield* svc.create("reexam", sessionId)
      let state: PatentWorkflow.WorkflowState | null = null
      for (const action of steps) {
        state = yield* svc.advance(sessionId, action, `${action}-output`)
      }
      expect(state!.status).toBe("completed")
    }),
  )

  it.instance("creates an invalidation workflow", () =>
    Effect.gen(function* () {
      const svc = yield* PatentWorkflow.Service
      const state = yield* svc.create("invalidation", "session-invalidation")
      expect(state.workflowType).toBe("invalidation")
      expect(state.totalSteps).toBe(5)
    }),
  )

  it.instance("completes invalidation workflow", () =>
    Effect.gen(function* () {
      const svc = yield* PatentWorkflow.Service
      const sessionId = "session-invalidation-complete"
      const steps = ["analyze_target", "search", "build_grounds", "strategy", "draft"]
      yield* svc.create("invalidation", sessionId)
      let state: PatentWorkflow.WorkflowState | null = null
      for (const action of steps) {
        state = yield* svc.advance(sessionId, action, `${action}-output`)
      }
      expect(state!.status).toBe("completed")
    }),
  )
})