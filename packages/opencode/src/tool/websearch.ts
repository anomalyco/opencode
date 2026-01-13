/**
 * ============================================================================
 * 文件名：websearch.ts
 * 所属包：packages/opencode/src/tool
 * ============================================================================
 *
 * 文件作用：
 * WebSearch 工具模块。允许 AI 执行网络搜索以获取最新信息。
 *
 * 主要功能：
 * - WebSearchTool：执行网络搜索的工具
 * - 使用 Exa AI API 进行搜索
 * - 支持多种搜索模式（auto、fast、deep）
 * - 支持实时爬取（livecrawl）
 * - 可配置结果数量和上下文长度
 *
 * 依赖关系：
 * - zod：类型验证
 * - ./tool：工具基类
 * - ./websearch.txt：工具描述模板
 *
 * 导出内容：
 * - WebSearchTool：WebSearch 工具定义
 *
 * 参数：
 * - query：搜索查询
 * - numResults：返回结果数量（默认 8）
 * - livecrawl：实时爬取模式（fallback/preferred）
 * - type：搜索类型（auto/fast/deep）
 * - contextMaxCharacters：上下文最大字符数（默认 10000）
 *
 * 返回：
 * - title：搜索查询标题
 * - output：搜索结果
 * - metadata：空元数据
 *
 * API 配置：
 * - BASE_URL：https://mcp.exa.ai
 * - ENDPOINT：/mcp
 * - 协议：JSON-RPC 2.0
 *
 * 搜索模式：
 * - auto：平衡搜索（默认）
 * - fast：快速结果
 * - deep：全面搜索
 *
 * 实时爬取模式：
 * - fallback：缓存不可用时使用实时爬取（默认）
 * - preferred：优先使用实时爬取
 *
 * 超时：
 * - 25 秒超时
 * - 支持 abort 信号取消
 *
 * 响应格式：
 * - Server-Sent Events (SSE)
 * - data: 开头的行包含 JSON 数据
 *
 * @package opencode
 * @module tool/websearch
 */

// 导入 Zod 类型验证库
import z from "zod"

// 导入工具基类
import { Tool } from "./tool"

// 导入工具描述模板
import DESCRIPTION from "./websearch.txt"

// API 配置
const API_CONFIG = {
  // API 基础 URL
  BASE_URL: "https://mcp.exa.ai",
  // API 端点
  ENDPOINTS: {
    SEARCH: "/mcp",
  },
  // 默认结果数量
  DEFAULT_NUM_RESULTS: 8,
} as const

// MCP 搜索请求接口
interface McpSearchRequest {
  jsonrpc: string
  id: number
  method: string
  params: {
    name: string
    arguments: {
      query: string
      numResults?: number
      livecrawl?: "fallback" | "preferred"
      type?: "auto" | "fast" | "deep"
      contextMaxCharacters?: number
    }
  }
}

// MCP 搜索响应接口
interface McpSearchResponse {
  jsonrpc: string
  result: {
    content: Array<{
      type: string
      text: string
    }>
  }
}

/**
 * WebSearch 工具定义
 *
 * 允许 AI 执行网络搜索以获取最新信息。
 */
export const WebSearchTool = Tool.define("websearch", {
  // 工具描述（从模板导入）
  description: DESCRIPTION,

  // 参数 Schema
  parameters: z.object({
    // 搜索查询
    query: z.string().describe("Websearch query"),
    // 返回结果数量
    numResults: z.number().optional().describe("Number of search results to return (default: 8)"),
    // 实时爬取模式
    livecrawl: z
      .enum(["fallback", "preferred"])
      .optional()
      .describe(
        "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
      ),
    // 搜索类型
    type: z
      .enum(["auto", "fast", "deep"])
      .optional()
      .describe("Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search"),
    // 上下文最大字符数
    contextMaxCharacters: z
      .number()
      .optional()
      .describe("Maximum characters for context string optimized for LLMs (default: 10000)"),
  }),

  async execute(params, ctx) {
    // 请求 websearch 权限
    await ctx.ask({
      permission: "websearch",
      patterns: [params.query],
      always: ["*"],
      metadata: {
        query: params.query,
        numResults: params.numResults,
        livecrawl: params.livecrawl,
        type: params.type,
        contextMaxCharacters: params.contextMaxCharacters,
      },
    })

    // 构建搜索请求
    const searchRequest: McpSearchRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "web_search_exa",
        arguments: {
          query: params.query,
          type: params.type || "auto",
          numResults: params.numResults || API_CONFIG.DEFAULT_NUM_RESULTS,
          livecrawl: params.livecrawl || "fallback",
          contextMaxCharacters: params.contextMaxCharacters,
        },
      },
    }

    // 创建超时控制器（25 秒）
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 25000)

    try {
      // 设置请求头
      const headers: Record<string, string> = {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      }

      // 发送搜索请求
      const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.SEARCH}`, {
        method: "POST",
        headers,
        body: JSON.stringify(searchRequest),
        signal: AbortSignal.any([controller.signal, ctx.abort]),
      })

      // 清除超时定时器
      clearTimeout(timeoutId)

      // 检查响应状态
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Search error (${response.status}): ${errorText}`)
      }

      // 读取响应文本
      const responseText = await response.text()

      // 解析 SSE（Server-Sent Events）响应
      const lines = responseText.split("\n")
      for (const line of lines) {
        // 查找以 "data: " 开头的行
        if (line.startsWith("data: ")) {
          const data: McpSearchResponse = JSON.parse(line.substring(6))
          // 返回第一个内容项
          if (data.result && data.result.content && data.result.content.length > 0) {
            return {
              output: data.result.content[0].text,
              title: `Web search: ${params.query}`,
              metadata: {},
            }
          }
        }
      }

      // 没有找到结果
      return {
        output: "No search results found. Please try a different query.",
        title: `Web search: ${params.query}`,
        metadata: {},
      }
    } catch (error) {
      // 清除超时定时器
      clearTimeout(timeoutId)

      // 处理超时错误
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Search request timed out")
      }

      throw error
    }
  },
})
