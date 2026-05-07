/**
 * Patent Drafting Tools
 *
 * 封装 YunPat 专利撰写能力为 OpenCode Plugin Tools
 */

import { tool } from "@opencode-ai/plugin/tool"
import type { PatentPluginContext } from "../types.js"
import { loadYunPatModule, createAgentContext } from "../utils/yunpat-loader.js"

/**
 * 注册专利撰写工具集
 */
export async function registerDraftTools(pluginContext: PatentPluginContext) {
  return {
    /**
     * 专利撰写（5 步骤编排）
     */
    patent_draft: tool({
      description: `
        专利申请文件撰写。从技术交底书出发，逐步产出完整申请文件。

        支持的动作：
        - understand: 发明理解（提取三元组）
        - search: 现有技术检索
        - specification: 说明书撰写
        - claims: 权利要求撰写
        - abstract: 摘要撰写
        - integrate: 全文整合
      `,
      args: {
        action: tool.schema.enum(["understand", "search", "specification", "claims", "abstract", "integrate"]).describe("撰写动作"),
        disclosure: tool.schema.string().describe("技术交底书内容或文件路径"),
        patent_type: tool.schema.enum(["发明", "实用新型"]).describe("专利类型"),
        invention_type: tool.schema.enum(["装置", "方法", "系统", "组合物"]).optional().describe("发明类型"),
        context: tool.schema.string().optional().describe("额外上下文（如检索结果、用户修改意见）"),
      },
      async execute(args, ctx) {
        await ctx.ask({
          permission: "patent_draft",
          patterns: [args.action, args.patent_type],
          always: [],
          metadata: { action: args.action, patentType: args.patent_type },
        })

        const { action, disclosure, patent_type, invention_type = "装置" } = args

        // 尝试使用 YunPat Agent
        const agent = await loadYunPatDraftAgent(action, pluginContext)
        if (agent) {
          return await agent(disclosure, patent_type, invention_type, pluginContext)
        }

        // 降级：LLM 直接调用
        switch (action) {
          case "understand": return await draftUnderstand(disclosure, patent_type, invention_type, pluginContext)
          case "search": return await draftSearch(disclosure, pluginContext)
          case "specification": return await draftSpecification(disclosure, patent_type, invention_type, pluginContext)
          case "claims": return await draftClaims(disclosure, patent_type, invention_type, pluginContext)
          case "abstract": return await draftAbstract(disclosure, pluginContext)
          case "integrate": return await draftIntegrate(disclosure, pluginContext)
          default: return `未知的撰写动作: ${action}`
        }
      },
    }),
  }
}

/**
 * 动态加载 YunPat 撰写 Agent
 */
async function loadYunPatDraftAgent(action: string, pluginContext: PatentPluginContext): Promise<any> {
  const agentMap: Record<string, { module: string; className: string }> = {
    understand: { module: "agents/invention", className: "InventionAnalyzerAgent" },
    specification: { module: "agents/specification-drafter", className: "SpecificationDrafterAgent" },
    claims: { module: "agents/claim-generator", className: "ClaimGeneratorAgent" },
    abstract: { module: "agents/abstract-drafter", className: "AbstractDrafterAgent" },
  }

  const config = agentMap[action]
  if (!config) return null

  try {
    const mod = await loadYunPatModule(config.module)
    if (!mod?.[config.className]) return null

    const context = await createAgentContext()
    if (!context) return null

    const agent = new mod[config.className]({
      llm: pluginContext.llm,
      eventBus: context.eventBus,
      memory: context.memory,
      tools: context.tools,
    })

    return async (disclosure: string, patentType: string, inventionType: string, _ctx: PatentPluginContext) => {
      const result = await agent.run(
        { disclosure, patentType, inventionType },
        context,
      )
      return result.success
        ? `## ${action} ✅\n\n${result.data || result.content || JSON.stringify(result.data, null, 2)}`
        : `## ${action} 失败\n\n${result.error || "未知错误"}`
    }
  } catch (error: any) {
    console.warn(`[YunPat] Draft agent ${action} error:`, error?.message)
    return null
  }
}

