import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { GlobalBus } from "@/bus/global"
import { EventV2 } from "@opencode-ai/core/event"
import { Effect, Queue } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { EventApi } from "../groups/event"
import { makeDesyncLatch } from "./event-desync"
import { clearFrameCache, frame, isTransientEvent, join } from "./sse-frame"

const EVENT_BUFFER = 8192

type Frame = { id: string; type: string; properties: unknown }

function eventID() {
  return EventV2.ID.create()
}

function eventResponse(events: EventV2.Interface) {
  return Effect.gen(function* () {
    const instance = yield* InstanceState.context
    const workspaceID = yield* InstanceState.workspaceID
    // Listener registration is eager, so events published after this point cannot
    // be lost while the HTTP body fiber is starting or emitting server.connected.
    // The buffer is bounded: a slow consumer drops the oldest events instead of
    // growing memory for every event in the process.
    const queue = yield* Queue.sliding<Frame>(EVENT_BUFFER)
    // The desync marker gets its own sliding(1) queue: offering it into the data queue
    // lets a fast burst evict the very marker warning about that burst. A dedicated
    // bounded queue guarantees the consumer receives at least the latest marker.
    const control = yield* Queue.sliding<Frame>(1)
    const desync = makeDesyncLatch({ capacity: EVENT_BUFFER })
    // Frames carry an `id:` for client-side dedup, but the server cannot replay from an
    // arbitrary id, so a resume attempt gets a desync marker instead of being ignored.
    const request = yield* HttpServerRequest.HttpServerRequest
    if (request.headers["last-event-id"]) {
      Queue.offerUnsafe(control, { id: eventID(), type: "server.desync", properties: {} })
    }
    const unsubscribe = yield* events.listen((event) =>
      Effect.sync(() => {
        // Foreign directories and workspaces are rejected before enqueue. Events
        // published without a workspace are directory-scoped by design and reach
        // every workspace connection on this directory (F-098).
        if (event.location?.directory !== instance.directory) return
        if (event.location.workspaceID !== undefined && event.location.workspaceID !== workspaceID) return
        // Sliding eviction is silent. Signal the gap on a cool-down while the
        // buffer stays full so sustained overflow keeps telling the consumer it
        // is behind, and re-arm immediately once the queue drains.
        if (desync.shouldSignal(Queue.sizeUnsafe(queue))) {
          Queue.offerUnsafe(control, { id: eventID(), type: "server.desync", properties: {} })
        }
        Queue.offerUnsafe(queue, { id: event.id, type: event.type, properties: event.data })
      }),
    )
    yield* Effect.addFinalizer(() => unsubscribe.pipe(Effect.andThen(Queue.shutdown(control)), Effect.asVoid))
    const stream = Stream.fromQueue(queue).pipe(
      Stream.merge(Stream.fromQueue(control), { haltStrategy: "left" }),
    )
    const disposed = Stream.callback<{ id: string; type: string; properties: unknown }>((queue) => {
      const listener = (event: {
        directory?: string
        payload: { id?: string; type?: string; properties?: unknown }
      }) => {
        if (event.directory !== instance.directory || event.payload.type !== "server.instance.disposed") return
        // The frames retained for this instance are dead weight once it is gone.
        clearFrameCache(instance.directory)
        Queue.offerUnsafe(queue, {
          id: event.payload.id ?? eventID(),
          type: "server.instance.disposed",
          properties: event.payload.properties ?? {},
        })
      }
      return Effect.acquireRelease(
        Effect.sync(() => GlobalBus.on("event", listener)),
        () => Effect.sync(() => GlobalBus.off("event", listener)),
      )
    })
    const output = stream.pipe(
      Stream.merge(disposed, { haltStrategy: "left" }),
      Stream.takeUntil((event) => event.type === "server.instance.disposed"),
    )
    const heartbeat = Stream.tick("10 seconds").pipe(
      Stream.drop(1),
      Stream.map(() => ({ id: eventID(), type: "server.heartbeat", properties: {} })),
    )

    yield* Effect.logInfo("event connected")
    return HttpServerResponse.stream(
      Stream.make({ id: eventID(), type: "server.connected", properties: {} }).pipe(
        Stream.concat(output.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }))),
        Stream.map((event) => frame(event.id, event.id, event, !isTransientEvent(event.type), instance.directory)),
        Stream.mapArray((batch) => (batch.length <= 1 ? batch : [join(batch)])),
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
