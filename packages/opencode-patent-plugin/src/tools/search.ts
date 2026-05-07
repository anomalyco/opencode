/**
 * Patent Search Tools
 *
 * 封装 YunPat 专利检索能力为 OpenCode Plugin Tools
 */

import { tool } from "@opencode-ai/plugin/tool"
import type { PatentPluginContext } from "../types.js"

/**
 * 注册专利检索工具集
 */
export async function registerSearchTools(context: PatentPluginContext) {
  return {
    /**
     * 专利文献检索
     */
    patent_search: tool({
      description: `
        专利文献检索。检索对比文件、现有技术、相关专利。

        支持的数据库：
        - CNIPA（中国专利，7500万+）
        - Google Patents
        - WIPO

        检索方式：
        - 关键词检索
        - IPC/CPC 分类检索
        - 语义检索（向量相似度）
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
        const { query, database = "all", search_type = "keyword", max_results = 10 } = args

        // 检索操作无需审批（公开数据库）
        ctx.metadata({
          title: `专利检索: ${query}`,
          metadata: { database, searchType: search_type, maxResults: max_results },
        })

        // TODO: 接入 YunPat PatentSearchAgent（@yunpat/agent-search V3）和专利数据库
        return `## 专利检索结果\n\n**查询**：${query}\n**数据库**：${database}\n**检索类型**：${search_type}\n\n> 注：真实检索功能需要接入 YunPat 专利数据库（7500万 CN 专利 + Google Patents API）。\n\n当前为模拟结果，请配置数据库连接后使用。`
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
