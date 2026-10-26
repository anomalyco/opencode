import { Event } from "@opencode/schema/event"
import { EventConnectionNotFoundError } from "@opencode/protocol/errors"
import { Effect, Stream } from "effect"
import { HttpServerResponse } from "effect/http"
import { HttpApiBuilder, HttpApiSchema } from "effect/http-api"
import { Api } from "../api"
import { EventFeed } from "../event-feed"

const sseHeaders = {
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
  "X-Content-Type-Options": "nosniff",
}

export const EventHandler = HttpApiBuilder.group(Api, "server.event", (handlers) =>
  Effect.gen(function* () {
    const feed = yield* EventFeed.Service
    return handlers
      .handleRaw("event.subscribe", (ctx) =>
        Effect.gen(function* () {
          const connected = {
            id: Event.ID.create(),
            type: "server.connected",
            data: {},
          } as const
          const output = Stream.unwrap(
            feed
              .subscribe(ctx.query.types)
              .pipe(Effect.map((live) => Stream.make(EventFeed.frame(connected)).pipe(Stream.concat(live)))),
          )
          const heartbeat = Stream.tick("15 seconds").pipe(Stream.map(() => ": heartbeat\n\n"))
          return HttpServerResponse.stream(
            output.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }), Stream.encodeText),
            {
              contentType: "text/event-stream",
              headers: sseHeaders,
            },
          )
        }),
      )
      .handleRaw("event.experimental.subscribe", (ctx) =>
        Effect.gen(function* () {
          const output = Stream.unwrap(
            feed.connect({ detail: ctx.query.detail }).pipe(
              Effect.map((connection) => {
                const connected = {
                  id: Event.ID.create(),
                  type: "server.connected",
                  data: { connection: connection.id },
                } as const
                return Stream.make(EventFeed.frame(connected)).pipe(Stream.concat(connection.stream))
              }),
            ),
          )
          const heartbeat = Stream.tick("15 seconds").pipe(Stream.map(() => ": heartbeat\n\n"))
          return HttpServerResponse.stream(
            output.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }), Stream.encodeText),
            {
              contentType: "text/event-stream",
              headers: sseHeaders,
            },
          )
        }),
      )
      .handle(
        "event.experimental.sessions",
        Effect.fn(function* (ctx) {
          const updated = yield* feed.setSessions(ctx.params.connection, ctx.payload.sessions)
          if (!updated)
            return yield* new EventConnectionNotFoundError({
              connection: ctx.params.connection,
              message: `Event stream connection not found: ${ctx.params.connection}`,
            })
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
