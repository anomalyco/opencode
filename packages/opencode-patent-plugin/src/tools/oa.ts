/**
 * OA Response Tools
 *
 * 封装 YunPat 审查意见答辩能力为 OpenCode Plugin Tools
 * 接入真实数据源：legal_world_model + Obsidian 知识库
 */

import { tool } from "@yunpat/plugin/tool"
import type { PatentPluginContext } from "../types.js"
import { safeAsk } from "../types.js"
import { loadYunPatModule } from "../utils/yunpat-loader.js"
import { createSharedAgentContext } from "../utils/agent-factory.js"
import { searchPatentJudgments, searchLegalRules } from "../utils/db.js"
import { queryInvalidationFromKB } from "../utils/obsidian-kb.js"
import { extractPatentKeywords } from "../utils/patent-keywords.js"
import { responseTemplate } from "../templates/response.js"
import { executeWorkflowStep } from "../services/workflow-orchestrator.js"

/**
 * 注册审查意见答辩工具集
 */
export async function registerOATools(pluginContext: PatentPluginContext) {
  return {
    /**
     * 审查意见分析与答辩
     */
    oa_response: tool({
      description: `
        审查意见（Office Action）分析与答辩。从审查意见通知书出发，逐步产出完整答辩文件。

        支持的动作：
        - parse: 解析审查意见通知书
        - analyze: 深度分析驳回理由
        - simulate: 模拟审查员视角
        - respond: 生成答辩策略和意见陈述书
        - revise_claims: 修改权利要求
        - validate: 验证答辩完整性
        - workflow: 多步骤编排模式（自动推进 5 步流程）
      `,
      args: {
        action: tool.schema.enum(["parse", "analyze", "simulate", "respond", "revise_claims", "validate", "workflow"]).describe("答辩动作"),
        office_action: tool.schema.string().describe("审查意见通知书内容或文件路径"),
        application_claims: tool.schema.string().optional().describe("当前权利要求书"),
        context: tool.schema.string().optional().describe("额外上下文（如对比文件、审查历史）"),
      },
      async execute(args, ctx) {
        await safeAsk(ctx, {
          permission: "oa_response",
          patterns: [args.action],
          always: [],
          metadata: { action: args.action },
        })

        const { action, office_action, application_claims = "", context: extraContext = "" } = args

        // 增强：检索相关先例和法规（并行查询）
        let precedentData = ""
        if (action === "analyze" || action === "respond") {
          try {
            const keywords = extractKeywords(office_action)
            if (keywords.length > 0) {
              // 并行查询三个数据源
              const [judgments, kbResult, rules] = await Promise.all([
                searchPatentJudgments(keywords.join(" "), { limit: 5 }).catch(() => []),
                queryInvalidationFromKB(keywords[0]).catch(() => null),
                searchLegalRules(keywords.join(" "), { limit: 5 }).catch(() => []),
              ])

              if (judgments.length > 0) {
                precedentData += `### 相关判决/先例（数据库）\n\n`
                judgments.forEach((j, i) => {
                  precedentData += `${i + 1}. **${j.case_number}** ${j.case_title}\n`
                  precedentData += `   - 法院：${j.court} | 日期：${j.judgment_date}\n`
                  if (j.case_summary) precedentData += `   - 摘要：${j.case_summary.slice(0, 200)}...\n`
                  precedentData += `\n`
                })
              }

              if (kbResult && !kbResult.includes("未在复审无效决定中找到")) {
                precedentData += `### 复审无效决定（知识库）\n\n${kbResult.slice(0, 1500)}\n\n`
              }

              if (rules.length > 0) {
                precedentData += `### 相关法规条文\n\n`
                rules.forEach((r, i) => {
                  precedentData += `${i + 1}. **${r.article_number}** ${r.title}\n`
                  precedentData += `   ${r.content?.slice(0, 300) || ""}${r.content?.length > 300 ? "..." : ""}\n\n`
                })
              }
            }
          } catch (error: any) {
            console.warn("[OA] Precedent search error:", error?.message)
            precedentData += `\n> ⚠️ 先例检索失败（${error?.message}），以下分析基于 LLM 推理，建议人工核实。\n`
          }
        }

        // 尝试使用 YunPat PatentResponderAgent
        if (action === "respond" || action === "revise_claims") {
          try {
            const result = await runPatentResponder(action, office_action, application_claims, extraContext, pluginContext)
            if (result) {
              return result + (precedentData ? `\n\n---\n\n${precedentData}` : "")
            }
          } catch (error: any) {
            console.warn("[YunPat] PatentResponderAgent error:", error?.message)
          }
        }

        switch (action) {
          case "workflow": return await oaWorkflow(office_action, application_claims, extraContext, pluginContext, ctx.sessionID)
          case "parse": return await oaParse(office_action, pluginContext)
          case "analyze": return await oaAnalyze(office_action, application_claims, pluginContext, precedentData)
          case "simulate": return await oaSimulate(office_action, application_claims, pluginContext)
          case "respond": return await oaRespond(office_action, application_claims, pluginContext, precedentData)
          case "revise_claims": return await oaReviseClaims(office_action, application_claims, pluginContext)
          case "validate": return await oaValidate(office_action, application_claims, pluginContext)
          default: return `未知的答辩动作: ${action}`
        }
      },
    }),
  }
}

