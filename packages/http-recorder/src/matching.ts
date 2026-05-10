import { Option, Schema } from "effect"
import { REDACTED, secretFindings } from "./redaction"
import type { HttpInteraction, RequestSnapshot } from "./schema"

const JsonValue = Schema.fromJsonString(Schema.Unknown)
export const decodeJson = Schema.decodeUnknownOption(JsonValue)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

export const canonicalizeJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .toSorted()
        .map((key) => [key, canonicalizeJson(value[key])]),
    )
  }
  return value
}

export type RequestMatcher = (incoming: RequestSnapshot, recorded: RequestSnapshot) => boolean

export const canonicalSnapshot = (snapshot: RequestSnapshot): string =>
  JSON.stringify({
    method: snapshot.method,
    url: snapshot.url,
    headers: canonicalizeJson(snapshot.headers),
    body: Option.match(decodeJson(snapshot.body), {
      onNone: () => snapshot.body,
      onSome: canonicalizeJson,
    }),
  })

export const defaultMatcher: RequestMatcher = (incoming, recorded) =>
  canonicalSnapshot(incoming) === canonicalSnapshot(recorded)

const safeText = (value: unknown) => {
  if (value === undefined) return "undefined"
  if (secretFindings(value).length > 0) return JSON.stringify(REDACTED)
  const text = JSON.stringify(value)
  if (!text) return String(value)
  return text.length > 300 ? `${text.slice(0, 300)}...` : text
}

const jsonBody = (body: string) => Option.getOrUndefined(decodeJson(body))

const valueDiffs = (expected: unknown, received: unknown, base = "$", limit = 8): ReadonlyArray<string> => {
  if (Object.is(expected, received)) return []
  if (isRecord(expected) && isRecord(received)) {
    return [...new Set([...Object.keys(expected), ...Object.keys(received)])]
      .toSorted()
      .flatMap((key) => valueDiffs(expected[key], received[key], `${base}.${key}`, limit))
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

export const requestDiff = (expected: RequestSnapshot, received: RequestSnapshot): ReadonlyArray<string> => {
  const lines: string[] = []
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

export const mismatchDetail = (interactions: ReadonlyArray<HttpInteraction>, incoming: RequestSnapshot): string => {
  if (interactions.length === 0) return "cassette has no recorded HTTP interactions"
  const ranked = interactions
    .map((interaction, index) => ({ index, lines: requestDiff(interaction.request, incoming) }))
    .toSorted((a, b) => a.lines.length - b.lines.length || a.index - b.index)
  const best = ranked[0]
  return ["no recorded interaction matched", `closest interaction: #${best.index + 1}`, ...best.lines].join("\n")
}

export const selectMatch = (
  interactions: ReadonlyArray<HttpInteraction>,
  incoming: RequestSnapshot,
  match: RequestMatcher,
): { readonly interaction: HttpInteraction | undefined; readonly detail: string } => {
  const interaction = interactions.find((candidate) => match(incoming, candidate.request))
  return { interaction, detail: interaction ? "" : mismatchDetail(interactions, incoming) }
}

export const selectSequential = (
  interactions: ReadonlyArray<HttpInteraction>,
  incoming: RequestSnapshot,
  match: RequestMatcher,
  index: number,
): { readonly interaction: HttpInteraction | undefined; readonly detail: string } => {
  const interaction = interactions[index]
  if (!interaction) return { interaction, detail: `interaction ${index + 1} of ${interactions.length} not recorded` }
  if (!match(incoming, interaction.request))
    return { interaction: undefined, detail: requestDiff(interaction.request, incoming).join("\n") }
  return { interaction, detail: "" }
}
