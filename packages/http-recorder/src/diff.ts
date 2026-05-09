import { Option } from "effect"
import { Headers, HttpBody, HttpClientRequest, UrlParams } from "effect/unstable/http"
import { decodeJson } from "./matching"
import { REDACTED, redactUrl, secretFindings } from "./redaction"
import { httpInteractions, type Cassette, type RequestSnapshot } from "./schema"

const safeText = (value: unknown) => {
  if (value === undefined) return "undefined"
  if (secretFindings(value).length > 0) return JSON.stringify(REDACTED)
  const text = typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value)
  if (!text) return String(value)
  return text.length > 300 ? `${text.slice(0, 300)}...` : text
}

const jsonBody = (body: string) => Option.getOrUndefined(decodeJson(body))

const valueDiffs = (expected: unknown, received: unknown, base = "$", limit = 8): ReadonlyArray<string> => {
  if (Object.is(expected, received)) return []
  if (
    expected &&
    received &&
    typeof expected === "object" &&
    typeof received === "object" &&
    !Array.isArray(expected) &&
    !Array.isArray(received)
  ) {
    return [...new Set([...Object.keys(expected), ...Object.keys(received)])]
      .toSorted()
      .flatMap((key) =>
        valueDiffs(
          (expected as Record<string, unknown>)[key],
          (received as Record<string, unknown>)[key],
          `${base}.${key}`,
          limit,
        ),
      )
      .slice(0, limit)
  }
  if (Array.isArray(expected) && Array.isArray(received)) {
    return Array.from({ length: Math.max(expected.length, received.length) }, (_, index) => index)
      .flatMap((index) => valueDiffs(expected[index], received[index], `${base}[${index}]`, limit))
      .slice(0, limit)
  }
  return [`${base} expected ${safeText(expected)}, received ${safeText(received)}`]
}

const headerDiffs = (expected: Record<string, string>, received: Record<string, string>) =>
  [...new Set([...Object.keys(expected), ...Object.keys(received)])].toSorted().flatMap((key) => {
    if (expected[key] === received[key]) return []
    if (expected[key] === undefined) return [`  ${key} unexpected ${safeText(received[key])}`]
    if (received[key] === undefined) return [`  ${key} missing expected ${safeText(expected[key])}`]
    return [`  ${key} expected ${safeText(expected[key])}, received ${safeText(received[key])}`]
  })

export const requestDiff = (expected: RequestSnapshot, received: RequestSnapshot) => {
  const lines = []
  if (expected.method !== received.method) {
    lines.push("method:", `  expected ${expected.method}, received ${received.method}`)
  }
  if (expected.url !== received.url) {
    lines.push("url:", `  expected ${expected.url}`, `  received ${received.url}`)
  }
  const headers = headerDiffs(expected.headers, received.headers)
  if (headers.length > 0) lines.push("headers:", ...headers.slice(0, 8))
  const expectedBody = jsonBody(expected.body)
  const receivedBody = jsonBody(received.body)
  const body =
    expectedBody !== undefined && receivedBody !== undefined
      ? valueDiffs(expectedBody, receivedBody).map((line) => `  ${line}`)
      : expected.body === received.body
        ? []
        : [`  expected ${safeText(expected.body)}, received ${safeText(received.body)}`]
  if (body.length > 0) lines.push("body:", ...body)
  return lines
}

export const mismatchDetail = (cassette: Cassette, incoming: RequestSnapshot) => {
  const interactions = httpInteractions(cassette)
  if (interactions.length === 0) return "cassette has no recorded HTTP interactions"
  const ranked = interactions
    .map((interaction, index) => ({ index, lines: requestDiff(interaction.request, incoming) }))
    .toSorted((a, b) => a.lines.length - b.lines.length || a.index - b.index)
  const best = ranked[0]
  return ["no recorded interaction matched", `closest interaction: #${best.index + 1}`, ...best.lines].join("\n")
}

export const redactedErrorRequest = (request: HttpClientRequest.HttpClientRequest) =>
  HttpClientRequest.makeWith(
    request.method,
    redactUrl(request.url),
    UrlParams.empty,
    Option.none(),
    Headers.empty,
    HttpBody.empty,
  )
