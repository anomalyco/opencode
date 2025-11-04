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

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024
const DEFAULT_TIMEOUT = 30 * 1000
const MAX_TIMEOUT = 120 * 1000
const SEARCH_THRESHOLD = 50000

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "he",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "that",
  "the",
  "to",
  "was",
  "will",
  "with",
])

interface Chunk {
  heading: string
  content: string
  position: number
  tokens: number
}

function chunkContent(content: string): Chunk[] {
  const chunks: Chunk[] = []
  const sections = content.split(/^(#{1,3}\s+.+)$/m)
  let currentHeading = "Introduction"
  let position = 0

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i].trim()
    if (!section) continue

    if (section.match(/^#{1,3}\s+/)) {
      currentHeading = section.replace(/^#+\s+/, "")
    } else {
      const paragraphs = section.split(/\n\n+/)
      for (const para of paragraphs) {
        if (para.length < 50) continue
        chunks.push({
          heading: currentHeading,
          content: para,
          position: position++,
          tokens: Token.estimate(para),
        })
      }
    }
  }
  return chunks
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
}

function searchChunks(chunks: Chunk[], query: string): Chunk[] {
  if (chunks.length === 0) return []
  const queryTerms = tokenize(query)
  if (queryTerms.length === 0) return []

  const totalLength = chunks.reduce((sum, c) => sum + tokenize(c.content).length, 0)
  const avgLength = totalLength / chunks.length

  const scored = chunks.map((chunk) => {
    const docTokens = tokenize(chunk.content + " " + chunk.heading)
    const docLength = docTokens.length
    let score = 0

    for (const term of queryTerms) {
      const termFreq = docTokens.filter((t) => t === term).length
      if (termFreq === 0) continue

      const docsWithTerm = chunks.filter((c) =>
        tokenize(c.content + " " + c.heading).includes(term),
      ).length

      const idf = Math.log((chunks.length - docsWithTerm + 0.5) / (docsWithTerm + 0.5))
      const k1 = 1.5
      const b = 0.75
      const tf = (termFreq * (k1 + 1)) / (termFreq + k1 * (1 - b + b * (docLength / avgLength)))
      let termScore = idf * tf

      if (tokenize(chunk.heading).includes(term)) {
        termScore *= 2
      }
      score += termScore
    }
    return { chunk, score }
  })

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.chunk)
}

function mergeChunks(chunks: Chunk[], maxTokens: number): string {
  let output = ""
  let tokens = 0
  let lastPosition = -1
  let lastHeading = ""

  for (const chunk of chunks) {
    const needsHeading = chunk.heading !== lastHeading
    const heading = needsHeading ? `\n\n## ${chunk.heading}\n\n` : "\n\n"
    const chunkText = heading + chunk.content
    const chunkTokens = Token.estimate(chunkText)

    if (tokens + chunkTokens > maxTokens) break

    if (lastPosition >= 0 && chunk.position > lastPosition + 1) {
      output += "\n\n[...]\n"
    }

    output += chunkText
    tokens += chunkTokens
    lastPosition = chunk.position
    lastHeading = chunk.heading
  }
  return output.trim()
}

function generateTableOfContents(chunks: Chunk[]): string {
  const sections: Record<string, number> = {}
  for (const chunk of chunks) {
    sections[chunk.heading] = (sections[chunk.heading] || 0) + chunk.tokens
  }

  let toc = "# Table of Contents\n\n"
  for (const [heading, tokens] of Object.entries(sections)) {
    toc += `- ${heading} (~${tokens} tokens)\n`
  }
  return toc
}

export const WebFetchTool = Tool.define("webfetch", {
  description: DESCRIPTION,
  parameters: z.object({
    url: z.string().describe("The URL to fetch content from"),
    format: z
      .enum(["text", "markdown", "html"])
      .describe("The format to return the content in (text, markdown, or html)"),
    search: z
      .string()
      .describe(
        "Optional search query to find relevant sections in large pages. Use descriptive multi-word queries like 'economic indicators and GDP growth' rather than single words. Returns only matching sections with context.",
      )
      .optional(),
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

      let currentTokens = 0
      for (const msg of messages) {
        if (msg.info.role === "assistant") {
          currentTokens +=
            msg.info.tokens.input + msg.info.tokens.cache.read + msg.info.tokens.output
        }
      }

      const contextLimit = model.info.limit.context
      if (contextLimit > 0) {
        const outputReserve =
          Math.min(model.info.limit.output, SessionPrompt.OUTPUT_TOKEN_MAX) ||
          SessionPrompt.OUTPUT_TOKEN_MAX
        const availableTokens = contextLimit - outputReserve - currentTokens
        const outputTokens = Token.estimate(output)

        if (params.search && outputTokens > SEARCH_THRESHOLD) {
          const chunks = chunkContent(output)
          const relevantChunks = searchChunks(chunks, params.search)

          if (relevantChunks.length > 0) {
            const sortedChunks = relevantChunks.sort((a, b) => a.position - b.position)
            output = mergeChunks(sortedChunks, Math.floor(availableTokens * 0.8))
            output += `\n\n[Search Results: Found ${relevantChunks.length} relevant sections for "${params.search}". Showing ~${Token.estimate(output)} tokens from ${chunks.length} total sections. Use a different search query to find other content.]`
          } else {
            output = generateTableOfContents(chunks)
            output += `\n\n[No results found for "${params.search}". Above is the table of contents with ~${chunks.length} sections. Try a different search query or fetch without search parameter to see full content.]`
          }
        } else if (outputTokens > availableTokens && availableTokens > 0) {
          if (!params.search && outputTokens > SEARCH_THRESHOLD) {
            const targetLength = Math.floor((availableTokens / outputTokens) * output.length * 0.8)
            const truncatedTokens = Token.estimate(output.slice(0, targetLength))
            output =
              output.slice(0, targetLength) +
              `\n\n[Content truncated: Original size was ~${outputTokens} tokens, reduced to ~${truncatedTokens} tokens due to context limit. Available context: ${availableTokens} tokens. The above content is approximately ${Math.round((targetLength / output.length) * 100)}% of the full page. Tip: Use the search parameter to find specific content: webfetch(url, format, search="your query")]`
          } else {
            const targetLength = Math.floor((availableTokens / outputTokens) * output.length * 0.8)
            const truncatedTokens = Token.estimate(output.slice(0, targetLength))
            output =
              output.slice(0, targetLength) +
              `\n\n[Content truncated: Original size was ~${outputTokens} tokens, reduced to ~${truncatedTokens} tokens due to context limit. Available context: ${availableTokens} tokens. The above content is approximately ${Math.round((targetLength / output.length) * 100)}% of the full page.]`
          }
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
