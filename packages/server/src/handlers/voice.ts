import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { AbsolutePath } from "@opencode/core/schema"
import { Voice } from "@opencode/core/voice"
import { VoiceLegacy } from "@opencode/core/voice-legacy"
import {
  InvalidRequestError,
  ModelNotFoundError,
  ServiceUnavailableError,
  UnsupportedModelError,
} from "@opencode/protocol/errors"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { locationErrors, response } from "../location"

export const VoiceHandler = HttpApiBuilder.group(Api, "server.voice", (handlers) =>
  Effect.gen(function* () {
    const global = yield* Global.Service
    const locations = yield* LocationServiceMap.Service
    const services = locations.get(Location.Ref.make({ directory: AbsolutePath.make(global.config) }))
    return handlers
      .handle(
        "voice.connect",
        Effect.fn("server.voice.connect")(function* (request) {
          const voice = yield* Voice.Service
          return yield* response(voice.connect(request.payload).pipe(Effect.mapError(voiceError)))
        }),
      )
      .handle(
        "voice.models",
        Effect.fn("server.voice.models")(
          function* () {
            return { data: yield* VoiceLegacy.models() }
          },
          Effect.provide(services),
          locationErrors,
        ),
      )
      .handle(
        "voice.session",
        Effect.fn("server.voice.session")(
          function* (request) {
            const transport = yield* VoiceLegacy.session(request.payload).pipe(
              Effect.mapError((error) =>
                error._tag === "Voice.InvalidRequestError"
                  ? new InvalidRequestError({ message: error.message })
                  : new ServiceUnavailableError({ message: error.message, service: error.service }),
              ),
            )
            return { data: { transport } }
          },
          Effect.provide(services),
          locationErrors,
        ),
      )
  }),
)

function voiceError(error: Voice.Error) {
  switch (error._tag) {
    case "Voice.ModelNotFoundError":
      return new ModelNotFoundError({ providerID: error.providerID, modelID: error.modelID, message: error.message })
    case "Voice.UnsupportedModelError":
      return new UnsupportedModelError({
        providerID: error.providerID,
        modelID: error.modelID,
        capability: "realtime",
        message: error.message,
      })
    case "Voice.InvalidRequestError":
      return new InvalidRequestError({ message: error.message, field: error.field })
    case "Voice.UnavailableError":
      return new ServiceUnavailableError({ message: error.message, service: error.service })
  }
}
