import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Deferred, Duration, Effect, Layer, Schema, Context, Option } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "@/session/schema"
import { EventV2Bridge } from "@/event-v2-bridge"
import { MessagingEvent } from "@opencode-ai/schema/messaging-event"

export const Sent = MessagingEvent.Sent
export const Replied = MessagingEvent.Replied
export const Rejected = MessagingEvent.Rejected

const ROUND_TRIP_CAP = 8
const DEFAULT_TIMEOUT = Duration.seconds(300)
export const INBOX_OUTBOUND_BUDGET = 20
export const INBOX_CAP = 50
export const DEDUP_WINDOW = 100
export const TREE_MESSAGE_CAP = 2000

export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("Messaging.RejectedError", {}) {
  override get message() {
    return "The parent agent is no longer available to reply"
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Messaging.NotFoundError", {
  childSessionID: SessionID,
}) {}

export class ReplyTimeoutError extends Schema.TaggedErrorClass<ReplyTimeoutError>()("Messaging.ReplyTimeoutError", {
  childSessionID: SessionID,
}) {}

export class AbuseError extends Schema.TaggedErrorClass<AbuseError>()("Messaging.AbuseError", {
  detail: Schema.String,
}) {
  override get message() {
    return this.detail
  }
}

interface PendingReply {
  childSessionID: SessionID
  parentSessionID: SessionID
  body: string
  deferred: Deferred.Deferred<string, RejectedError>
}

interface ChildCounters {
  inFlight: number
  roundTrips: number
}

export interface InboxItem {
  from: SessionID
  fromSlug: string
  body: string
  time: number
}

interface State {
  pending: Map<SessionID, PendingReply>
  counters: Map<SessionID, ChildCounters>
  registry: Map<string, SessionID>
  allow: Map<SessionID, string[]>
  inbox: Map<SessionID, InboxItem[]>
  dedup: Map<SessionID, string[]>
  outbound: Map<SessionID, number>
  waiters: Map<SessionID, Deferred.Deferred<void>>
  treeTotal: { count: number }
}

