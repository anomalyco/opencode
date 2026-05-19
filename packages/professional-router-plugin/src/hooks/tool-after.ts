/**
 * 工具执行后钩子
 * 记录工具执行结果，更新路由决策状态
 */

import type { RouterContext, RoutingDecision } from "../types/index.js"

export function createToolAfterHandler(context: RouterContext) {
  return async (
    input: { tool: string; sessionID: string; callID: string; args: any },
    output: {
      title: string
      output: string
      metadata: any
    },
  ) => {
    const { tool, sessionID } = input

    // 从内存 store 获取路由决策
    const routingDecision = context.decisionStore.get(sessionID)

    if (!routingDecision || !routingDecision.isProfessional) return

    console.debug(`[ToolAfter] 工具 ${tool} 执行完成 (领域: ${routingDecision.domain}):`, {
      title: output.title,
      outputLength: output.output.length,
    })
  }
}
