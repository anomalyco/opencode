/**
 * 路由决策结果类型
 */

import type { OpencodeClient } from "@yunpat/sdk"

export type Domain = "patent" | "trademark" | "legal" | "copyright" | "general"

export type Complexity = "simple" | "medium" | "complex"

export type WorkflowType = "direct" | "hitl" | "plan_plus_hitl"

export interface RoutingDecision {
  domain: Domain
  complexity: Complexity
  workflowType: WorkflowType
  isProfessional: boolean
  reasoning: string
  requiresConfirmation: boolean
  suggestedSkills?: string[]
  suggestedTools?: string[]
}

/** 路由服务接口（用于依赖反转，避免循环导入） */
export interface IRouterService {
  route(userInput: string): Promise<RoutingDecision>
  suggestSkills(decision: RoutingDecision): string[]
  suggestTools(decision: RoutingDecision): string[]
  requiresHITL(decision: RoutingDecision): boolean
  getWorkflowType(decision: RoutingDecision): WorkflowType
}

/** 内存路由决策存储（线程安全、按 session 隔离） */
export class RoutingDecisionStore {
  private store = new Map<string, { decision: RoutingDecision; timestamp: number }>()
  private readonly TTL = 30 * 60 * 1000 // 30 minutes

  set(sessionID: string, decision: RoutingDecision): void {
    this.store.set(sessionID, { decision, timestamp: Date.now() })
  }

  get(sessionID: string): RoutingDecision | undefined {
    const entry = this.store.get(sessionID)
    if (!entry) return undefined
    if (Date.now() - entry.timestamp > this.TTL) {
      this.store.delete(sessionID)
      return undefined
    }
    return entry.decision
  }

  delete(sessionID: string): void {
    this.store.delete(sessionID)
  }
}

/** 插件生命周期上下文（不包含每次调用变化的字段） */
export interface RouterContext {
  client: OpencodeClient
  routerService: IRouterService
  decisionStore: RoutingDecisionStore
  options: Record<string, unknown>
}
