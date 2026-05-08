/**
 * 工作流编排器
 *
 * 管理多步骤工作流的状态机和步骤推进。
 * 核心设计：编排器不阻塞，通过结构化输出 + 系统提示词引导 LLM 按步骤推进。
 *
 * 流程：
 * 1. createFlow() 创建编排实例，记录初始状态
 * 2. advance() 执行当前步骤，返回结果和下一步指示
 * 3. 如果 requiresConfirmation=true，LLM 向用户展示并等待确认
 * 4. 用户确认后再次调用 advance() 推进到下一步
 * 5. 所有步骤完成后状态变为 completed
 */

import { getWorkflowStore } from "../utils/workflow-store.js"
import type { OrchestratorStep, OrchestratorState } from "../workflows/types.js"
import type { WorkflowStep } from "../utils/workflow-store.js"
import { DRAFT_FLOW } from "../workflows/flows.js"
import { OA_FLOW } from "../workflows/oa-flow.js"
import { REEXAM_FLOW } from "../workflows/reexam-flow.js"
import { INVALIDATION_FLOW } from "../workflows/invalidation-flow.js"
import { RESEARCH_FLOW } from "../workflows/research-flow.js"

/** 工作流类型 */
export type WorkflowType = "draft" | "oa" | "reexam" | "invalidation" | "research"

/** 工作流注册表 */
const WORKFLOW_REGISTRY: Record<WorkflowType, OrchestratorStep[]> = {
  draft: DRAFT_FLOW,
  oa: OA_FLOW,
  reexam: REEXAM_FLOW,
  invalidation: INVALIDATION_FLOW,
  research: RESEARCH_FLOW,
}

/** 内存中的活跃工作流状态（sessionId → state） */
const activeFlows = new Map<string, OrchestratorState>()

/**
 * 创建工作流
 */
export function createFlow(
  type: WorkflowType,
  sessionId: string,
  caseId?: string,
): OrchestratorState {
  const steps = WORKFLOW_REGISTRY[type]
  if (!steps) throw new Error(`Unknown workflow type: ${type}`)

  const state: OrchestratorState = {
    sessionId,
    caseId: caseId ?? null,
    workflowType: type,
    currentStep: 0,
    totalSteps: steps.length,
    status: "running",
    stepOutputs: {},
    startedAt: Date.now(),
  }

  // 持久化到 WorkflowStore
  try {
    const store = getWorkflowStore()
    const workflowSteps: WorkflowStep[] = steps.map(s => ({
      toolName: type,
      action: s.action,
      description: s.description,
    }))
    store.recordExecution({
      sessionId,
      steps: workflowSteps,
    })
  } catch {
    // 持久化失败不影响编排
  }

  activeFlows.set(sessionId, state)
  return state
}

/**
 * 推进工作流
 *
 * 记录当前步骤的输出，推进到下一步。
 * @returns 更新后的状态
 */
export function advance(
  sessionId: string,
  stepAction: string,
  stepOutput: string,
): OrchestratorState {
  const state = activeFlows.get(sessionId)
  if (!state) throw new Error(`No active workflow for session: ${sessionId}`)
  if (state.status !== "running") throw new Error(`Workflow is ${state.status}, cannot advance`)

  // 记录当前步骤输出
  state.stepOutputs[stepAction] = stepOutput

  const steps = WORKFLOW_REGISTRY[state.workflowType]

  // 推进到下一步
  state.currentStep++

  if (state.currentStep >= state.totalSteps) {
    state.status = "completed"
  } else {
    const nextStep = steps[state.currentStep]
    state.status = nextStep.requiresConfirmation ? "paused" : "running"
  }

  activeFlows.set(sessionId, state)
  return state
}

/**
 * 获取工作流状态
 */
export function getState(sessionId: string): OrchestratorState | null {
  return activeFlows.get(sessionId) ?? null
}

/**
 * 获取当前步骤定义
 */
export function getCurrentStep(state: OrchestratorState): OrchestratorStep | null {
  const steps = WORKFLOW_REGISTRY[state.workflowType]
  if (state.currentStep >= steps.length) return null
  return steps[state.currentStep]
}

/**
 * 获取工作流步骤定义
 */
export function getFlowSteps(type: WorkflowType): OrchestratorStep[] {
  return WORKFLOW_REGISTRY[type]
}

/**
 * 重置工作流
 */
export function reset(sessionId: string): void {
  activeFlows.delete(sessionId)
}

/**
 * 格式化步骤结果为标准输出
 *
 * 返回包含 [WORKFLOW_STEP_COMPLETE] 标记的结构化文本，
 * 系统提示词引导 LLM 识别此标记并向用户请求确认。
 */
export function formatStepResult(
  state: OrchestratorState,
  step: OrchestratorStep,
  output: string,
): string {
  const steps = WORKFLOW_REGISTRY[state.workflowType]
  const isLast = state.status === "completed"
  const nextStep = !isLast ? steps[state.currentStep] : null

  let result = `[WORKFLOW_STEP_COMPLETE]\n`
  result += `步骤 ${state.currentStep}/${state.totalSteps}「${step.description}」已完成。\n\n`
  result += `${output}\n\n`

  if (!isLast && nextStep) {
    if (step.requiresConfirmation) {
      result += `⚠️ 请确认以上结果，然后回复「继续」进入下一步。\n\n`
    }
    result += `下一步骤：${nextStep.description}\n`
  } else {
    result += `✅ 工作流全部步骤已完成。\n`
  }

  return result
}
