/**
 * 专利领域系统提示词注入 Hook
 *
 * 在 LLM 对话系统提示词中注入 YunPat 知识产权助手的角色定义和能力说明。
 * 支持动态上下文感知：根据可用 Agent 和工作流状态调整提示词。
 */

import { getAvailableAgents } from "../utils/agent-health.js"
import { getWorkflowStore } from "../utils/workflow-store.js"

/**
 * 创建 experimental.chat.system.transform 钩子
 */
export function createSystemPromptHandler() {
  return async (
    _input: { sessionID?: string; model: any },
    output: { system: string[] },
  ) => {
    output.system.push(
      `你是 YunPat 知识产权智能助手，基于 OpenCode 平台运行。`,
      `当用户涉及专利问题时，优先使用 patent_* 系列工具；涉及商标问题时，优先使用 trademark_* 系列工具。`,
    )

    // 动态能力声明（根据可用 Agent 调整）
    const availableAgents = getAvailableAgents()
    const agentNames = availableAgents.map(a => a.className)
    const hasSearchAgent = agentNames.some(n => n.includes("Search"))
    const hasAnalyzeAgent = agentNames.some(n => n.includes("Analyzer") || n.includes("analysis"))
    const hasQualityAgent = agentNames.some(n => n.includes("Quality"))
    const hasDrawingAgent = agentNames.some(n => n.includes("Drawing") || n.includes("Image"))

    const capabilities: string[] = ["法规研究", "专利撰写", "审查意见答辩", "商标全流程", "文档解析", "文件输出"]
    if (hasSearchAgent) capabilities.push("智能专利检索")
    if (hasAnalyzeAgent) capabilities.push("深度专利分析")
    if (hasQualityAgent) capabilities.push("7维度质量检查")
    if (hasDrawingAgent) capabilities.push("附图分析")

    output.system.push(
      `你可以使用 document_read 工具读取 DOCX/PDF/图片等文档文件，提取技术交底书、对比文件等内容。`,
      `使用 file_write 工具将撰写稿、答辩书等产出保存到文件。`,
      `专利检索时：CNIPA 数据库（patent_search）用于中国专利，Google Patents（patent_search_google）用于全球专利，academic_search 用于学术论文检索。`,
      `你的能力包括：${capabilities.join("、")}。`,
      `所有法律文件生成后必须标记为"草案"状态，需经专业审校。`,
      `涉及未公开发明内容的操作需经用户明确审批。`,
    )

    // 动态工作流状态提示
    if (_input.sessionID) {
      try {
        const store = getWorkflowStore()
        const activeState = store.loadWorkflowState(_input.sessionID)
        if (activeState && activeState.status !== "completed" && activeState.status !== "failed") {
          output.system.push(
            `【当前工作流】${activeState.workflowType} 工作流进行中，当前步骤 ${activeState.currentStep + 1}/${activeState.totalSteps}，状态: ${activeState.status}。`,
          )
        }
      } catch { /* ignore */ }
    }

    // 跨会话记忆指令
    output.system.push(
      `【重要】你拥有跨会话记忆能力。在处理新任务时：`,
      `1. 先用 task_memory(action="search", task_type=..., keyword=...) 查询相似历史任务`,
      `2. 参考历史经验（输出摘要、关键词、策略）来指导当前工作`,
      `3. 如果用户提到之前做过的任务，用 task_memory 查找历史记录`,
      `4. 完成任务后，产出会自动保存到记忆系统，供未来复用`,
      `这确保了"做过的事不需要重复指导"，经验会持续积累。`,
    )

    // 工作流编排指令
    output.system.push(
      `【工作流编排】当使用 patent_draft/oa_response/reexam_response/invalidation_response 的 workflow 动作，或 patent_research 的 action="workflow" 时：`,
      `1. 每次调用返回 [WORKFLOW_STEP_COMPLETE] 标记，表示当前步骤已完成`,
      `2. 如果标记要求确认（requiresConfirmation=true），必须向用户展示结果并等待确认`,
      `3. 用户确认后，再次调用同一工具的 workflow 动作以推进到下一步`,
      `4. 不要跳过步骤，不要并行执行步骤，严格按顺序推进`,
      `5. 如果用户说"继续"或"下一步"，自动调用 workflow 推进`,
    )
  }
}
