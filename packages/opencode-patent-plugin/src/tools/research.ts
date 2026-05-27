/**
 * Patent Research Tools
 *
 * 封装 YunPat 规则研究能力为 OpenCode Plugin Tools
 * 接入真实数据源：legal_world_model + Obsidian 知识库
 */

import { tool } from "@yunpat/plugin/tool"
import type { PatentPluginContext } from "../types.js"
import { runAgentSafely } from "../utils/agent-runner.js"
import { searchLegalRules, searchPatentJudgments, searchLegalArticlesSemantic, searchKnowledgeGraphNodes } from "../utils/db.js"
import { queryLawFromKB, queryGuidelinesFromKB, queryInvalidationFromKB, searchKnowledgeBase } from "../utils/obsidian-kb.js"
import { executeWorkflowStep } from "../services/workflow-orchestrator.js"

/**
 * 注册规则研究工具集
 */
export async function registerResearchTools(pluginContext: PatentPluginContext) {
  return {
    /**
     * 专利法规与实务研究
     */
    patent_research: tool({
      description: `
        研究知识产权法规与实务规则。当用户询问专利相关法规、审查指南、
        案例或实务操作时调用此工具。

        能力：
        - 检索法规条文（legal_world_model 数据库 + Obsidian 知识库）
        - 查询审查指南具体条款
        - 引用典型案例和复审无效决定
        - 归纳总结规则要点

        输入：研究主题、范围（法规/案例/实务/全部）、深度（概述/详细/深度）
        输出：结构化研究报告（Markdown），包含法规条文、案例摘要、操作要点、参考来源
      `,
      args: {
        topic: tool.schema.string().describe("研究主题，如'新用途专利创造性判定'"),
        scope: tool.schema.enum(["法规", "案例", "实务", "全部"]).optional().describe("研究范围"),
        depth: tool.schema.enum(["概述", "详细", "深度"]).optional().describe("研究深度"),
        action: tool.schema.enum(["workflow"]).optional().describe("可选：设为 'workflow' 启用多步骤编排模式"),
      },
      async execute(args, ctx) {
        const { topic, scope = "全部", depth = "详细", action } = args

        // 工作流编排模式
        if (action === "workflow") {
          return await researchWorkflow(topic, scope, depth, pluginContext, ctx.sessionID)
        }

        let output = `## 专利法规研究：${topic}\n\n`
        let hasRealData = false

        // 并行查询所有数据源（DB + KB），大幅减少延迟
        const [dbRules, dbJudgments, kbLaw, kbGuidelines, kbInvalidation] = await Promise.all([
          (scope === "法规" || scope === "全部")
            ? searchLegalRules(topic, { limit: 10 }).catch((e: any) => {
                console.warn("[LegalDB] Rules query error:", e?.message)
                return [] as any[]
              })
            : Promise.resolve([] as any[]),
          (scope === "案例" || scope === "全部")
            ? searchPatentJudgments(topic, { limit: 5 }).catch((e: any) => {
                console.warn("[LegalDB] Judgments query error:", e?.message)
                return [] as any[]
              })
            : Promise.resolve([] as any[]),
          (scope === "法规" || scope === "全部")
            ? queryLawFromKB(topic).catch((e: any) => {
                console.warn("[ObsidianKB] Law query error:", e?.message)
                return null as string | null
              })
            : Promise.resolve(null as string | null),
          (scope === "法规" || scope === "全部")
            ? queryGuidelinesFromKB(topic).catch((e: any) => {
                console.warn("[ObsidianKB] Guidelines query error:", e?.message)
                return null as string | null
              })
            : Promise.resolve(null as string | null),
          (scope === "案例" || scope === "全部")
            ? queryInvalidationFromKB(topic).catch((e: any) => {
                console.warn("[ObsidianKB] Invalidation query error:", e?.message)
                return null as string | null
              })
            : Promise.resolve(null as string | null),
        ])

        // 整合法规条文（DB）
        if (dbRules.length > 0) {
          output += `### 法规条文（数据库）\n\n`
          dbRules.forEach((r: any, i: number) => {
            output += `**${i + 1}. ${r.article_number || ""} ${r.title || ""}**\n`
            output += `${r.content?.slice(0, 500) || ""}${r.content?.length > 500 ? "..." : ""}\n\n`
            if (r.core_principle) {
              output += `> 核心原则：${r.core_principle}\n\n`
            }
          })
          hasRealData = true
        }

        // 整合判决/案例（DB）
        if (dbJudgments.length > 0) {
          output += `### 相关判决/案例（数据库）\n\n`
          dbJudgments.forEach((j: any, i: number) => {
            output += `**${i + 1}. ${j.case_number || ""} ${j.case_title || ""}**\n`
            output += `- 法院：${j.court || "N/A"}\n`
            output += `- 日期：${j.judgment_date || "N/A"}\n`
            output += `- 类型：${j.judgment_type || "N/A"}\n`
            if (j.case_summary) {
              output += `- 摘要：${j.case_summary.slice(0, 300)}...\n`
            }
            output += `\n`
          })
          hasRealData = true
        }

        // 整合知识库法规
        if (kbLaw && !kbLaw.includes("未在知识库中找到")) {
          output += `### 知识库相关文件\n\n${kbLaw.slice(0, 2000)}${kbLaw.length > 2000 ? "\n\n..." : ""}\n\n`
          hasRealData = true
        }

        // 整合审查指南
        if (kbGuidelines && !kbGuidelines.includes("未在审查指南中找到")) {
          output += `### 审查指南\n\n${kbGuidelines.slice(0, 2000)}${kbGuidelines.length > 2000 ? "\n\n..." : ""}\n\n`
          hasRealData = true
        }

        // 整合复审无效决定
        if (kbInvalidation && !kbInvalidation.includes("未在复审无效决定中找到")) {
          output += `### 复审无效决定\n\n${kbInvalidation.slice(0, 2000)}${kbInvalidation.length > 2000 ? "\n\n..." : ""}\n\n`
          hasRealData = true
        }

        // 3. 尝试使用 YunPat ResearcherAgent
        if (!hasRealData || depth === "深度") {
          try {
            const agentResult = await runAgentSafely(
              { module: "agents/researcher", className: "ResearcherAgent", maxIterations: 2 },
              { question: topic, depth: mapDepth(depth), sources: ["database"], maxResults: 10 },
              pluginContext,
            )
            if (agentResult.success && agentResult.data) {
              output += `### 智能体分析\n\n${formatResearchResult(agentResult.data)}\n\n`
              hasRealData = true
            }
          } catch (error: any) {
            console.warn("[YunPat] ResearcherAgent error:", error?.message)
          }
        }

        // 4. LLM fallback
        if (!hasRealData) {
          const prompt = buildResearchPrompt(topic, scope, depth)
          const response = await pluginContext.llm.chat({
            messages: [
              { role: "system", content: "你是知识产权法规研究专家，熟悉中国专利法及实施细则、审查指南、复审无效案例。" },
              { role: "user", content: prompt },
            ],
          })
          output += response.content
        }

        ctx.metadata({
          title: `规则研究: ${topic}`,
          metadata: { scope, depth, mode: hasRealData ? "real-data" : "llm-fallback" },
        })

        return output
      },
    }),

    /**
     * 法规条文查询
     */
    patent_law_query: tool({
      description: `
        查询具体的专利法规条文。当用户询问某个法条的具体内容时调用。
        如"专利法第22条第三款是什么"
      `,
      args: {
        law: tool.schema.string().describe("法规名称，如'专利法'、'实施细则'、'审查指南'"),
        article: tool.schema.string().describe("条款号，如'第22条'"),
        paragraph: tool.schema.string().optional().describe("款项，如'第一款'"),
      },
      async execute(args, _ctx) {
        const { law, article, paragraph } = args

        // 1. 查询 Obsidian 知识库
        try {
          const result = await queryLawFromKB(law, article)
          if (result && !result.includes("未在知识库中找到")) {
            return `## ${law}${article}${paragraph ?? ""}\n\n${result}`
          }
        } catch (error: any) {
          console.warn("[ObsidianKB] Law query error:", error?.message)
        }

        // 2. 查询 legal_world_model 数据库
        try {
          const rules = await searchLegalRules(`${law} ${article}`, { limit: 5 })
          if (rules.length > 0) {
            let output = `## ${law}${article}${paragraph ?? ""}\n\n`
            rules.forEach((r, i) => {
              output += `### ${r.article_number || ""} ${r.title || ""}\n\n`
              output += `${r.content || ""}\n\n`
              if (r.core_principle) {
                output += `> **核心原则**：${r.core_principle}\n\n`
              }
            })
            return output
          }
        } catch (error: any) {
          console.warn("[LegalDB] Law query error:", error?.message)
        }

        return `【${law}${article}${paragraph ?? ""}】\n\n> 注：未在知识库或数据库中找到该条款的准确内容。请提供更多信息或检查条款编号。`
      },
    }),
  }
}

