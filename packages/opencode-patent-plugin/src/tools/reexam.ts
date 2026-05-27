/**
 * Reexamination Tools
 *
 * 封装 YunPat 复审请求能力为 OpenCode Plugin Tools
 * - 解析驳回决定 → 分析驳回理由 → 撰写复审请求书
 */

import { tool } from "@yunpat/plugin/tool"
import type { PatentPluginContext } from "../types.js"
import { safeAsk } from "../types.js"
import { loadYunPatModule } from "../utils/yunpat-loader.js"
import { createSharedAgentContext } from "../utils/agent-factory.js"
import { searchLegalRules, searchPatentJudgments } from "../utils/db.js"
import { queryInvalidationFromKB, queryGuidelinesFromKB } from "../utils/obsidian-kb.js"
import { extractPatentKeywords } from "../utils/patent-keywords.js"
import { reexamTemplate } from "../templates/reexam.js"
import { executeWorkflowStep } from "../services/workflow-orchestrator.js"

/**
 * 注册复审请求工具集
 */
export async function registerReexamTools(pluginContext: PatentPluginContext) {
  return {
    /**
     * 复审请求分析与撰写
     */
    reexam_response: tool({
      description: `
        复审请求分析与撰写。从驳回决定出发，逐步产出完整复审请求文件。

        支持的动作：
        - parse: 解析驳回决定
        - analyze: 分析驳回理由和复审可行性
        - draft: 撰写复审请求书
        - revise_claims: 修改权利要求（复审版）
        - workflow: 多步骤编排模式（自动推进 4 步流程）
      `,
      args: {
        action: tool.schema.enum(["parse", "analyze", "draft", "revise_claims", "workflow"]).describe("复审动作"),
        rejection_decision: tool.schema.string().describe("驳回决定内容或文件路径"),
        application_claims: tool.schema.string().optional().describe("当前权利要求书"),
        context: tool.schema.string().optional().describe("额外上下文（如审查历史、对比文件）"),
      },
      async execute(args, ctx) {
        await safeAsk(ctx, {
          permission: "reexam",
          patterns: [args.action],
          always: [],
          metadata: { action: args.action },
        })

        const { action, rejection_decision, application_claims = "", context: extraContext = "" } = args

        switch (action) {
          case "workflow": return await reexamWorkflow(rejection_decision, application_claims, extraContext, pluginContext, ctx.sessionID)
          case "parse": return await reexamParse(rejection_decision, pluginContext)
          case "analyze": return await reexamAnalyze(rejection_decision, application_claims, extraContext, pluginContext)
          case "draft": return await reexamDraft(rejection_decision, application_claims, extraContext, pluginContext)
          case "revise_claims": return await reexamReviseClaims(rejection_decision, application_claims, pluginContext)
          default: return `未知的复审动作: ${action}`
        }
      },
    }),
  }
}

/**
 * 解析驳回决定
 */
async function reexamParse(rejectionDecision: string, pluginContext: PatentPluginContext) {
  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是专利审查专家。准确解析驳回决定中的结构化信息。" },
      {
        role: "user",
        content: `请解析以下驳回决定，提取关键信息：

${rejectionDecision}

请提取：
1. 申请号、申请人、发明名称
2. 驳回类型（全部驳回/部分驳回）
3. 驳回理由列表（每个理由的类型、涉及权利要求、引用的对比文件）
4. 审查员的核心论点
5. 可复审的法律依据
6. 复审期限（驳回决定发文日起 3 个月内）`,
      },
    ],
  })

  return `## 复审步骤 1/4：驳回决定解析 ✅\n\n${response.content}\n\n---\n\n*请确认解析结果。确认后将继续步骤 2：复审可行性分析。*`
}

/**
 * 分析复审可行性与策略
 */
