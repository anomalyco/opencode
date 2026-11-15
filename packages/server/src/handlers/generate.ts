import { Flag } from "@opencode/core/flag"
import { Generate } from "@opencode/core/generate"
import { Generation } from "@opencode/core/generation"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { AbsolutePath } from "@opencode/core/schema"
import {
  ForbiddenError,
  GenerationNotFoundError,
  InvalidRequestError,
  ModelNotFoundError,
  ProviderRequestError,
  ServiceUnavailableError,
  UnsupportedModelError,
} from "@opencode/protocol/errors"
import type { DecisionRequest, GenerationID, ImageRequest, VideoRequest } from "@opencode/schema/generate"
import { Global } from "@opencode/util/global"
import { Model } from "@opencode/schema/model"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { awaitPlugins, locationErrors } from "../location"

export const GenerateHandler = HttpApiBuilder.group(Api, "server.generate", (handlers) =>
  Effect.gen(function* () {
    const global = yield* Global.Service
    const locations = yield* LocationServiceMap.Service
    const generations = yield* Generation.Service
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
    const videoStart = Effect.fn("server.generate.video.start")(
      function* (request: { readonly payload: VideoRequest }) {
        yield* videoEnabled
        yield* awaitPlugins
        return { data: yield* generations.video(request.payload).pipe(Effect.mapError(generateError)) }
      },
      Effect.provide(services),
      locationErrors,
    )
    const videoGet = Effect.fn("server.generate.video.get")(
      function* (request: { readonly params: { readonly id: GenerationID } }) {
        yield* videoEnabled
        const job = yield* generations
          .get(request.params.id)
          .pipe(
            Effect.mapError((error) => new GenerationNotFoundError({ generationID: error.id, message: error.message })),
          )
        return { data: job }
      },
      Effect.provide(services),
      locationErrors,
    )
    return handlers
      .handle("generate.text", text)
      .handle("generate.textLegacy", text)
      .handle("generate.image", image)
      .handle("generate.decisions", decisions)
      .handle("generate.video.start", videoStart)
      .handle("generate.video.get", videoGet)
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
