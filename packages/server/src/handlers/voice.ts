import { Voice } from "@opencode/core/voice"
import { VoiceLegacy } from "@opencode/core/voice-legacy"
import { InvalidRequestError, ModelNotFoundError, ServiceUnavailableError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"

export const VoiceHandler = HttpApiBuilder.group(Api, "server.voice", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "voice.connect",
        Effect.fn("server.voice.connect")(function* (request) {
          const voice = yield* Voice.Service
          const transport = yield* voice.connect(request.payload).pipe(Effect.mapError(voiceError))
          return { data: { transport } }
        }),
      )
      .handle(
        "voice.models",
        Effect.fn("server.voice.models")(function* () {
          return { data: yield* VoiceLegacy.models() }
        }),
      )
      .handle(
        "voice.session",
        Effect.fn("server.voice.session")(function* (request) {
          const transport = yield* VoiceLegacy.session(request.payload).pipe(
            Effect.mapError((error) => {
              if (error._tag === "Voice.InvalidRequestError") return new InvalidRequestError({ message: error.message })
              // The legacy endpoint never answered 404: a model it can't start needs a key.
              if (error._tag === "Voice.ModelNotFoundError")
                return new ServiceUnavailableError({ message: Voice.missingKeyMessage })
              return new ServiceUnavailableError({ message: error.message, service: error.service })
            }),
          )
          return { data: { transport } }
        }),
      )
  }),
)

function voiceError(error: Voice.Error) {
  switch (error._tag) {
    case "Voice.ModelNotFoundError":
      return new ModelNotFoundError({ providerID: error.providerID, modelID: error.modelID, message: error.message })
    case "Voice.InvalidRequestError":
      return new InvalidRequestError({ message: error.message })
    case "Voice.UnavailableError":
      return new ServiceUnavailableError({ message: error.message, service: error.service })
  }
}
