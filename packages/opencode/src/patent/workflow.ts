import { Context, Effect, Layer, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { randomUUID } from "crypto"

class WorkflowNotFoundError extends Schema.TaggedErrorClass<WorkflowNotFoundError>()("WorkflowNotFoundError", {
  sessionId: Schema.String,
}) {}

class ActionMismatchError extends Schema.TaggedErrorClass<ActionMismatchError>()("ActionMismatchError", {
  expected: Schema.String,
  actual: Schema.String,
}) {}

type WorkflowType = "draft" | "oa" | "reexam" | "invalidation" | "creativity"
type WorkflowStatus = "running" | "paused" | "completed" | "failed"

interface Step {
  name: string
  action: string
  description: string
}

export interface WorkflowState {
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
  reexam: [
    { name: "驳回理由确认", action: "confirm_rejection", description: "确认驳回理由和依据" },
    { name: "复审理由深度分析", action: "analyze", description: "法条适用性与事实分析" },
    { name: "证据收集与准备", action: "evidence", description: "收集支持复审的证据" },
    { name: "复审请求书撰写", action: "draft", description: "撰写复审请求书" },
    { name: "验证与打包", action: "validate", description: "最终验证" },
  ],
  invalidation: [
    { name: "目标专利分析", action: "analyze_target", description: "分析权利要求和说明书" },
    { name: "现有技术检索", action: "search", description: "检索对比文件" },
    { name: "无效理由构建", action: "build_grounds", description: "构建新颖性/创造性/充分性等理由" },
    { name: "证据组合策略", action: "strategy", description: "制定证据组合方案" },
    { name: "无效宣告请求书撰写", action: "draft", description: "撰写请求书" },
  ],
  creativity: [
    { name: "技术方案理解", action: "understand", description: "提取三元组" },
    { name: "现有技术检索与对比", action: "search", description: "检索对比文件" },
    { name: "创造性三步法分析", action: "three_step", description: "最接近现有技术→区别特征→技术启示" },
    { name: "技术效果论证", action: "effects", description: "论证显著进步" },
    { name: "创造性结论报告", action: "conclude", description: "输出结论报告" },
  ],
}

export interface Interface {
  readonly create: (type: WorkflowType, sessionId: string) => Effect.Effect<WorkflowState>
  readonly advance: (sessionId: string, action: string, output: string) => Effect.Effect<WorkflowState, ActionMismatchError | WorkflowNotFoundError>
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
          return yield* new WorkflowNotFoundError({ sessionId })
        }
        const steps = WORKFLOW_STEPS[workflowState.workflowType] ?? []
        const currentStep = steps[workflowState.currentStep]
        if (currentStep?.action !== action) {
          return yield* new ActionMismatchError({ expected: currentStep?.action ?? "none", actual: action })
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