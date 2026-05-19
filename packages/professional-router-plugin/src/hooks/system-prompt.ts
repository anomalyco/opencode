/**
 * 系统提示词转换钩子
 * 根据路由决策注入专业领域提示词
 */

import type { RouterContext, RoutingDecision } from "../types/index.js"

export function createSystemPromptHandler(context: RouterContext) {
  return async (
    input: { sessionID?: string; model: any },
    output: { system: string[] },
  ) => {
    const { sessionID } = input
    if (!sessionID) return

    // 从内存 store 获取路由决策
    const routingDecision = context.decisionStore.get(sessionID)
    if (!routingDecision) return

    if (!routingDecision.isProfessional) return

    const domainPrompt = getDomainPrompt(routingDecision.domain)
    if (domainPrompt) {
      output.system.push(domainPrompt)
      console.debug(`[SystemPrompt] 注入 ${routingDecision.domain} 领域提示词`)
    }
  }
}

/**
 * 获取领域提示词
 */
function getDomainPrompt(domain: string): string {
  const prompts: Record<string, string> = {
    patent: `你是专利领域的专家。在处理专利相关任务时，请遵循以下原则：
1. 准确引用专利法及相关法规
2. 使用标准的专利术语
3. 关注新颖性、创造性和实用性
4. 提供可操作的专业建议`,
    trademark: `你是商标领域的专家。在处理商标相关任务时，请遵循以下原则：
1. 准确引用商标法及相关法规
2. 关注商标的显著性和不冲突性
3. 提供专业的商标布局建议`,
    legal: `你是法律领域的专家。在处理法律相关任务时，请遵循以下原则：
1. 准确引用相关法律法规
2. 提供专业的法律分析
3. 关注实务操作和风险防控`,
    copyright: `你是著作权领域的专家。在处理著作权相关任务时，请遵循以下原则：
1. 准确引用著作权法及相关法规
2. 关注原创性和权利边界
3. 提供专业的版权保护建议`,
  }

  return prompts[domain] || ""
}
