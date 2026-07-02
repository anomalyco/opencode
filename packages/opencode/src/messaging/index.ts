import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Deferred, Duration, Effect, Layer, Schema, Context, Option } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "@/session/schema"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@opencode-ai/core/event"

const ROUND_TRIP_CAP = 8
const DEFAULT_TIMEOUT = Duration.seconds(300)

export const Sent = Schema.Struct({
  childSessionID: SessionID,
  parentSessionID: SessionID,
  body: Schema.String,
  expectReply: Schema.Boolean,
}).annotate({ identifier: "MessagingSent" })

export const Replied = Schema.Struct({
  childSessionID: SessionID,
  parentSessionID: SessionID,
  body: Schema.String,
}).annotate({ identifier: "MessagingReplied" })

export const Rejected = Schema.Struct({
  childSessionID: SessionID,
}).annotate({ identifier: "MessagingRejected" })

export const Event = {
  Sent: EventV2.define({ type: "messaging.sent", schema: Sent.fields }),
  Replied: EventV2.define({ type: "messaging.replied", schema: Replied.fields }),
  Rejected: EventV2.define({ type: "messaging.rejected", schema: Rejected.fields }),
}

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

interface State {
  pending: Map<SessionID, PendingReply>
  counters: Map<SessionID, ChildCounters>
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
        }
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const item of state.pending.values()) {
              yield* Deferred.fail(item.deferred, new RejectedError())
            }
            state.pending.clear()
            state.counters.clear()
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
        yield* events.publish(Event.Sent, {
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
          yield* events.publish(Event.Sent, {
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
      yield* events.publish(Event.Replied, {
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
      yield* events.publish(Event.Rejected, { childSessionID })
      yield* Deferred.fail(existing.deferred, new RejectedError())
    })

    const list: Interface["list"] = Effect.fn("Messaging.list")(function* () {
      const value = yield* InstanceState.get(state)
      return Array.from(value.pending.values())
    })

    return Service.of({ send, reply, reject, list })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [EventV2Bridge.node] })

export * as Messaging from "."
