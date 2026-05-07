/**
 * Patent Search Tools
 *
 * 封装 YunPat 专利检索能力为 OpenCode Plugin Tools
 * 接入真实数据源：patent_db (7500万+ 中国专利)
 */

import { tool } from "@opencode-ai/plugin/tool"
import type { PatentPluginContext } from "../types.js"
import { loadYunPatModule, createAgentContext } from "../utils/yunpat-loader.js"
import { searchPatents, type PatentRecord } from "../utils/db.js"

/**
 * 注册专利检索工具集
 */
export async function registerSearchTools(pluginContext: PatentPluginContext) {
  return {
    /**
     * 专利文献检索
     */
    patent_search: tool({
      description: `
        专利文献检索。检索对比文件、现有技术、相关专利。

        支持的数据库：
        - CNIPA（中国专利，7500万+）
        - 通过 PostgreSQL 全文搜索 + 向量搜索

        检索方式：
        - 关键词检索（中文分词）
        - IPC/CPC 分类检索
        - 申请人/发明人检索
      `,
      args: {
        query: tool.schema.string().describe("检索查询，可以是关键词、专利号、申请人等"),
        database: tool.schema.enum(["cnipa", "google", "wipo", "all"]).default("all").describe("检索数据库"),
        search_type: tool.schema.enum(["keyword", "semantic", "ipc", "applicant"]).default("keyword").describe("检索类型"),
        max_results: tool.schema.number().default(10).describe("最大结果数"),
        filters: tool.schema.string().optional().describe("过滤条件（JSON 格式）"),
      },
      async execute(args, ctx) {
        const { query, database = "all", search_type = "keyword", max_results = 10, filters } = args

        ctx.metadata({
          title: `专利检索: ${query}`,
          metadata: { database, searchType: search_type, maxResults: max_results },
        })

        // 优先使用真实专利数据库 (patent_db)
        try {
          const filterObj = filters ? JSON.parse(filters) : {}
          const results = await searchPatents(query, {
            limit: max_results,
            ...filterObj,
          })

          if (results.length > 0) {
            return formatRealSearchResults(results, query)
          }
        } catch (error: any) {
          console.warn("[PatentDB] Search error:", error?.message)
        }

        // 尝试使用 YunPat PatentSearchAgent v3
        try {
          const yunpat = await loadYunPatModule("agents/search")
          if (yunpat?.PatentSearchAgent) {
            const context = await createAgentContext()
            if (context) {
              const agent = new yunpat.PatentSearchAgent({
                llm: pluginContext.llm,
                name: "patent-search",
                description: "专利检索智能体",
                eventBus: context.eventBus,
                memory: context.memory,
                tools: context.tools,
              })

              const result = await agent.run(
                {
                  title: query,
                  field: "general",
                  technicalProblem: query,
                  technicalSolution: query,
                  keyFeatures: [query],
                },
                context,
              )

              if (result.success && result.data) {
                return formatSearchResult(result.data, query, database)
              }
            }
          }
        } catch (error: any) {
          console.warn("[YunPat] PatentSearchAgent error:", error?.message)
        }

        // 降级：LLM 模拟检索
        const response = await pluginContext.llm.chat({
          messages: [
            { role: "system", content: "你是专利检索专家。请模拟一次专利检索，返回结构化的检索结果。" },
            { role: "user", content: `请检索以下主题的现有技术：${query}\n\n数据库：${database}\n检索类型：${search_type}\n最大结果数：${max_results}` },
          ],
        })

        return `## 专利检索结果（LLM 模拟）\n\n**查询**：${query}\n**数据库**：${database}\n\n${response.content}`
      },
    }),

    /**
     * IPC/CPC 分类查询
     */
    patent_classify: tool({
      description: `
        IPC/CPC 专利分类查询。根据技术主题查询对应的分类号，或根据分类号查询技术含义。
      `,
      args: {
        query: tool.schema.string().describe("技术主题或分类号"),
        type: tool.schema.enum(["ipc", "cpc"]).default("ipc").describe("分类体系"),
      },
      async execute(args, _ctx) {
        const { query, type = "ipc" } = args

        // TODO: 接入 YunPat 的 IPC 分类服务（Rust 实现）
        return `## ${type.toUpperCase()} 分类查询\n\n**查询**：${query}\n\n> 注：完整分类查询需要接入 YunPat patent-core（Rust CLI bridge）的 IPC 分类模块。`
      },
    }),
  }
}

function formatRealSearchResults(results: PatentRecord[], query: string): string {
  let output = `## 专利检索结果（真实数据库）\n\n**查询**：${query}\n**数据库**：patent_db（7500万+ 中国专利）\n**命中**：${results.length} 条\n\n`

  results.forEach((r, i) => {
    output += `### ${i + 1}. ${r.patent_name || "未知"}\n`
    output += `- **申请号**：${r.application_number || "N/A"}\n`
    output += `- **公开号**：${r.publication_number || "N/A"}\n`
    output += `- **申请人**：${r.applicant || "N/A"}\n`
    output += `- **发明人**：${r.inventor || "N/A"}\n`
    output += `- **IPC**：${r.ipc_main_class || "N/A"}\n`
    output += `- **申请日**：${r.application_date || "N/A"}\n`
    if (r.abstract) {
      output += `- **摘要**：${r.abstract.slice(0, 300)}${r.abstract.length > 300 ? "..." : ""}\n`
    }
    output += `\n`
  })

  return output
}

function formatSearchResult(data: any, query: string, database: string): string {
  let output = `## 专利检索结果\n\n**查询**：${query}\n**数据库**：${database}\n\n`

  if (data.strategy) {
    output += `### 检索策略\n- 关键词：${data.strategy.keywords?.join(", ") || "N/A"}\n`
    output += `- IPC 分类：${data.strategy.ipcCodes?.join(", ") || "N/A"}\n\n`
  }

  if (data.results?.length) {
    output += `### 检索结果（${data.totalFound || data.results.length} 条）\n\n`
    data.results.slice(0, 10).forEach((r: any, i: number) => {
      output += `${i + 1}. **${r.title || r.publicationNumber || "未知"}**`
      if (r.publicationNumber) output += ` (${r.publicationNumber})`
      output += `\n`
      if (r.abstract) output += `   ${r.abstract.slice(0, 200)}...\n`
      output += `\n`
    })
  } else {
    output += "未找到相关专利。\n"
  }

  if (data.dataSource) {
    output += `\n*数据源：${data.dataSource}*\n`
  }

  return output
}