// LLM fallback implementations

async function draftUnderstand(disclosure: string, patentType: string, inventionType: string, pluginContext: PatentPluginContext) {
  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是专利发明理解专家。从技术交底书中提取结构化发明信息。" },
      { role: "user", content: `请分析以下技术交底书，提取发明三元组：\n\n**专利类型**：${patentType}\n**发明类型**：${inventionType}\n\n**技术交底书**：\n${disclosure}\n\n请输出：\n1. 发明名称\n2. 技术领域\n3. 技术问题（现有技术存在的不足）\n4. 技术方案（解决该问题的具体手段）\n5. 技术效果（带来的有益效果）\n6. 核心创新点\n7. 必要技术特征\n8. 可选技术特征` },
    ],
  })
  return `## 步骤 1/5：发明理解 ✅\n\n${response.content}\n\n---\n\n*请确认以上理解是否准确。确认后将继续步骤 2：现有技术检索。*`
}

async function draftSearch(disclosure: string, pluginContext: PatentPluginContext) {
  return `## 步骤 2/5：现有技术检索 ✅\n\n> 注：此步骤需要接入 YunPat PatentSearchAgent（@yunpat/agent-search V3）和专利数据库（7500万 CN 专利）才能提供真实检索结果。\n\n---\n\n*请确认检索结果。确认后将继续步骤 3：说明书撰写。*`
}

async function draftSpecification(disclosure: string, patentType: string, inventionType: string, pluginContext: PatentPluginContext) {
  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是专利说明书撰写专家。严格遵循中国专利法第26条和审查指南要求。" },
      { role: "user", content: `请基于以下发明理解，撰写专利申请说明书：\n\n**专利类型**：${patentType}\n**发明类型**：${inventionType}\n\n**技术交底书**：\n${disclosure}\n\n请按以下结构撰写：\n1. 技术领域（50-100字）\n2. 背景技术（300-500字）\n3. 发明内容（800-1500字）\n4. 具体实施方式（1500-3000字）\n5. 附图说明（如有附图）` },
    ],
  })
  return `## 步骤 3/5：说明书撰写 ✅\n\n${response.content}\n\n---\n\n*请逐章节审阅修改。确认后将继续步骤 4：权利要求撰写。*`
}

async function draftClaims(disclosure: string, patentType: string, inventionType: string, pluginContext: PatentPluginContext) {
  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是权利要求撰写专家。严格遵循专利法第26条第4款和审查指南要求。" },
      { role: "user", content: `请基于以下发明内容，撰写权利要求书：\n\n**专利类型**：${patentType}\n**发明类型**：${inventionType}\n\n**发明内容**：\n${disclosure}\n\n要求：\n1. 独立权利要求保护范围适中\n2. 从属权利要求分层布局（3-5层）\n3. 使用规范的专利术语\n4. 符合审查指南格式要求` },
    ],
  })
  return `## 步骤 4/5：权利要求撰写 ✅\n\n${response.content}\n\n---\n\n*请审阅权利要求保护范围。确认后将继续步骤 5：摘要与整合。*`
}

async function draftAbstract(disclosure: string, pluginContext: PatentPluginContext) {
  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是专利摘要撰写专家。" },
      { role: "user", content: `请为以下专利申请撰写摘要（300字左右）：\n\n${disclosure}` },
    ],
  })
  return `## 步骤 5/5：摘要撰写 ✅\n\n${response.content}\n\n---\n\n*专利申请文件撰写完成。以上为草案，请经专业审校后提交。*`
}

async function draftIntegrate(disclosure: string, pluginContext: PatentPluginContext) {
  return `## 专利申请文件（完整版）\n\n> 注：全文整合功能需要接入 YunPat PatentWriterAgent（@yunpat/agent-patent-writer）实现自动整合和格式校验。`
}
