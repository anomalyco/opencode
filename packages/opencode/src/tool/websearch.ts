import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./websearch.txt"
import path from "path"

// ---------------------------------------------------------------------------
// Rate limiter – sliding-window token bucket
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute
const RATE_LIMIT_MAX = 20           // max requests per window
const RATE_LIMIT_MIN_GAP_MS = 2_000 // minimum gap between requests

const timestamps: number[] = []

function acquireSearchSlot(): { ok: boolean; retryAfterMs?: number } {
  const now = Date.now()

  // Purge entries outside the window
  while (timestamps.length > 0 && timestamps[0] <= now - RATE_LIMIT_WINDOW_MS) {
    timestamps.shift()
  }

  // Check minimum gap since last request
  if (timestamps.length > 0) {
    const last = timestamps[timestamps.length - 1]
    const gap = now - last
    if (gap < RATE_LIMIT_MIN_GAP_MS) {
      return { ok: false, retryAfterMs: RATE_LIMIT_MIN_GAP_MS - gap }
    }
  }

  // Check window capacity
  if (timestamps.length >= RATE_LIMIT_MAX) {
    const oldest = timestamps[0]
    const retryAfterMs = oldest + RATE_LIMIT_WINDOW_MS - now
    return { ok: false, retryAfterMs: Math.max(retryAfterMs, RATE_LIMIT_MIN_GAP_MS) }
  }

  timestamps.push(now)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Tool parameters
// ---------------------------------------------------------------------------

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Search query" }),
  numResults: Schema.optional(Schema.Number).annotate({
    description: "Number of search results to return (default: 8)",
  }),
  livecrawl: Schema.optional(Schema.Literals(["fallback", "preferred"])).annotate({
    description:
      "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
  }),
  type: Schema.optional(Schema.Literals(["auto", "fast", "deep"])).annotate({
    description: "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
  }),
  contextMaxCharacters: Schema.optional(Schema.Number).annotate({
    description: "Maximum characters for context string optimized for LLMs (default: 10000)",
  }),
})

// ---------------------------------------------------------------------------
// DuckDuckGo search via Python subprocess
// ---------------------------------------------------------------------------

interface DdgResult {
  title: string
  url: string
  snippet: string
}

interface DdgResponse {
  results: DdgResult[]
  query: string
  provider: string
  error?: string
}

function getScriptPath(): string {
  return path.resolve(import.meta.dirname, "../../../../standalone-crawler/duckduckgo_search.py")
}

function formatResults(response: DdgResponse): string {
  if (response.error) {
    return `Search error: ${response.error}`
  }
  if (response.results.length === 0) {
    return "No search results found. Please try a different query."
  }

  const lines: string[] = []
  for (const r of response.results) {
    lines.push(`## ${r.title}`)
    lines.push(`URL: ${r.url}`)
    if (r.snippet) lines.push(`${r.snippet}`)
    lines.push("")
  }
  return lines.join("\n").trim()
}

async function runSearch(
  query: string,
  maxResults: number,
  type?: string,
): Promise<DdgResponse> {
  const script = getScriptPath()
  const args = ["python", script, query, "--max-results", String(maxResults)]
  if (type === "fast") {
    args.push("--time-period", "w")
  } else if (type === "deep") {
    args.push("--time-period", "m")
  }

  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    const errMsg = stderr.trim() || `DuckDuckGo search exited with code ${exitCode}`
    return {
      results: [],
      query,
      provider: "duckduckgo",
      error: errMsg,
    }
  }

  try {
    return JSON.parse(stdout) as DdgResponse
  } catch {
    return {
      results: [],
      query,
      provider: "duckduckgo",
      error: "Search returned invalid response",
    }
  }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const WebSearchTool = Tool.define(
  "websearch",
  Effect.succeed({
    get description() {
      return DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
    },
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        // Rate-limit gate before any network request
        const slot = acquireSearchSlot()
        if (!slot.ok) {
          const waitSec = Math.ceil((slot.retryAfterMs ?? 2000) / 1000)
          return {
            output: `Search rate limit reached. Please wait ${waitSec} seconds before searching again.`,
            title: "DuckDuckGo Search",
            metadata: { provider: "duckduckgo" as const },
          }
        }

        yield* ctx.ask({
          permission: "websearch",
          patterns: [params.query],
          always: ["*"],
          metadata: {
            query: params.query,
            numResults: params.numResults,
            provider: "duckduckgo",
          },
        })

        const maxResults = params.numResults ?? 8
        const response = yield* Effect.tryPromise({
          try: () => runSearch(params.query, maxResults, params.type),
          catch: (e) => new Error(`DuckDuckGo search failed: ${e instanceof Error ? e.message : String(e)}`),
        })

        const output = formatResults(response)

        // Truncate context if contextMaxCharacters is set
        const maxChars = params.contextMaxCharacters ?? 10_000
        const truncated = output.length > maxChars ? output.slice(0, maxChars) + "\n\n[truncated]" : output

        return {
          output: truncated,
          title: `DuckDuckGo: ${params.query}`,
          metadata: { provider: "duckduckgo" as const },
        }
      }).pipe(Effect.orDie),
  }),
)
