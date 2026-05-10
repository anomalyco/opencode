import { NodeFileSystem } from "@effect/platform-node"
import { Effect, Layer, Ref } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http"
import * as CassetteService from "./cassette"
import { mismatchDetail, redactedErrorRequest, requestDiff } from "./diff"
import { defaultMatcher, type RequestMatcher } from "./matching"
import { appendOrFail } from "./recorder"
import { defaults, type Redactor } from "./redactor"
import { httpInteractions, type Cassette, type CassetteMetadata, type HttpInteraction, type ResponseSnapshot } from "./schema"

export type RecordReplayMode = "record" | "replay" | "passthrough"

export interface RecordReplayOptions {
  readonly mode?: RecordReplayMode
  readonly directory?: string
  readonly metadata?: CassetteMetadata
  readonly redactor?: Redactor
  readonly dispatch?: "match" | "sequential"
  readonly match?: RequestMatcher
}

const BINARY_CONTENT_TYPES: ReadonlyArray<string> = ["vnd.amazon.eventstream", "octet-stream"]

const isBinaryContentType = (contentType: string | undefined) =>
  contentType !== undefined && BINARY_CONTENT_TYPES.some((token) => contentType.toLowerCase().includes(token))

const captureResponseBody = (response: HttpClientResponse.HttpClientResponse, contentType: string | undefined) =>
  isBinaryContentType(contentType)
    ? response.arrayBuffer.pipe(
        Effect.map((bytes) => ({ body: Buffer.from(bytes).toString("base64"), bodyEncoding: "base64" as const })),
      )
    : response.text.pipe(Effect.map((body) => ({ body })))

const decodeResponseBody = (snapshot: ResponseSnapshot) =>
  snapshot.bodyEncoding === "base64" ? Buffer.from(snapshot.body, "base64") : snapshot.body

const transportError = (request: HttpClientRequest.HttpClientRequest, description: string) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({ request: redactedErrorRequest(request), description }),
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
      const redactor = options.redactor ?? defaults()
      const match = options.match ?? defaultMatcher
      const mode = options.mode ?? "replay"
      const sequential = options.dispatch === "sequential"
      const replay = yield* Ref.make<Cassette | undefined>(undefined)
      const cursor = yield* Ref.make(0)

      const snapshotRequest = (request: HttpClientRequest.HttpClientRequest) =>
        Effect.gen(function* () {
          const web = yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie)
          return redactor.request({
            method: web.method,
            url: web.url,
            headers: Object.fromEntries(web.headers.entries()),
            body: yield* Effect.promise(() => web.text()),
          })
        })

      const selectInteraction = (cassette: Cassette, incoming: HttpInteraction["request"]) =>
        Effect.gen(function* () {
          const interactions = httpInteractions(cassette)
          if (sequential) {
            const index = yield* Ref.get(cursor)
            const interaction = interactions[index]
            if (!interaction)
              return { interaction, detail: `interaction ${index + 1} of ${interactions.length} not recorded` }
            if (!match(incoming, interaction.request))
              return { interaction: undefined, detail: requestDiff(interaction.request, incoming).join("\n") }
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
          const cassette = yield* cassetteService
            .read(name)
            .pipe(Effect.mapError(() => transportError(request, `Fixture "${name}" not found.`)))
          yield* Ref.set(replay, cassette)
          return cassette
        })

      return HttpClient.make((request) => {
        if (mode === "passthrough") return upstream.execute(request)

        if (mode === "record") {
          return Effect.gen(function* () {
            const currentRequest = yield* snapshotRequest(request)
            const response = yield* upstream.execute(request)
            const captured = yield* captureResponseBody(response, response.headers["content-type"])
            const interaction: HttpInteraction = {
              transport: "http",
              request: currentRequest,
              response: redactor.response({
                status: response.status,
                headers: response.headers as Record<string, string>,
                ...captured,
              }),
            }
            yield* appendOrFail(cassetteService, name, interaction, options.metadata).pipe(
              Effect.catchTag("UnsafeCassetteError", (error) => Effect.fail(transportError(request, error.message))),
            )
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
          if (!interaction)
            return yield* Effect.fail(transportError(request, `Fixture "${name}" does not match the current request: ${detail}.`))
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
