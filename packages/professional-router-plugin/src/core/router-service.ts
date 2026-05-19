/**
 * 路由服务 - 封装 Python 实现的路由逻辑
 */

import type { RoutingDecision, IRouterService, Domain, Complexity, WorkflowType } from "../types/index.js"

export class ProfessionalRouterService implements IRouterService {
  private config: Record<string, unknown>
  private enabled: boolean
  private routeCache = new Map<string, { decision: RoutingDecision; timestamp: number }>()
  private readonly ROUTE_CACHE_TTL = 60_000 // 1 minute

  constructor(options: Record<string, unknown> = {}) {
    this.config = (options.config as Record<string, unknown>) || {}
    const pm = this.config.professionalMode as Record<string, unknown> | undefined
    this.enabled = pm?.enabled === true

    console.debug(`[RouterService] 初始化, 启用状态: ${this.enabled}`)
  }

  /**
   * 路由决策主函数
   */
  async route(userInput: string): Promise<RoutingDecision> {
    // 如果未启用专业模式，返回通用模式
    if (!this.enabled) {
      return {
        domain: "general",
        complexity: "simple",
        workflowType: "direct",
        isProfessional: false,
        reasoning: "专业模式未启用，使用通用直接执行模式",
        requiresConfirmation: false,
      }
    }

    // 检查缓存
    const cached = this.routeCache.get(userInput)
    if (cached && Date.now() - cached.timestamp < this.ROUTE_CACHE_TTL) {
      return cached.decision
    }

    // 调用 Python 路由器（通过子进程或 MCP），带错误边界
    try {
      const decision = await this.callPythonRouter(userInput)
      this.routeCache.set(userInput, { decision, timestamp: Date.now() })
      // 超过 100 条时淘汰最早条目（LRU）
      if (this.routeCache.size > 100) {
        const firstKey = this.routeCache.keys().next().value
        if (firstKey) this.routeCache.delete(firstKey)
      }
      return decision
    } catch (error) {
      console.error("[Router] Routing failed, falling back to general:", error)
      return {
        domain: "general",
        complexity: "simple",
        workflowType: "direct",
        isProfessional: false,
        reasoning: "路由失败，降级为通用模式",
        requiresConfirmation: false,
      }
    }
  }

  /**
   * 调用 Python 路由器
   *
   * 已知限制：当前使用关键词匹配的简化实现（simpleRoute）。
   * TODO: 迁移完整的 Python 路由逻辑（基于 LLM 的领域分类和复杂度评估）到 TypeScript。
   */
  private async callPythonRouter(userInput: string): Promise<RoutingDecision> {
    // 方式 1: 使用 bun spawn 调用 Python
    // 方式 2: 使用 MCP server（如果有）
    // 方式 3: 直接在 TypeScript 中实现（迁移 Python 逻辑）

    // 暂时使用简化实现
    const decision = this.simpleRoute(userInput)

    return decision
  }

  /**
   * 简化路由实现（临时）
   * TODO: 迁移完整的 Python 路由逻辑到 TypeScript
   */
  private simpleRoute(userInput: string): RoutingDecision {
    const lower = userInput.toLowerCase()

    // 检测领域
    let domain: Domain = "general"
    if (lower.includes("专利") || lower.includes("patent")) {
      domain = "patent"
    } else if (lower.includes("商标") || lower.includes("trademark")) {
      domain = "trademark"
    } else if (lower.includes("合同") || lower.includes("诉讼") || lower.includes("法律")) {
      domain = "legal"
    } else if (lower.includes("版权") || lower.includes("著作权")) {
      domain = "copyright"
    }

    const isProfessional = domain !== "general"

    // 评估复杂度
    let complexity: Complexity = "simple"
    if (lower.includes("策略") || lower.includes("布局") || lower.includes("保护") || lower.includes("分析")) {
      complexity = "complex"
    } else if (lower.includes("检索") || lower.includes("搜索") || lower.includes("查询")) {
      complexity = "medium"
    }

    // 任务类型复杂度覆盖（对已知任务类型优先于关键词匹配）
    const taskComplexity: Record<string, Complexity> = {
      "撰写": "complex", "申请": "complex", "答辩": "complex", "无效": "complex",
      "异议": "complex", "复审": "complex", "分析": "medium", "检索": "medium",
      "搜索": "medium", "查询": "medium",
    }
    for (const [task, level] of Object.entries(taskComplexity)) {
      if (lower.includes(task)) {
        complexity = level
        break
      }
    }

    // 决定工作流
    let workflowType: WorkflowType = "direct"
    if (complexity === "simple") {
      workflowType = "direct"
    } else if (complexity === "medium") {
      workflowType = "hitl"
    } else if (complexity === "complex") {
      workflowType = "plan_plus_hitl"
    }

    // 推荐技能和工具
    const suggestedSkills: string[] = []
    const suggestedTools: string[] = []

    if (domain === "patent") {
      suggestedSkills.push("patent-draft")
      suggestedTools.push("patent_search", "patent_analyze")
    } else if (domain === "trademark") {
      suggestedTools.push("trademark_search", "trademark_analyze")
    }

    return {
      domain,
      complexity,
      workflowType,
      isProfessional,
      reasoning: `检测到 ${domain} 领域业务，复杂度为 ${complexity}，使用 ${workflowType} 工作流`,
      requiresConfirmation: workflowType !== "direct",
      suggestedSkills,
      suggestedTools,
    }
  }

  /**
   * 根据路由决策建议技能
   * TODO: integrate into routing pipeline — currently unused outside simpleRoute
   */
  suggestSkills(decision: RoutingDecision): string[] {
    return decision.suggestedSkills || []
  }

  /**
   * 根据路由决策建议工具
   * TODO: integrate into routing pipeline — currently unused outside simpleRoute
   */
  suggestTools(decision: RoutingDecision): string[] {
    return decision.suggestedTools || []
  }

  /**
   * 检查是否需要 HITL 确认
   */
  requiresHITL(decision: RoutingDecision): boolean {
    return decision.requiresConfirmation
  }

  /**
   * 获取工作流类型
   */
  getWorkflowType(decision: RoutingDecision): WorkflowType {
    return decision.workflowType
  }
}
