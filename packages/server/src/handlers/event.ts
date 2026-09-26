import { EventV2 } from "@opencode-ai/core/event"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { OpenCodeEvent } from "@opencode-ai/protocol/groups/event"
import { Effect, Option, Queue, Schema, Stream } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { Api } from "../api"

const subscriberCapacity = 8192

function eventData(data: { id?: string }): Sse.Event {
  return {
    _tag: "Event",
    event: "message",
    id: data.id,
    data: JSON.stringify(Schema.encodeUnknownSync(OpenCodeEvent)(data)),
  }
}

export const EventHandler = HttpApiBuilder.group(Api, "server.event", (handlers) =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    return handlers.handleRaw("event.subscribe", () =>
      Effect.gen(function* () {
        // The event group is not annotated with the location middleware, so the requested
        // location is derived from the request the same way `LocationMiddleware` does.
        const request = yield* HttpServerRequest.HttpServerRequest
        const query = new URL(request.url, "http://localhost").searchParams
        const rawWorkspaceID = query.get("location[workspace]") || request.headers["x-opencode-workspace"]
        const workspaceID = rawWorkspaceID ? Schema.decodeUnknownOption(WorkspaceV2.ID)(rawWorkspaceID) : Option.none()
        const rawDirectory = query.get("location[directory]") || request.headers["x-opencode-directory"]
        const directory = AbsolutePath.make(rawDirectory ? decodeURIComponent(rawDirectory) : process.cwd())
        const connected = {
          id: EventV2.ID.create(),
          type: "server.connected",
          data: {},
        }
        const output = Stream.unwrap(
          Effect.gen(function* () {
            // Bounded. A slow client now terminates the stream on overflow instead of
            // silently dropping events, so it reconnects and refetches rather than
            // diverging without knowing (F-015/D-P1-03). Listener registration is eager
            // so events cannot be lost while the body fiber is starting.
            const queue = yield* Queue.dropping<EventV2.Payload>(subscriberCapacity)
            let overflowed = false
            const unsubscribe = yield* events.listen((event) =>
              Effect.suspend(() => {
                // Scope the stream to the requesting directory/workspace instead of
                // broadcasting every directory's events to every client.
                if (event.location?.directory !== directory) return Effect.void
                const requestedWorkspace = Option.getOrUndefined(workspaceID)
                if (event.location?.workspaceID !== undefined && event.location.workspaceID !== requestedWorkspace)
                  return Effect.void
                return Queue.offer(queue, event).pipe(
                  Effect.tap((accepted) =>
                    Effect.sync(() => {
                      if (!accepted) overflowed = true
                    }),
                  ),
                  Effect.asVoid,
                )
              }),
            )
            yield* Effect.addFinalizer(() => unsubscribe)
            return Stream.make(connected).pipe(
              Stream.concat(
                Stream.fromQueue(queue).pipe(
                  Stream.mapEffect((event) =>
                    overflowed
                      ? Effect.fail(new EventV2.SubscriberOverflowError({ capacity: subscriberCapacity }))
                      : Effect.succeed(event),
                  ),
                ),
              ),
            )
          }),
        ).pipe(Stream.map(eventData), Stream.pipeThroughChannel(Sse.encode()))
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