export interface Interface {
  readonly send: (input: {
    childSessionID: SessionID
    parentSessionID: SessionID
    body: string
    expectReply: boolean
    deliver: Effect.Effect<void>
    timeout?: Duration.Input
  }) => Effect.Effect<Option.Option<string>, RejectedError | ReplyTimeoutError | AbuseError>
  readonly reply: (input: {
    childSessionID: SessionID
    body: string
    callerSessionID: SessionID
  }) => Effect.Effect<void, NotFoundError>
  readonly reject: (childSessionID: SessionID) => Effect.Effect<void, NotFoundError>
  readonly list: () => Effect.Effect<ReadonlyArray<PendingReply>>
  readonly registerSlug: (slug: string, sessionID: SessionID) => Effect.Effect<void>
  readonly resolveSlug: (slug: string) => Effect.Effect<Option.Option<SessionID>>
  readonly setAllow: (sessionID: SessionID, slugs: string[]) => Effect.Effect<void>
  readonly getAllow: (sessionID: SessionID) => Effect.Effect<string[]>
  readonly slugFor: (sessionID: SessionID) => Effect.Effect<string>
  readonly enqueue: (input: {
    target: SessionID
    from: SessionID
    fromSlug: string
    body: string
  }) => Effect.Effect<void, AbuseError | NotFoundError>
  readonly drain: (sessionID: SessionID) => Effect.Effect<ReadonlyArray<InboxItem>>
  readonly awaitInbox: (
    sessionID: SessionID,
    opts: { timeoutMs: number },
  ) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Messaging") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const state = yield* InstanceState.make<State>(
      Effect.fn("Messaging.state")(function* () {
        const state: State = {
          pending: new Map<SessionID, PendingReply>(),
          counters: new Map<SessionID, ChildCounters>(),
          registry: new Map<string, SessionID>(),
          allow: new Map<SessionID, string[]>(),
          inbox: new Map<SessionID, InboxItem[]>(),
          dedup: new Map<SessionID, string[]>(),
          outbound: new Map<SessionID, number>(),
          waiters: new Map<SessionID, Deferred.Deferred<void>>(),
          treeTotal: { count: 0 },
        }
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const item of state.pending.values()) {
              yield* Deferred.fail(item.deferred, new RejectedError())
            }
            state.pending.clear()
            state.counters.clear()
            state.registry.clear()
            state.allow.clear()
            state.inbox.clear()
            state.dedup.clear()
            state.outbound.clear()
            state.waiters.clear()
            state.treeTotal.count = 0
          }),
        )
        return state
      }),
    )

    const send: Interface["send"] = Effect.fn("Messaging.send")(function* (input) {
      const value = yield* InstanceState.get(state)
      const counters = value.counters.get(input.childSessionID) ?? { inFlight: 0, roundTrips: 0 }
      if (input.expectReply && counters.inFlight >= 1)
        return yield* new AbuseError({ detail: "A previous message to the parent is still awaiting a reply" })
      if (counters.roundTrips >= ROUND_TRIP_CAP)
        return yield* new AbuseError({ detail: `Message round-trip cap (${ROUND_TRIP_CAP}) reached for this subagent` })

      // Atomically reserve counters BEFORE any yield (events.publish).
      // Effect only interrupts at yield points; no yield between the cap check above
      // and this .set(), so the check+reserve is race-free.
      value.counters.set(input.childSessionID, {
        inFlight: counters.inFlight + (input.expectReply ? 1 : 0),
        // roundTrips is cumulative/monotonic and intentionally never released;
        // leaking a +1 on interrupt is acceptable as anti-abuse.
        roundTrips: counters.roundTrips + 1,
      })

      if (!input.expectReply) {
        // Fire-and-forget path: no inFlight reserved above, so an interrupt here
        // can only leak the roundTrips +1 (acceptable as anti-abuse).
        yield* events.publish(Sent, {
          childSessionID: input.childSessionID,
          parentSessionID: input.parentSessionID,
          body: input.body,
          expectReply: input.expectReply,
        })
        yield* input.deliver
        return Option.none()
      }

      // release is idempotent: clears pending AND decrements inFlight (only for expect_reply
      // path, which is the only path that reserved inFlight above).
      const release = Effect.sync(() => {
        value.pending.delete(input.childSessionID)
        const current = value.counters.get(input.childSessionID)
        if (current) value.counters.set(input.childSessionID, { ...current, inFlight: Math.max(0, current.inFlight - 1) })
      })

      // expect_reply path: the publish must run INSIDE the protected block so
      // an interrupt during publish still triggers release and doesn't leak inFlight.
      return yield* Effect.ensuring(
        Effect.gen(function* () {
          yield* events.publish(Sent, {
            childSessionID: input.childSessionID,
            parentSessionID: input.parentSessionID,
            body: input.body,
            expectReply: input.expectReply,
          })

          const deferred = yield* Deferred.make<string, RejectedError>()
          value.pending.set(input.childSessionID, {
            childSessionID: input.childSessionID,
            parentSessionID: input.parentSessionID,
            body: input.body,
            deferred,
          })

          yield* input.deliver
          const result = yield* Deferred.await(deferred).pipe(
            Effect.timeoutOption(input.timeout ?? DEFAULT_TIMEOUT),
          )
          if (Option.isNone(result)) return yield* new ReplyTimeoutError({ childSessionID: input.childSessionID })
          return Option.some(result.value)
        }),
        release,
      )
    })

    const reply: Interface["reply"] = Effect.fn("Messaging.reply")(function* (input) {
      const value = yield* InstanceState.get(state)
      const existing = value.pending.get(input.childSessionID)
      if (!existing || existing.parentSessionID !== input.callerSessionID) {
        yield* Effect.logWarning("reply for unknown/unauthorized child", { childSessionID: input.childSessionID })
        return yield* new NotFoundError({ childSessionID: input.childSessionID })
      }
      value.pending.delete(input.childSessionID)
      yield* events.publish(Replied, {
        childSessionID: existing.childSessionID,
        parentSessionID: existing.parentSessionID,
        body: input.body,
      })
      yield* Deferred.succeed(existing.deferred, input.body)
    })

    const reject: Interface["reject"] = Effect.fn("Messaging.reject")(function* (childSessionID) {
      const value = yield* InstanceState.get(state)
      const existing = value.pending.get(childSessionID)
      if (!existing) return yield* new NotFoundError({ childSessionID })
      value.pending.delete(childSessionID)
      yield* events.publish(Rejected, { childSessionID })
      yield* Deferred.fail(existing.deferred, new RejectedError())
    })

    const list: Interface["list"] = Effect.fn("Messaging.list")(function* () {
      const value = yield* InstanceState.get(state)
      return Array.from(value.pending.values())
    })

    const registerSlug: Interface["registerSlug"] = Effect.fn("Messaging.registerSlug")(function* (slug, sessionID) {
      const value = yield* InstanceState.get(state)
      value.registry.set(slug, sessionID)
      if (!value.inbox.has(sessionID)) value.inbox.set(sessionID, [])
    })

    const resolveSlug: Interface["resolveSlug"] = Effect.fn("Messaging.resolveSlug")(function* (slug) {
      const value = yield* InstanceState.get(state)
      const found = value.registry.get(slug)
      return found === undefined ? Option.none<SessionID>() : Option.some(found)
    })

    const setAllow: Interface["setAllow"] = Effect.fn("Messaging.setAllow")(function* (sessionID, slugs) {
      const value = yield* InstanceState.get(state)
      value.allow.set(sessionID, slugs)
    })

    const getAllow: Interface["getAllow"] = Effect.fn("Messaging.getAllow")(function* (sessionID) {
      const value = yield* InstanceState.get(state)
      return value.allow.get(sessionID) ?? []
    })

    const slugFor: Interface["slugFor"] = Effect.fn("Messaging.slugFor")(function* (sessionID) {
      const value = yield* InstanceState.get(state)
      for (const [slug, id] of value.registry) {
        if (id === sessionID) return slug
      }
      return String(sessionID)
    })

    const enqueue: Interface["enqueue"] = Effect.fn("Messaging.enqueue")(function* (input) {
      const v = yield* InstanceState.get(state)
      if (v.treeTotal.count >= TREE_MESSAGE_CAP)
        return yield* new AbuseError({ detail: "task-tree message cap reached; coordinators must synthesize and end" })
      const used = v.outbound.get(input.from) ?? 0
      if (used >= INBOX_OUTBOUND_BUDGET)
        return yield* new AbuseError({ detail: `per-agent outbound budget (${INBOX_OUTBOUND_BUDGET}) reached` })
      const queue = v.inbox.get(input.target)
      if (queue === undefined) return yield* new NotFoundError({ childSessionID: input.target })
      const hash = `${String(input.from)}\u0000${input.body}`
      const seen = v.dedup.get(input.target) ?? []
      if (seen.includes(hash)) return
      if (queue.length >= INBOX_CAP)
        return yield* new AbuseError({ detail: `recipient inbox cap (${INBOX_CAP}) reached` })
      queue.push({ from: input.from, fromSlug: input.fromSlug, body: input.body, time: Date.now() })
      v.outbound.set(input.from, used + 1)
      v.treeTotal.count++
      v.dedup.set(input.target, [...seen, hash].slice(-DEDUP_WINDOW))
      const w = v.waiters.get(input.target)
      if (w) {
        v.waiters.delete(input.target)
        yield* Deferred.succeed(w, undefined)
      }
    })

    const drain: Interface["drain"] = Effect.fn("Messaging.drain")(function* (sessionID) {
      const v = yield* InstanceState.get(state)
      const q = v.inbox.get(sessionID) ?? []
      v.inbox.set(sessionID, [])
      return q
    })

    const awaitInbox: Interface["awaitInbox"] = Effect.fn("Messaging.awaitInbox")(function* (
      sessionID,
      opts,
    ) {
      // Bounded behaviors (Phase 1):
      //   (i) Lost-wakeup window: the empty-check at line 1 and the waiter
      //       registration at line 2 are not atomic. A concurrent `enqueue` that
      //       resolves its waiter between those two steps can leave the new
      //       item in the inbox with no waiter to wake. Self-correcting: the
      //       coordinator's NEXT `drain` (one turn later at worst) sees the
      //       item. Worst case is one timeout of latency, never message loss.
      //  (ii) Single-waiter-per-session: `v.waiters` is a `Map<SessionID,
      //       Deferred>`, so a second concurrent `awaitInbox` for the same
      //       session overwrites the first's Deferred without resolving it.
      //       Phase 1 assumes one coordinator per session. A multi-coordinator
      //       fan-in would need a per-session waiter set.
      // (iii) On interrupt mid-await: the `Effect.timeoutOption` causes the
      //       function to return `false`, and the `v.waiters.delete` cleanup
      //       runs in the same scope. The instance finalizer (added in
      //       `InstanceState.make`) sweeps any leftover waiter on shutdown.
      const v = yield* InstanceState.get(state)
      if ((v.inbox.get(sessionID)?.length ?? 0) > 0) return true
      const d = yield* Deferred.make<void>()
      v.waiters.set(sessionID, d)
      const woke = yield* Deferred.await(d).pipe(Effect.timeoutOption(Duration.millis(opts.timeoutMs)))
      v.waiters.delete(sessionID)
      return Option.isSome(woke)
    })

    return Service.of({
      send,
      reply,
      reject,
      list,
      registerSlug,
      resolveSlug,
      setAllow,
      getAllow,
      slugFor,
      enqueue,
      drain,
      awaitInbox,
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [EventV2Bridge.node] })

export const defaultLayer = layer

export * as Messaging from "."