function mapDepth(depth: string): "quick" | "standard" | "comprehensive" {
  const map: Record<string, "quick" | "standard" | "comprehensive"> = {
    "概述": "quick",
    "详细": "standard",
    "深度": "comprehensive",
  }
  return map[depth] ?? "standard"
}

function formatResearchResult(data: any): string {
  if (!data) return "研究完成，但未返回有效数据。"

  const result = data as any
  let output = ""

  if (result.summary) {
    output += `### 摘要\n${result.summary}\n\n`
  }

  if (result.keyFindings?.length) {
    output += "### 核心发现\n"
    result.keyFindings.forEach((f: string, i: number) => {
      output += `${i + 1}. ${f}\n`
    })
    output += "\n"
  }

  if (result.sources?.length) {
    output += "### 参考来源\n"
    result.sources.forEach((s: any, i: number) => {
      output += `${i + 1}. ${s.title}${s.url ? ` (${s.url})` : ""}\n`
    })
    output += "\n"
  }

  return output
}

function buildResearchPrompt(topic: string, scope: string, depth: string): string {
  return `请对以下知识产权主题进行深入研究：

**研究主题**：${topic}
**研究范围**：${scope}
**研究深度**：${depth}

请按以下结构输出研究报告：

## 一、背景概述
简要说明该主题在专利实务中的背景和重要性。

## 二、相关法规条文
列出与该主题直接相关的专利法、实施细则、审查指南条文，并标注具体条款号。

## 三、典型案例/决定
引用 2-3 个相关复审无效决定或法院判例，标注案号。

## 四、实务操作要点
总结专利代理人在实务中处理该主题时的关键要点和注意事项。

## 五、参考来源
列出所有引用的法规、案例、指南来源。

注意：
- 所有法规引用必须标注具体条款号
- 所有案例引用必须标注案号
- 不允许无出处的断言
- 如信息不确定，明确标注"待核实"`
}

