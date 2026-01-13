/**
 * ============================================================================
 * 文件名：codesearch.ts
 * 所属包：packages/opencode/src/tool
 * ============================================================================
 *
 * 文件作用：
 * CodeSearch 工具模块。允许 AI 搜索代码文档和 API 使用示例。
 *
 * 主要功能：
 * - CodeSearchTool：搜索代码上下文的工具
 * - 使用 Exa AI API 搜索代码片段和文档
 * - 获取 API、库和 SDK 的相关上下文
 * - 可配置返回的 token 数量
 *
 * 依赖关系：
 * - zod：类型验证
 * - ./tool：工具基类
 * - ./codesearch.txt：工具描述模板
 *
 * 导出内容：
 * - CodeSearchTool：CodeSearch 工具定义
 *
 * 参数：
 * - query：搜索查询（如 "React useState hook examples"）
 * - tokensNum：返回的 token 数量（1000-50000，默认 5000）
 *
 * 返回：
 * - title：搜索查询标题
 * - output：代码片段和文档
 * - metadata：空元数据
 *
 * API 配置：
 * - BASE_URL：https://mcp.exa.ai
 * - ENDPOINT：/mcp
 * - 协议：JSON-RPC 2.0
 * - 方法：get_code_context_exa
 *
 * Token 数量：
 * - 最小：1000
 * - 最大：50000
 * - 默认：5000
 *
 * 使用场景：
 * - 查找 API 使用示例
 * - 获取库的文档
 * - 学习 SDK 的用法
 * - 查找编程概念的实现
 *
 * 搜索示例：
 * - "React useState hook examples"
 * - "Python pandas dataframe filtering"
 * - "Express.js middleware"
 * - "Next js partial prerendering configuration"
 *
 * 超时：
 * - 30 秒超时
 * - 支持 abort 信号取消
 *
 * 响应格式：
 * - Server-Sent Events (SSE)
 * - data: 开头的行包含 JSON 数据
 *
 * @package opencode
 * @module tool/codesearch
 */

// 导入 Zod 类型验证库
import z from "zod"

// 导入工具基类
import { Tool } from "./tool"

// 导入工具描述模板
import DESCRIPTION from "./codesearch.txt"

// API 配置
const API_CONFIG = {
  // API 基础 URL
  BASE_URL: "https://mcp.exa.ai",
  // API 端点
  ENDPOINTS: {
    CONTEXT: "/mcp",
  },
} as const

// MCP 代码请求接口
interface McpCodeRequest {
  jsonrpc: string
  id: number
  method: string
  params: {
    name: string
    arguments: {
      query: string
      tokensNum: number
    }
  }
}

// MCP 代码响应接口
interface McpCodeResponse {
  jsonrpc: string
  result: {
    content: Array<{
      type: string
      text: string
    }>
  }
}

/**
 * CodeSearch 工具定义
 *
 * 允许 AI 搜索代码文档和 API 使用示例。
 */
export const CodeSearchTool = Tool.define("codesearch", {
  // 工具描述（从模板导入）
  description: DESCRIPTION,

  // 参数 Schema
  parameters: z.object({
    // 搜索查询
    query: z
      .string()
      .describe(
        "Search query to find relevant context for APIs, Libraries, and SDKs. For example, 'React useState hook examples', 'Python pandas dataframe filtering', 'Express.js middleware', 'Next js partial prerendering configuration'",
      ),
    // 返回的 token 数量
    tokensNum: z
      .number()
      .min(1000)
      .max(50000)
      .default(5000)
      .describe(
        "Number of tokens to return (1000-50000). Default is 5000 tokens. Adjust this value based on how much context you need - use lower values for focused queries and higher values for comprehensive documentation.",
      ),
  }),

  async execute(params, ctx) {
    // 请求 codesearch 权限
    await ctx.ask({
      permission: "codesearch",
      patterns: [params.query],
      always: ["*"],
      metadata: {
        query: params.query,
        tokensNum: params.tokensNum,
      },
    })

    // 构建代码搜索请求
    const codeRequest: McpCodeRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "get_code_context_exa",
        arguments: {
          query: params.query,
          tokensNum: params.tokensNum || 5000,
        },
      },
    }

    // 创建超时控制器（30 秒）
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)

    try {
      // 设置请求头
      const headers: Record<string, string> = {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      }

      // 发送代码搜索请求
      const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.CONTEXT}`, {
        method: "POST",
        headers,
        body: JSON.stringify(codeRequest),
        signal: AbortSignal.any([controller.signal, ctx.abort]),
      })

      // 清除超时定时器
      clearTimeout(timeoutId)

      // 检查响应状态
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Code search error (${response.status}): ${errorText}`)
      }

      // 读取响应文本
      const responseText = await response.text()

      // 解析 SSE（Server-Sent Events）响应
      const lines = responseText.split("\n")
      for (const line of lines) {
        // 查找以 "data: " 开头的行
        if (line.startsWith("data: ")) {
          const data: McpCodeResponse = JSON.parse(line.substring(6))
          // 返回第一个内容项
          if (data.result && data.result.content && data.result.content.length > 0) {
            return {
              output: data.result.content[0].text,
              title: `Code search: ${params.query}`,
              metadata: {},
            }
          }
        }
      }

      // 没有找到结果
      return {
        output:
          "No code snippets or documentation found. Please try a different query, be more specific about the library or programming concept, or check the spelling of framework names.",
        title: `Code search: ${params.query}`,
        metadata: {},
      }
    } catch (error) {
      // 清除超时定时器
      clearTimeout(timeoutId)

      // 处理超时错误
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Code search request timed out")
      }

      throw error
    }
  },
})