async function reexamAnalyze(
  rejectionDecision: string,
  claims: string,
  extraContext: string,
  pluginContext: PatentPluginContext,
) {
  // 检索相关法规和先例（并行查询）
  let referenceData = ""
  try {
    const keywords = extractReexamKeywords(rejectionDecision)
    if (keywords.length > 0) {
      const [rules, kbResult, guidelines] = await Promise.all([
        searchLegalRules(keywords[0], { limit: 5 }).catch(() => []),
        queryInvalidationFromKB(keywords[0]).catch(() => null),
        queryGuidelinesFromKB("复审").catch(() => null),
      ])

      if (rules.length > 0) {
        referenceData += `### 相关法规\n\n`
        rules.forEach((r, i) => {
          referenceData += `${i + 1}. **${r.article_number}** ${r.title}\n`
          referenceData += `   ${r.content?.slice(0, 300) || ""}\n\n`
        })
      }

      if (kbResult && !kbResult.includes("未在复审无效决定中找到")) {
        referenceData += `### 复审先例\n\n${kbResult.slice(0, 1500)}\n\n`
      }

      if (guidelines && !guidelines.includes("未在审查指南中找到")) {
        referenceData += `### 审查指南参考\n\n${guidelines.slice(0, 1500)}\n\n`
      }
    }
  } catch (error: any) {
    console.warn("[Reexam] Reference search error:", error?.message)
    referenceData += `\n> ⚠️ 法规检索失败（${error?.message}），以下分析基于 LLM 推理，建议人工核实。\n`
  }

  const prompt = `请对以下驳回决定进行复审可行性分析：

**驳回决定**：
${rejectionDecision}

${claims ? `**当前权利要求**：\n${claims}\n\n` : ""}
${extraContext ? `**审查历史**：\n${extraContext}\n\n` : ""}
${referenceData ? `**参考资料**：\n${referenceData}\n\n` : ""}

请分析：
1. **复审可行性评估**（高/中/低）
   - 驳回理由是否存在事实认定错误？
   - 驳回理由是否存在法律适用错误？
   - 是否有充分的修改空间克服驳回？

2. **复审策略**（针对每个驳回理由）
   - 策略类型：修改权利要求 / 争辩 / 修改+争辩
   - 具体理由和论点
   - 预期成功率

3. **风险提示**
   - 复审可能的失败点
   - 需要特别准备的证据或材料`

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是复审请求分析专家。客观评估复审可行性，制定有效复审策略。参考相关法规和先例。" },
      { role: "user", content: prompt },
    ],
  })

  return `## 复审步骤 2/4：复审可行性分析 ✅\n\n${response.content}\n\n---\n\n*请确认分析结论和策略方向。确认后将继续步骤 3：复审请求书撰写。*`
}

/**
 * 撰写复审请求书
 */
async function reexamDraft(
  rejectionDecision: string,
  claims: string,
  extraContext: string,
  pluginContext: PatentPluginContext,
) {
  const templateRef = reexamTemplate()

  const prompt = `请基于以下驳回决定和复审策略，撰写复审请求书：

**驳回决定**：
${rejectionDecision}

${claims ? `**当前权利要求**：\n${claims}\n\n` : ""}
${extraContext ? `**额外上下文**：\n${extraContext}\n\n` : ""}

**复审请求书模板参考**（严格遵循此结构）：
${templateRef}

请按模板结构撰写，要求：
- 法律依据引用准确（专利法、实施细则、审查指南）
- 论证逻辑严密
- 使用规范的法律文书用语
- 区分事实问题和法律问题`

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是复审请求书撰写专家。按提供的模板结构撰写，严格遵循中国专利法和审查指南要求。" },
      { role: "user", content: prompt },
    ],
    maxTokens: 8192,
  })

  return `## 复审步骤 3/4：复审请求书撰写 ✅\n\n${response.content}\n\n---\n\n*请逐条审阅修改。确认后将继续步骤 4：权利要求修改。*\n\n⚠️ 以上为草案，需经专业审校后提交。`
}

/**
 * 修改权利要求（复审版）
 */
async function reexamReviseClaims(
  rejectionDecision: string,
  claims: string,
  pluginContext: PatentPluginContext,
) {
  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是权利要求修改专家。修改必须基于原始申请文件（A33不超范围），且能克服驳回理由。" },
      {
        role: "user",
        content: `请基于驳回决定修改权利要求，生成修改对照表和修改后的权利要求书：

**驳回决定**：
${rejectionDecision}

**原权利要求**：
${claims}

请输出：
1. **修改对照表**

| 权利要求 | 原文 | 修改后 | 修改依据 |
|---------|------|--------|---------|

2. **修改后的完整权利要求书**

3. **修改说明**
   - 每处修改的原始依据（说明书中的位置）
   - 修改如何克服驳回理由
   - 修改后的保护范围变化`,
      },
    ],
    maxTokens: 4096,
  })

  return `## 复审步骤 4/4：权利要求修改 ✅\n\n${response.content}\n\n---\n\n*请逐条确认修改。所有修改必须不超范围（A33），且经用户逐条批准。*`
}

/**
 * 从驳回决定中提取复审相关关键词（使用共享工具）
 */
function extractReexamKeywords(text: string): string[] {
  return extractPatentKeywords(text)
}

/**
 * 复审工作流编排
 */
async function reexamWorkflow(
  rejectionDecision: string,
  claims: string,
  extraContext: string,
  pluginContext: PatentPluginContext,
  sessionId: string,
): Promise<string> {
  return executeWorkflowStep("reexam", sessionId, async (step) => {
    switch (step.action) {
      case "parse": return await reexamParse(rejectionDecision, pluginContext)
      case "analyze": return await reexamAnalyze(rejectionDecision, claims, extraContext, pluginContext)
      case "draft": return await reexamDraft(rejectionDecision, claims, extraContext, pluginContext)
      case "revise_claims": return await reexamReviseClaims(rejectionDecision, claims, pluginContext)
      default: return `未知步骤: ${step.action}`
    }
  })
}
