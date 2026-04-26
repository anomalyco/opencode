import { NodeFileSystem } from "@effect/platform-node"
import { Effect, FileSystem, Layer, Option, Ref, Schema } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = path.resolve(__dirname, "fixtures", "recordings")

const RequestSnapshot = Schema.Struct({
  method: Schema.String,
  url: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.String,
})
type RequestSnapshot = Schema.Schema.Type<typeof RequestSnapshot>

const ResponseSnapshot = Schema.Struct({
  status: Schema.Number,
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.String,
  // Most provider responses are text (SSE, JSON). AWS Bedrock streams are
  // binary AWS event-stream frames whose CRC32 fields would mangle through a
  // UTF-8 round-trip — store those as base64. Older cassettes omit this field
  // and decode as text by default.
  bodyEncoding: Schema.optional(Schema.Literals(["text", "base64"])),
})

const Interaction = Schema.Struct({
  request: RequestSnapshot,
  response: ResponseSnapshot,
})
type Interaction = Schema.Schema.Type<typeof Interaction>

const Cassette = Schema.Struct({
  version: Schema.Literal(1),
  interactions: Schema.Array(Interaction),
})

const decodeCassette = Schema.decodeUnknownSync(Cassette)
const encodeCassette = Schema.encodeSync(Cassette)

const JsonValue = Schema.fromJsonString(Schema.Unknown)
const decodeJson = Schema.decodeUnknownOption(JsonValue)

const isRecordMode = process.env.RECORD === "true"

const fixturePath = (name: string) => path.join(FIXTURES_DIR, `${name}.json`)

/**
 * Default request header allow-list. Provider adapters with custom auth
 * (Anthropic `x-api-key`, Bedrock SigV4, etc.) should extend this via the
 * `requestHeaders` option so cassette matching uses the right keys.
 */
export const DEFAULT_REQUEST_HEADERS: ReadonlyArray<string> = [
  "content-type",
  "accept",
  "openai-beta",
]

const DEFAULT_RESPONSE_HEADERS: ReadonlyArray<string> = ["content-type"]

export interface RecordReplayOptions {
  /**
   * Lower-cased request header names that participate in cassette matching and
   * are persisted to disk. Anything not in this list is dropped.
   */
  readonly requestHeaders?: ReadonlyArray<string>
  /**
   * Lower-cased response header names persisted to disk. Defaults to
   * `content-type` only. Add `x-request-id`, rate-limit headers, etc. when a
   * test depends on them.
   */
  readonly responseHeaders?: ReadonlyArray<string>
  /**
   * Hook to redact secrets from request bodies before they are written. Runs
   * on the parsed JSON value when the body decodes as JSON; non-JSON bodies
   * pass through untouched.
   */
  readonly redactBody?: (body: unknown) => unknown
  /**
   * Custom request matcher. Defaults to `defaultMatcher`, which compares
   * method, url, structurally-canonical JSON body, and the allow-listed
   * headers against any recorded interaction. Use `sequentialMatcher` for
   * multi-interaction cassettes where two requests in a row may be
   * structurally identical (retry / repeated polling) and should map to
   * recorded responses by position.
   */
  readonly match?: RequestMatcher
}

export type RequestMatcher = (incoming: RequestSnapshot, recorded: RequestSnapshot) => boolean

/**
 * Sort object keys recursively so two semantically equal JSON values produce
 * the same string. Arrays preserve order — provider request bodies care about
 * `messages` ordering.
 */
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

const canonicalSnapshot = (snapshot: RequestSnapshot): string =>
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

/**
 * Sentinel matcher that signals position-based dispatch. The replay layer
 * detects this matcher by reference identity and consumes interactions in
 * recorded order, regardless of whether two requests produce the same
 * canonical snapshot. Use for retries or repeated polling that expect
 * different responses to identical requests.
 */
export const sequentialMatcher: RequestMatcher = () => true

const lowerHeaders = (headers: Record<string, string>, allow: ReadonlyArray<string>) => {
  const allowed = new Set(allow.map((name) => name.toLowerCase()))
  return Object.fromEntries(
    Object.entries(headers)
      .map(([name, value]) => [name.toLowerCase(), value] as const)
      .filter(([name]) => allowed.has(name))
      .toSorted(([a], [b]) => a.localeCompare(b)),
  )
}

const responseHeaders = (
  response: HttpClientResponse.HttpClientResponse,
  allow: ReadonlyArray<string>,
) => {
  const merged = lowerHeaders(response.headers as Record<string, string>, allow)
  if (!merged["content-type"]) merged["content-type"] = "text/event-stream"
  return merged
}

// Content types whose payloads are binary frames or arbitrary bytes — they
// would not survive a UTF-8 text round-trip. The list intentionally matches
// the substrings that appear in `Content-Type` headers, not full values.
const BINARY_CONTENT_TYPES: ReadonlyArray<string> = [
  "vnd.amazon.eventstream",
  "octet-stream",
]

const isBinaryContentType = (contentType: string | undefined) => {
  if (!contentType) return false
  const lower = contentType.toLowerCase()
  return BINARY_CONTENT_TYPES.some((token) => lower.includes(token))
}

