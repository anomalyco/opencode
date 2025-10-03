import z from "zod/v4"
import { Tool } from "./tool"
import TurndownService from "turndown"
import { Octokit } from "@octokit/rest"
import { parseHTML } from "linkedom"
import DESCRIPTION from "./fetchurl.txt"
import { Config } from "../config/config"
import { Permission } from "../permission"

const MAX_RESPONSE_SIZE = 10 * 1024 * 1024 // 10MB
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes
const MAX_REDIRECTS = 5

// Private IP ranges to block
const PRIVATE_IP_RANGES = [
  /^127\./, // 127.0.0.0/8
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^localhost$/i,
  /^::1$/, // IPv6 localhost
  /^fe80::/i, // IPv6 link-local
]

const schema = z.object({
  url: z.string().describe("The URL to fetch content from"),
  format: z
    .enum(["markdown", "text", "html", "json", "auto"])
    .optional()
    .describe("Output format (auto-detected if not specified)"),
  integration: z
    .enum(["google_docs", "notion", "linear", "github", "gitlab", "jira", "pagerduty", "slack", "sentry", "generic"])
    .optional()
    .describe("Integration type (auto-detected if not specified)"),
  auth_type: z
    .enum(["bearer", "api_key", "header", "query", "none"])
    .optional()
    .describe("Authentication type"),
  auth_token: z.string().optional().describe("Authentication token/API key"),
  auth_header_name: z.string().optional().describe("Custom header name for auth (if auth_type=header)"),
  auth_query_param: z.string().optional().describe("Query parameter name for auth (if auth_type=query)"),
  timeout: z.number().optional().describe("Optional timeout in seconds (max 120)"),
  follow_redirects: z.boolean().optional().describe("Follow HTTP redirects (default true, max 5)"),
})

type FetchArgs = z.infer<typeof schema>
type FetchMeta = {
  integration: string
  api_used: boolean
  content_type: string
  size: number
  redirects?: number
  final_url?: string
}

export const FetchUrlTool = Tool.define("fetchurl", {
  description: DESCRIPTION,
  parameters: schema,
  async execute(params, ctx) {
    // Validate URL and check for private IPs
    if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
      throw new Error("URL must start with http:// or https://")
    }

    // Extract hostname and check against private IP patterns
    const hostname = new URL(params.url).hostname
    for (const pattern of PRIVATE_IP_RANGES) {
      if (pattern.test(hostname)) {
        throw new Error("Access to localhost and private IP addresses is not allowed")
      }
    }

    const cfg = await Config.get()
    if (cfg.permission?.fetchurl === "ask")
      await Permission.ask({
        type: "fetchurl",
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
        callID: ctx.callID,
        title: "Fetch content from: " + params.url,
        metadata: {
          url: params.url,
          integration: params.integration,
        },
      })

    const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT)

    // Auto-detect integration type if not specified
    const integration = params.integration || detectIntegration(params.url)

    // Use API integration if available
    if (integration === "github" && canUseGitHubAPI(params.url, params.auth_token)) {
      const content = await fetchGitHubContent(params.url, params.auth_token, params.format)
      return {
        title: `${params.url} (github-api)`,
        output: content,
        metadata: {
          integration: "github",
          api_used: true,
          content_type: "api/json",
          size: content.length,
        },
      }
    }

    // Fallback to HTTP fetch for other integrations
    const result = await fetchHTTP(params, ctx, integration, timeout)
    return result
  },
})

function detectIntegration(url: string): string {
  const hostname = new URL(url).hostname.toLowerCase()

  if (hostname.includes("docs.google.com")) return "google_docs"
  if (hostname.includes("notion.so") || hostname.includes("notion.site")) return "notion"
  if (hostname.includes("linear.app")) return "linear"
  if (hostname.includes("github.com")) return "github"
  if (hostname.includes("gitlab.com")) return "gitlab"
  if (hostname.includes("atlassian.net") || hostname.includes("jira.")) return "jira"
  if (hostname.includes("pagerduty.com")) return "pagerduty"
  if (hostname.includes("slack.com")) return "slack"
  if (hostname.includes("sentry.io")) return "sentry"

  return "generic"
}

