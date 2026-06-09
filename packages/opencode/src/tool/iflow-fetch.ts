import { Effect } from "effect"
import { HttpClient } from "effect/unstable/http"
import { objectValue, postJson, stringValue } from "./iflow-client"

export const IFLOW_FETCH_MISSING_KEY = "IFLOW_API_KEY is required when OPENCODE_WEBFETCH_PROVIDER=iflow."

export const fetch = (http: HttpClient.HttpClient, params: { url: string }) =>
  Effect.gen(function* () {
    const data = yield* postJson(
      http,
      "/api/search/webFetch",
      { url: params.url },
      IFLOW_FETCH_MISSING_KEY,
      "30 seconds",
    )
    return formatFetchResult(data, params.url)
  })

export function formatFetchResult(data: Record<string, unknown>, fallbackURL: string) {
  const source = findFetchData(data)
  const title = stringValue(source.title)
  const url = stringValue(source.url) ?? fallbackURL
  const content =
    stringValue(source.markdown) ??
    stringValue(source.content) ??
    stringValue(source.text) ??
    stringValue(source.raw_content) ??
    stringValue(source.rawContent)

  return [
    title ? `Title: ${title}` : undefined,
    `URL: ${url}`,
    content ? `Content:\n${content}` : "Content:\nNo content returned.",
  ]
    .filter(Boolean)
    .join("\n")
}

function findFetchData(data: Record<string, unknown>) {
  const candidates = [
    data.data,
    data.result,
    objectValue(data.data)?.result,
    objectValue(data.data)?.page,
    objectValue(data.data)?.document,
  ]

  for (const candidate of candidates) {
    const object = objectValue(candidate)
    if (object) return object
  }

  return data
}
