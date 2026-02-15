import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./law_search.txt"
import { Config } from "../config/config"

export const LawSearchTool = Tool.define("law_search", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z.string().describe("检索关键词或法律问题"),
    searchType: z.enum(["law", "case", "all"]).describe("检索类型：law=法规, case=案例, all=全部").optional(),
    limit: z.coerce.number().describe("返回结果数量限制（默认10条）").optional(),
  }),
  async execute(params, ctx) {
    const query = params.query
    const searchType = params.searchType ?? "all"
    const limit = params.limit ?? 10

    await ctx.ask({
      permission: "read",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        query,
        searchType,
      },
    })

    // 获取MCP配置的法律检索服务
    const config = await Config.get()
    const mcpConfig = config.mcp ?? {}

    // 检查是否有配置法律检索MCP服务
    const lawMcp = mcpConfig["law-regulation"] ?? mcpConfig["law"] ?? null

    // 模拟检索结果（实际应调用MCP服务）
    // 这里提供一个基础实现，当配置了MCP服务后会替换
    const results: Array<{
      type: string
      title: string
      source: string
      content: string
      relevance: number
    }> = []

    // 如果没有配置MCP服务，返回提示信息
    if (!lawMcp) {
      const output = [
        `<法律检索结果>`,
        `<查询>${query}</查询>`,
        `<检索类型>${searchType}</检索类型>`,
        `<状态>提示</状态>`,
        `<消息>`,
        `未配置法律检索MCP服务。`,
        ``,
        `要启用法律检索功能，请在 opencode.json 中配置 MCP 服务：`,
        ``,
        `\`\`\`json`,
        `{`,
        `  "mcp": {`,
        `    "law-regulation": {`,
        `      "type": "remote",`,
        `      "url": "https://your-law-server.com/mcp",`,
        `      "enabled": true`,
        `    }`,
        `  }`,
        `}`,
        `\`\`\``,
        ``,
        `支持的MCP服务类型：`,
        `- 法规库服务（提供法律法规检索）`,
        `- 案例库服务（提供类案参考）`,
        `- 司法解释库服务（提供司法解释检索）`,
        `</消息>`,
        `</法律检索结果>`,
      ].join("\n")

      return {
        title: `法律检索: ${query}`,
        output,
        metadata: {
          query,
          searchType,
          limit,
          results: [],
          configured: false,
        },
      }
    }

    // 实际检索逻辑（当MCP服务可用时）
    // TODO: 实现MCP调用
    const output = [
      `<法律检索结果>`,
      `<查询>${query}</查询>`,
      `<检索类型>${searchType}</检索类型>`,
      `<结果数量>${results.length}</结果数量>`,
      results.length > 0
        ? results
            .map(
              (r, i) => `
<结果 序号="${i + 1}">
  <类型>${r.type}</类型>
  <标题>${r.title}</标题>
  <来源>${r.source}</来源>
  <相关度>${r.relevance}</相关度>
  <内容>${r.content}</内容>
</结果>`,
            )
            .join("\n")
        : "<提示>未找到相关结果</提示>",
      `</法律检索结果>`,
    ].join("\n")

    return {
      title: `法律检索: ${query}`,
      output,
      metadata: {
        query,
        searchType,
        limit,
        results,
        configured: true,
      },
    }
  },
})