function canUseGitHubAPI(url: string, authToken?: string): boolean {
  // Check if URL is a GitHub file/repo URL and we have an auth token
  return url.includes("github.com") && (!!authToken || !!process.env["GITHUB_TOKEN"])
}

async function fetchGitHubContent(url: string, authToken?: string, format?: string): Promise<string> {
  const token = authToken || process.env["GITHUB_TOKEN"]
  const octokit = new Octokit({ auth: token })

  // Parse GitHub URL
  const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)(?:\/(?:blob|tree)\/([^\/]+)\/(.+))?/)
  if (!match) {
    throw new Error("Invalid GitHub URL format")
  }

  const [, owner, repo, ref, path] = match

  // If no path, fetch README
  if (!path) {
    const { data } = await octokit.repos.getReadme({ owner, repo, ref })
    const content = Buffer.from(data.content, "base64").toString()
    if (format === "html") return content
    if (format === "text") return stripMarkdown(content)
    return content // markdown by default
  }

  // Fetch file content
  const { data } = await octokit.repos.getContent({ owner, repo, path, ref })

  if (Array.isArray(data)) {
    // Directory listing
    let markdown = `# Directory: ${path}\n\n`
    for (const item of data) {
      markdown += `- [${item.type === "dir" ? "📁" : "📄"} ${item.name}](${item.html_url})\n`
    }
    return markdown
  }

  if ("content" in data) {
    const content = Buffer.from(data.content, "base64").toString()
    const ext = path.split(".").pop()?.toLowerCase()

    if (format === "text") return content
    if (format === "html") return `<pre><code>${escapeHTML(content)}</code></pre>`

    // Return with syntax highlighting info
    return `\`\`\`${ext}\n${content}\n\`\`\``
  }

  throw new Error("Could not fetch GitHub content")
}

