import { NodeHttpServerRequest } from "@effect/platform-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Effect, Stream } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { EventFeed } from "../event-feed"

/** Bun may emit IncomingMessage aborted/close without ServerResponse.close — destroy so the fiber ends. */
function bridgeClientDisconnect(request: HttpServerRequest.HttpServerRequest) {
  return Effect.sync(() => {
    try {
      const incoming = NodeHttpServerRequest.toIncomingMessage(request)
      const response = NodeHttpServerRequest.toServerResponse(request)
      const destroy = () => {
        if (!response.writableEnded && !response.destroyed) response.destroy()
      }
      if (incoming.aborted || incoming.destroyed) {
        destroy()
        return
      }
      incoming.once("aborted", destroy)
      incoming.once("close", destroy)
    } catch {
      // Non-Node sources (tests using fromWeb) have no ServerResponse to bridge.
    }
  })
}

export const EventHandler = HttpApiBuilder.group(Api, "server.event", (handlers) =>
  Effect.gen(function* () {
    const feed = yield* EventFeed.Service
    return handlers.handleRaw("event.subscribe", (ctx) =>
      Effect.gen(function* () {
        yield* bridgeClientDisconnect(ctx.request)
        // handleRaw still Schema-decodes query; map into feed interest without re-parsing the URL.
        const interest = EventFeed.interestFromSubscribeQuery(ctx.query)
        const connected = {
          id: EventV2.ID.create(),
          type: "server.connected",
          data: {},
        } as const
        const output = Stream.unwrap(
          feed
            .subscribe(interest)
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