// 关键词提取使用共享工具
function extractKeywords(text: string): string[] {
  return extractPatentKeywords(text)
}

async function runPatentResponder(
  action: string,
  officeAction: string,
  claims: string,
  extraContext: string,
  pluginContext: PatentPluginContext,
): Promise<string | null> {
  const mod = await loadYunPatModule("agents/patent-responder")
  if (!mod?.PatentResponderAgentV5 && !mod?.PatentResponderAgent) return null

  const AgentClass = mod.PatentResponderAgentV5 || mod.PatentResponderAgent
  const context = await createSharedAgentContext()
  if (!context) return null

  const agent = new AgentClass({
    llm: pluginContext.llm,
    eventBus: context.eventBus,
    memory: context.memory,
    tools: context.tools,
  })

  const result = await agent.run(
    {
      officeAction,
      originalClaims: claims,
      context: extraContext,
      enablePrecedentSearch: false,
    },
    context,
  )

  if (!result.success) return null

  if (action === "respond") {
    return `## 答辩策略与意见陈述书 ✅\n\n${result.data?.responseText || result.data?.content || JSON.stringify(result.data, null, 2)}`
  }

  if (action === "revise_claims") {
    return `## 权利要求修改建议 ✅\n\n${result.data?.revisedClaims || result.data?.content || JSON.stringify(result.data, null, 2)}`
  }

  return null
}

async function oaParse(officeAction: string, pluginContext: PatentPluginContext) {
  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是审查意见解析专家。准确提取审查意见通知书中的结构化信息。" },
      { role: "user", content: `请解析以下审查意见通知书：\n\n${officeAction}\n\n请提取：\n1. OA 编号、申请号\n2. 驳回类型（新颖性/创造性/公开不充分/不清楚/超范围）\n3. 引用的对比文件列表\n4. 被驳回的权利要求\n5. 审查员论点摘要\n6. 答复期限` },
    ],
  })
  return `## 步骤 1/5：审查意见解析 ✅\n\n${response.content}\n\n---\n\n*请确认解析是否完整准确。确认后将继续步骤 2：深度分析。*`
}

async function oaAnalyze(officeAction: string, claims: string, pluginContext: PatentPluginContext, precedentData: string = "") {
  const prompt = `请对以下审查意见进行深度技术分析：

**审查意见**：
${officeAction}

**当前权利要求**：
${claims}

${precedentData ? `**相关先例和法规**：\n${precedentData}\n\n` : ""}

请按驳回类型逐一分析：
1. 新颖性（A22.2）：单独对比原则，逐特征比对
2. 创造性（A22.3）：三步法（最接近现有技术→区别特征→技术启示）
3. 其他驳回理由（如适用）

如有相关先例，请引用以支持分析。`

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是专利分析专家。运用新颖性单独对比原则和创造性三步法进行深度分析。善用相关先例和法规支持论点。" },
      { role: "user", content: prompt },
    ],
  })
  return `## 步骤 2/5：深度分析 ✅\n\n${response.content}\n\n---\n\n*请确认技术分析。确认后将继续步骤 3：答辩策略。*`
}

