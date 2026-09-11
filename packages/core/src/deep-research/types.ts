export * as DeepResearch from "./types"

import { Schema } from "effect"

export const MAX_QUERIES = 12
export const MAX_RESULTS_PER_QUERY = 8
export const MAX_TOTAL_FETCHES = 24
export const MAX_FETCH_CONCURRENCY = 6
export const MAX_CONTENT_BYTES = 4 * 1024 * 1024
export const DEFAULT_TIMEOUT_SECONDS = 20

export const SourceType = Schema.Literals(["official", "paper", "github", "blog", "forum", "seo", "unknown"])
export type SourceType = Schema.Schema.Type<typeof SourceType>

export const Source = Schema.Struct({
  rank: Schema.Number,
  title: Schema.String,
  url: Schema.String,
  domain: Schema.String,
  sourceType: SourceType,
  score: Schema.Number,
  snippet: Schema.String,
})
export type Source = Schema.Schema.Type<typeof Source>

export const Evidence = Schema.Struct({
  sourceURL: Schema.String,
  sourceIndex: Schema.Number,
  heading: Schema.String,
  passage: Schema.String,
  claims: Schema.optional(Schema.Array(Schema.String)),
  code: Schema.optional(Schema.Array(Schema.String)),
  tables: Schema.optional(Schema.Array(Schema.String)),
  references: Schema.optional(Schema.Array(Schema.String)),
  freshness: Schema.optional(Schema.String),
})
export type Evidence = Schema.Schema.Type<typeof Evidence>

export const ResearchRound = Schema.Struct({
  depth: Schema.Number,
  queries: Schema.Array(Schema.String),
})
export type ResearchRound = Schema.Schema.Type<typeof ResearchRound>

export const Output = Schema.Struct({
  goal: Schema.String,
  rounds: Schema.Array(ResearchRound),
  sources: Schema.Array(Source),
  evidence: Schema.Array(Evidence),
  notes: Schema.Array(Schema.String),
})
export type Output = Schema.Schema.Type<typeof Output>

export interface SearchResultItem {
  title: string
  url: string
  snippet: string
  published?: string
}

export interface FetchedPage {
  url: string
  canonicalURL: string
  domain: string
  title: string
  contentType: string
  markdown: string
  fetchedAt: number
}

/**
 * Normalizes a URL to a canonical identity string used for deduplication.
 * Strips fragments, common tracking parameters, default ports, trailing slash,
 * and (scheme-agnostic) `www.`.
 */
export function canonicalizeURL(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return raw.trim()
  }
  url.hash = ""
  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase()
    if (
      lower.startsWith("utm_") ||
      lower === "ref" ||
      lower === "source" ||
      lower === "mc_cid" ||
      lower === "mc_eid" ||
      lower === "fbclid" ||
      lower === "gclid" ||
      lower === "igshid"
    ) {
      url.searchParams.delete(key)
    }
  }
  const [host] = url.host.split(":")
  url.host = host === "www" ? url.hostname : host!.replace(/^www\./, "")
  if (url.pathname.replace(/\//g, "") === "" && url.search === "") url.pathname = "/"
  else if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "")
  return url.toString()
}

/** Extracts a stable hostname for a canonicalized URL. */
export function hostnameOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, "").toLowerCase()
  } catch {
    return ""
  }
}

export interface DomainBudget {
  readonly maxPerDomain: number
  readonly delayMs: number
}

export interface ResearchConfig {
  readonly provider?: "exa" | "parallel"
  readonly enableExa: boolean
  readonly enableParallel: boolean
  readonly exaApiKey?: string
  readonly parallelApiKey?: string
  readonly maxQueries: number
  readonly maxResultsPerQuery: number
  readonly maxTotalFetches: number
  readonly fetchConcurrency: number
  readonly timeoutSeconds: number
  readonly pageCacheMs: number
  readonly domainBudget: DomainBudget
  readonly maxDepth: number
  readonly minRelevanceScore: number
}

export function normalizeConfig(
  config: Partial<ResearchConfig>,
): ResearchConfig {
  return {
    enableExa: config.enableExa ?? true,
    enableParallel: config.enableParallel ?? false,
    exaApiKey: config.exaApiKey,
    parallelApiKey: config.parallelApiKey,
    maxQueries: config.maxQueries ?? MAX_QUERIES,
    maxResultsPerQuery: config.maxResultsPerQuery ?? MAX_RESULTS_PER_QUERY,
    maxTotalFetches: config.maxTotalFetches ?? MAX_TOTAL_FETCHES,
    fetchConcurrency: config.fetchConcurrency ?? MAX_FETCH_CONCURRENCY,
    timeoutSeconds: config.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
    pageCacheMs: config.pageCacheMs ?? 10 * 60 * 1000,
    domainBudget: config.domainBudget ?? { maxPerDomain: 3, delayMs: 250 },
    maxDepth: config.maxDepth ?? 2,
    minRelevanceScore: config.minRelevanceScore ?? 0.3,
  }
}