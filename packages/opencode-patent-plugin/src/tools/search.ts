/**
 * Patent Search Tools
 *
 * 封装 YunPat 专利检索能力为 OpenCode Plugin Tools
 * 接入真实数据源：patent_db (7500万+ 中国专利)
 */

import { tool } from "@yunpat/plugin/tool"
import type { PatentPluginContext } from "../types.js"
import { loadYunPatModule } from "../utils/yunpat-loader.js"
import { createSharedAgentContext } from "../utils/agent-factory.js"
import { searchPatents, type PatentRecord } from "../utils/db.js"
import { searchGooglePatents, searchSemanticScholar } from "../utils/patent-search-ext.js"

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
            const context = await createSharedAgentContext()
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

        数据源：
        - patent_db 的 IPC 分类字段
        - LLM 降级补充
      `,
      args: {
        query: tool.schema.string().describe("技术主题或分类号"),
        type: tool.schema.enum(["ipc", "cpc"]).default("ipc").describe("分类体系"),
      },
      async execute(args, ctx) {
        const { query, type = "ipc" } = args

        ctx.metadata({
          title: `分类查询: ${query}`,
          metadata: { type },
        })

        // 尝试从 patent_db 获取匹配的 IPC 分类
        try {
          const isClassificationCode = /^[A-H]\d{2}[A-Z]/i.test(query)
          if (isClassificationCode) {
            const results = await searchPatents(query, {
              limit: 5,
              fields: ["title", "abstract"],
            })
            if (results.length > 0) {
              const ipcSet = new Set<string>()
              results.forEach(r => {
                if (r.ipc_main_class) ipcSet.add(r.ipc_main_class)
              })
              return `## ${type.toUpperCase()} 分类号 ${query}\n\n**关联专利数**：${results.length}\n**相关 IPC 分类**：${[...ipcSet].join(", ")}\n\n### 代表性专利\n\n${results.slice(0, 3).map((r, i) => `${i + 1}. **${r.patent_name}** (${r.application_number})\n   IPC: ${r.ipc_main_class}\n   ${r.abstract?.slice(0, 200) || ""}`).join("\n\n")}`
            }
          } else {
            const results = await searchPatents(query, { limit: 20 })
            if (results.length > 0) {
              const ipcCount = new Map<string, number>()
              results.forEach(r => {
                if (r.ipc_main_class) {
                  ipcCount.set(r.ipc_main_class, (ipcCount.get(r.ipc_main_class) || 0) + 1)
                }
              })
              const sortedIPC = [...ipcCount.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)

              if (sortedIPC.length > 0) {
                let output = `## ${type.toUpperCase()} 分类查询\n\n**查询主题**：${query}\n**分析专利数**：${results.length}\n\n`
                output += `### 推荐 IPC 分类号\n\n`
                output += `| IPC 分类号 | 出现次数 | 说明 |\n`
                output += `|-----------|---------|------|\n`
                for (const [ipc, count] of sortedIPC) {
                  const section = ipc.charAt(0)
                  const sectionNames: Record<string, string> = {
                    A: "人类生活必需", B: "作业/运输", C: "化学/冶金",
                    D: "纺织/造纸", E: "固定建筑物", F: "机械工程",
                    G: "物理", H: "电学",
                  }
                  output += `| ${ipc} | ${count} | ${sectionNames[section] || ""} |\n`
                }
                return output
              }
            }
          }
        } catch (error: any) {
          console.warn("[Classify] Patent DB query error:", error?.message)
        }

        // LLM 降级
        const response = await pluginContext.llm.chat({
          messages: [
            { role: "system", content: "你是 IPC/CPC 专利分类专家。根据技术主题推荐分类号，或解释分类号的含义。" },
            { role: "user", content: `请为以下查询提供 ${type.toUpperCase()} 分类建议：\n\n${query}\n\n请列出最相关的 3-5 个分类号及其含义。` },
          ],
          temperature: 0.1,
        })

        return `## ${type.toUpperCase()} 分类查询\n\n**查询**：${query}\n\n${response.content}`
      },
    }),

    /**
     * Google Patents 全球专利检索
     */
    patent_search_google: tool({
      description: `
        Google Patents 在线专利检索。检索全球专利文献。

        适用场景：
        - 需要检索非中国专利（美国、欧洲、日本、PCT 等）
        - 需要英文专利文献
        - 跨国专利族检索

        注：CNIPA 中国专利请使用 patent_search 工具。
      `,
      args: {
        query: tool.schema.string().describe("检索查询（英文关键词或专利号）"),
        max_results: tool.schema.number().default(10).describe("最大结果数"),
      },
      async execute(args, ctx) {
        const { query, max_results = 10 } = args

        ctx.metadata({
          title: `Google Patents 检索: ${query}`,
          metadata: { source: "google_patents", maxResults: max_results },
        })

        const results = await searchGooglePatents(query, max_results)

        if (results.length > 0) {
          return formatGoogleResults(results, query)
        }

        // API 不可用时降级
        const response = await pluginContext.llm.chat({
          messages: [
            { role: "system", content: "你是专利检索专家。提供 Google Patents 检索建议。" },
            {
              role: "user",
              content: `请为以下主题提供 Google Patents 检索策略和可能的专利方向：\n\n${query}`,
            },
          ],
        })
        return `## Google Patents 检索\n\n**查询**：${query}\n\n> ⚠️ Google Patents API 暂时不可用，以下为 LLM 生成的检索建议。\n\n${response.content}\n\n🔗 [直接搜索 Google Patents](https://patents.google.com/?q=${encodeURIComponent(query)})`
      },
    }),

    /**
     * 学术论文检索
     */
    academic_search: tool({
      description: `
        学术论文检索（Semantic Scholar）。检索科技论文、会议论文、预印本。

        适用场景：
        - 现有技术检索需涵盖学术文献
        - 技术背景研究
        - 寻找技术领域前沿论文

        数据源：Semantic Scholar（2亿+学术论文）
      `,
      args: {
        query: tool.schema.string().describe("检索查询（中英文关键词）"),
        max_results: tool.schema.number().default(10).describe("最大结果数"),
        year_from: tool.schema.number().optional().describe("起始年份"),
        year_to: tool.schema.number().optional().describe("截止年份"),
      },
      async execute(args, ctx) {
        const { query, max_results = 10, year_from, year_to } = args

        ctx.metadata({
          title: `学术论文检索: ${query}`,
          metadata: { source: "semantic_scholar", maxResults: max_results },
        })

        const results = await searchSemanticScholar(query, {
          limit: max_results,
          yearFrom: year_from,
          yearTo: year_to,
        })

        if (results.length > 0) {
          return formatAcademicResults(results, query)
        }

        // API 不可用时降级
        const response = await pluginContext.llm.chat({
          messages: [
            { role: "system", content: "你是学术研究专家。基于知识推荐相关论文方向。" },
            {
              role: "user",
              content: `请为以下主题推荐学术论文方向和关键文献：\n\n${query}`,
            },
          ],
        })
        return `## 学术论文检索\n\n**查询**：${query}\n\n> ⚠️ Semantic Scholar API 暂时不可用，以下为 LLM 生成的检索建议。\n\n${response.content}\n\n🔗 [直接搜索 Semantic Scholar](https://www.semanticscholar.org/search?q=${encodeURIComponent(query)})`
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

function formatGoogleResults(results: any[], query: string): string {
  let output = `## Google Patents 检索结果\n\n**查询**：${query}\n**命中**：${results.length} 条\n\n`

  results.forEach((r, i) => {
    output += `### ${i + 1}. ${r.title || "未知"}\n`
    output += `- **专利号**：${r.patentId || "N/A"}\n`
    output += `- **申请人**：${r.assignee || "N/A"}\n`
    output += `- **公开日**：${r.publicationDate || "N/A"}\n`
    if (r.abstract) {
      output += `- **摘要**：${r.abstract.slice(0, 300)}${r.abstract.length > 300 ? "..." : ""}\n`
    }
    if (r.url) output += `- **链接**：${r.url}\n`
    output += `\n`
  })

  return output
}

function formatAcademicResults(results: any[], query: string): string {
  let output = `## 学术论文检索结果（Semantic Scholar）\n\n**查询**：${query}\n**命中**：${results.length} 条\n\n`

  results.forEach((r, i) => {
    output += `### ${i + 1}. ${r.title || "未知"}\n`
    output += `- **作者**：${r.authors?.join(", ") || "N/A"}\n`
    output += `- **年份**：${r.year || "N/A"}\n`
    output += `- **引用数**：${r.citationCount ?? "N/A"}\n`
    if (r.abstract) {
      output += `- **摘要**：${r.abstract.slice(0, 300)}${r.abstract.length > 300 ? "..." : ""}\n`
    }
    if (r.url) output += `- **链接**：${r.url}\n`
    output += `\n`
  })

  return output
}
