import { Option, Schema } from "effect"
import type { RequestSnapshot } from "./schema"

const JsonValue = Schema.fromJsonString(Schema.Unknown)
export const decodeJson = Schema.decodeUnknownOption(JsonValue)

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .toSorted()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
    )
  }
  return value
}

export type RequestMatcher = (incoming: RequestSnapshot, recorded: RequestSnapshot) => boolean

export const canonicalSnapshot = (snapshot: RequestSnapshot): string =>
  JSON.stringify({
    method: snapshot.method,
    url: snapshot.url,
    headers: canonicalize(snapshot.headers),
    body: Option.match(decodeJson(snapshot.body), {
      onNone: () => snapshot.body,
      onSome: canonicalize,
    }),
  })

export const defaultMatcher: RequestMatcher = (incoming, recorded) =>
  canonicalSnapshot(incoming) === canonicalSnapshot(recorded)
