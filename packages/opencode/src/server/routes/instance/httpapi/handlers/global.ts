import { Config } from "@/config/config"
import { GlobalBus, type GlobalEvent as GlobalBusEvent } from "@/bus/global"
import { EffectBridge } from "@/effect/bridge"
import { EventV2 } from "@opencode-ai/core/event"
import { Installation } from "@/installation"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Effect, Queue } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { GlobalUpgradeInput } from "../groups/global"
import { makeDesyncLatch } from "./event-desync"
import { frame, isTransientEvent, join } from "./sse-frame"

function eventResponse() {
  return Effect.gen(function* () {
    yield* Effect.logInfo("global event connected")
    // The buffer is bounded: a slow consumer drops the oldest events instead of
    // growing memory for every event in the process. Mirrors the per-instance
    // bound in handlers/event.ts. `sync` payloads are part of the declared
    // GlobalEvent contract and are replayed by remote workspace sync, so they
    // must not be filtered here.
    const queue = yield* Queue.sliding<GlobalBusEvent>(8192)
    // A dedicated bounded queue keeps the overflow marker from being evicted by the
    // burst it warns about; the TUI needs the signal to refetch instead of diverging.
    const control = yield* Queue.sliding<GlobalBusEvent>(1)
    const desync = makeDesyncLatch({ capacity: 8192 })
    const handler = (event: GlobalBusEvent) => {
      if (desync.shouldSignal(Queue.sizeUnsafe(queue))) {
        Queue.offerUnsafe(control, {
          payload: { id: EventV2.ID.create(), type: "server.desync", properties: {} },
        })
      }
      Queue.offerUnsafe(queue, event)
    }
    // The global stream cannot replay from an arbitrary id, so a resume attempt is
    // answered with a desync marker (the TUI then refetches) instead of being ignored.
    const request = yield* HttpServerRequest.HttpServerRequest
    if (request.headers["last-event-id"]) {
      Queue.offerUnsafe(control, { payload: { id: EventV2.ID.create(), type: "server.desync", properties: {} } })
    }
    GlobalBus.on("event", handler)
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => GlobalBus.off("event", handler)).pipe(
        Effect.andThen(Queue.shutdown(queue)),
        Effect.andThen(Queue.shutdown(control)),
      ),
    )
    const events = Stream.fromQueue(queue).pipe(Stream.merge(Stream.fromQueue(control), { haltStrategy: "left" }))
    const heartbeat = Stream.tick("10 seconds").pipe(
      Stream.drop(1),
      Stream.map(() => ({ payload: { id: EventV2.ID.create(), type: "server.heartbeat", properties: {} } })),
    )

    return HttpServerResponse.stream(
      Stream.make({ payload: { id: EventV2.ID.create(), type: "server.connected", properties: {} } }).pipe(
        Stream.concat(events.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }))),
        Stream.map((event) => {
          const id = event.payload?.id
          // A durable event and its `sync` mirror share an id but carry different
          // bodies, so the type is part of the frame cache key.
          const type = event.payload?.type ?? ""
          return frame(`${id ?? ""}\0${type}`, id, event, !isTransientEvent(type))
        }),
        Stream.mapArray((batch) => (batch.length <= 1 ? batch : [join(batch)])),
        Stream.ensuring(Effect.logInfo("global event disconnected")),
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

export const globalHandlers = HttpApiBuilder.group(RootHttpApi, "global", (handlers) =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const installation = yield* Installation.Service
    const bridge = yield* EffectBridge.make()

    const health = Effect.fn("GlobalHttpApi.health")(function* () {
      return { healthy: true as const, version: InstallationVersion }
    })

    const event = Effect.fn("GlobalHttpApi.event")(function* () {
      return yield* eventResponse()
    })

    const configGet = Effect.fn("GlobalHttpApi.configGet")(function* () {
      return yield* config.getGlobal()
    })

    const configUpdate = Effect.fn("GlobalHttpApi.configUpdate")(function* (ctx) {
      const result = yield* config.updateGlobal(ctx.payload)
      if (result.changed) bridge.fork(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }))
      return result.info
    })

    const dispose = Effect.fn("GlobalHttpApi.dispose")(function* () {
      yield* disposeAllInstancesAndEmitGlobalDisposed()
      return true
    })

    const upgrade = Effect.fn("GlobalHttpApi.upgrade")(function* (ctx: { payload: typeof GlobalUpgradeInput.Type }) {
      const method = yield* installation.method()
      if (method === "unknown") {
        return HttpServerResponse.jsonUnsafe(
          { success: false as const, error: "Unknown installation method" },
          { status: 400 },
        )
      }
      const target = ctx.payload.target
      const result = yield* installation.upgrade(method, target).pipe(
        Effect.as({ success: true as const, version: target }),
        Effect.catch((err) =>
          Effect.succeed({
            success: false as const,
            error: err instanceof Error ? err.message : String(err),
          }),
        ),
      )
      if (!result.success) return HttpServerResponse.jsonUnsafe(result, { status: 500 })
      GlobalBus.emit("event", {
        directory: "global",
        payload: {
          type: Installation.Event.Updated.type,
          properties: { version: target },
        },
      })
      return HttpServerResponse.jsonUnsafe(result)
    })

    return handlers
      .handle("health", health)
      .handleRaw("event", event)
      .handle("configGet", configGet)
      .handle("configUpdate", configUpdate)
      .handle("dispose", dispose)
      .handle("upgrade", upgrade)
  }),
)
