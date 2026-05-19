/**
 * 消息处理钩子
 * 拦截用户消息，进行路由决策，并根据决策决定是否启用 HITL
 */

import type { RouterContext, RoutingDecision } from "../types/index.js"

export function createMessageHandler(context: RouterContext) {
  return async (
    input: {
      sessionID: string
      agent?: string
      model?: { providerID: string; modelID: string }
      messageID?: string
      variant?: string
    },
    output: { message: any; parts: any[] },
  ) => {
    const { routerService } = context
    const { sessionID } = input

    // 提取用户消息文本
    let userText = ""

    if (output.parts && Array.isArray(output.parts)) {
      userText = output.parts
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join("\n")
    }

    if (!userText && output.message?.text) {
      userText = output.message.text
    }

    if (!userText && output.message?.content) {
      userText = typeof output.message.content === "string" ? output.message.content : JSON.stringify(output.message.content)
    }

    if (!userText) return

    console.debug(`[MessageHandler] 会话 ${sessionID} 接收消息: ${userText.substring(0, 100)}...`)

    // 进行路由决策
    try {
      const decision = await routerService.route(userText)

      console.debug(`[MessageHandler] 路由决策:`, {
        domain: decision.domain,
        complexity: decision.complexity,
        workflowType: decision.workflowType,
        isProfessional: decision.isProfessional,
        reasoning: decision.reasoning,
      })

      // 如果是专业业务，存储路由决策到内存 store
      if (decision.isProfessional) {
        context.decisionStore.set(sessionID, decision)
        console.debug(`[MessageHandler] 路由决策已存储到 session ${sessionID}`)
      }
    } catch (error) {
      console.error("[MessageHandler] 路由决策失败:", error)
    }
  }
}
