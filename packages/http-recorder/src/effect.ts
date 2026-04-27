import { NodeFileSystem } from "@effect/platform-node"
import { Effect, FileSystem, Layer, Option, Ref } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http"
import * as path from "node:path"
import { redactedErrorRequest, mismatchDetail } from "./diff"
import { defaultMatcher, decodeJson, type RequestMatcher } from "./matching"
import { cassetteSecretFindings, redactHeaders, redactUrl, type SecretFinding } from "./redaction"
import type { Cassette, CassetteMetadata, Interaction, ResponseSnapshot } from "./schema"
import { cassetteFor, cassettePath, formatCassette, parseCassette } from "./storage"

const isRecordMode = process.env.RECORD === "true"

export const DEFAULT_REQUEST_HEADERS: ReadonlyArray<string> = ["content-type", "accept", "openai-beta"]
const DEFAULT_RESPONSE_HEADERS: ReadonlyArray<string> = ["content-type"]

export interface RecordReplayOptions {
  readonly directory?: string
  readonly metadata?: CassetteMetadata
  readonly redact?: {
    readonly headers?: ReadonlyArray<string>
    readonly query?: ReadonlyArray<string>
  }
  readonly requestHeaders?: ReadonlyArray<string>
  readonly responseHeaders?: ReadonlyArray<string>
  readonly redactBody?: (body: unknown) => unknown
  readonly dispatch?: "match" | "sequential"
  readonly match?: RequestMatcher
}

const responseHeaders = (
  response: HttpClientResponse.HttpClientResponse,
  allow: ReadonlyArray<string>,
  redact: ReadonlyArray<string> | undefined,
) => {
  const merged = redactHeaders(response.headers as Record<string, string>, allow, redact)
  if (!merged["content-type"]) merged["content-type"] = "text/event-stream"
  return merged
}

const BINARY_CONTENT_TYPES: ReadonlyArray<string> = ["vnd.amazon.eventstream", "octet-stream"]

const isBinaryContentType = (contentType: string | undefined) => {
  if (!contentType) return false
  const lower = contentType.toLowerCase()
  return BINARY_CONTENT_TYPES.some((token) => lower.includes(token))
}

const captureResponseBody = (
  response: HttpClientResponse.HttpClientResponse,
  contentType: string | undefined,
) =>
  isBinaryContentType(contentType)
    ? response.arrayBuffer.pipe(
        Effect.map((bytes) => ({ body: Buffer.from(bytes).toString("base64"), bodyEncoding: "base64" as const })),
      )
    : response.text.pipe(Effect.map((body) => ({ body })))

const decodeResponseBody = (snapshot: ResponseSnapshot) =>
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
      request: redactedErrorRequest(request),
      description: `Fixture "${name}" does not match the current request: ${detail}. Run with RECORD=true to update it.`,
    }),
  })

const unsafeCassette = (
  request: HttpClientRequest.HttpClientRequest,
  name: string,
  findings: ReadonlyArray<SecretFinding>,
) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({
      request,
      description: `Refusing to write cassette "${name}" because it contains possible secrets: ${findings
        .map((item) => `${item.path} (${item.reason})`)
        .join(", ")}`,
    }),
  })

export const cassetteLayer = (
  name: string,
  options: RecordReplayOptions = {},
): Layer.Layer<HttpClient.HttpClient> =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
      const upstream = yield* HttpClient.HttpClient
      const fileSystem = yield* FileSystem.FileSystem
      const file = cassettePath(name, options.directory)
      const dir = path.dirname(file)
      const requestHeadersAllow = options.requestHeaders ?? DEFAULT_REQUEST_HEADERS
      const responseHeadersAllow = options.responseHeaders ?? DEFAULT_RESPONSE_HEADERS
      const match = options.match ?? defaultMatcher
      const sequential = options.dispatch === "sequential"
      const recorded = yield* Ref.make<ReadonlyArray<Interaction>>([])
      const cursor = yield* Ref.make(0)

      const snapshotRequest = (request: HttpClientRequest.HttpClientRequest) =>
        Effect.gen(function* () {
          const web = yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie)
          const raw = yield* Effect.promise(() => web.text())
          const body = options.redactBody
            ? Option.match(decodeJson(raw), {
                onNone: () => raw,
                onSome: (parsed) => JSON.stringify(options.redactBody?.(parsed)),
              })
            : raw
          return {
            method: web.method,
            url: redactUrl(web.url, options.redact?.query),
            headers: redactHeaders(Object.fromEntries(web.headers.entries()), requestHeadersAllow, options.redact?.headers),
            body,
          }
        })

      const selectInteraction = (cassette: Cassette, incoming: Interaction["request"]) =>
        Effect.gen(function* () {
          if (sequential) {
            const index = yield* Ref.getAndUpdate(cursor, (n) => n + 1)
            const interaction = cassette.interactions[index]
            return { interaction, detail: `interaction ${index + 1} of ${cassette.interactions.length} not recorded` }
          }
          const interaction = cassette.interactions.find((candidate) => match(incoming, candidate.request))
          return { interaction, detail: interaction ? "" : mismatchDetail(cassette, incoming) }
        })

      return HttpClient.make((request) => {
        if (isRecordMode) {
          return Effect.gen(function* () {
            const currentRequest = yield* snapshotRequest(request)
            const response = yield* upstream.execute(request)
            const headers = responseHeaders(response, responseHeadersAllow, options.redact?.headers)
            const captured = yield* captureResponseBody(response, headers["content-type"])
            const interaction: Interaction = {
              request: currentRequest,
              response: { status: response.status, headers, ...captured },
            }
            const interactions = yield* Ref.updateAndGet(recorded, (prev) => [...prev, interaction])
            const cassette = cassetteFor(name, interactions, options.metadata)
            const findings = cassetteSecretFindings(cassette)
            if (findings.length > 0) return yield* unsafeCassette(request, name, findings)
            yield* fileSystem.makeDirectory(dir, { recursive: true }).pipe(Effect.orDie)
            yield* fileSystem.writeFileString(file, formatCassette(cassette)).pipe(Effect.orDie)
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