async function oaSimulate(officeAction: string, claims: string, pluginContext: PatentPluginContext) {
  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你模拟专利审查员视角，预判申请人的答辩可能性和审查员可能的反驳。" },
      { role: "user", content: `请从审查员角度分析以下案件：\n\n**审查意见**：\n${officeAction}\n\n**权利要求**：\n${claims}\n\n请输出：\n1. 审查员可能的反驳论点\n2. 申请方答辩的薄弱环节\n3. 建议的答辩策略方向` },
    ],
  })
  return `## 审查员视角模拟\n\n${response.content}\n\n---\n\n*以上模拟结果仅供参考。*`
}

async function oaRespond(officeAction: string, claims: string, pluginContext: PatentPluginContext, precedentData: string = "") {
  const templateRef = responseTemplate()

  const prompt = `请基于以下审查意见和权利要求，撰写意见陈述书草案：

**审查意见**：
${officeAction}

**权利要求**：
${claims}

${precedentData ? `**相关先例和法规**：\n${precedentData}\n\n` : ""}

**意见陈述书模板参考**（严格遵循此结构）：
${templateRef}

请按模板结构撰写，确保：
一、关于驳回理由N（类型）
  1. 审查员观点概述
  2. 申请人的意见（逐条回应）
  3. 技术对比分析（详细对比表）
  4. 法律依据（法条和审查指南引用）
  5. 结论（明确请求）
二、权利要求修改说明（如修改）
  修改依据 + 修改内容标注 + 修改后文本

如有相关先例，请引用以支持论点。`

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是审查意见答辩专家。按提供的模板结构撰写意见陈述书。善用相关先例和法规支持论点。" },
      { role: "user", content: prompt },
    ],
  })
  return `## 步骤 4/5：答辩文本撰写 ✅\n\n${response.content}\n\n---\n\n*请逐条审阅修改。确认后将继续步骤 5：验证打包。*`
}

async function oaReviseClaims(officeAction: string, claims: string, pluginContext: PatentPluginContext) {
  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是权利要求修改专家。确保修改不超范围（A33），并克服驳回理由。" },
      { role: "user", content: `请基于审查意见修改以下权利要求，生成修改对照表：\n\n**审查意见**：\n${officeAction}\n\n**原权利要求**：\n${claims}\n\n请输出：\n1. 修改对照表（原文 vs 修改后 + 修改依据）\n2. 修改后的完整权利要求书\n3. 修改如何克服驳回理由的说明` },
    ],
  })
  return `## 权利要求修改建议\n\n${response.content}\n\n---\n\n*请逐条审阅修改。权利要求修改必须经用户逐条批准。*`
}

/**
 * OA 答辩完整性验证
 *
 * 使用 LLM 对答辩文件进行结构化完整性检查，
 * 确保所有驳回理由均已回应、修改不超范围、格式合规。
 */
