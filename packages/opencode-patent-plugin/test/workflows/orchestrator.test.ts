import { describe, test, expect, beforeEach } from "bun:test"
import {
  createFlow,
  advance,
  getState,
  getCurrentStep,
  getFlowSteps,
  reset,
  formatStepResult,
  type WorkflowType,
} from "../../src/services/workflow-orchestrator.js"

describe("WorkflowOrchestrator", () => {
  const testSessionId = "test-session-001"

  beforeEach(() => {
    reset(testSessionId)
  })

  describe("createFlow", () => {
    test("创建 draft 工作流", () => {
      const state = createFlow("draft", testSessionId)
      expect(state.sessionId).toBe(testSessionId)
      expect(state.workflowType).toBe("draft")
      expect(state.currentStep).toBe(0)
      expect(state.status).toBe("running")
      expect(state.totalSteps).toBe(5)
    })

    test("创建 oa 工作流（6步骤）", () => {
      const state = createFlow("oa", testSessionId)
      expect(state.workflowType).toBe("oa")
      expect(state.totalSteps).toBe(6)
    })

    test("创建 reexam 工作流", () => {
      const state = createFlow("reexam", testSessionId)
      expect(state.totalSteps).toBe(4)
    })

    test("创建 invalidation 工作流", () => {
      const state = createFlow("invalidation", testSessionId)
      expect(state.totalSteps).toBe(4)
    })

    test("创建 research 工作流", () => {
      const state = createFlow("research", testSessionId)
      expect(state.totalSteps).toBe(3)
    })

    test("未知工作流类型抛出错误", () => {
      expect(() => createFlow("unknown" as WorkflowType, testSessionId)).toThrow("Unknown workflow type")
    })

    test("支持 caseId 参数", () => {
      const state = createFlow("draft", testSessionId, "case-001")
      expect(state.caseId).toBe("case-001")
    })

    test("无 caseId 时默认为 null", () => {
      const state = createFlow("draft", testSessionId)
      expect(state.caseId).toBeNull()
    })
  })

  describe("advance", () => {
    test("推进到下一步", () => {
      createFlow("draft", testSessionId)
      const state = advance(testSessionId, "understand", "理解结果")
      expect(state.currentStep).toBe(1)
    })

    test("记录步骤输出", () => {
      createFlow("draft", testSessionId)
      advance(testSessionId, "understand", "理解结果内容")
      const state = getState(testSessionId)!
      expect(state.stepOutputs["understand"]).toBe("理解结果内容")
    })

    test("完成所有步骤后状态为 completed", () => {
      const flow = createFlow("research", testSessionId)
      // research 有 3 步
      advance(testSessionId, "plan", "计划内容")
      advance(testSessionId, "search", "检索内容")
      const finalState = advance(testSessionId, "synthesize", "综合结果")

      expect(finalState.status).toBe("completed")
      expect(finalState.currentStep).toBe(3)
    })

    test("需要确认的步骤暂停为 paused", () => {
      // draft 步骤 0: understand (requiresConfirmation: true)
      // 推进后到步骤 1: search (requiresConfirmation: true) → paused
      createFlow("draft", testSessionId)
      const state = advance(testSessionId, "understand", "理解结果")
      expect(state.status).toBe("paused")
    })

    test("不存在的 session 抛出错误", () => {
      expect(() => advance("nonexistent", "action", "output")).toThrow("No active workflow")
    })

    test("已完成的工作流不能再推进", () => {
      createFlow("research", testSessionId)
      advance(testSessionId, "plan", "计划")
      advance(testSessionId, "search", "检索")
      advance(testSessionId, "synthesize", "综合")
      // 现在已完成
      expect(() => advance(testSessionId, "extra", "额外")).toThrow("Workflow is completed")
    })
  })

  describe("getState", () => {
    test("返回已创建的工作流状态", () => {
      createFlow("draft", testSessionId)
      const state = getState(testSessionId)
      expect(state).not.toBeNull()
      expect(state!.workflowType).toBe("draft")
    })

    test("不存在的 session 返回 null", () => {
      expect(getState("nonexistent")).toBeNull()
    })
  })

  describe("getCurrentStep", () => {
    test("返回当前步骤定义", () => {
      createFlow("draft", testSessionId)
      const step = getCurrentStep(getState(testSessionId)!)
      expect(step).not.toBeNull()
      expect(step!.action).toBe("understand")
    })

    test("完成后返回 null", () => {
      createFlow("research", testSessionId)
      advance(testSessionId, "plan", "计划")
      advance(testSessionId, "search", "检索")
      advance(testSessionId, "synthesize", "综合")
      const step = getCurrentStep(getState(testSessionId)!)
      expect(step).toBeNull()
    })
  })

  describe("getFlowSteps", () => {
    test("draft 有 5 个步骤", () => {
      const steps = getFlowSteps("draft")
      expect(steps.length).toBe(5)
    })

    test("oa 有 6 个步骤", () => {
      const steps = getFlowSteps("oa")
      expect(steps.length).toBe(6)
    })

    test("oa 包含 revise_claims 步骤", () => {
      const steps = getFlowSteps("oa")
      const actions = steps.map(s => s.action)
      expect(actions).toContain("revise_claims")
    })

    test("所有工作流步骤 action 唯一", () => {
      for (const type of ["draft", "oa", "reexam", "invalidation", "research"] as WorkflowType[]) {
        const steps = getFlowSteps(type)
        const actions = steps.map(s => s.action)
        const uniqueActions = new Set(actions)
        expect(uniqueActions.size).toBe(actions.length)
      }
    })
  })

  describe("reset", () => {
    test("重置后状态不存在", () => {
      createFlow("draft", testSessionId)
      reset(testSessionId)
      expect(getState(testSessionId)).toBeNull()
    })
  })

  describe("formatStepResult", () => {
    test("包含 WORKFLOW_STEP_COMPLETE 标记", () => {
      createFlow("draft", testSessionId)
      const state = getState(testSessionId)!
      const step = getCurrentStep(state)!
      const result = formatStepResult(state, step, "步骤输出")
      expect(result).toContain("[WORKFLOW_STEP_COMPLETE]")
    })

    test("最后一步显示完成标记", () => {
      createFlow("research", testSessionId)
      advance(testSessionId, "plan", "计划")
      advance(testSessionId, "search", "检索")
      const finalState = advance(testSessionId, "synthesize", "综合")
      const steps = getFlowSteps("research")
      const lastStep = steps[2]
      const result = formatStepResult(finalState, lastStep, "综合结果")

      expect(result).toContain("工作流全部步骤已完成")
    })

    test("需要确认的步骤包含确认提示", () => {
      createFlow("draft", testSessionId)
      const state = getState(testSessionId)!
      const step = getCurrentStep(state)!
      // understand 步骤 requiresConfirmation=true
      if (step.requiresConfirmation) {
        // 模拟步骤完成后的格式化（不实际推进，只是格式化）
        const result = formatStepResult(state, step, "理解结果")
        expect(result).toContain("请确认")
      }
    })
  })
})
