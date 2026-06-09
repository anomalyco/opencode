import { Effect } from "effect"
import { HttpClient } from "effect/unstable/http"
import { arrayValue, numberValue, objectValue, postJson, stringValue } from "./iflow-client"

export const IFLOW_SEARCH_MISSING_KEY = "IFLOW_API_KEY is required when OPENCODE_WEBSEARCH_PROVIDER=iflow."

export const search = (http: HttpClient.HttpClient, params: { query: string; count?: number }) =>
  Effect.gen(function* () {
    const count = normalizeCount(params.count)
    const data = yield* postJson(
      http,
      "/api/search/webSearch",
      { keywords: params.query, ...(count ? { num: count } : {}) },
      IFLOW_SEARCH_MISSING_KEY,
      "25 seconds",
    )
    return formatSearchResults(data)
  })

export function normalizeCount(count: unknown) {
  const value = numberValue(count)
  if (!value) return undefined
  return Math.min(Math.max(Math.trunc(value), 1), 20)
}

export function formatSearchResults(data: Record<string, unknown>) {
  const results = findResults(data)
  if (!results.length) return "No search results found. Please try a different query."

  return results
    .map((item, index) => {
      const title = stringValue(item.title) ?? stringValue(item.name) ?? "Untitled"
      const url = stringValue(item.url) ?? stringValue(item.link)
      const snippet = stringValue(item.snippet) ?? stringValue(item.content) ?? stringValue(item.summary)
      const published = stringValue(item.published_time) ?? stringValue(item.publishedTime)
      const source = stringValue(item.source)

      return [
        `${index + 1}. ${title}`,
        url ? `URL: ${url}` : undefined,
        snippet ? `Snippet: ${snippet}` : undefined,
        published ? `Published: ${published}` : undefined,
        source ? `Source: ${source}` : undefined,
      ]
        .filter(Boolean)
        .join("\n")
    })
    .join("\n\n")
}

function findResults(data: Record<string, unknown>) {
  const candidates = [
    data.results,
    data.webPages,
    data.list,
    data.items,
    objectValue(data.data)?.results,
    objectValue(data.data)?.organic,
    objectValue(data.data)?.webPages,
    objectValue(data.data)?.list,
    objectValue(data.data)?.items,
    objectValue(objectValue(data.data)?.webPages)?.value,
  ]

  for (const candidate of candidates) {
    const results = arrayValue(candidate)?.map(objectValue).filter((item): item is Record<string, unknown> => !!item)
    if (results?.length) return results
  }

  const single = objectValue(data.data)
  return single && (single.title || single.url || single.link) ? [single] : []
}
