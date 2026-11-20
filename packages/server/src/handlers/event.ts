import { Event } from "@opencode/schema/event"
import { Effect, Stream } from "effect"
import { HttpServerResponse } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { SpaceStore } from "../space-store"
import { EventFeed } from "../event-feed"

export const EventHandler = HttpApiBuilder.group(Api, "server.event", (handlers) =>
  Effect.gen(function* () {
    const feed = yield* EventFeed.Service
    return handlers.handleRaw("event.subscribe", (ctx) =>
      Effect.gen(function* () {
        const connected = {
          id: Event.ID.create(),
          type: "server.connected",
          data: {},
        } as const
        const output = Stream.unwrap(
          feed
            .subscribe(
              ctx.query.types,
              Array.from(
                new Map(
                  (ctx.query["experimental.kv"] ?? []).map(parse).map((request) => [request.space, request]),
                ).values(),
              ),
            )
            .pipe(Effect.map((live) => Stream.make(EventFeed.frame(connected)).pipe(Stream.concat(live)))),
        )
        const heartbeat = Stream.tick("15 seconds").pipe(Stream.map(() => ": heartbeat\n\n"))
        return HttpServerResponse.stream(
          output.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }), Stream.encodeText),
          {
            contentType: "text/event-stream",
            headers: {
              "Cache-Control": "no-cache, no-transform",
              "X-Accel-Buffering": "no",
              "X-Content-Type-Options": "nosniff",
            },
          },
        )
      }),
    )
  }),
)

// `space:epoch.revision`; a cursor that does not parse is unusable, so the space gets a snapshot.
function parse(item: string): SpaceStore.Request {
  const index = item.indexOf(":")
  if (index < 0) return { space: item }
  const space = item.slice(0, index)
  const cursor = item.slice(index + 1)
  const dot = cursor.lastIndexOf(".")
  const revision = cursor.slice(dot + 1)
  if (dot < 1 || !/^\d+$/u.test(revision) || !Number.isSafeInteger(Number(revision))) return { space }
  return { space, epoch: cursor.slice(0, dot), since: Number(revision) }
}
