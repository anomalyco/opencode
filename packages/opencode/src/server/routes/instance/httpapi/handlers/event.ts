import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { GlobalBus } from "@/bus/global"
import { EventV2 } from "@opencode-ai/core/event"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { Effect, Queue } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerResponse } from "effect/unstable/http"
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
    // Listener registration is eager, so events published after this point cannot
    // be lost while the HTTP body fiber is starting or emitting server.connected.
    const queue = yield* Queue.unbounded<EventV2.Payload>()
    const unsubscribe = yield* events.listen((event) => Effect.sync(() => Queue.offerUnsafe(queue, event)))
    yield* Effect.addFinalizer(() => unsubscribe)
    const sessions = yield* Session.Service

    // OPENCODE_EVENT_SUBTREE (default on): a subscription on directory D receives events from every
    // session whose tree is ROOTED in D — the open session plus all of its (possibly cross-directory)
    // descendant subagents. This is what lets a monorepo-root TUI observe a subagent launched in a
    // subproject (live progress, child-session navigation, live questions). Matching is by session
    // lineage (parentID), NOT by the child's own directory, so it is robust to subagents anchored
    // anywhere — including worktrees outside the subscription directory. Events without an owning
    // session (global/instance events) stay scoped to the exact instance directory. Set
    // OPENCODE_EVENT_SUBTREE=0 to restore strict matching (events only for sessions whose own
    // directory equals the subscription directory).
    // TODO(PR anomalyco/opencode#29271): revisit this env gate before upstreaming (opt-in or drop it).
    const subtreeEvents = !["0", "false", "off", "no"].includes(
      (process.env["OPENCODE_EVENT_SUBTREE"] ?? "").toLowerCase(),
    )

    // Memoized lineage resolver: maps a session id to the directory of its root ancestor (the
    // subscription anchor for the whole tree). Cached per connection; each session is walked at most
    // once, so subsequent events for it are an O(1) map lookup.
    const rootDirectoryCache = new Map<string, string>()
    const rootDirectoryOf = (sessionID: string): Effect.Effect<string | undefined> =>
      Effect.gen(function* () {
        const chain: string[] = []
        let current: string | undefined = sessionID
        let root: string | undefined = undefined
        while (current) {
          const cached = rootDirectoryCache.get(current)
          if (cached) {
            root = cached
            break
          }
          if (chain.includes(current)) break // cycle guard (should not happen)
          chain.push(current)
          const info: Session.Info | undefined = yield* sessions
            .get(SessionID.make(current))
            .pipe(Effect.catchCause(() => Effect.succeed(undefined)))
          if (!info) break
          if (!info.parentID) {
            root = info.directory
            break
          }
          current = info.parentID
        }
        if (root) for (const id of chain) rootDirectoryCache.set(id, root)
        return root
      })

    const sessionIDOf = (event: EventV2.Payload): string | undefined => {
      const sid = (event.data as { sessionID?: unknown } | undefined)?.sessionID
      return typeof sid === "string" ? sid : undefined
    }

    const matches = (event: EventV2.Payload): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        if (event.location?.workspaceID !== undefined && event.location.workspaceID !== workspaceID) return false
        const sessionID = sessionIDOf(event)
        // Global/instance events (no owning session) keep the historical exact-directory behaviour.
        if (sessionID === undefined) return event.location?.directory === instance.directory
        if (!subtreeEvents) return event.location?.directory === instance.directory
        const root = yield* rootDirectoryOf(sessionID)
        return root === instance.directory
      })

    const stream = Stream.fromQueue(queue).pipe(
      Stream.mapEffect((event) => matches(event).pipe(Effect.map((keep) => ({ event, keep })))),
      Stream.filter(({ keep }) => keep),
      Stream.map(({ event }) => ({ id: event.id, type: event.type, properties: event.data })),
    )
    const disposed = Stream.callback<{ id: string; type: string; properties: unknown }>((queue) => {
      const listener = (event: {
        directory?: string
        payload: { id?: string; type?: string; properties?: unknown }
      }) => {
        if (event.directory !== instance.directory || event.payload.type !== "server.instance.disposed") return
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
