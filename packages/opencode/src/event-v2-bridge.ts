// Opencode publish boundary for core events. Attach routed instance location
// so direct EventV2 consumers can isolate directory/workspace streams.
//
// Also the closure-aware replay boundary: `replay`/`replayAll` are wrapped so a replay cannot
// reach the destructive projectors without a permit issued under a mutation reservation.
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { GlobalBus } from "@/bus/global"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionReplayPermit } from "@/session/closure/replay-permit"
import { Context, Effect, Layer } from "effect"

export class Service extends Context.Service<Service, EventV2.Interface>()("@opencode/EventV2Bridge") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service

    const publish: EventV2.Interface["publish"] = (definition, data, options) =>
      Effect.gen(function* () {
        if (options?.location) return yield* events.publish(definition, data, options)
        const ctx = yield* InstanceRef
        if (!ctx) return yield* events.publish(definition, data, options)
        const workspaceID = yield* WorkspaceRef
        return yield* events.publish(definition, data, {
          ...options,
          location: new Location.Info({
            directory: AbsolutePath.make(ctx.directory),
            ...(workspaceID ? { workspaceID } : {}),
            project: { id: Project.ID.make(ctx.project.id), directory: AbsolutePath.make(ctx.worktree) },
          }),
        })
      })

    const unsubscribe = yield* events.listen((event) =>
      Effect.gen(function* () {
        const ctx = yield* InstanceRef
        const workspaceID = (yield* WorkspaceRef) ?? event.location?.workspaceID
        GlobalBus.emit("event", {
          directory: event.location?.directory ?? ctx?.directory,
          project: ctx?.project.id,
          workspace: workspaceID,
          payload: { id: event.id, type: event.type, properties: event.data },
        })
        if (event.durable === undefined) return
        GlobalBus.emit("event", {
          directory: event.location?.directory ?? ctx?.directory,
          project: ctx?.project.id,
          workspace: workspaceID,
          payload: {
            type: "sync",
            syncEvent: {
              id: event.id,
              type: EventV2.versionedType(event.type, event.durable.version),
              seq: event.durable.seq,
              aggregateID: event.durable.aggregateID,
              data: event.data,
            },
          },
        })
      }),
    )
    yield* Effect.addFinalizer(() => unsubscribe)

    // Replay reaches the projectors' row deletes, so it must not run outside a mutation
    // reservation. Every production replay is routed through `SessionMutation.replayLeased`, which
    // is the only issuer of a permit; this is the check that makes routing around it impossible
    // rather than merely discouraged.
    //
    // Deliberately a permit lookup and never a coordinator call. A coordinator dependency here
    // would propagate to the twenty-odd modules that build this bridge, every one of which would
    // then have to provide it. The refusal decision happens earlier, in `replayLeased`.
    const replay: EventV2.Interface["replay"] = (event, options) =>
      SessionReplayPermit.require_([event.aggregateID]).pipe(Effect.andThen(events.replay(event, options)))

    const replayAll: EventV2.Interface["replayAll"] = (list, options) =>
      SessionReplayPermit.require_(list.map((item) => item.aggregateID)).pipe(
        Effect.andThen(events.replayAll(list, options)),
      )

    return Service.of({ ...events, publish, replay, replayAll })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [EventV2.node] })

export * as EventV2Bridge from "./event-v2-bridge"
