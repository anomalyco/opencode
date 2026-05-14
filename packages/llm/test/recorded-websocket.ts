import { Cassette, makeWebSocketExecutor, type RecordReplayMode } from "@opencode-ai/http-recorder"
import { Effect, Layer } from "effect"
import { WebSocketExecutor } from "../src/route"
import type { Service as WebSocketExecutorService } from "../src/route/transport/websocket"

const liveWebSocket = WebSocketExecutor.open

export const webSocketCassetteLayer = (
  cassette: string,
  input: { readonly metadata?: Record<string, unknown>; readonly mode: RecordReplayMode },
): Layer.Layer<WebSocketExecutorService, never, Cassette.Service> =>
  Layer.effect(
    WebSocketExecutor.Service,
    Effect.gen(function* () {
      const cassetteService = yield* Cassette.Service
      const executor = yield* makeWebSocketExecutor({
        name: cassette,
        mode: input.mode,
        metadata: input.metadata,
        cassette: cassetteService,
        live: { open: liveWebSocket },
        compareClientMessagesAsJson: true,
      })
      return WebSocketExecutor.Service.of(executor)
    }),
  )
