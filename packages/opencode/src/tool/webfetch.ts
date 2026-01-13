/**
 * ============================================================================
 * 文件名：webfetch.ts
 * 所属包：packages/opencode/src/tool
 * ============================================================================
 *
 * 文件作用：
 * WebFetch 工具模块。允许 AI 从 URL 获取网页内容。
 *
 * 主要功能：
 * - WebFetchTool：获取网页内容的工具
 * - 支持多种输出格式（text、markdown、html）
 * - HTML 转 Markdown 转换
 * - HTML 提取纯文本
 * - 超时和大小限制
 *
 * 依赖关系：
 * - zod：类型验证
 * - ./tool：工具基类
 * - turndown：HTML 转 Markdown 库
 * - ./webfetch.txt：工具描述模板
 *
 * 导出内容：
 * - WebFetchTool：WebFetch 工具定义
 * - extractTextFromHTML()：从 HTML 提取纯文本
 * - convertHTMLToMarkdown()：将 HTML 转换为 Markdown
 *
 * 参数：
 * - url：要获取内容的 URL
 * - format：输出格式（text、markdown、html），默认 markdown
 * - timeout：超时时间（秒），最大 120 秒
 *
 * 返回：
 * - title：URL 和内容类型
 * - output：处理后的内容
 * - metadata：空元数据
 *
 * 常量：
 * - MAX_RESPONSE_SIZE：最大响应大小（5MB）
 * - DEFAULT_TIMEOUT：默认超时时间（30 秒）
 * - MAX_TIMEOUT：最大超时时间（120 秒）
 *
 * 格式处理：
 * - markdown：HTML 转 Markdown，其他格式返回原内容
 * - text：HTML 提取纯文本，其他格式返回原内容
 * - html：返回原始 HTML
 *
 * Accept 头：
 * 根据请求格式设置 Accept 头，带优先级（q 参数）：
 * - markdown：text/markdown > text/x-markdown > text/plain > text/html
 * - text：text/plain > text/markdown > text/html
 * - html：text/html > application/xhtml+xml > text/plain
 *
 * 文本提取：
 * 使用 HTMLRewriter 跳过以下元素：
 * - script, style, noscript
 * - iframe, object, embed
 *
 * Markdown 转换配置：
 * - headingStyle：atx（# 标题）
 * - hr：---（分隔线）
 * - bulletListMarker：-（无序列表）
 * - codeBlockStyle：fenced（围栏代码块）
 * - emDelimiter：*（斜体）
 *
 * @package opencode
 * @module tool/webfetch
 */

// 导入 Zod 类型验证库
import z from "zod"

// 导入工具基类
import { Tool } from "./tool"

// 导入 HTML 转 Markdown 库
import TurndownService from "turndown"

// 导入工具描述模板
import DESCRIPTION from "./webfetch.txt"

// 最大响应大小（5MB）
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024

// 默认超时时间（30 秒）
const DEFAULT_TIMEOUT = 30 * 1000

// 最大超时时间（120 秒）
const MAX_TIMEOUT = 120 * 1000

/**
 * WebFetch 工具定义
 *
 * 允许 AI 从 URL 获取网页内容。
 */
