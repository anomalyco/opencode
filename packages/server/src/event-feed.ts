export * as EventFeed from "./event-feed"

import { Bus } from "@opencode/core/bus"
import { Event } from "@opencode/schema/event"
import { SessionEvent } from "@opencode/schema/session-event"
import type { Session } from "@opencode/schema/session"
import { isOpenCodeEvent, type EventDetailMode, type OpenCodeEvent } from "@opencode/protocol/groups/event"
import { Cause, Context, Effect, Layer, Queue, Schema, Scope, Stream } from "effect"

export const SubscriberCapacity = 4_096

export class SubscriberOverflowError extends Schema.TaggedError<SubscriberOverflowError>()(
  "EventFeed.SubscriberOverflow",
  { capacity: Schema.Int },
) {}

export class EncodingError extends Schema.TaggedError<EncodingError>()("EventFeed.EncodingError", {
  eventID: Event.ID,
  eventType: Schema.String,
  cause: Schema.Defect(),
}) {}

export type Error = SubscriberOverflowError | EncodingError

export interface ConnectOptions {
  readonly detail?: EventDetailMode
  readonly types?: ReadonlyArray<string>
}

export interface Connection {
  readonly id: string
  readonly stream: Stream.Stream<string, Error>
}

export interface Interface {
  readonly subscribe: (types?: ReadonlyArray<string>) => Effect.Effect<Stream.Stream<string, Error>, never, Scope.Scope>
  readonly connect: (options?: ConnectOptions) => Effect.Effect<Connection, never, Scope.Scope>
  readonly setSessions: (connection: string, sessions: Iterable<Session.ID>) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/EventFeed") {}

export function frame(event: OpenCodeEvent) {
  return `data: ${JSON.stringify(event)}\n\n`
}

type Subscriber = {
  readonly id: string
  readonly queue: Queue.Queue<string, Error>
  readonly types: ReadonlySet<string> | undefined
  sessions: ReadonlySet<string> | undefined
}

export const make = Effect.fn("EventFeed.make")(function* (
  observe: (subscriber: Bus.Subscriber) => Effect.Effect<Bus.Unsubscribe>,
  options?: { readonly capacity?: number; readonly encode?: (event: OpenCodeEvent) => string },
) {
  const capacity = options?.capacity ?? SubscriberCapacity
  const render = options?.encode ?? frame
  const subscribers = new Map<string, Subscriber>()

  const fail = (error: Error) =>
    Effect.sync(() => {
      const current = Array.from(subscribers.values())
      subscribers.clear()
      for (const subscriber of current) Queue.failCauseUnsafe(subscriber.queue, Cause.fail(error))
    })

  const publish = Effect.fnUntraced(function* (event: Event.Payload) {
    if (!isOpenCodeEvent(event)) return
    if (subscribers.size === 0) return
    const sessionID = SessionEvent.detailSessionID(event)
    let encoded: string | undefined
    for (const subscriber of subscribers.values()) {
      if (subscriber.types && !subscriber.types.has(event.type)) continue
      if (sessionID !== undefined && subscriber.sessions !== undefined && !subscriber.sessions.has(sessionID)) continue
      encoded ??= yield* Effect.try({
        try: () => render(event),
        catch: (cause) => new EncodingError({ eventID: event.id, eventType: event.type, cause }),
      }).pipe(
        Effect.catch((error) =>
          Effect.logError("Failed to encode public event", {
            eventID: error.eventID,
            eventType: error.eventType,
            cause: error.cause,
          }).pipe(Effect.andThen(fail(error)), Effect.as(undefined)),
        ),
      )
      if (encoded === undefined) return
      if (Queue.offerUnsafe(subscriber.queue, encoded)) continue
      subscribers.delete(subscriber.id)
      Queue.failCauseUnsafe(subscriber.queue, Cause.fail(new SubscriberOverflowError({ capacity })))
    }
  })

  const unsubscribe = yield* observe(publish)
  yield* Effect.addFinalizer(() => unsubscribe)

  const connect = (connectOptions?: ConnectOptions) =>
    Effect.acquireRelease(
      Queue.dropping<string, Error>(capacity).pipe(
        Effect.map((queue): Subscriber => ({
          id: crypto.randomUUID(),
          queue,
          types: connectOptions?.types?.length ? new Set(connectOptions.types) : undefined,
          sessions: connectOptions?.detail === "subscribed" ? new Set<string>() : undefined,
        })),
        Effect.tap((subscriber) => Effect.sync(() => subscribers.set(subscriber.id, subscriber))),
      ),
      (subscriber) =>
        Effect.sync(() => subscribers.delete(subscriber.id)).pipe(
          Effect.andThen(Queue.shutdown(subscriber.queue)),
          Effect.asVoid,
        ),
    ).pipe(
      Effect.map(
        (subscriber): Connection => ({
          id: subscriber.id,
          stream: Stream.fromQueue(subscriber.queue),
        }),
      ),
    )

  return Service.of({
    subscribe: (types) => connect({ types }).pipe(Effect.map((connection) => connection.stream)),
    connect,
    setSessions: (connection, sessions) =>
      Effect.sync(() => {
        const subscriber = subscribers.get(connection)
        if (!subscriber) return false
        subscriber.sessions = new Set(sessions)
        return true
      }),
  })
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    return yield* make(bus.listen)
  }),
)
