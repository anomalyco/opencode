import { EventV2 } from "@opencode-ai/core/event"
import { OpenCodeEvent } from "@opencode-ai/protocol/groups/event"
import { Effect, Schema, Stream } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

const subscriberCapacity = 256
const encodeEvent = Schema.encodeUnknownSync(OpenCodeEvent)
const textEncoder = new TextEncoder()
const heartbeat = textEncoder.encode(": heartbeat\n\n")

function eventFrame(event: unknown) {
  return textEncoder.encode(`data: ${JSON.stringify(encodeEvent(event))}\n\n`)
}

export const EventHandler = HttpApiBuilder.group(Api, "server.event", (handlers) =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const frames = new WeakMap<object, Uint8Array>()
    return handlers.handleRaw("event.subscribe", () =>
      Effect.gen(function* () {
        const connected = {
          id: EventV2.ID.create(),
          type: "server.connected",
          data: {},
        }
        const output = Stream.unwrap(
          Effect.gen(function* () {
            // Acquiring the bounded stream installs its listener before readiness is observable.
            const live = yield* EventV2.allBounded(events, subscriberCapacity)
            return Stream.make(connected).pipe(Stream.concat(live))
          }),
        ).pipe(
          Stream.map((event) => {
            const frame = frames.get(event)
            if (frame) return frame
            const encoded = eventFrame(event)
            frames.set(event, encoded)
            return encoded
          }),
        )
        const heartbeats = Stream.tick("15 seconds").pipe(Stream.map(() => heartbeat))
        return HttpServerResponse.stream(output.pipe(Stream.merge(heartbeats, { haltStrategy: "left" })), {
          contentType: "text/event-stream",
          headers: {
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "X-Content-Type-Options": "nosniff",
          },
        })
      }),
    )
  }),
)
