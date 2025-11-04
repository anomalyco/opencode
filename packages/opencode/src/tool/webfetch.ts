import z from "zod"
import { Tool } from "./tool"
import TurndownService from "turndown"
import DESCRIPTION from "./webfetch.txt"
import { Config } from "../config/config"
import { Permission } from "../permission"
import { Provider } from "../provider/provider"
import { Session } from "../session"
import { Token } from "../util/token"
import { SessionPrompt } from "../session/prompt"

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes

export const WebFetchTool = Tool.define("webfetch", {
  description: DESCRIPTION,
  parameters: z.object({
    url: z.string().describe("The URL to fetch content from"),
    format: z
      .enum(["text", "markdown", "html"])
      .describe("The format to return the content in (text, markdown, or html)"),
    timeout: z.number().describe("Optional timeout in seconds (max 120)").optional(),
  }),
  async execute(params, ctx) {
    // Validate URL
    if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
      throw new Error("URL must start with http:// or https://")
    }

    const cfg = await Config.get()
    if (cfg.permission?.webfetch === "ask")
      await Permission.ask({
        type: "webfetch",
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
        callID: ctx.callID,
        title: "Fetch content from: " + params.url,
        metadata: {
          url: params.url,
          format: params.format,
          timeout: params.timeout,
        },
      })

    const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    // Build Accept header based on requested format with q parameters for fallbacks
    let acceptHeader = "*/*"
    switch (params.format) {
      case "markdown":
        acceptHeader =
          "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
        break
      case "text":
        acceptHeader = "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
        break
      case "html":
        acceptHeader =
          "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
        break
      default:
        acceptHeader =
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
    }

    const response = await fetch(params.url, {
      signal: AbortSignal.any([controller.signal, ctx.abort]),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: acceptHeader,
        "Accept-Language": "en-US,en;q=0.9",
      },
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`Request failed with status code: ${response.status}`)
    }

    // Check content length
    const contentLength = response.headers.get("content-length")
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
      throw new Error("Response too large (exceeds 5MB limit)")
    }

    const arrayBuffer = await response.arrayBuffer()
    if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
      throw new Error("Response too large (exceeds 5MB limit)")
    }

    let content = new TextDecoder().decode(arrayBuffer)
    const contentType = response.headers.get("content-type") || ""

    const title = `${params.url} (${contentType})`

    let output = ""
    switch (params.format) {
      case "markdown":
        if (contentType.includes("text/html")) {
          output = convertHTMLToMarkdown(content)
        } else {
          output = content
        }
        break
      case "text":
        if (contentType.includes("text/html")) {
          output = await extractTextFromHTML(content)
        } else {
          output = content
        }
        break
      case "html":
        output = content
        break
      default:
        output = content
    }

    if (ctx.extra?.providerID && ctx.extra?.modelID) {
      const model = await Provider.getModel(ctx.extra.providerID, ctx.extra.modelID)
      const messages = await Session.messages(ctx.sessionID)
      const lastAssistant = messages.findLast((m) => m.info.role === "assistant")

      if (lastAssistant?.info.role === "assistant") {
        const currentTokens =
          lastAssistant.info.tokens.input +
          lastAssistant.info.tokens.cache.read +
          lastAssistant.info.tokens.output
        const contextLimit = model.info.limit.context
        const outputReserve =
          Math.min(model.info.limit.output, SessionPrompt.OUTPUT_TOKEN_MAX) ||
          SessionPrompt.OUTPUT_TOKEN_MAX
        const availableTokens = contextLimit - outputReserve - currentTokens

        const outputTokens = Token.estimate(output)
        if (outputTokens > availableTokens && availableTokens > 0) {
          const targetLength = Math.floor((availableTokens / outputTokens) * output.length * 0.8)
          output = output.slice(0, targetLength) + "\n\n[Content truncated due to context limit]"
        }
      }
    }

    return {
      output,
      title,
      metadata: {},
    }
  },
})

async function extractTextFromHTML(html: string) {
  let text = ""
  let skipContent = false

  const rewriter = new HTMLRewriter()
    .on("script, style, noscript, iframe, object, embed", {
      element() {
        skipContent = true
      },
      text() {
        // Skip text content inside these elements
      },
    })
    .on("*", {
      element(element) {
        // Reset skip flag when entering other elements
        if (
          !["script", "style", "noscript", "iframe", "object", "embed"].includes(element.tagName)
        ) {
          skipContent = false
        }
      },
      text(input) {
        if (!skipContent) {
          text += input.text
        }
      },
    })
    .transform(new Response(html))

  await rewriter.text()
  return text.trim()
}

function convertHTMLToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  })
  turndownService.remove(["script", "style", "meta", "link"])
  return turndownService.turndown(html)
}