/**
 * 研究工作流编排（3 步骤）
 */
async function researchWorkflow(
  topic: string,
  scope: string,
  depth: string,
  pluginContext: PatentPluginContext,
  sessionId: string,
): Promise<string> {
  return executeWorkflowStep("research", sessionId, async (step) => {
    switch (step.action) {
      case "plan": {
        const response = await pluginContext.llm.chat({
          messages: [
            { role: "system", content: "你是知识产权法规研究专家。根据研究主题制定结构化检索计划。" },
            { role: "user", content: `请为以下研究主题制定检索计划：\n\n**主题**：${topic}\n**范围**：${scope}\n**深度**：${depth}\n\n请输出：\n1. 研究子问题分解\n2. 关键检索词（中英文）\n3. 需要查询的法规/指南/案例清单` },
          ],
        })
        return `## 步骤 1/3：研究计划 ✅\n\n${response.content}`
      }
      case "search": {
        let searchOutput = `## 步骤 2/3：知识库与法规检索 ✅\n\n`
        try {
          const rules = await searchLegalRules(topic, { limit: 10 })
          if (rules.length > 0) {
            searchOutput += `### 法规条文\n\n`
            rules.forEach((r, i) => {
              searchOutput += `**${i + 1}. ${r.article_number || ""} ${r.title || ""}**\n${r.content?.slice(0, 300) || ""}\n\n`
            })
          }
          const judgments = await searchPatentJudgments(topic, { limit: 5 })
          if (judgments.length > 0) {
            searchOutput += `### 相关判决\n\n`
            judgments.forEach((j, i) => {
              searchOutput += `${i + 1}. **${j.case_number}** ${j.case_title}\n`
            })
            searchOutput += "\n"
          }
        } catch {
          searchOutput += "> 检索失败，将在下一步通过 LLM 推理补充。\n"
        }
        return searchOutput
      }
      case "synthesize": {
        const prompt = buildResearchPrompt(topic, scope, depth)
        const response = await pluginContext.llm.chat({
          messages: [
            { role: "system", content: "你是知识产权法规研究专家，熟悉中国专利法及实施细则、审查指南、复审无效案例。" },
            { role: "user", content: prompt },
          ],
        })
        return `## 步骤 3/3：综合研究报告 ✅\n\n${response.content}`
      }
      default:
        return `未知步骤: ${step.action}`
    }
  })
}
