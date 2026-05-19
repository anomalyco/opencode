/**
 * 工具执行前钩子
 * 根据路由决策决定是否需要用户确认
 */

import type { RouterContext, RoutingDecision } from "../types/index.js"

export function createToolBeforeHandler(context: RouterContext) {
  return async (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: any },
  ) => {
    const { routerService } = context
    const { tool, sessionID } = input

    // 从内存 store 获取路由决策
    const routingDecision = context.decisionStore.get(sessionID)

    if (!routingDecision || !routingDecision.isProfessional) return

    console.debug(`[ToolBefore] 工具 ${tool} 路由决策:`, {
      domain: routingDecision.domain,
      workflowType: routingDecision.workflowType,
    })

    // HITL 确认：对于高复杂度的专业任务，在建议工具列表中的工具需要用户确认
    if (routingDecision.requiresConfirmation && routingDecision.suggestedTools?.includes(tool)) {
      console.debug(`[ToolBefore] 工具 ${tool} 需要用户确认 (HITL)`)
      // 注意：实际的权限拦截由 permission.ask 钩子处理
      // 这里记录日志和准备上下文供后续钩子使用
    }
  }
}
