import { Effect, Schema } from "effect"
import type { WebSocketChannelDriver } from "../route/transport/index.js"
import * as ProviderShared from "./shared.js"
import { OpenResponses } from "./open-responses.js"

const ADAPTER = "openai-responses"
const NAME = "OpenAI Responses"
const decodeEvent = Schema.decodeUnknownEffect(OpenResponses.protocol.stream.event)

export const make = (message: string): WebSocketChannelDriver => ({
  create: () => Effect.succeed({ message, mode: "full" }),
  observe: (_create, frame) =>
    Effect.gen(function* () {
      const event = yield* decodeEvent(frame).pipe(
        Effect.mapError(() => ProviderShared.eventError(ADAPTER, "Invalid OpenAI Responses WebSocket event", frame)),
      )
      if (event.type === "response.completed") return { type: "completed", frame }
      if (event.type === "response.incomplete") return { type: "incomplete", frame }
      if (event.type === "response.failed")
        return {
          type: "provider-failure",
          error: OpenResponses.providerFailure(ADAPTER, event, `${NAME} response failed`),
        }
      if (event.type === "error") {
        yield* OpenResponses.decodeKnownErrorEvent(event).pipe(
          Effect.mapError(() => ProviderShared.eventError(ADAPTER, `${NAME} returned a malformed error event`, frame)),
        )
        return {
          type: "provider-failure",
          error: OpenResponses.providerFailure(ADAPTER, event, `${NAME} stream error`),
        }
      }
      return { type: "frame", frame }
    }),
})

export const OpenAIResponsesChannel = { make } as const
