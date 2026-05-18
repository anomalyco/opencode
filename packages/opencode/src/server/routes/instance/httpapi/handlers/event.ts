import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import type { InstanceContext } from "@/project/instance-context"
import { GlobalBus } from "@/bus/global"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
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

function eventLocation(instance: InstanceContext, workspaceID: WorkspaceV2.ID | undefined) {
  return new Location.Info({
    directory: AbsolutePath.make(instance.directory),
    ...(workspaceID ? { workspaceID } : {}),
    project: { id: Project.ID.make(instance.project.id), directory: AbsolutePath.make(instance.worktree) },
  })
}

type LegacyEvent = { readonly id: string; readonly type: string; readonly properties: unknown }
type StreamEvent = EventV2.Payload | LegacyEvent

function legacyEvent(event: EventV2.Payload): LegacyEvent {
  return { id: event.id, type: event.type, properties: event.data }
}

function eventResponse(events: EventV2.Interface) {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const nativeEvents = request.url.startsWith("/api/")
    const instance = yield* InstanceState.context
    const workspaceID = yield* InstanceState.workspaceID
    const location = eventLocation(instance, workspaceID)
    // Listener registration is eager, so events published after this point cannot
    // be lost while the HTTP body fiber is starting or emitting server.connected.
    const queue = yield* Queue.unbounded<EventV2.Payload>()
    const unsubscribe = yield* events.listen((event) => Effect.sync(() => Queue.offerUnsafe(queue, { ...event, location })))
    yield* Effect.addFinalizer(() => unsubscribe.pipe(Effect.andThen(Queue.shutdown(queue))))
    const formatEvent = (event: EventV2.Payload): StreamEvent => (nativeEvents ? event : legacyEvent(event))
    const stream = Stream.fromQueue(queue).pipe(
      Stream.filter(
        (event) =>
          event.location?.directory === instance.directory &&
          (event.location.workspaceID === undefined || event.location.workspaceID === workspaceID),
      ),
      Stream.map(formatEvent),
    )
    const disposed = Stream.callback<StreamEvent>((queue) => {
      const listener = (event: {
        directory?: string
        payload: { id?: string; type?: string; properties?: unknown }
      }) => {
        if (event.directory !== instance.directory || event.payload.type !== "server.instance.disposed") return
        const payload = {
          id: EventV2.ID.make(event.payload.id ?? eventID()),
          type: "server.instance.disposed",
          location,
          data: event.payload.properties ?? {},
        }
        Queue.offerUnsafe(queue, formatEvent(payload))
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
      Stream.map(() => {
        const event = { id: eventID(), type: "server.heartbeat", location, data: {} }
        return formatEvent(event)
      }),
    )

    yield* Effect.logInfo("event connected")
    return HttpServerResponse.stream(
      Stream.make(formatEvent({ id: eventID(), type: "server.connected", location, data: {} })).pipe(
        Stream.concat(output.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }))),
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
