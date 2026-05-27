/**
 * 商标检索工具
 *
 * 检索商标审查审理指南中的审查实例，辅助近似判断。
 */

import { tool } from "@yunpat/plugin/tool"
import type { PatentPluginContext } from "../types.js"
import { safeAsk } from "../types.js"
import { queryTrademarkExamGuide } from "../utils/obsidian-kb.js"

export async function registerTrademarkSearchTools(pluginContext: PatentPluginContext) {
  return {
    trademark_search: tool({
      description: `
        商标检索。查询商标审查审理指南中的审查实例，支持近似商标、显著性等检索。

        支持的检索类型：
        - 文字: 按商标名称关键词检索
        - 类别: 按商品/服务类别检索
        - 语义: 语义相似度检索审查实例
      `,
      args: {
        query: tool.schema.string().describe("检索关键词或商标名称"),
        search_type: tool.schema.enum(["文字", "类别", "语义"]).optional().describe("检索类型"),
        max_results: tool.schema.number().optional().describe("最大返回结果数"),
      },
      async execute(args, ctx) {
        await safeAsk(ctx, {
          permission: "trademark",
          patterns: ["search"],
          always: [],
          metadata: { action: "search", searchType: args.search_type },
        })

        const { query, search_type = "文字", max_results = 10 } = args
        return await trademarkSearch(query, search_type, max_results, pluginContext)
      },
    }),
  }
}

async function trademarkSearch(
  query: string,
  searchType: string,
  maxResults: number,
  pluginContext: PatentPluginContext,
) {
  let output = `## 商标检索：${query}\n\n`
  output += `**检索类型**：${searchType}\n\n`

  // 查询知识库中的审查实例
  let hasData = false
  try {
    const examResult = await queryTrademarkExamGuide(query)
    if (examResult && !examResult.includes("未在商标审查指南中找到")) {
      output += examResult + "\n"
      hasData = true
    }
  } catch (error: any) {
    console.warn("[TM Search] Exam guide query error:", error?.message)
  }

  if (!hasData) {
    // LLM 辅助：基于知识生成检索建议
    const response = await pluginContext.llm.chat({
      messages: [
        { role: "system", content: "你是商标检索专家。基于商标审查审理指南提供检索建议。" },
        {
          role: "user",
          content: `请为以下商标提供近似检索分析：

**商标名称**：${query}
**检索类型**：${searchType}

请提供：
1. 可能的近似商标类型（音近/形近/义近）
2. 建议检索的商品/服务类别
3. 需要特别关注的类似群组
4. 常见的驳回/异议风险点`,
        },
      ],
    })
    output += response.content
    output += `\n\n> ⚠️ 以上为基于 LLM 的分析建议。建议在 CTMO 商标查询系统（tmsearch.cnipa.gov.cn）中进行实际检索确认。`
  }

  return output
}
