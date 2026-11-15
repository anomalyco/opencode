export * as SessionIdleCompaction from "./idle-compaction.js"

import { Clock, Context, DateTime, Duration, Effect, FiberMap, Layer, Option, Stream } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Session } from "@opencode/schema/session"
import { Agent } from "../agent.js"
import { Bus } from "../bus.js"
import { Config } from "../config.js"
import { Flag } from "../flag.js"
import { LocationServiceMap } from "../location-service-map.js"
import { SessionCompaction } from "./compaction.js"
import { SessionContext } from "./context.js"
import { SessionEvent } from "./event.js"
import { SessionExecution } from "./execution.js"
import { SessionInbox } from "./inbox.js"
import { SessionMessage } from "./message.js"
import { SessionPresence } from "./presence.js"
import { SessionStore } from "./store.js"

// How far before cache expiry the timer fires. Must stay above SessionCompaction.CACHE_MARGIN so the fire
// moment is inside the warm window; the anchor, not time_idle, is the cache's clock.
const FIRE_MARGIN = Duration.seconds(90)

export interface Interface {
  /** Re-arms the idle timer from durable state. Cheap process-local checks run before any Location load. */
  readonly touch: (sessionID: Session.ID) => Effect.Effect<void>
  readonly cancel: (sessionID: Session.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionIdleCompaction") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const presence = yield* SessionPresence.Service
    const inbox = yield* SessionInbox.Service
    const execution = yield* SessionExecution.Service
    const locations = yield* LocationServiceMap.Service
    const config = yield* Effect.serviceOption(Config.Service)
    const bus = yield* Bus.Service
    const timers = yield* FiberMap.make<Session.ID>()

    const cancel = (sessionID: Session.ID) => FiberMap.remove(timers, sessionID)

    /** The Location-scoped firing laws: model, cache clock, size floor, and epoch. */
    const atLocation = Effect.fn("SessionIdleCompaction.atLocation")(function* (
      session: Session.Info,
      messages: ReadonlyArray<SessionMessage.Info>,
    ) {
      const compaction = yield* SessionCompaction.Service
      const context = yield* SessionContext.Service
      const settings = compaction.settings()
      if (!settings.auto) return undefined
      const model = yield* context.resolveModel(session).pipe(Effect.option)
      if (Option.isNone(model)) return undefined
      const ttl = model.value.cache?.ttl
      // Only an explicit TTL gives a known cache clock; warming-configured Sessions are left to warming.
      if (!ttl || model.value.compaction?.type === "native") return undefined
      const entries = Option.isSome(config) ? yield* config.value.entries() : []
      if (model.value.cache?.warming ?? Config.latest(entries, "warming")) return undefined

      const anchor = SessionCompaction.cacheAnchor(messages, model.value.ref)
      if (anchor?.type !== "assistant" || !anchor.tokens) return undefined
      const lifetime = SessionCompaction.cacheLifetime(ttl)
      const age = (yield* Clock.currentTimeMillis) - DateTime.toEpochMillis(anchor.time.created)
      if (age > lifetime - SessionCompaction.CACHE_MARGIN) return undefined

      const estimate = SessionCompaction.estimatePrompt({
        session,
        messages,
        model: model.value,
        agent: { id: Agent.defaultID, info: Agent.Info.default(Agent.defaultID) },
        initial: [],
        tools: { definitions: [], execute: () => Effect.die("idle compaction estimates without tools") },
      })
      if (estimate.measured + estimate.estimated < settings.idleMinTokens) return undefined

      // Once per idle epoch: a completed or failed compaction since the latest user input blocks another,
      // so even a fast provider failure that leaves the anchor warm cannot loop.
      const lastUser = messages.findLastIndex((message) => message.type === "user")
      if (
        messages.slice(lastUser + 1).some((message) => message.type === "compaction" && message.status !== "running")
      )
        return undefined

      return { anchor, lifetime }
    })

    /** The firing laws. Returns the admission inputs when every law holds, undefined otherwise. */
    const eligible = Effect.fn("SessionIdleCompaction.eligible")(function* (sessionID: Session.ID) {
      if (!(yield* Flag.enabled("idle_compaction"))) return undefined
      if (!(yield* presence.present(sessionID))) return undefined
      const session = yield* store.get(sessionID)
      if (!session || session.parentID || session.time.archived || session.revert) return undefined
      if (yield* execution.isActive(sessionID)) return undefined
      if ((yield* inbox.list(sessionID)).some((item) => item.type === "user" || item.type === "synthetic"))
        return undefined

      const messages = yield* store.context(sessionID).pipe(Effect.orElseSucceed(() => []))
      const placed = yield* Effect.scoped(
        Effect.provide(atLocation(session, messages), locations.get(session.location)),
      ).pipe(Effect.option)
      if (Option.isNone(placed) || placed.value === undefined) return undefined
      return { session, ...placed.value }
    })

    const fire = Effect.fn("SessionIdleCompaction.fire")(function* (sessionID: Session.ID, due: number) {
      const now = yield* Clock.currentTimeMillis
      yield* Effect.sleep(Duration.millis(Math.max(0, due - now)))
      const ready = yield* eligible(sessionID)
      if (!ready) return
      yield* inbox.admitCompaction({
        id: SessionMessage.ID.create(),
        sessionID,
        delivery: "queue",
        payload: {
          reason: "idle",
          idle: ready.session.time.idle ? DateTime.toEpochMillis(ready.session.time.idle) : undefined,
        },
      })
      yield* execution.wake(sessionID)
    })

    const touch = Effect.fn("SessionIdleCompaction.touch")(function* (sessionID: Session.ID) {
      const ready = yield* eligible(sessionID)
      if (!ready) return
      const due =
        DateTime.toEpochMillis(ready.anchor.time.created) + ready.lifetime - Duration.toMillis(FIRE_MARGIN)
      yield* FiberMap.run(timers, sessionID, fire(sessionID, due))
    })

    // Terminal executions arm the timer; new work and deletion cancel it. A shutdown interruption preserves
    // the execution claim for startup recovery, so it must not arm.
    yield* bus
      .subscribe([
        SessionEvent.Execution.Succeeded,
        SessionEvent.Execution.Failed,
        SessionEvent.Execution.Interrupted,
        SessionEvent.Execution.Started,
        SessionEvent.Deleted,
      ])
      .pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            const sessionID = event.data.sessionID
            if (event.type === "session.execution.started" || event.type === "session.deleted")
              return yield* cancel(sessionID)
            if (event.type === "session.execution.interrupted" && event.data.reason === "shutdown") return
            yield* touch(sessionID)
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )

    return Service.of({ touch, cancel })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [
    SessionStore.node,
    SessionPresence.node,
    SessionInbox.node,
    SessionExecution.node,
    LocationServiceMap.node,
    Bus.node,
  ],
})