async function oaValidate(officeAction: string, claims: string, pluginContext: PatentPluginContext) {
  // 先解析审查意见中的驳回理由
  const parseResponse = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是审查意见解析专家。提取审查意见中的所有驳回理由列表，只返回 JSON。" },
      { role: "user", content: `从以下审查意见中提取所有驳回理由（每条一个条目）：\n\n${officeAction}\n\n返回 JSON：{"rejections": [{"id": 1, "type": "创造性", "claims": ["1-3"], "citations": ["D1", "D2"]}]}` },
    ],
    temperature: 0.1,
  })

  let rejections: Array<{ id: number; type: string; claims: string[]; citations: string[] }> = []
  try {
    const jsonMatch = parseResponse.content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      rejections = parsed.rejections || []
    }
  } catch {
    // 解析失败，设置默认值
    rejections = [{ id: 1, type: "未知", claims: ["全部"], citations: [] }]
  }

  // 让 LLM 执行完整性验证
  const validateResponse = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是审查意见答辩验证专家。逐项检查答辩文件的完整性。" },
      {
        role: "user",
        content: `请对以下 OA 答辩进行完整性验证。

**审查意见**：
${officeAction.slice(0, 3000)}

**当前权利要求**：
${claims.slice(0, 2000)}

**已识别的驳回理由**：
${rejections.map(r => `${r.id}. ${r.type}（权利要求 ${r.claims.join(", ")}，引用 ${r.citations.join(", ")}）`).join("\n")}

请逐项验证以下检查清单：

1. **驳回理由覆盖**：每个驳回理由是否都有对应的回应？
2. **权利要求修改合规**（A33）：修改是否超范围？是否基于原始申请文件？
3. **法律依据引用**：是否引用了正确的法条和审查指南段落？
4. **技术对比完整性**：每个区别特征是否有充分的技术对比分析？
5. **格式合规**：是否符合国知局 OA 答复格式要求？
6. **权利要求引用基础**：修改后的权利要求在说明书中是否有支持？

返回 JSON：
{
  "checks": [
    {"item": "检查项", "status": "pass/warn/fail", "detail": "具体说明"}
  ],
  "overall": "pass/warn/fail",
  "summary": "总结"
}`,
      },
    ],
    temperature: 0.1,
  })

  // 解析验证结果
  let checks: Array<{ item: string; status: string; detail: string }> = []
  let overall = "warn"
  let summary = ""

  try {
    const jsonMatch = validateResponse.content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      checks = parsed.checks || []
      overall = parsed.overall || "warn"
      summary = parsed.summary || ""
    }
  } catch {
    summary = validateResponse.content
  }

  // 格式化输出
  const statusIcon = (s: string) => s === "pass" ? "✅" : s === "fail" ? "❌" : "⚠️"

  let output = `## 步骤 5/5：验证与打包 ${statusIcon(overall)}\n\n`
  output += `**驳回理由数**：${rejections.length}\n`
  output += `**验证结论**：${overall === "pass" ? "通过，可以提交" : overall === "fail" ? "不通过，需修改" : "有警告项，请确认"}\n\n`

  if (checks.length > 0) {
    output += `| # | 检查项 | 状态 | 说明 |\n`
    output += `|---|--------|------|------|\n`
    checks.forEach((c, i) => {
      output += `| ${i + 1} | ${c.item} | ${statusIcon(c.status)} ${c.status} | ${c.detail} |\n`
    })
    output += `\n`
  }

  if (summary) {
    output += `### 验证总结\n\n${summary}\n\n`
  }

  const failedChecks = checks.filter(c => c.status === "fail")
  if (failedChecks.length > 0) {
    output += `### ⚠️ 需要修改的项\n\n`
    failedChecks.forEach(c => {
      output += `- **${c.item}**：${c.detail}\n`
    })
    output += `\n`
  }

  output += `---\n\n*验证完成。如有不合格项，请返回修改后重新验证。*`
  return output
}

/**
 * OA 答辩工作流编排
 */
async function oaWorkflow(
  officeAction: string,
  claims: string,
  extraContext: string,
  pluginContext: PatentPluginContext,
  sessionId: string,
): Promise<string> {
  return executeWorkflowStep("oa", sessionId, async (step) => {
    switch (step.action) {
      case "parse": return await oaParse(officeAction, pluginContext)
      case "analyze": return await oaAnalyze(officeAction, claims, pluginContext)
      case "simulate": return await oaSimulate(officeAction, claims, pluginContext)
      case "respond": return await oaRespond(officeAction, claims, pluginContext)
      case "validate": return await oaValidate(officeAction, claims, pluginContext)
      default: return `未知步骤: ${step.action}`
    }
  })
}
