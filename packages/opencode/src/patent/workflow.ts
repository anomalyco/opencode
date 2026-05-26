import { Context, Effect, Layer } from "effect"
import { InstanceState } from "@/effect/instance-state"
import type { InstanceContext } from "@/project/instance"
import { randomUUID } from "crypto"

type WorkflowType = "draft" | "oa" | "reexam" | "invalidation"
type WorkflowStatus = "running" | "paused" | "completed" | "failed"

interface Step {
  name: string
  action: string
  description: string
}

interface WorkflowState {
  sessionId: string
  caseId: string | null
  workflowType: WorkflowType
  currentStep: number
  totalSteps: number
  status: WorkflowStatus
  stepOutputs: Record<string, string>
  startedAt: number
}

const WORKFLOW_STEPS: Record<WorkflowType, Step[]> = {
  draft: [
    { name: "交底书预处理", action: "preprocess", description: "文档格式转换与图纸识别" },
    { name: "发明理解", action: "understand", description: "提取三元组" },
    { name: "现有技术检索", action: "search", description: "检索对比文件" },
    { name: "说明书撰写", action: "specification", description: "撰写说明书" },
    { name: "权利要求撰写", action: "claims", description: "撰写权利要求" },
    { name: "摘要与整合", action: "integrate", description: "撰写摘要并整合" },
  ],
  oa: [
    { name: "审查意见解析", action: "parse", description: "解析审查意见" },
    { name: "法规调研与分析", action: "analyze", description: "深度分析" },
    { name: "答复策略制定", action: "strategy", description: "制定策略" },
    { name: "答复文本撰写", action: "respond", description: "撰写答复" },
    { name: "验证与打包", action: "validate", description: "最终验证" },
  ],
  reexam: [],
  invalidation: [],
}

export interface Interface {
  readonly create: (type: WorkflowType, sessionId: string) => Effect.Effect<WorkflowState>
  readonly advance: (sessionId: string, action: string, output: string) => Effect.Effect<WorkflowState>
  readonly getState: (sessionId: string) => Effect.Effect<WorkflowState | null>
  readonly getCurrentStep: (state: WorkflowState) => Effect.Effect<Step | null>
  readonly reset: (sessionId: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PatentWorkflow") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make<Map<string, WorkflowState>>(() =>
      Effect.succeed(new Map()),
    )

    const create = Effect.fn("PatentWorkflow.create")(function* (type: WorkflowType, sessionId: string) {
      const steps = yield* Effect.succeed(WORKFLOW_STEPS[type] ?? [])
      const workflowState: WorkflowState = {
        sessionId,
        caseId: null,
        workflowType: type,
        currentStep: 0,
        totalSteps: steps.length,
        status: "running",
        stepOutputs: {},
        startedAt: Date.now(),
      }
      const stateMap = yield* InstanceState.get(state)
      stateMap.set(sessionId, workflowState)
      return workflowState
    })

    const advance = Effect.fn("PatentWorkflow.advance")(
      function* (sessionId: string, action: string, output: string) {
        const stateMap = yield* InstanceState.get(state)
        const workflowState = stateMap.get(sessionId)
        if (!workflowState) {
          return yield* Effect.die(new Error(`Workflow not found for session: ${sessionId}`))
        }
        const steps = WORKFLOW_STEPS[workflowState.workflowType] ?? []
        const currentStep = steps[workflowState.currentStep]
        if (currentStep?.action !== action) {
          return yield* Effect.die(new Error(`Action mismatch: expected ${currentStep?.action}, got ${action}`))
        }
        const updatedOutputs = { ...workflowState.stepOutputs, [action]: output }
        const nextStep = workflowState.currentStep + 1
        const status = nextStep >= workflowState.totalSteps ? "completed" : "running"
        const updatedState: WorkflowState = {
          ...workflowState,
          currentStep: nextStep,
          status,
          stepOutputs: updatedOutputs,
        }
        stateMap.set(sessionId, updatedState)
        return updatedState
      },
    )

    const getState = Effect.fn("PatentWorkflow.getState")(function* (sessionId: string) {
      const stateMap = yield* InstanceState.get(state)
      return stateMap.get(sessionId) ?? null
    })

    const getCurrentStep = Effect.fn("PatentWorkflow.getCurrentStep")(function* (workflowState: WorkflowState) {
      const steps = WORKFLOW_STEPS[workflowState.workflowType] ?? []
      return steps[workflowState.currentStep] ?? null
    })

    const reset = Effect.fn("PatentWorkflow.reset")(function* (sessionId: string) {
      const stateMap = yield* InstanceState.get(state)
      stateMap.delete(sessionId)
      yield* Effect.void
    })

    return Service.of({ create, advance, getState, getCurrentStep, reset })
  }),
)

export const defaultLayer = layer

export * as PatentWorkflow from "./workflow"