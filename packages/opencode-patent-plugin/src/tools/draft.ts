/**
 * Patent Drafting Tools
 *
 * 封装 YunPat 专利撰写能力为 OpenCode Plugin Tools
 */

import { tool } from "@yunpat/plugin/tool"
import type { PatentPluginContext } from "../types.js"
import { safeAsk } from "../types.js"
import { loadYunPatModule } from "../utils/yunpat-loader.js"
import { createSharedAgentContext } from "../utils/agent-factory.js"
import { searchPatents, type PatentRecord } from "../utils/db.js"
import { specificationTemplate, SPEC_LENGTH_GUIDE } from "../templates/specification.js"
import { getClaimsTemplate } from "../templates/claims.js"
import { executeWorkflowStep } from "../services/workflow-orchestrator.js"

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
        - workflow: 多步骤编排模式（自动推进 5 步流程）
      `,
      args: {
        action: tool.schema.enum(["understand", "search", "specification", "claims", "abstract", "integrate", "workflow"]).describe("撰写动作"),
        disclosure: tool.schema.string().describe("技术交底书内容或文件路径"),
        patent_type: tool.schema.enum(["发明", "实用新型"]).describe("专利类型"),
        invention_type: tool.schema.enum(["装置", "方法", "系统", "组合物"]).optional().describe("发明类型"),
        context: tool.schema.string().optional().describe("额外上下文（如检索结果、用户修改意见）"),
      },
      async execute(args, ctx) {
        await safeAsk(ctx, {
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
          case "workflow": return await draftWorkflow(disclosure, patent_type, invention_type, pluginContext, ctx.sessionID)
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

    const context = await createSharedAgentContext()
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

/**
 * 现有技术检索
 *
 * 从交底书提取关键词，在专利数据库中检索相关现有技术。
 * 先尝试 patent_db（7500万 CN 专利），失败则用 LLM 提取关键词后返回提示。
 */
async function draftSearch(disclosure: string, pluginContext: PatentPluginContext) {
  // 用 LLM 提取检索关键词
  const kwResponse = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是专利检索专家。从技术交底书中提取用于现有技术检索的关键词。只返回 JSON。" },
      { role: "user", content: `从以下技术交底书中提取 3-5 个检索关键词（中英文各一组），用于在专利数据库中检索相关现有技术：\n\n${disclosure.slice(0, 2000)}\n\n请返回 JSON 格式：{"keywords_cn": ["关键词1", ...], "keywords_en": ["keyword1", ...], "ipc_hint": "可能的IPC分类号"}` },
    ],
    temperature: 0.2,
  })

  let keywords: string[] = []
  let ipcHint = ""
  try {
    const jsonMatch = kwResponse.content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      keywords = [...(parsed.keywords_cn || []), ...(parsed.keywords_en || [])]
      ipcHint = parsed.ipc_hint || ""
    }
  } catch (error: unknown) {
    console.warn("[Draft] JSON keyword parse failed:", error instanceof Error ? error.message : String(error))
    keywords = disclosure.slice(0, 100).split(/[,，、\s]+/).filter(w => w.length >= 2).slice(0, 5)
    if (keywords.length === 0) keywords = ["技术", "发明"]
  }

  if (keywords.length === 0) {
    return `## 步骤 2/5：现有技术检索 ⚠️\n\n无法从交底书提取有效检索关键词，请手动提供检索词。`
  }

  // 尝试在 patent_db 中检索
  let patents: PatentRecord[] = []
  try {
    patents = await searchPatents(keywords[0], {
      limit: 10,
      ...(ipcHint ? { ipcClass: ipcHint } : {}),
    })
  } catch (error: any) {
    console.warn("[Draft] Patent DB search failed:", error?.message)
  }

  let output = `## 步骤 2/5：现有技术检索 ✅\n\n`
  output += `**检索关键词**：${keywords.join("、")}\n`
  if (ipcHint) output += `**IPC 分类提示**：${ipcHint}\n`
  output += `\n`

  if (patents.length > 0) {
    output += `### 检索结果（${patents.length} 篇相关专利）\n\n`
    output += `| # | 专利名称 | 申请号 | 申请人 | 申请日 | 相关度 |\n`
    output += `|---|---------|--------|--------|--------|--------|\n`
    patents.forEach((p, i) => {
      const name = p.patent_name?.slice(0, 30) || "—"
      output += `| ${i + 1} | ${name} | ${p.application_number || "—"} | ${p.applicant?.slice(0, 15) || "—"} | ${p.application_date || "—"} | ${(p.relevance || 0).toFixed(2)} |\n`
    })
    output += `\n### 最相关专利摘要\n\n`
    for (const p of patents.slice(0, 3)) {
      output += `**${p.patent_name}**（${p.application_number}）\n\n`
      output += `${p.abstract?.slice(0, 300) || "无摘要"}...\n\n---\n\n`
    }
  } else {
    output += `> 专利数据库未返回结果（可能未连接或无匹配专利）。建议手动在 CNIPA/Google Patents 中检索。\n\n`
    output += `**建议检索式**：\n`
    output += `- 中文：${keywords.filter(k => /[\u4e00-\u9fff]/.test(k)).join(" AND ")}\n`
    output += `- 英文：${keywords.filter(k => /[a-zA-Z]/.test(k)).join(" AND ")}\n`
  }

  output += `\n---\n\n*请确认检索结果。确认后将继续步骤 3：说明书撰写。*`
  return output
}

