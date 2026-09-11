export * as FetchLayer from "./fetch"

import { Duration, Effect } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Option } from "effect"
import { collectBoundedResponseBody } from "../tool/http-body"
import { convertHTMLToMarkdown, extractTextFromHTML } from "../tool/webfetch"
import type { FetchedPage, ResearchConfig } from "./types"
import { canonicalizeURL, hostnameOf, MAX_CONTENT_BYTES } from "./types"

export type { FetchedPage } from "./types"

// ------------------------------------------------------------------
// MIME helpers
// ------------------------------------------------------------------

const mimeFrom = (contentType: string) => contentType.split(";", 1)[0]?.trim().toLowerCase() ?? ""

const ACCEPTED_TYPES = new Set([
  "text/html",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/x-markdown",
  "application/json",
  "application/xml",
  "text/xml",
  "application/xhtml+xml",
])

const isAcceptedMime = (mime: string) => !mime || ACCEPTED_TYPES.has(mime) || mime.startsWith("text/")

function titleFromHTML(html: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  return match ? match[1].trim().slice(0, 200) : ""
}

function bodyMarkdown(html: string): string {
  try { return convertHTMLToMarkdown(html) } catch { return extractTextFromHTML(html) }
}

// ------------------------------------------------------------------
// Domain throttling map
// ------------------------------------------------------------------

interface DomainState {
  lastFetch: number
  count: number
}

const domainStates = new Map<string, DomainState>()

function domainKey(domain: string): string {
  return domain.replace(/^www\./, "")
}

function acquireDomainPermit(domain: string, budget: { maxPerDomain: number; delayMs: number }): boolean {
  const key = domainKey(domain)
  const now = Date.now()
  const state = domainStates.get(key)
  if (!state) {
    domainStates.set(key, { lastFetch: now, count: 1 })
    return true
  }
  if (state.count >= budget.maxPerDomain) return false
  if (now - state.lastFetch < budget.delayMs) return false
  state.lastFetch = now
  state.count++
  return true
}

// ------------------------------------------------------------------
// Page cache
// ------------------------------------------------------------------

const pageCache = new Map<string, FetchedPage>()

function cachedPage(canonical: string, config: ResearchConfig): FetchedPage | null {
  const entry = pageCache.get(canonical)
  if (!entry) return null
  if (Date.now() - entry.fetchedAt > config.pageCacheMs) {
    pageCache.delete(canonical)
    return null
  }
  return entry
}

function storePage(page: FetchedPage, config: ResearchConfig): FetchedPage {
  if (pageCache.size > 500) {
    const oldest = [...pageCache.keys()].slice(0, 100)
    for (const key of oldest) pageCache.delete(key)
  }
  pageCache.set(page.canonicalURL, page)
  return page
}

// ------------------------------------------------------------------
// Single-page fetch
// ------------------------------------------------------------------

const browserUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"

const isCloudflareChallenge = (error: unknown) => {
  if (!error || typeof error !== "object" || !("reason" in error)) return false
  const reason = (error as Record<string, unknown>).reason as Record<string, unknown> | undefined
  if (!reason || reason._tag !== "StatusCodeError" || !("response" in reason)) return false
  const response = reason.response as HttpClientResponse.HttpClientResponse
  return response.status === 403 && response.headers["cf-mitigated"] === "challenge"
}

function fetchOne(
  http: HttpClient.HttpClient,
  url: string,
  timeoutSeconds: number,
): Effect.Effect<FetchedPage, Error> {
  return Effect.gen(function* () {
    const assertValidURL = Effect.try({
      try: () => { const u = new URL(url); if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error() },
      catch: () => new Error(`Invalid URL: ${url}`),
    })
    yield* assertValidURL

    const doFetch = (userAgent: string) =>
      Effect.gen(function* () {
        const request = HttpClientRequest.get(url).pipe(
          HttpClientRequest.setHeaders({
            "User-Agent": userAgent,
            Accept: "text/html;q=1.0, text/plain;q=0.8, text/markdown;q=0.7, application/json;q=0.5, */*;q=0.1",
            "Accept-Language": "en-US,en;q=0.9",
          }),
        )
        const response = yield* HttpClient.filterStatusOk(http).execute(request)
        const contentType = response.headers["content-type"] || ""
        const mime = mimeFrom(contentType)
        if (!isAcceptedMime(mime)) return yield* Effect.fail(new Error(`Unsupported content type: ${mime}`))
        const body = yield* collectBoundedResponseBody(
          response,
          MAX_CONTENT_BYTES,
          () => new Error(`Page too large (>${MAX_CONTENT_BYTES} bytes)`),
        )
        return { contentType, body: new TextDecoder().decode(body) }
      })

    const { contentType, body } = yield* doFetch(browserUserAgent).pipe(
      Effect.catchIf(isCloudflareChallenge, () => doFetch("argus")),
    )
    const canonical = canonicalizeURL(url)
    const domain = hostnameOf(url)

    let markdown = ""
    let title = ""
    if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
      title = titleFromHTML(body)
      markdown = bodyMarkdown(body)
    } else if (contentType.includes("application/json") || contentType.endsWith("+json")) {
      try {
        const pretty = JSON.stringify(JSON.parse(body), null, 2)
        markdown = "```json\n" + pretty + "\n```"
        title = title || "JSON document"
      } catch {
        markdown = body
        title = title || "JSON (unparseable)"
      }
    } else if (contentType.includes("application/xml") || contentType.endsWith("+xml")) {
      markdown = extractTextFromHTML(body) // XML is often parseable via htmlparser2
      title = title || "XML document"
    } else {
      markdown = body
      title = title || body.slice(0, 80)
    }

    return {
      url,
      canonicalURL: canonical,
      domain,
      title,
      contentType,
      markdown: markdown.slice(0, MAX_CONTENT_BYTES),
      fetchedAt: Date.now(),
    }
  }).pipe(
    Effect.timeoutOrElse({
      duration: Duration.seconds(timeoutSeconds),
      orElse: () => Effect.fail(new Error(`Fetch timeout: ${url}`)),
    }),
  )
}

// ------------------------------------------------------------------
// Parallel batch fetch
// ------------------------------------------------------------------

export function fetchPages(
  http: HttpClient.HttpClient,
  urls: string[],
  config: ResearchConfig,
): Effect.Effect<FetchedPage[], never> {
  const cached: FetchedPage[] = []
  const toFetch: string[] = []
  for (const raw of urls) {
    const canonical = canonicalizeURL(raw)
    const entry = cachedPage(canonical, config)
    if (entry) { cached.push(entry); continue }
    if (!toFetch.includes(raw)) toFetch.push(raw)
  }

  const budget = { maxPerDomain: config.domainBudget.maxPerDomain, delayMs: config.domainBudget.delayMs }
  const eligible = toFetch.filter((raw) => acquireDomainPermit(hostnameOf(raw), budget))

  const run = Effect.forEach(
    eligible,
    (url) =>
      fetchOne(http, url, config.timeoutSeconds).pipe(
        Effect.catchIf(
          (error): error is Error => error instanceof Error,
          () => Effect.succeed(null),
        ),
      ),
    { concurrency: config.fetchConcurrency },
  )
  return Effect.map(run, (fetched) => [
    ...cached,
    ...fetched.filter((page): page is FetchedPage => page !== null).map((page) => storePage(page, config)),
  ])
}