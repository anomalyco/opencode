export * as Search from "./search"

import { Duration, Effect, Schema } from "effect"
import { Option } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { collectBoundedResponseBody } from "../tool/http-body"
import {
  ConfigService,
  exaUrl,
  McpRequest,
  ExaArgs,
  ParallelArgs,
  parseResponse,
  PARALLEL_URL,
  MAX_RESPONSE_BYTES,
} from "../tool/websearch"
import { InstallationVersion } from "../installation/version"
import type { ResearchConfig, SearchResultItem } from "./types"
import { canonicalizeURL, hostnameOf, MAX_RESULTS_PER_QUERY } from "./types"

// ------------------------------------------------------------------
// Parse MCP search text → structured items
// ------------------------------------------------------------------

interface ExaResult { title?: string; url?: string; text?: string; snippet?: string; publishedDate?: string }
const ExaJson = Schema.Struct({
  results: Schema.optional(
    Schema.Array(Schema.Struct({
      title: Schema.optional(Schema.String),
      url: Schema.optional(Schema.String),
      text: Schema.optional(Schema.String),
      snippet: Schema.optional(Schema.String),
      publishedDate: Schema.optional(Schema.String),
    })),
  ),
})

function parseExaText(raw: string): SearchResultItem[] {
  const trimmed = raw.trim()
  const json = trimmed.startsWith("[") || trimmed.startsWith("{")
    ? trimmed
    : [...trimmed.split("\n")].reverse().find((line) => line.trimStart().startsWith("{") || line.trimStart().startsWith("[")) ?? ""
  if (!json) return extractItemsFromLines(raw)
  try {
    const parsed = JSON.parse(json)
    const decoded = Option.getOrElse(Schema.decodeUnknownOption(ExaJson)(parsed), () => ({ results: [] }))
    const results = decoded.results ?? []
    if (results.length === 0) return extractItemsFromLines(raw)
    return results.map((item) => ({
      title: item.title ?? "",
      url: item.url ?? "",
      snippet: item.snippet ?? item.text?.slice(0, 300) ?? "",
      published: item.publishedDate,
    })).filter((item) => item.url)
  } catch {
    return extractItemsFromLines(raw)
  }
}

