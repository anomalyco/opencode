import { NodeFileSystem } from "@effect/platform-node"
import { Deferred, Effect, Layer, Option, Ref } from "effect"
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
import * as CassetteService from "./cassette.js"
import { defaultMatcher, selectSequential } from "./matching.js"
import { makeReplayState, resolveAutoMode } from "./recorder.js"
import { make, type Redactor } from "./redactor.js"
import { redactUrl } from "./redaction.js"
import { httpInteractions } from "./schema.js"
import type { CassetteMetadata, HttpInteraction, RequestMatcher, ResponseSnapshot } from "./types.js"

export { defaultMatcher }

export type RecordReplayMode = "auto" | "record" | "replay" | "passthrough"

export interface RecordReplayOptions {
  readonly mode?: RecordReplayMode
  readonly directory?: string
  readonly metadata?: CassetteMetadata
  readonly redactor?: Redactor
  readonly match?: RequestMatcher
}

const TEXT_CONTENT_TYPES = new Set([
  "application/graphql",
  "application/javascript",
  "application/json",
  "application/sql",
  "application/x-www-form-urlencoded",
  "application/xml",
  "application/yaml",
  "image/svg+xml",
])

const isTextContentType = (contentType: string | undefined) => {
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase()
  if (!mediaType) return false
  return (
    mediaType.startsWith("text/") ||
    mediaType.endsWith("+json") ||
    mediaType.endsWith("+xml") ||
    TEXT_CONTENT_TYPES.has(mediaType)
  )
}

const captureResponseBody = (response: HttpClientResponse.HttpClientResponse, contentType: string | undefined) =>
  response.arrayBuffer.pipe(
    Effect.map((bytes) =>
      isTextContentType(contentType)
        ? { body: new TextDecoder().decode(bytes) }
        : { body: Buffer.from(bytes).toString("base64"), bodyEncoding: "base64" as const },
    ),
  )

const decodeResponseBody = (snapshot: ResponseSnapshot) =>
  snapshot.bodyEncoding === "base64" ? Buffer.from(snapshot.body, "base64") : snapshot.body

const responseFromSnapshot = (request: HttpClientRequest.HttpClientRequest, snapshot: ResponseSnapshot) =>
  HttpClientResponse.fromWeb(
    request,
    new Response(
      request.method === "HEAD" || snapshot.status === 204 || snapshot.status === 205 || snapshot.status === 304
        ? null
        : decodeResponseBody(snapshot),
      snapshot,
    ),
  )

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
      const redactor = options.redactor ?? make()
      const match = options.match ?? defaultMatcher
      const requested = options.mode ?? "auto"
      const mode = requested === "auto" ? yield* resolveAutoMode(cassetteService, name) : requested

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

      if (mode === "passthrough") return upstream

      if (mode === "record") {
        const initial = yield* Deferred.make<void>()
        yield* Deferred.succeed(initial, undefined)
        const tail = yield* Ref.make(initial)
        return HttpClient.make((request) =>
          Effect.gen(function* () {
            const completed = yield* Deferred.make<void>()
            const previous = yield* Ref.modify(tail, (current) => [current, completed])
            return yield* Effect.gen(function* () {
              const incoming = yield* snapshotRequest(request)
              const response = yield* upstream.execute(request)
              const captured = yield* captureResponseBody(response, response.headers["content-type"])
              const responseSnapshot: ResponseSnapshot = {
                status: response.status,
                headers: response.headers as Record<string, string>,
                ...captured,
              }
              const interaction: HttpInteraction = {
                transport: "http",
                request: incoming,
                response: redactor.response(responseSnapshot),
              }
              yield* Deferred.await(previous)
              yield* cassetteService
                .append(name, interaction, options.metadata)
                .pipe(
                  Effect.catchTag("UnsafeCassetteError", (error) =>
                    Effect.fail(transportError(request, error.message)),
                  ),
                )
              return responseFromSnapshot(request, responseSnapshot)
            }).pipe(Effect.ensuring(Deferred.succeed(completed, undefined)))
          }),
        )
      }

      const replay = yield* makeReplayState(cassetteService, name, httpInteractions)
      return HttpClient.make((request) =>
        Effect.gen(function* () {
          const incoming = yield* snapshotRequest(request)
          const claimed = yield* replay
            .claim((interaction, index, interactions) => {
              const result = selectSequential(interactions, incoming, match, index)
              if (result.interaction) return Effect.void
              return Effect.fail(
                transportError(request, `Fixture "${name}" does not match the current request: ${result.detail}.`),
              )
            })
            .pipe(
              Effect.mapError((error) =>
                error._tag === "CassetteNotFoundError"
                  ? transportError(
                      request,
                      `Fixture "${name}" not found. Run locally to record it (CI=true forces replay).`,
                    )
                  : error,
              ),
            )
          return responseFromSnapshot(request, claimed.interaction.response)
        }),
      )
    }),
  )

export const cassetteLayer = (name: string, options: RecordReplayOptions = {}): Layer.Layer<HttpClient.HttpClient> =>
  recordingLayer(name, options).pipe(
    Layer.provide(CassetteService.fileSystem({ directory: options.directory })),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(NodeFileSystem.layer),
  )