export const WebFetchTool = Tool.define("webfetch", {
  // 工具描述（从模板导入）
  description: DESCRIPTION,

  // 参数 Schema
  parameters: z.object({
    // 要获取内容的 URL
    url: z.string().describe("The URL to fetch content from"),
    // 输出格式（text、markdown、html）
    format: z
      .enum(["text", "markdown", "html"])
      .default("markdown")
      .describe("The format to return the content in (text, markdown, or html). Defaults to markdown."),
    // 超时时间（秒）
    timeout: z.number().describe("Optional timeout in seconds (max 120)").optional(),
  }),

  async execute(params, ctx) {
    // 验证 URL 格式
    if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
      throw new Error("URL must start with http:// or https://")
    }

    // 请求 webfetch 权限
    await ctx.ask({
      permission: "webfetch",
      patterns: [params.url],
      always: ["*"],
      metadata: {
        url: params.url,
        format: params.format,
        timeout: params.timeout,
      },
    })

    // 计算超时时间（最大 120 秒）
    const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT)

    // 创建超时控制器
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    // 根据请求格式构建 Accept 头（带优先级 q 参数）
    let acceptHeader = "*/*"
    switch (params.format) {
      case "markdown":
        acceptHeader = "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
        break
      case "text":
        acceptHeader = "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
        break
      case "html":
        acceptHeader = "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
        break
      default:
        acceptHeader =
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
    }

    // 发起请求
    const response = await fetch(params.url, {
      signal: AbortSignal.any([controller.signal, ctx.abort]),
      headers: {
        // 使用常见的浏览器 User-Agent
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: acceptHeader,
        "Accept-Language": "en-US,en;q=0.9",
      },
    })

    // 清除超时定时器
    clearTimeout(timeoutId)

    // 检查响应状态
    if (!response.ok) {
      throw new Error(`Request failed with status code: ${response.status}`)
    }

    // 检查内容长度
    const contentLength = response.headers.get("content-length")
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
      throw new Error("Response too large (exceeds 5MB limit)")
    }

    // 读取响应内容
    const arrayBuffer = await response.arrayBuffer()
    if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
      throw new Error("Response too large (exceeds 5MB limit)")
    }

    // 解码内容
    const content = new TextDecoder().decode(arrayBuffer)
    const contentType = response.headers.get("content-type") || ""

    const title = `${params.url} (${contentType})`

    // 根据请求格式处理内容
    switch (params.format) {
      case "markdown":
        // 如果是 HTML，转换为 Markdown
        if (contentType.includes("text/html")) {
          const markdown = convertHTMLToMarkdown(content)
          return {
            output: markdown,
            title,
            metadata: {},
          }
        }
        // 其他格式直接返回
        return {
          output: content,
          title,
          metadata: {},
        }

      case "text":
        // 如果是 HTML，提取纯文本
        if (contentType.includes("text/html")) {
          const text = await extractTextFromHTML(content)
          return {
            output: text,
            title,
            metadata: {},
          }
        }
        // 其他格式直接返回
        return {
          output: content,
          title,
          metadata: {},
        }

      case "html":
        // 返回原始 HTML
        return {
          output: content,
          title,
          metadata: {},
        }

      default:
        return {
          output: content,
          title,
          metadata: {},
        }
    }
  },
})

/**
 * 从 HTML 提取纯文本
 *
 * 使用 HTMLRewriter 跳过脚本、样式等不需要的元素。
 *
 * @param html - HTML 字符串
 * @returns 提取的纯文本
 *
 * 处理逻辑：
 * 1. 跳过 script, style, noscript, iframe, object, embed 元素
 * 2. 提取其他元素的文本内容
 * 3. 保留文本的基本结构
 */
async function extractTextFromHTML(html: string) {
  let text = ""
  let skipContent = false

  // 使用 HTMLRewriter 处理 HTML
  const rewriter = new HTMLRewriter()
    // 处理需要跳过的元素
    .on("script, style, noscript, iframe, object, embed", {
      element() {
        skipContent = true
      },
      text() {
        // 跳过这些元素内的文本
      },
    })
    // 处理所有其他元素
    .on("*", {
      element(element) {
        // 进入其他元素时重置跳过标志
        if (!["script", "style", "noscript", "iframe", "object", "embed"].includes(element.tagName)) {
          skipContent = false
        }
      },
      text(input) {
        // 如果不需要跳过，添加文本
        if (!skipContent) {
          text += input.text
        }
      },
    })
    .transform(new Response(html))

  await rewriter.text()
  return text.trim()
}

/**
 * 将 HTML 转换为 Markdown
 *
 * 使用 TurndownService 进行转换。
 *
 * @param html - HTML 字符串
 * @returns Markdown 字符串
 *
 * 转换配置：
 * - headingStyle：atx（# ## ### 标题格式）
 * - hr：---（水平分隔线）
 * - bulletListMarker：-（无序列表标记）
 * - codeBlockStyle：fenced（``` 代码块）
 * - emDelimiter：*（斜体标记）
 *
 * 移除的标签：
 * - script, style, meta, link
 */
function convertHTMLToMarkdown(html: string): string {
  // 创建 TurndownService 实例
  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  })

  // 移除不需要的标签
  turndownService.remove(["script", "style", "meta", "link"])

  // 转换 HTML 为 Markdown
  return turndownService.turndown(html)
}
