/**
 * 商标法规研究工具
 *
 * 查询 Obsidian 知识库中的商标法规、司法解释、实务指南。
 */

import { tool } from "@yunpat/plugin/tool"
import type { PatentPluginContext } from "../types.js"
import { safeAsk } from "../types.js"
import { queryTrademarkLaw, queryTrademarkExamGuide, queryTrademarkPractice } from "../utils/obsidian-kb.js"

export async function registerTrademarkResearchTools(pluginContext: PatentPluginContext) {
  return {
    trademark_research: tool({
      description: `
        商标法规研究与查询。检索商标法、实施条例、司法解释、审查指南、实务指南。

        支持的动作：
        - understand: 概述商标法框架和核心条款
        - search: 搜索商标相关法规条文
        - analyze: 深度分析特定商标法律问题
      `,
      args: {
        action: tool.schema.enum(["understand", "search", "analyze"]).describe("研究动作"),
        topic: tool.schema.string().describe("研究主题，如'商标显著性判断标准'"),
        scope: tool.schema.enum(["法规", "案例", "实务", "全部"]).optional().describe("检索范围"),
        depth: tool.schema.enum(["概述", "详细", "深度"]).optional().describe("分析深度"),
      },
      async execute(args, ctx) {
        await safeAsk(ctx, {
          permission: "trademark",
          patterns: [args.action],
          always: [],
          metadata: { action: args.action },
        })

        const { action, topic, scope = "全部", depth = "概述" } = args

        switch (action) {
          case "understand": return await trademarkResearchUnderstand(topic, pluginContext)
          case "search": return await trademarkResearchSearch(topic, scope, pluginContext)
          case "analyze": return await trademarkResearchAnalyze(topic, depth, pluginContext)
          default: return `未知的研究动作: ${action}`
        }
      },
    }),
  }
}

async function trademarkResearchUnderstand(topic: string, pluginContext: PatentPluginContext) {
  // 查询知识库获取法规概要
  let kbData = ""
  try {
    const [lawResult, practiceResult] = await Promise.all([
      queryTrademarkLaw(topic).catch(() => ""),
      queryTrademarkPractice(topic).catch(() => ""),
    ])
    if (lawResult && !lawResult.includes("未在商标知识库中找到")) {
      kbData += lawResult
    }
    if (practiceResult && !practiceResult.includes("未在商标实务指南中找到")) {
      kbData += "\n\n" + practiceResult
    }
  } catch (error: any) {
    console.warn("[TM Research] KB query error:", error?.message)
  }

  const prompt = `请概述以下商标法律主题的核心要点：

**主题**：${topic}

${kbData ? `**知识库参考资料**：\n${kbData}\n\n` : ""}
请涵盖：
1. 法律框架（相关法条）
2. 核心原则和标准
3. 实务要点
4. 常见争议焦点`

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: "你是商标法律专家，熟悉中国商标法、实施条例、司法解释和审查指南。" },
      { role: "user", content: prompt },
    ],
  })
  return `## 商标法律研究：${topic}\n\n${response.content}`
}

async function trademarkResearchSearch(topic: string, scope: string, pluginContext: PatentPluginContext) {
  let output = `## 商标法规检索：${topic}\n\n`
  let hasData = false

  try {
    const [lawResult, examResult, practiceResult] = await Promise.all([
      (scope === "法规" || scope === "全部") ? queryTrademarkLaw(topic).catch(() => "") : "",
      (scope === "案例" || scope === "全部") ? queryTrademarkExamGuide(topic).catch(() => "") : "",
      (scope === "实务" || scope === "全部") ? queryTrademarkPractice(topic).catch(() => "") : "",
    ])

    if (lawResult && !lawResult.includes("未在商标知识库中找到")) {
      output += lawResult + "\n"
      hasData = true
    }
    if (examResult && !examResult.includes("未在商标审查指南中找到")) {
      output += examResult + "\n"
      hasData = true
    }
    if (practiceResult && !practiceResult.includes("未在商标实务指南中找到")) {
      output += practiceResult + "\n"
      hasData = true
    }
  } catch (error: any) {
    console.warn("[TM Research] Search error:", error?.message)
    output += `\n> ⚠️ 知识库查询失败（${error?.message}）。\n`
  }

  if (!hasData) {
    const response = await pluginContext.llm.chat({
      messages: [
        { role: "system", content: "你是商标法律专家。" },
        { role: "user", content: `请简要说明商标法中关于"${topic}"的相关规定。` },
      ],
    })
    output += response.content
  }

  return output
}

async function trademarkResearchAnalyze(topic: string, depth: string, pluginContext: PatentPluginContext) {
  let kbData = ""
  try {
    const [lawResult, practiceResult] = await Promise.all([
      queryTrademarkLaw(topic).catch(() => ""),
      queryTrademarkPractice(topic).catch(() => ""),
    ])
    if (lawResult && !lawResult.includes("未在商标知识库中找到")) kbData += lawResult
    if (practiceResult && !practiceResult.includes("未在商标实务指南中找到")) kbData += "\n\n" + practiceResult
  } catch (error: any) {
    console.warn("[TM Research] KB error:", error?.message)
  }

  const prompt = `请对以下商标法律问题进行${depth === "深度" ? "深度" : depth === "详细" ? "详细" : "概述性"}分析：

**主题**：${topic}

${kbData ? `**参考资料**：\n${kbData}\n\n` : ""}
请分析：
1. 法律依据（具体法条和司法解释）
2. 适用标准和判断方法
3. 实务中的争议焦点和常见问题
4. 相关案例或审查实例
${depth === "深度" ? "5. 理论争议和学术观点\n6. 比较法视角（如适用）" : ""}`

  const response = await pluginContext.llm.chat({
    messages: [
      { role: "system", content: `你是商标法律分析专家。基于中国商标法、实施条例、司法解释和商标审查审理指南进行专业分析。${depth === "深度" ? "请提供全面深入的分析。" : ""}` },
      { role: "user", content: prompt },
    ],
  })
  return `## 商标法律深度分析：${topic}\n\n${response.content}`
}