async function fetchHTTP(
  params: FetchArgs,
  ctx: Tool.Context,
  integration: string,
  timeout: number,
): Promise<{ title: string; output: string; metadata: FetchMeta }> {
  const state = { url: params.url, redirects: 0 }
  const follow = params.follow_redirects !== false

  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  }

  if (params.auth_token) {
    const authType = params.auth_type || "bearer"
    if (authType === "bearer") headers["Authorization"] = `Bearer ${params.auth_token}`
    if (authType === "api_key") headers["X-API-Key"] = params.auth_token
    if (authType === "header" && params.auth_header_name) headers[params.auth_header_name] = params.auth_token
    if (authType === "query" && params.auth_query_param) {
      const urlObj = new URL(state.url)
      urlObj.searchParams.set(params.auth_query_param, params.auth_token)
      state.url = urlObj.toString()
    }
  }

  while (true) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    const response = await fetch(state.url, {
      signal: AbortSignal.any([controller.signal, ctx.abort]),
      headers,
      redirect: "manual",
    })

    clearTimeout(timer)

    const isRedirect =
      response.status === 301 || response.status === 302 || response.status === 307 || response.status === 308
    if (follow && isRedirect) {
      const location = response.headers.get("location")
      if (!location) throw new Error(`Redirect without location header`)

      state.redirects += 1
      if (state.redirects > MAX_REDIRECTS) throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`)

      state.url = new URL(location, state.url).toString()
      const newHostname = new URL(state.url).hostname
      for (const pattern of PRIVATE_IP_RANGES) {
        if (pattern.test(newHostname)) throw new Error("Redirect to localhost/private IP is not allowed")
      }

      continue
    }

    if (!response.ok) throw new Error(`Request failed with status code: ${response.status}`)

    const contentLength = response.headers.get("content-length")
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
      throw new Error(`Response too large (exceeds ${MAX_RESPONSE_SIZE / 1024 / 1024}MB limit)`)
    }

    const arrayBuffer = await response.arrayBuffer()
    if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
      throw new Error(`Response too large (exceeds ${MAX_RESPONSE_SIZE / 1024 / 1024}MB limit)`)
    }

    const content = new TextDecoder().decode(arrayBuffer)
    const contentType = response.headers.get("content-type") || ""
    const output = await processContent(content, contentType, integration, state.url, params.format)

    return {
      title: `${state.url} (${integration})`,
      output,
      metadata: {
        integration,
        api_used: false,
        content_type: contentType,
        size: arrayBuffer.byteLength,
        redirects: state.redirects,
        final_url: state.url,
      },
    }
  }
}

async function processContent(
  content: string,
  contentType: string,
  integration: string,
  url: string,
  formatPreference?: FetchArgs["format"],
): Promise<string> {
  // Handle JSON responses
  if (contentType.includes("application/json")) {
    if (formatPreference === "json" || formatPreference === "text") {
      return content
    }
    try {
      const json = JSON.parse(content)
      return formatJSONAsMarkdown(json, integration)
    } catch {
      return content
    }
  }

  // Handle HTML content
  if (contentType.includes("text/html")) {
    if (formatPreference === "html") {
      return content
    }
    if (formatPreference === "text") {
      return extractTextFromHTML(content)
    }
    // Default to markdown
    return convertHTMLToMarkdown(content, integration, url)
  }

  // Plain text or other
  return content
}

function formatJSONAsMarkdown(data: unknown, integration: string): string {
  const heading = `# ${integration.toUpperCase()} Content`
  const parts = [heading, ""]
  const record = toRecord(data)

  if (integration === "github" && record) {
    const name = record["name"]
    if (typeof name === "string" && name) parts.push(`## ${name}`, "")
    const description = record["description"]
    if (typeof description === "string" && description) parts.push(description, "")
    const content = record["content"]
    if (typeof content === "string" && content) {
      const decoded = Buffer.from(content, "base64").toString()
      parts.push("```", decoded, "```", "")
    }
    return parts.join("\n").trimEnd()
  }

  if (integration === "linear" && record) {
    const title = record["title"]
    if (typeof title === "string" && title) parts.push(`## ${title}`, "")
    const description = record["description"]
    if (typeof description === "string" && description) parts.push(description, "")
    const state = record["state"]
    if (typeof state === "string" && state) parts.push(`**State:** ${state}`, "")
    return parts.join("\n").trimEnd()
  }

  if (integration === "jira" && record) {
    const fields = toRecord(record["fields"])
    if (fields) {
      const summary = fields["summary"]
      if (typeof summary === "string" && summary) parts.push(`## ${summary}`, "")
      const description = fields["description"]
      if (typeof description === "string" && description) parts.push(description, "")
      const status = toRecord(fields["status"])
      const name = status ? status["name"] : undefined
      if (typeof name === "string" && name) parts.push(`**Status:** ${name}`, "")
    }
    return parts.join("\n").trimEnd()
  }

  parts.push("```json", JSON.stringify(data, null, 2), "```", "")
  return parts.join("\n").trimEnd()
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object") return value as Record<string, unknown>
  return null
}

function convertHTMLToMarkdown(html: string, integration: string, url: string): string {
  // First extract relevant content based on integration
  const extracted = extractIntegrationContent(html, integration)

  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  })

  turndownService.remove(["script", "style", "meta", "link", "nav", "footer", "header"])

  let markdown = turndownService.turndown(extracted)
  markdown = `# Content from ${url}\n\n${markdown}`

  return markdown.trim()
}

function extractIntegrationContent(html: string, integration: string): string {
  try {
    const { document } = parseHTML(html)

    switch (integration) {
      case "google_docs":
        const docsContent = document.querySelector(".kix-appview-editor")
        return docsContent?.innerHTML || html
      case "notion":
        const notionContent = document.querySelector(".notion-page-content")
        return notionContent?.innerHTML || html
      case "github":
        const ghContent =
          document.querySelector(".markdown-body") || document.querySelector(".highlight")
        return ghContent?.innerHTML || html
      default:
        // Try to find main content
        const main = document.querySelector("main") || document.querySelector("article") || document.querySelector("body")
        return main?.innerHTML || html
    }
  } catch {
    return html
  }
}

function extractTextFromHTML(html: string): string {
  try {
    const { document } = parseHTML(html)
    return document.body?.textContent?.trim() || html
  } catch {
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
  }
}

function stripMarkdown(content: string): string {
  return content
    .replace(/#+\s/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim()
}

function escapeHTML(text: string): string {
  return text.replace(/[&<>"']/g, (char) => {
    const escape: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }
    return escape[char] || char
  })
}
