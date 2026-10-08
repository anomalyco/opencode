import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-services"
import { AbsolutePath } from "@opencode/core/schema"
import { Voice } from "@opencode/core/voice"
import { ServiceUnavailableError } from "@opencode/protocol/errors"
import { Global } from "@opencode/util/global"
import { Effect, Encoding, Stream } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { locationErrors } from "../location"

const unavailable = (error: Voice.UnavailableError) =>
  new ServiceUnavailableError({ message: error.message, service: error.service ?? "voice" })

export const VoiceHandler = HttpApiBuilder.group(Api, "server.voice", (handlers) =>
  Effect.gen(function* () {
    const global = yield* Global.Service
    const locations = yield* LocationServiceMap.Service
    // Voice models come from the base configuration, like one-shot generation.
    const services = locations.get(Location.Ref.make({ directory: AbsolutePath.make(global.config) }))
    return handlers
      .handle(
        "voice.transcribe",
        Effect.fn("server.voice.transcribe")(
          function* (request) {
            const voice = yield* Voice.Service
            const text = yield* voice
              .transcribe({ audio: request.payload, mediaType: request.query.mediaType })
              .pipe(Effect.mapError(unavailable))
            return { data: { text } }
          },
          Effect.provide(services),
          locationErrors,
        ),
      )
      .handle(
        "voice.speech",
        Effect.fn("server.voice.speech")(
          function* (request) {
            const voice = yield* Voice.Service
            const audio = yield* voice.speak({ text: request.payload.text }).pipe(Effect.mapError(unavailable))
            return audio.pipe(
              Stream.map((chunk) =>
                chunk.type === "format" ? chunk : { type: "audio" as const, data: Encoding.encodeBase64(chunk.chunk) },
              ),
              Stream.concat(Stream.succeed({ type: "done" as const })),
              // Provider failures arrive after the response started, so they travel as a terminal event.
              Stream.catchTag("Voice.UnavailableError", (error) =>
                Stream.succeed({ type: "error" as const, message: error.message }),
              ),
            )
          },
          Effect.provide(services),
          locationErrors,
        ),
      )
  }),
)