async function draftSpecification(disclosure: string, patentType: string, inventionType: string, pluginContext: PatentPluginContext) {
  // 生成模板参考结构
  const templateRef = specificationTemplate({
    inventionTitle: "[发明名称]",
    patentType: patentType as "发明" | "实用新型",
    inventionType: inventionType as "装置" | "方法" | "系统" | "组合物",
  })

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是专利说明书撰写专家。严格遵循中国专利法第26条和审查指南要求。按提供的模板结构撰写。" },
      { role: "user", content: `请基于以下发明理解，撰写专利申请说明书：

**专利类型**：${patentType}
**发明类型**：${inventionType}

**技术交底书**：
${disclosure}

**说明书模板结构参考**（严格遵循此结构）：
${templateRef}

**字数要求**：
- 技术领域：${SPEC_LENGTH_GUIDE.technicalField.min}-${SPEC_LENGTH_GUIDE.technicalField.max}字
- 背景技术：${SPEC_LENGTH_GUIDE.backgroundArt.min}-${SPEC_LENGTH_GUIDE.backgroundArt.max}字
- 发明内容：${SPEC_LENGTH_GUIDE.inventionContent.min}-${SPEC_LENGTH_GUIDE.inventionContent.max}字
- 具体实施方式：${SPEC_LENGTH_GUIDE.detailedDescription.min}-${SPEC_LENGTH_GUIDE.detailedDescription.max}字` },
    ],
  })
  return `## 步骤 3/5：说明书撰写 ✅\n\n${response.content}\n\n---\n\n*请逐章节审阅修改。确认后将继续步骤 4：权利要求撰写。*`
}

async function draftClaims(disclosure: string, patentType: string, inventionType: string, pluginContext: PatentPluginContext) {
  // 生成权利要求模板参考
  const templateRef = getClaimsTemplate({
    inventionTitle: "[发明名称]",
    patentType: patentType as "发明" | "实用新型",
    inventionType: inventionType as "装置" | "方法" | "系统" | "组合物",
  })

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是权利要求撰写专家。严格遵循专利法第26条第4款和审查指南要求。按提供的模板结构撰写。" },
      { role: "user", content: `请基于以下发明内容，撰写权利要求书：

**专利类型**：${patentType}
**发明类型**：${inventionType}

**发明内容**：
${disclosure}

**权利要求模板参考**（遵循此格式）：
${templateRef}

要求：
1. 独立权利要求保护范围适中
2. 从属权利要求分层布局（3-5层）
3. 使用规范的专利术语
4. 符合审查指南格式要求` },
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

/**
 * 全文整合
 *
 * 将分步产出的说明书、权利要求、摘要整合为完整专利申请文件，
 * 进行一致性校验后输出。
 */
async function draftIntegrate(disclosure: string, pluginContext: PatentPluginContext) {
  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是专利文件整合专家。将提供的专利文件各部分整合为完整的专利申请文件，确保格式规范、术语一致、附图标记统一。" },
      {
        role: "user",
        content: `请将以下内容整合为完整的专利申请文件。确保：
1. 各部分之间术语一致
2. 附图标记统一
3. 权利要求与说明书对应
4. 格式符合国知局标准

**待整合内容**：
${disclosure}

请按以下结构输出完整文件：
---
**专利申请文件**

【发明名称】

【技术领域】

【背景技术】

【发明内容】

【附图说明】

【具体实施方式】

【权利要求书】

【摘要】
---`,
      },
    ],
    maxTokens: 8192,
  })

  return `## 专利申请文件（完整版）✅\n\n${response.content}\n\n---\n\n⚠️ 以上为草案，请经专业审校后提交。建议使用 \`patent_check\` 工具进行质量检查。`
}

/**
 * 撰写工作流编排
 *
 * 多步骤编排模式：通过 workflow orchestrator 管理状态，
 * 每次调用推进一个步骤，暂停等待用户确认。
 */
async function draftWorkflow(
  disclosure: string,
  patentType: string,
  inventionType: string,
  pluginContext: PatentPluginContext,
  sessionId: string,
): Promise<string> {
  return executeWorkflowStep("draft", sessionId, async (step) => {
    switch (step.action) {
      case "understand": return await draftUnderstand(disclosure, patentType, inventionType, pluginContext)
      case "search": return await draftSearch(disclosure, pluginContext)
      case "specification": return await draftSpecification(disclosure, patentType, inventionType, pluginContext)
      case "claims": return await draftClaims(disclosure, patentType, inventionType, pluginContext)
      case "integrate": return await draftIntegrate(disclosure, pluginContext)
      default: return `未知步骤: ${step.action}`
    }
  })
}
