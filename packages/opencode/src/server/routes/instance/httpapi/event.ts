import { Bus } from "@/bus"
import { Log } from "@/util"
import { Effect } from "effect"
import * as Stream from "effect/Stream"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"

const log = Log.create({ service: "server" })

export const EventPaths = {
  event: "/event",
} as const

function eventData(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`
}

export const eventRoute = HttpRouter.add(
  "GET",
  EventPaths.event,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const events = bus.subscribeAll().pipe(Stream.takeUntil((event) => event.type === Bus.InstanceDisposed.type))
    const heartbeat = Stream.tick("10 seconds").pipe(
      Stream.drop(1),
      Stream.map(() => ({ type: "server.heartbeat", properties: {} })),
    )

    log.info("event connected")
    return HttpServerResponse.stream(
      Stream.make({ type: "server.connected", properties: {} }).pipe(
        Stream.concat(events.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }))),
        Stream.map(eventData),
        Stream.encodeText,
        Stream.ensuring(Effect.sync(() => log.info("event disconnected"))),
      ),
      {
        contentType: "text/event-stream",
        headers: {
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
          "X-Content-Type-Options": "nosniff",
        },
      },
    )
  }).pipe(Effect.provide(Bus.layer)),
)
