import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { GlobalBus } from "@/bus/global"
import { EventV2 } from "@opencode-ai/core/event"
import { NodeHttpServerRequest } from "@effect/platform-node"
import { Effect, Queue } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { EventApi } from "../groups/event"

function eventData(data: unknown): Sse.Event {
  return {
    _tag: "Event",
    event: "message",
    id: undefined,
    data: JSON.stringify(data),
  }
}

function eventID() {
  return EventV2.ID.create()
}

function eventResponse(events: EventV2.Interface) {
  return Effect.gen(function* () {
    const instance = yield* InstanceState.context
    const workspaceID = yield* InstanceState.workspaceID
    const request = yield* HttpServerRequest.HttpServerRequest
    const output = Stream.scoped(
      Stream.unwrap(
        Effect.gen(function* () {
          // Acquire both subscriptions in the response body's scope before its
          // first server.connected element. Disconnecting the body releases them.
          const queue = yield* Queue.unbounded<EventV2.Payload>()
          const disposedQueue = yield* Queue.unbounded<{ id: string; type: string; properties: unknown }>()
          const disconnectedQueue = yield* Queue.unbounded<void>()
          const listener = (event: {
            directory?: string
            payload: { id?: string; type?: string; properties?: unknown }
          }) => {
            if (event.directory !== instance.directory || event.payload.type !== "server.instance.disposed") return
            Queue.offerUnsafe(disposedQueue, {
              id: event.payload.id ?? eventID(),
              type: "server.instance.disposed",
              properties: event.payload.properties ?? {},
            })
          }
          yield* Effect.acquireRelease(
            Effect.gen(function* () {
              const unsubscribe = yield* events.listen((event) => Effect.sync(() => Queue.offerUnsafe(queue, event)))
              GlobalBus.on("event", listener)
              // The listening server is Node-backed, while the in-process web
              // handler has a Web Request source and relies on stream release.
              const socket: ReturnType<typeof NodeHttpServerRequest.toIncomingMessage>["socket"] | undefined =
                NodeHttpServerRequest.toIncomingMessage(request)?.socket
              let closed = false
              const onClose = () => {
                if (closed) return
                closed = true
                GlobalBus.off("event", listener)
                Queue.offerUnsafe(disconnectedQueue, undefined)
              }
              socket?.once("close", onClose)
              if (socket?.destroyed) onClose()
              return { unsubscribe, socket, onClose }
            }),
            ({ unsubscribe, socket, onClose }) =>
              Effect.gen(function* () {
                socket?.off("close", onClose)
                GlobalBus.off("event", listener)
                yield* unsubscribe
              }),
          )

          const stream = Stream.fromQueue(queue).pipe(
            Stream.filter(
              (event) =>
                event.location?.directory === instance.directory &&
                (event.location.workspaceID === undefined || event.location.workspaceID === workspaceID),
            ),
            Stream.map((event) => ({ id: event.id, type: event.type, properties: event.data })),
          )
          const heartbeat = Stream.tick("10 seconds").pipe(
            Stream.drop(1),
            Stream.map(() => ({ id: eventID(), type: "server.heartbeat", properties: {} })),
          )
          const outputEvents = Stream.make({ id: eventID(), type: "server.connected", properties: {} }).pipe(
            Stream.concat(
              stream.pipe(
                Stream.merge(Stream.fromQueue(disposedQueue), { haltStrategy: "left" }),
                Stream.merge(heartbeat, { haltStrategy: "left" }),
              ),
            ),
          )
          const disconnected = Stream.fromQueue(disconnectedQueue).pipe(Stream.take(1), Stream.drain)
          return outputEvents.pipe(Stream.merge(disconnected, { haltStrategy: "right" }))
        }),
      ),
    )

    yield* Effect.logInfo("event connected")
    return HttpServerResponse.stream(
      output.pipe(
        Stream.map(eventData),
        Stream.pipeThroughChannel(Sse.encode()),
        Stream.encodeText,
        Stream.ensuring(Effect.logInfo("event disconnected")),
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
  })
}

export const eventHandlers = HttpApiBuilder.group(EventApi, "event", (handlers) =>
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    return handlers.handleRaw(
      "subscribe",
      Effect.fn("EventHttpApi.subscribe")(function* () {
        return yield* eventResponse(events)
      }),
    )
  }),
)