const captureResponseBody = (
  response: HttpClientResponse.HttpClientResponse,
  contentType: string | undefined,
) =>
  Effect.gen(function* () {
    if (!isBinaryContentType(contentType)) {
      const text = yield* response.text
      return { body: text, bodyEncoding: undefined as "text" | "base64" | undefined }
    }
    const bytes = yield* response.arrayBuffer
    return { body: Buffer.from(bytes).toString("base64"), bodyEncoding: "base64" as const }
  })

const decodeResponseBody = (snapshot: Schema.Schema.Type<typeof ResponseSnapshot>) =>
  snapshot.bodyEncoding === "base64" ? Buffer.from(snapshot.body, "base64") : snapshot.body

const fixtureMissing = (request: HttpClientRequest.HttpClientRequest, name: string) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({
      request,
      description: `Fixture "${name}" not found. Run with RECORD=true to create it.`,
    }),
  })

const fixtureMismatch = (request: HttpClientRequest.HttpClientRequest, name: string, detail: string) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({
      request,
      description: `Fixture "${name}" does not match the current request: ${detail}. Run with RECORD=true to update it.`,
    }),
  })

/**
 * Cassettes are JSON edited by humans. Pretty-print with two-space indent so
 * multi-interaction cassettes diff cleanly. `Schema.encodeSync` returns a
 * JSON-compatible value; `JSON.stringify` is used here only to control
 * formatting, not for schema serialization.
 */
const formatCassette = (interactions: ReadonlyArray<Interaction>) =>
  `${JSON.stringify(encodeCassette({ version: 1, interactions }), null, 2)}\n`

const parseCassette = (raw: string) => decodeCassette(JSON.parse(raw))

export const hasFixtureSync = (name: string) => {
  if (!fs.existsSync(fixturePath(name))) return false
  return Option.isSome(
    Option.liftThrowable(parseCassette)(fs.readFileSync(fixturePath(name), "utf8")),
  )
}

export const layer = (
  name: string,
  options: RecordReplayOptions = {},
): Layer.Layer<HttpClient.HttpClient> =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
      const upstream = yield* HttpClient.HttpClient
      const fileSystem = yield* FileSystem.FileSystem
      const file = fixturePath(name)
      const dir = path.dirname(file)
      const requestHeadersAllow = options.requestHeaders ?? DEFAULT_REQUEST_HEADERS
      const responseHeadersAllow = options.responseHeaders ?? DEFAULT_RESPONSE_HEADERS
      const match = options.match ?? defaultMatcher
      const sequential = match === sequentialMatcher
      const recorded = yield* Ref.make<ReadonlyArray<Interaction>>([])
      const cursor = yield* Ref.make(0)

      const snapshotRequest = (request: HttpClientRequest.HttpClientRequest) =>
        Effect.gen(function* () {
          const web = yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie)
          const raw = yield* Effect.promise(() => web.text())
          const redact = options.redactBody
          const body = redact
            ? Option.match(decodeJson(raw), {
                onNone: () => raw,
                onSome: (parsed) => JSON.stringify(redact(parsed)),
              })
            : raw
          return {
            method: web.method,
            url: web.url,
            headers: lowerHeaders(Object.fromEntries(web.headers.entries()), requestHeadersAllow),
            body,
          }
        })

      const selectInteraction = (
        cassette: Schema.Schema.Type<typeof Cassette>,
        incoming: RequestSnapshot,
      ) =>
        Effect.gen(function* () {
          if (sequential) {
            const index = yield* Ref.getAndUpdate(cursor, (n) => n + 1)
            const interaction = cassette.interactions[index]
            return {
              interaction,
              detail: `interaction ${index + 1} of ${cassette.interactions.length} not recorded`,
            }
          }
          const incomingCanonical = canonicalSnapshot(incoming)
          const interaction =
            match === defaultMatcher
              ? cassette.interactions.find(
                  (candidate) => canonicalSnapshot(candidate.request) === incomingCanonical,
                )
              : cassette.interactions.find((candidate) => match(incoming, candidate.request))
          return { interaction, detail: "no recorded interaction matched" }
        })

      return HttpClient.make((request) => {
        if (isRecordMode) {
          return Effect.gen(function* () {
            const currentRequest = yield* snapshotRequest(request)
            const response = yield* upstream.execute(request)
            const headers = responseHeaders(response, responseHeadersAllow)
            const captured = yield* captureResponseBody(response, headers["content-type"])
            const interaction: Interaction = {
              request: currentRequest,
              response: { status: response.status, headers, body: captured.body, bodyEncoding: captured.bodyEncoding },
            }
            const interactions = yield* Ref.updateAndGet(recorded, (prev) => [...prev, interaction])
            yield* fileSystem.makeDirectory(dir, { recursive: true }).pipe(Effect.orDie)
            yield* fileSystem.writeFileString(file, formatCassette(interactions)).pipe(Effect.orDie)
            return HttpClientResponse.fromWeb(request, new Response(decodeResponseBody(interaction.response), interaction.response))
          })
        }

        return Effect.gen(function* () {
          const cassette = parseCassette(
            yield* fileSystem.readFileString(file).pipe(Effect.mapError(() => fixtureMissing(request, name))),
          )
          const incoming = yield* snapshotRequest(request)
          const { interaction, detail } = yield* selectInteraction(cassette, incoming)
          if (!interaction) return yield* fixtureMismatch(request, name, detail)

          return HttpClientResponse.fromWeb(request, new Response(decodeResponseBody(interaction.response), interaction.response))
        })
      })
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer), Layer.provide(NodeFileSystem.layer))
