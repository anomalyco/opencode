import { NodeFileSystem } from "@effect/platform-node"
import { Effect, Layer, Option } from "effect"
import {
  FetchHttpClient,
  Headers,
  HttpBody,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
  UrlParams,
} from "effect/unstable/http"
import * as CassetteService from "./cassette"
import { defaultMatcher, selectMatch, selectSequential, type RequestMatcher } from "./matching"
import { appendOrFail, makeReplayState, resolveAutoMode } from "./recorder"
import { defaults, type Redactor } from "./redactor"
import { redactUrl } from "./redaction"
import { httpInteractions, type CassetteMetadata, type HttpInteraction, type ResponseSnapshot } from "./schema"

export type RecordReplayMode = "auto" | "record" | "replay" | "passthrough"

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

export const redactedErrorRequest = (request: HttpClientRequest.HttpClientRequest) =>
  HttpClientRequest.makeWith(
    request.method,
    redactUrl(request.url),
    UrlParams.empty,
    Option.none(),
    Headers.empty,
    HttpBody.empty,
  )

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
      const requested = options.mode ?? "auto"
      const mode = requested === "auto" ? yield* resolveAutoMode(cassetteService, name) : requested
      const sequential = options.dispatch === "sequential"
      const replay = yield* makeReplayState(cassetteService, name, httpInteractions)

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

      return HttpClient.make((request) => {
        if (mode === "passthrough") return upstream.execute(request)

        if (mode === "record") {
          return Effect.gen(function* () {
            const incoming = yield* snapshotRequest(request)
            const response = yield* upstream.execute(request)
            const captured = yield* captureResponseBody(response, response.headers["content-type"])
            const interaction: HttpInteraction = {
              transport: "http",
              request: incoming,
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
          const incoming = yield* snapshotRequest(request)
          const interactions = yield* replay.load.pipe(
            Effect.mapError(() =>
              transportError(
                request,
                `Fixture "${name}" not found. Run locally to record it (CI=true forces replay).`,
              ),
            ),
          )
          const result = sequential
            ? selectSequential(interactions, incoming, match, yield* replay.cursor)
            : selectMatch(interactions, incoming, match)
          if (!result.interaction)
            return yield* Effect.fail(
              transportError(request, `Fixture "${name}" does not match the current request: ${result.detail}.`),
            )
          if (sequential) yield* replay.advance
          return HttpClientResponse.fromWeb(
            request,
            new Response(decodeResponseBody(result.interaction.response), result.interaction.response),
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
