import { Bus } from "@/bus"
import { Log } from "@/util"
import { Effect, Queue } from "effect"
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
    return HttpServerResponse.stream(
      Stream.callback<string>((queue) =>
        Effect.gen(function* () {
          let done = false
          let unsubscribe = () => {}
          const push = (data: unknown) => Queue.offerUnsafe(queue, eventData(data))
          const stop = () => {
            if (done) return
            done = true
            clearInterval(heartbeat)
            unsubscribe()
            Queue.endUnsafe(queue)
            log.info("event disconnected")
          }

          log.info("event connected")
          push({ type: "server.connected", properties: {} })

          const heartbeat = setInterval(() => {
            push({ type: "server.heartbeat", properties: {} })
          }, 10_000)

          unsubscribe = yield* bus.subscribeAllCallback((event) => {
            push(event)
            if (event.type === Bus.InstanceDisposed.type) stop()
          })

          yield* Effect.addFinalizer(() => Effect.sync(stop))
        }),
      ).pipe(Stream.encodeText),
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
