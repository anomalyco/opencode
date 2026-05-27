/**
 * Invalidation Tools
 *
 * 封装 YunPat 专利无效宣告能力为 OpenCode Plugin Tools
 * - 解析目标专利 → 无效理由分析 → 撰写无效宣告请求书 / 答辩意见
 */

import { tool } from "@yunpat/plugin/tool"
import type { PatentPluginContext } from "../types.js"
import { safeAsk } from "../types.js"
import { searchLegalRules, searchPatentJudgments, searchPatents } from "../utils/db.js"
import { queryInvalidationFromKB } from "../utils/obsidian-kb.js"
import { extractPatentKeywords } from "../utils/patent-keywords.js"
import { invalidationAttackTemplate, invalidationDefendTemplate } from "../templates/invalidation.js"
import { executeWorkflowStep } from "../services/workflow-orchestrator.js"

/**
 * 注册无效宣告工具集
 */
export async function registerInvalidationTools(pluginContext: PatentPluginContext) {
  return {
    /**
     * 专利无效宣告（攻方/守方双向）
     */
    invalidation_response: tool({
      description: `
        专利无效宣告分析与撰写。支持攻方（提出无效）和守方（答辩无效）两种角色。

        支持的动作：
        - parse: 解析目标专利的权利要求
        - analyze: 分析无效理由和可行性
        - attack: 撰写无效宣告请求书（攻方）
        - defend: 撰写无效答辩意见（守方）
        - evidence: 检索现有技术证据
        - workflow: 多步骤编排模式（自动推进 4 步流程）
      `,
      args: {
        action: tool.schema.enum(["parse", "analyze", "attack", "defend", "evidence", "workflow"]).describe("无效动作"),
        target_patent: tool.schema.string().describe("目标专利的权利要求书或专利号"),
        role: tool.schema.enum(["attacker", "defender"]).optional().describe("角色：attacker（无效请求人）或 defender（专利权人）"),
        evidence: tool.schema.string().optional().describe("证据材料（对比文件、公知常识等）"),
        context: tool.schema.string().optional().describe("额外上下文"),
      },
      async execute(args, ctx) {
        await safeAsk(ctx, {
          permission: "invalidation",
          patterns: [args.action, args.role || "attacker"],
          always: [],
          metadata: { action: args.action, role: args.role },
        })

        const {
          action,
          target_patent,
          role = "attacker",
          evidence = "",
          context: extraContext = "",
        } = args

        switch (action) {
          case "workflow": return await invalidationWorkflow(target_patent, role, evidence, extraContext, pluginContext, ctx.sessionID)
          case "parse": return await invalidationParse(target_patent, pluginContext)
          case "analyze": return await invalidationAnalyze(target_patent, role, evidence, pluginContext)
          case "attack": return await invalidationAttack(target_patent, evidence, extraContext, pluginContext)
          case "defend": return await invalidationDefend(target_patent, evidence, extraContext, pluginContext)
          case "evidence": return await invalidationEvidence(target_patent, pluginContext)
          default: return `未知的无效动作: ${action}`
        }
      },
    }),
  }
}

/**
 * 解析目标专利权利要求
 */
async function invalidationParse(targetPatent: string, pluginContext: PatentPluginContext) {
  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是专利分析专家。精确解析权利要求结构，识别保护范围边界。" },
      {
        role: "user",
        content: `请解析以下专利权利要求，提取结构化信息：

${targetPatent}

请提取：
1. 独立权利要求数量和各自保护范围
2. 每个独立权利要求的前序部分和特征部分
3. 必要技术特征清单
4. 可选技术特征清单
5. 从属权利要求的分层结构
6. 权利要求的保护范围宽窄评估
7. 潜在的无效攻击点（如范围过宽、特征模糊等）`,
      },
    ],
  })

  return `## 无效步骤 1/4：权利要求解析 ✅\n\n${response.content}\n\n---\n\n*请确认解析结果。确认后将继续步骤 2：无效理由分析。*`
}

/**
 * 分析无效理由和可行性
 */
