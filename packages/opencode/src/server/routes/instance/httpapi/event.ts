import { Bus } from "@/bus"
import { GlobalBus, type GlobalEvent as GlobalBusEvent } from "@/bus/global"
import * as InstanceState from "@/effect/instance-state"
import type { WorkspaceID } from "@/control-plane/schema"
import type { InstanceContext } from "@/project/instance"
import * as Log from "@opencode-ai/core/util/log"
import { Effect, Queue, Schema } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { WorkspaceRoutingQuery } from "./middleware/workspace-routing"

const log = Log.create({ service: "server" })

export const EventPaths = {
  event: "/event",
} as const

export const EventApi = HttpApi.make("event").add(
  HttpApiGroup.make("event")
    .add(
      HttpApiEndpoint.get("subscribe", EventPaths.event, {
        query: WorkspaceRoutingQuery,
        success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/event-stream" })),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "event.subscribe",
          summary: "Subscribe to events",
          description: "Get events",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "event", description: "Instance event stream route." })),
)

function eventData(data: unknown): Sse.Event {
  return {
    _tag: "Event",
    event: "message",
    id: undefined,
    data: JSON.stringify(data),
  }
}

function eventResponse(context: { instance: InstanceContext; workspace: WorkspaceID | undefined }) {
  const events = Stream.callback<GlobalBusEvent>((queue) => {
    const handler = (event: GlobalBusEvent) => {
      if (event.directory !== context.instance.directory) return
      if (event.workspace !== context.workspace) return
      Queue.offerUnsafe(queue, event)
    }
    return Effect.acquireRelease(
      Effect.sync(() => GlobalBus.on("event", handler)),
      () => Effect.sync(() => GlobalBus.off("event", handler)),
    )
  }).pipe(
    Stream.map((event) => event.payload),
    Stream.takeUntil((event) => event.type === Bus.InstanceDisposed.type),
  )
  const heartbeat = Stream.tick("10 seconds").pipe(
    Stream.drop(1),
    Stream.map(() => ({ id: Bus.createID(), type: "server.heartbeat", properties: {} })),
  )

  log.info("event connected")
  return HttpServerResponse.stream(
    Stream.make({ id: Bus.createID(), type: "server.connected", properties: {} }).pipe(
      Stream.concat(events.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }))),
      Stream.map(eventData),
      Stream.pipeThroughChannel(Sse.encode()),
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
}

export const eventHandlers = HttpApiBuilder.group(EventApi, "event", (handlers) =>
  Effect.gen(function* () {
    return handlers.handleRaw(
      "subscribe",
      Effect.fn("EventHttpApi.subscribe")(function* () {
        return eventResponse({
          instance: yield* InstanceState.context,
          workspace: yield* InstanceState.workspaceID,
        })
      }),
    )
  }),
)
