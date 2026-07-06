import { HashSet, Option } from "effect"
import type { RequestMatcher, RequestSnapshot } from "../api.js"
import { canonicalizeJson, decodeJson, isJsonRecord, jsonBody, safeText } from "../replay/comparison.js"
import type { HttpInteraction } from "./model.js"

export type { RequestMatcher } from "../api.js"

export const canonicalSnapshot = (snapshot: RequestSnapshot): string =>
  JSON.stringify({
    method: snapshot.method,
    url: snapshot.url,
    headers: canonicalizeJson(snapshot.headers),
    body: Option.match(decodeJson(snapshot.body), { onNone: () => snapshot.body, onSome: canonicalizeJson }),
  })
export const defaultMatcher: RequestMatcher = (incoming, recorded) =>
  canonicalSnapshot(incoming) === canonicalSnapshot(recorded)

const valueDiffs = (expected: unknown, received: unknown, base = "$", limit = 8): ReadonlyArray<string> => {
  if (Object.is(expected, received)) return []
  if (isJsonRecord(expected) && isJsonRecord(received))
    return [...new Set([...Object.keys(expected), ...Object.keys(received)])]
      .toSorted()
      .flatMap((key) => valueDiffs(expected[key], received[key], `${base}.${key}`, limit))
      .slice(0, limit)
  if (Array.isArray(expected) && Array.isArray(received))
    return Array.from({ length: Math.max(expected.length, received.length) }, (_, index) => index)
      .flatMap((index) => valueDiffs(expected[index], received[index], `${base}[${index}]`, limit))
      .slice(0, limit)
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
  if (expected.method !== received.method)
    lines.push("method:", `  expected ${expected.method}, received ${received.method}`)
  if (expected.url !== received.url) lines.push("url:", `  expected ${expected.url}`, `  received ${received.url}`)
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

export const selectFirstMatching = (
  interactions: ReadonlyArray<HttpInteraction>,
  incoming: RequestSnapshot,
  match: RequestMatcher,
  used: HashSet.HashSet<number>,
): { readonly _tag: "Matched"; readonly index: number } | { readonly _tag: "Unmatched"; readonly detail: string } => {
  let firstUnused: HttpInteraction | undefined
  for (let index = 0; index < interactions.length; index++) {
    if (HashSet.has(used, index)) continue
    const interaction = interactions[index]
    firstUnused ??= interaction
    if (match(incoming, interaction.request)) return { _tag: "Matched", index }
  }
  if (firstUnused === undefined)
    return { _tag: "Unmatched", detail: `all ${interactions.length} recorded interactions have already been consumed` }
  return { _tag: "Unmatched", detail: requestDiff(firstUnused.request, incoming).join("\n") }
}

export * as HttpMatching from "./matching.js"
