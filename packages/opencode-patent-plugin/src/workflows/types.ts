/**
 * 工作流步骤定义
 *
 * 每个 OrchestratorStep 定义工作流中的一个步骤，
 * 包括对应的 tool action、描述以及是否需要人工确认。
 */

/** 工作流步骤 */
export interface OrchestratorStep {
  /** 步骤名称（中文） */
  name: string
  /** 对应的 tool action */
  action: string
  /** 步骤描述（返回给用户） */
  description: string
  /** true = 等待用户确认后再进入下一步 */
  requiresConfirmation: boolean
}

/** 工作流状态 */
export interface OrchestratorState {
  /** 会话 ID */
  sessionId: string
  /** 案件 ID */
  caseId: string | null
  /** 工作流类型 */
  workflowType: "draft" | "oa" | "reexam" | "invalidation" | "research"
  /** 当前步骤索引（0-based） */
  currentStep: number
  /** 总步骤数 */
  totalSteps: number
  /** 编排状态 */
  status: "running" | "paused" | "completed" | "failed"
  /** 各步骤累积输出（action → output） */
  stepOutputs: Record<string, string>
  /** 创建时间 */
  startedAt: number
}