async function invalidationAnalyze(
  targetPatent: string,
  role: string,
  evidence: string,
  pluginContext: PatentPluginContext,
) {
  // 检索相关法规和先例（并行查询）
  let referenceData = ""
  try {
    const keywords = extractInvalidationKeywords(targetPatent)
    if (keywords.length > 0) {
      const [rules, judgments, kbResult] = await Promise.all([
        searchLegalRules(keywords[0], { limit: 5 }).catch(() => []),
        searchPatentJudgments(keywords.join(" "), { limit: 5 }).catch(() => []),
        queryInvalidationFromKB(keywords[0]).catch(() => null),
      ])

      if (rules.length > 0) {
        referenceData += `### 相关法规\n\n`
        rules.forEach((r, i) => {
          referenceData += `${i + 1}. **${r.article_number}** ${r.title}\n`
          referenceData += `   ${r.content?.slice(0, 300) || ""}\n\n`
        })
      }

      if (judgments.length > 0) {
        referenceData += `### 相关判决\n\n`
        judgments.forEach((j, i) => {
          referenceData += `${i + 1}. **${j.case_number}** ${j.case_title}\n`
          referenceData += `   - ${j.court} | ${j.judgment_date}\n`
          if (j.case_summary) referenceData += `   - ${j.case_summary.slice(0, 200)}...\n`
          referenceData += `\n`
        })
      }

      if (kbResult && !kbResult.includes("未在复审无效决定中找到")) {
        referenceData += `### 复审无效先例\n\n${kbResult.slice(0, 1500)}\n\n`
      }
    }
  } catch (error: any) {
    console.warn("[Invalidation] Reference search error:", error?.message)
    referenceData += `\n> ⚠️ 法规检索失败（${error?.message}），以下分析基于 LLM 推理，建议人工核实。\n`
  }

  const roleLabel = role === "attacker" ? "无效请求人（攻方）" : "专利权人（守方）"

  const prompt = `请以${roleLabel}视角，分析以下专利的无效理由：

**目标专利权利要求**：
${targetPatent}

${evidence ? `**已有证据**：\n${evidence}\n\n` : ""}
${referenceData ? `**参考资料**：\n${referenceData}\n\n` : ""}

请分析以下无效理由（A45 实施细则第 65 条）的适用性：

| 无效理由 | 法条 | 适用性 | 证据要求 | 成功率 |
|---------|------|--------|---------|--------|
| 新颖性不足 | A22.2 | 高/中/低/不适用 | 单独对比的现有技术 | ? |
| 创造性不足 | A22.3 | 高/中/低/不适用 | 最接近现有技术+技术启示 | ? |
| 公开不充分 | A26.3 | 高/中/低/不适用 | 技术事实分析 | ? |
| 权利要求不支持 | A26.4 | 高/中/低/不适用 | 说明书与权利要求对比 | ? |
| 修改超范围 | A33 | 高/中/低/不适用 | 申请文件对比 | ? |
| 不符合单一性 | A31 | 高/中/低/不适用 | 特定技术特征分析 | ? |
| 其他理由 | — | — | — | — |

请给出：
1. 最优攻击/防御策略（优先选择成功率最高的理由组合）
2. 证据缺口（还需补充的证据材料）
3. 风险评估`

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: `你是专利无效专家。以${roleLabel}视角进行专业分析。参考相关法规和先例。` },
      { role: "user", content: prompt },
    ],
  })

  return `## 无效步骤 2/4：无效理由分析 ✅\n\n${response.content}\n\n---\n\n*请确认分析结论和策略方向。*`
}

/**
 * 撰写无效宣告请求书（攻方）
 */
async function invalidationAttack(
  targetPatent: string,
  evidence: string,
  extraContext: string,
  pluginContext: PatentPluginContext,
) {
  const templateRef = invalidationAttackTemplate()

  const prompt = `请撰写专利无效宣告请求书：

**目标专利权利要求**：
${targetPatent}

${evidence ? `**证据材料**：\n${evidence}\n\n` : ""}
${extraContext ? `**额外上下文**：\n${extraContext}\n\n` : ""}

**无效宣告请求书模板参考**（严格遵循此结构）：
${templateRef}

请按模板结构撰写，要求：
- 论证严密，证据链完整
- 引用准确的法条和审查指南
- 对比分析使用表格形式
- 使用规范的法律文书用语`

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是专利无效宣告请求书撰写专家。按提供的模板结构撰写，严格遵循审查指南第四部分第五章要求。" },
      { role: "user", content: prompt },
    ],
    maxTokens: 8192,
  })

  return `## 无效步骤 3/4：无效宣告请求书 ✅\n\n${response.content}\n\n---\n\n⚠️ 以上为草案，需经专业审校后提交。`
}

/**
 * 撰写无效答辩意见（守方）
 */
async function invalidationDefend(
  targetPatent: string,
  evidence: string,
  extraContext: string,
  pluginContext: PatentPluginContext,
) {
  const templateRef = invalidationDefendTemplate()

  const prompt = `请撰写专利无效答辩意见：

**目标专利权利要求**：
${targetPatent}

${evidence ? `**无效请求人的理由和证据**：\n${evidence}\n\n` : ""}
${extraContext ? `**额外上下文**：\n${extraContext}\n\n` : ""}

**无效答辩意见模板参考**（严格遵循此结构）：
${templateRef}

请按模板结构撰写，要求：
- 逐一回应对方论点
- 论证有力、逻辑清晰
- 必要时提出权利要求修改方案
- 修改不超范围（A33）`

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是专利无效答辩专家。按提供的模板结构撰写，维护专利权人的合法权益，逐一反驳无效理由。" },
      { role: "user", content: prompt },
    ],
    maxTokens: 8192,
  })

  return `## 无效答辩意见 ✅\n\n${response.content}\n\n---\n\n⚠️ 以上为草案，需经专业审校后提交。`
}

