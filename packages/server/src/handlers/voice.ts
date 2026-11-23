import { Voice } from "@opencode/core/voice"
import { InvalidRequestError, ServiceUnavailableError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"

export const VoiceHandler = HttpApiBuilder.group(Api, "server.voice", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "voice.models",
        Effect.fn("server.voice.models")(function* () {
          const voice = yield* Voice.Service
          return { data: yield* voice.models() }
        }),
      )
      .handle(
        "voice.session",
        Effect.fn("server.voice.session")(function* (request) {
          const voice = yield* Voice.Service
          const transport = yield* voice
            .session(request.payload)
            .pipe(
              Effect.mapError((error) =>
                error._tag === "Voice.InvalidRequestError"
                  ? new InvalidRequestError({ message: error.message })
                  : new ServiceUnavailableError({ message: error.message, service: error.service }),
              ),
            )
          return { data: { transport } }
        }),
      )
  }),
)
