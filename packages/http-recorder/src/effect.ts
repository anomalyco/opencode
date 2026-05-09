import { NodeFileSystem } from "@effect/platform-node"
import { Effect, Layer, Option, Ref } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http"
import { redactedErrorRequest, mismatchDetail, requestDiff } from "./diff"
import { defaultMatcher, decodeJson, type RequestMatcher } from "./matching"
import { redactHeaders, redactUrl, type SecretFinding } from "./redaction"
import {
  httpInteractions,
  type Cassette,
  type CassetteMetadata,
  type HttpInteraction,
  type ResponseSnapshot,
} from "./schema"
import * as CassetteService from "./cassette"

export const DEFAULT_REQUEST_HEADERS: ReadonlyArray<string> = ["content-type", "accept", "openai-beta"]
const DEFAULT_RESPONSE_HEADERS: ReadonlyArray<string> = ["content-type"]

export type RecordReplayMode = "record" | "replay" | "passthrough"

export interface RecordReplayOptions {
  readonly mode?: RecordReplayMode
  readonly directory?: string
  readonly metadata?: CassetteMetadata
  readonly redact?: {
    readonly headers?: ReadonlyArray<string>
    readonly query?: ReadonlyArray<string>
    readonly url?: (url: string) => string
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

const captureResponseBody = (response: HttpClientResponse.HttpClientResponse, contentType: string | undefined) =>
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
      request: redactedErrorRequest(request),
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
      request: redactedErrorRequest(request),
      description: `Refusing to write cassette "${name}" because it contains possible secrets: ${findings
        .map((item) => `${item.path} (${item.reason})`)
        .join(", ")}`,
    }),
  })

export const recordingLayer = (
  name: string,
  options: Omit<RecordReplayOptions, "directory"> = {},
): Layer.Layer<HttpClient.HttpClient, never, HttpClient.HttpClient | CassetteService.Service> =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
      const upstream = yield* HttpClient.HttpClient
      const cassetteService = yield* CassetteService.Service
      const requestHeadersAllow = options.requestHeaders ?? DEFAULT_REQUEST_HEADERS
      const responseHeadersAllow = options.responseHeaders ?? DEFAULT_RESPONSE_HEADERS
      const match = options.match ?? defaultMatcher
      const mode = options.mode ?? "replay"
      const sequential = options.dispatch === "sequential"
      const replay = yield* Ref.make<Cassette | undefined>(undefined)
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
            url: redactUrl(web.url, options.redact?.query, options.redact?.url),
            headers: redactHeaders(
              Object.fromEntries(web.headers.entries()),
              requestHeadersAllow,
              options.redact?.headers,
            ),
            body,
          }
        })

      const selectInteraction = (cassette: Cassette, incoming: HttpInteraction["request"]) =>
        Effect.gen(function* () {
          const interactions = httpInteractions(cassette)
          if (sequential) {
            const index = yield* Ref.get(cursor)
            const interaction = interactions[index]
            if (!interaction)
              return { interaction, detail: `interaction ${index + 1} of ${interactions.length} not recorded` }
            if (!match(incoming, interaction.request)) {
              return { interaction: undefined, detail: requestDiff(interaction.request, incoming).join("\n") }
            }
            yield* Ref.update(cursor, (n) => n + 1)
            return { interaction, detail: "" }
          }
          const interaction = interactions.find((candidate) => match(incoming, candidate.request))
          return { interaction, detail: interaction ? "" : mismatchDetail(cassette, incoming) }
        })

      const loadReplay = (request: HttpClientRequest.HttpClientRequest) =>
        Effect.gen(function* () {
          const cached = yield* Ref.get(replay)
          if (cached) return cached
          const cassette = yield* cassetteService.read(name).pipe(Effect.mapError(() => fixtureMissing(request, name)))
          yield* Ref.set(replay, cassette)
          return cassette
        })

      return HttpClient.make((request) => {
        if (mode === "passthrough") return upstream.execute(request)

        if (mode === "record") {
          return Effect.gen(function* () {
            const currentRequest = yield* snapshotRequest(request)
            const response = yield* upstream.execute(request)
            const headers = responseHeaders(response, responseHeadersAllow, options.redact?.headers)
            const captured = yield* captureResponseBody(response, headers["content-type"])
            const interaction: HttpInteraction = {
              transport: "http",
              request: currentRequest,
              response: { status: response.status, headers, ...captured },
            }
            const result = yield* cassetteService.append(name, interaction, options.metadata).pipe(Effect.orDie)
            const findings = result.findings
            if (findings.length > 0) return yield* unsafeCassette(request, name, findings)
            return HttpClientResponse.fromWeb(
              request,
              new Response(decodeResponseBody(interaction.response), interaction.response),
            )
          })
        }

        return Effect.gen(function* () {
          const cassette = yield* loadReplay(request)
          const incoming = yield* snapshotRequest(request)
          const { interaction, detail } = yield* selectInteraction(cassette, incoming)
          if (!interaction) return yield* fixtureMismatch(request, name, detail)

          return HttpClientResponse.fromWeb(
            request,
            new Response(decodeResponseBody(interaction.response), interaction.response),
          )
        })
      })
    }),
  )

export const cassetteLayer = (name: string, options: RecordReplayOptions = {}): Layer.Layer<HttpClient.HttpClient> =>
  recordingLayer(name, options).pipe(
    Layer.provide(CassetteService.layer({ directory: options.directory })),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(NodeFileSystem.layer),
  )