function extractItemsFromLines(text: string): SearchResultItem[] {
  const items: SearchResultItem[] = []
  let current: Partial<SearchResultItem> | null = null
  for (const line of text.split("\n")) {
    const urlMatch = line.match(/\bhttps?:\/\/[^\s)>\]]+/)
    if (urlMatch) {
      if (current?.url) items.push({ title: current.title ?? "", url: current.url, snippet: current.snippet ?? "" })
      current = { url: urlMatch[0], title: line.replace(urlMatch[0], "").replace(/^[#\-*:.\s]+/, "").trim() }
    } else if (current) {
      current.snippet = (current.snippet ? current.snippet + " " : "") + line.trim()
    }
  }
  if (current?.url) items.push({ title: current.title ?? "", url: current.url, snippet: current.snippet ?? "" })
  return items
}

function parseParallelText(raw: string): SearchResultItem[] {
  const cleaned = raw.replace(/```json\n?|```\n?/g, "")
  try {
    const parsed = JSON.parse(cleaned)
    if (Array.isArray(parsed)) {
      return parsed.map((item: Record<string, unknown>) => ({
        title: (item.title as string) ?? (item.name as string) ?? "",
        url: (item.url as string) ?? (item.link as string) ?? "",
        snippet: (item.snippet as string) ?? (item.text as string) ?? "",
        published: item.publishedDate as string | undefined,
      })).filter((i) => i.url)
    }
  } catch { /* fall through */ }
  return extractItemsFromLines(cleaned)
}

// ------------------------------------------------------------------
// HTTP Post MCP helper (thin, internal)
// ------------------------------------------------------------------

const mcpPost = <F extends Schema.Struct.Fields>(
  http: HttpClient.HttpClient,
  url: string,
  tool: string,
  args: Schema.Struct<F>,
  value: Schema.Struct.Type<F>,
  headers: Record<string, string> = {},
) =>
  Effect.gen(function* () {
    const request = yield* HttpClientRequest.post(url).pipe(
      HttpClientRequest.accept("application/json, text/event-stream"),
      HttpClientRequest.setHeaders(headers),
      HttpClientRequest.schemaBodyJson(McpRequest(args))({
        jsonrpc: "2.0" as const,
        id: 1 as const,
        method: "tools/call" as const,
        params: { name: tool, arguments: value },
      }),
    )
    const response = yield* HttpClient.filterStatusOk(http).execute(request)
    const body = yield* collectBoundedResponseBody(
      response,
      MAX_RESPONSE_BYTES,
      () => new Error(`${tool} response exceeded ${MAX_RESPONSE_BYTES} bytes`),
    )
    const text = yield* parseResponse(body.toString("utf8"))
    return text ?? ""
  }).pipe(Effect.timeoutOrElse({ duration: Duration.seconds(20), orElse: () => Effect.fail(new Error("search timed out")) }))

// ------------------------------------------------------------------
// Per-query, per-provider search
// ------------------------------------------------------------------

function searchExa(
  http: HttpClient.HttpClient,
  apiKey: string | undefined,
  sessionID: string,
  query: string,
  numResults: number,
): Effect.Effect<SearchResultItem[], Error> {
  return mcpPost(http, exaUrl(apiKey), "web_search_exa", ExaArgs, {
    query,
    type: "auto",
    numResults,
    livecrawl: "fallback",
  }).pipe(
    Effect.map(parseExaText),
    Effect.catchIf(
      (error): error is Error => error instanceof Error,
      () => Effect.succeed([]),
    ),
  )
}

function searchParallel(
  http: HttpClient.HttpClient,
  apiKey: string | undefined,
  sessionID: string,
  query: string,
): Effect.Effect<SearchResultItem[], Error> {
  return mcpPost(http, PARALLEL_URL, "web_search", ParallelArgs, {
    objective: query,
    search_queries: [query],
    session_id: sessionID,
  }, {
    "User-Agent": `argus/${InstallationVersion}`,
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  }).pipe(
    Effect.map(parseParallelText),
    Effect.catchIf(
      (error): error is Error => error instanceof Error,
      () => Effect.succeed([]),
    ),
  )
}

// ------------------------------------------------------------------
// Unified search API
// ------------------------------------------------------------------

const URL_RE = /^https?:\/\/.+/i

function isURL(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return URL_RE.test(value)
  }
}

export function search(
  http: HttpClient.HttpClient,
  config: ResearchConfig,
  queries: string[],
  sessionID: string,
  maxResultsPerQuery: number = MAX_RESULTS_PER_QUERY,
): Effect.Effect<SearchResultItem[], never, never> {
  const items = queries.flatMap((query) => {
    const providers: Array<Effect.Effect<SearchResultItem[], Error>> = []
    if (config.enableExa || config.provider === "exa" || (!config.enableParallel && !config.provider))
      providers.push(searchExa(http, config.exaApiKey, sessionID, query, maxResultsPerQuery))
    if (config.enableParallel || config.provider === "parallel")
      providers.push(searchParallel(http, config.parallelApiKey, sessionID, query))
    return providers.map((provider) =>
      provider.pipe(
        Effect.catchIf(
          (error): error is Error => error instanceof Error,
          () => Effect.succeed([]),
        ),
      ),
    )
  })
  return Effect.forEach(items, (i) => i, { concurrency: 20, discard: false }).pipe(
    Effect.map((resultSets) => {
      const seen = new Set<string>()
      const deduped: SearchResultItem[] = []
      for (const results of resultSets) {
        for (const item of results) {
          if (!item.url || !isURL(item.url)) continue
          const canonical = canonicalizeURL(item.url)
          if (seen.has(canonical)) continue
          seen.add(canonical)
          deduped.push(item)
        }
      }
      return deduped
    }),
  )
}