/**
 * 检索现有技术证据
 */
async function invalidationEvidence(targetPatent: string, pluginContext: PatentPluginContext) {
  // 用 LLM 从权利要求中提取检索关键词
  const kwResponse = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是专利检索专家。从权利要求中提取用于无效检索的关键词。只返回 JSON。" },
      {
        role: "user",
        content: `从以下权利要求中提取用于检索现有技术证据的关键词：\n\n${targetPatent.slice(0, 2000)}\n\n返回 JSON：{"keywords_cn": ["关键词1", ...], "keywords_en": ["keyword1", ...], "ipc_class": "IPC分类号"}`,
      },
    ],
    temperature: 0.2,
  })

  let keywords: string[] = []
  let ipcClass = ""
  try {
    const jsonMatch = kwResponse.content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      keywords = [...(parsed.keywords_cn || []), ...(parsed.keywords_en || [])]
      ipcClass = parsed.ipc_class || ""
    }
  } catch (error: unknown) {
    console.warn("[Invalidation] JSON keyword parse failed:", error instanceof Error ? error.message : String(error))
    keywords = targetPatent.slice(0, 100).split(/[,，、\s]+/).filter(w => w.length >= 2).slice(0, 5)
    if (keywords.length === 0) keywords = ["技术", "发明"]
  }

  // 在专利数据库中检索
  let patents: any[] = []
  try {
    if (keywords.length > 0) {
      patents = await searchPatents(keywords[0], {
        limit: 15,
        ...(ipcClass ? { ipcClass } : {}),
      })
    }
  } catch (error: any) {
    console.warn("[Invalidation] Evidence search error:", error?.message)
  }

  let output = `## 现有技术证据检索\n\n`
  output += `**检索关键词**：${keywords.join("、")}\n`
  if (ipcClass) output += `**IPC 分类**：${ipcClass}\n`
  output += `\n`

  if (patents.length > 0) {
    output += `### 检索结果（${patents.length} 篇）\n\n`
    output += `| # | 专利名称 | 申请号 | 申请日 | 相关度 | 用途 |\n`
    output += `|---|---------|--------|--------|--------|------|\n`
    // 尝试从目标专利中提取优先权日/申请日作为截止日期
    const targetDateMatch = targetPatent.match(/(\d{4}[-/]\d{2}[-/]\d{2})/)

    patents.forEach((p, i) => {
      const name = p.patent_name?.slice(0, 25) || "—"
      const date = p.application_date || "—"
      const appNum = p.application_number || "—"
      const relevance = (p.relevance || 0).toFixed(2)
      // 判断用途：申请日在目标专利之前可作为现有技术
      let usage = "待确认"
      if (targetDateMatch && p.application_date) {
        usage = p.application_date <= targetDateMatch[1] ? "现有技术 ✅" : "申请日后 ⚠️"
      }
      output += `| ${i + 1} | ${name} | ${appNum} | ${date} | ${relevance} | ${usage} |\n`
    })
    output += `\n### 高相关专利详情\n\n`
    for (const p of patents.slice(0, 3)) {
      output += `**${p.patent_name}**（${p.application_number}）\n\n`
      output += `${p.abstract?.slice(0, 400) || "无摘要"}\n\n---\n\n`
    }
  } else {
    output += `> 专利数据库未返回结果。建议在以下渠道手动检索：\n`
    output += `- CNIPA 专利查询系统\n- Google Patents\n- Espacenet\n- 佰腾网\n\n`
    output += `**建议检索式**：${keywords.join(" AND ")}\n`
  }

  return output
}

/**
 * 提取无效相关关键词（使用共享工具）
 */
function extractInvalidationKeywords(text: string): string[] {
  return extractPatentKeywords(text)
}

/**
 * 无效宣告工作流编排
 */
async function invalidationWorkflow(
  targetPatent: string,
  role: string,
  evidence: string,
  extraContext: string,
  pluginContext: PatentPluginContext,
  sessionId: string,
): Promise<string> {
  return executeWorkflowStep("invalidation", sessionId, async (step) => {
    switch (step.action) {
      case "parse": return await invalidationParse(targetPatent, pluginContext)
      case "analyze": return await invalidationAnalyze(targetPatent, role, evidence, pluginContext)
      case "attack": return await invalidationAttack(targetPatent, evidence, extraContext, pluginContext)
      case "defend": return await invalidationDefend(targetPatent, evidence, extraContext, pluginContext)
      case "evidence": return await invalidationEvidence(targetPatent, pluginContext)
      default: return `未知步骤: ${step.action}`
    }
  })
}
