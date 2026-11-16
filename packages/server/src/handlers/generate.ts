import { Flag } from "@opencode/core/flag"
import { Generate } from "@opencode/core/generate"
import { VideoGeneration } from "@opencode/core/video-generation"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { AbsolutePath } from "@opencode/core/schema"
import {
  ForbiddenError,
  VideoNotFoundError,
  InvalidRequestError,
  ModelNotFoundError,
  ProviderRequestError,
  ServiceUnavailableError,
  SessionNotFoundError,
  UnsupportedModelError,
} from "@opencode/protocol/errors"
import type { DecisionRequest, VideoID, ImageRequest, VideoRequest } from "@opencode/schema/generate"
import { Global } from "@opencode/util/global"
import { Model } from "@opencode/schema/model"
import { Effect } from "effect"
import { type HttpServerRequest, HttpServerResponse } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { FSUtil } from "@opencode/util/fs-util"
import { ContentHeaders } from "../content-headers"
import { ByteRange } from "../range"
import { Api } from "../api"
import { awaitPlugins, locationErrors } from "../location"

export const GenerateHandler = HttpApiBuilder.group(Api, "server.generate", (handlers) =>
  Effect.gen(function* () {
    const global = yield* Global.Service
    const locations = yield* LocationServiceMap.Service
    const videos = yield* VideoGeneration.Service
    const fs = yield* FSUtil.Service
    const services = locations.get(Location.Ref.make({ directory: AbsolutePath.make(global.config) }))
    const text = Effect.fn("server.generate.text")(
      function* (request: { readonly payload: { readonly prompt: string; readonly model?: Model.Ref } }) {
        yield* awaitPlugins
        const generate = yield* Generate.Service
        return { data: { text: yield* generate.text(request.payload).pipe(Effect.mapError(generateError)) } }
      },
      Effect.provide(services),
      locationErrors,
    )
    const image = Effect.fn("server.generate.image")(
      function* (request: { readonly payload: ImageRequest }) {
        yield* awaitPlugins
        const generate = yield* Generate.Service
        return { data: yield* generate.image(request.payload).pipe(Effect.mapError(generateError)) }
      },
      Effect.provide(services),
      locationErrors,
    )
    const decisions = Effect.fn("server.generate.decisions")(
      function* (request: { readonly payload: DecisionRequest }) {
        const names = new Set(request.payload.questions.map((question) => question.name))
        if (names.size !== request.payload.questions.length)
          return yield* new InvalidRequestError({
            message: "Decision question names must be unique",
            field: "questions",
          })
        yield* awaitPlugins
        const generate = yield* Generate.Service
        return { data: yield* generate.decisions(request.payload).pipe(Effect.mapError(generateError)) }
      },
      Effect.provide(services),
      locationErrors,
    )
    // The flag is read from the same base configuration generation runs on.
    const videoEnabled = Effect.gen(function* () {
      if (yield* Flag.enabled("video_generate")) return
      return yield* new ForbiddenError({ message: "Video generation is disabled; enable experimental.video_generate" })
    })
    const videoCreate = Effect.fn("server.generate.video.create")(
      function* (request: { readonly payload: VideoRequest }) {
        yield* videoEnabled
        yield* awaitPlugins
        return {
          data: yield* videos.start(request.payload).pipe(
            Effect.catchTag("Session.NotFoundError", (error) =>
              Effect.fail(
                new SessionNotFoundError({
                  sessionID: error.sessionID,
                  message: `Session not found: ${error.sessionID}`,
                }),
              ),
            ),
            Effect.mapError((error) => (error._tag === "SessionNotFoundError" ? error : generateError(error))),
          ),
        }
      },
      Effect.provide(services),
      locationErrors,
    )
    const videoGet = Effect.fn("server.generate.video.get")(
      function* (request: { readonly params: { readonly id: VideoID } }) {
        yield* videoEnabled
        const job = yield* videos
          .get(request.params.id)
          .pipe(Effect.mapError((error) => new VideoNotFoundError({ videoID: error.id, message: error.message })))
        return { data: job }
      },
      Effect.provide(services),
      locationErrors,
    )
    // Raw, so it can stream the file and answer Range and 304 itself.
    const videoContent = (id: VideoID, request: HttpServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        yield* videoEnabled
        const video = yield* videos
          .content(id)
          .pipe(Effect.mapError((error) => new VideoNotFoundError({ videoID: error.id, message: error.message })))
        // The ID names one immutable video.
        const etag = `"${id}"`
        const headers = {
          ...ContentHeaders.download({ mime: video.mime }),
          "cache-control": "private, max-age=604800, immutable",
          etag,
          "accept-ranges": "bytes",
        }
        if (
          request.headers["if-none-match"]
            ?.split(",")
            .some((tag) => tag.trim() === "*" || tag.trim().replace(/^w\//i, "") === etag)
        )
          return HttpServerResponse.empty({ status: 304, headers })
        // If-Range takes only a strong match (RFC 9110 13.1.5); anything else serves the whole body.
        const ifRange = request.headers["if-range"]
        const range =
          ifRange === undefined || ifRange.trim() === etag
            ? ByteRange.parse(request.headers["range"], video.bytes)
            : undefined
        if (range === "unsatisfiable")
          return HttpServerResponse.empty({
            status: 416,
            headers: { ...headers, "content-range": `bytes */${video.bytes}` },
          })
        const offset = range?.start ?? 0
        const length = range === undefined ? video.bytes : range.end - range.start + 1
        return HttpServerResponse.stream(fs.stream(video.path, { offset, bytesToRead: length }), {
          status: range === undefined ? 200 : 206,
          contentType: headers["content-type"],
          contentLength: length,
          headers:
            range === undefined
              ? headers
              : { ...headers, "content-range": `bytes ${range.start}-${range.end}/${video.bytes}` },
        })
      }).pipe(Effect.provide(services), locationErrors)
    return handlers
      .handle("generate.text", text)
      .handle("generate.textLegacy", text)
      .handle("generate.image", image)
      .handle("generate.decisions", decisions)
      .handle("generate.video.create", videoCreate)
      .handle("generate.video.get", videoGet)
      .handleRaw("generate.video.content", (ctx) => videoContent(ctx.params.id, ctx.request))
  }),
)

function generateError(error: Generate.Error) {
  switch (error._tag) {
    case "Generate.ModelNotFoundError":
      return new ModelNotFoundError({ providerID: error.providerID, modelID: error.modelID, message: error.message })
    case "Generate.UnsupportedModelError":
      return new UnsupportedModelError({
        providerID: error.providerID,
        modelID: error.modelID,
        capability: error.capability,
        message: error.message,
      })
    case "Generate.InvalidRequestError":
      return new InvalidRequestError({
        message: error.message,
        ...(error.field === undefined ? {} : { field: error.field }),
      })
    case "Generate.ProviderRequestError":
      return new ProviderRequestError({
        providerID: error.providerID,
        reason: error.reason,
        message: error.message,
        ...(error.status === undefined ? {} : { status: error.status }),
        ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
      })
    case "Generate.UnavailableError":
      return new ServiceUnavailableError({
        message: error.message,
        ...(error.service === undefined ? {} : { service: error.service }),
      })
  }
}
