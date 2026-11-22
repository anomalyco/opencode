export * as EventFeed from "./event-feed"

import { Bus } from "@opencode/core/bus"
import { Event } from "@opencode/schema/event"
import { isOpenCodeEvent, type OpenCodeEvent } from "@opencode/protocol/groups/event"
import { Cause, Context, Effect, Exit, Layer, Queue, Schema, Scope, Stream } from "effect"

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

export interface Interface {
  /** Opens a stream of encoded events, with the random ID that addresses it, e.g. to subscribe it to more events. */
  readonly subscribe: (
    types?: ReadonlyArray<string>,
  ) => Effect.Effect<{ readonly id: string; readonly events: Stream.Stream<string, Error> }, never, Scope.Scope>
}

/**
 * Adds events from outside the bus. `open` runs once for each stream, with its ID and a `send` that reaches that
 * stream, whatever its `types`, until the stream closes along with the scope `open` gets.
 */
export interface Extension {
  readonly open: (
    stream: string,
    send: (event: OpenCodeEvent) => Effect.Effect<void>,
  ) => Effect.Effect<void, never, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/EventFeed") {}

export function frame(event: OpenCodeEvent) {
  return `data: ${JSON.stringify(event)}\n\n`
}

export const make = Effect.fn("EventFeed.make")(function* (
  observe: (subscriber: Bus.Subscriber) => Effect.Effect<Bus.Unsubscribe>,
  options?: {
    readonly capacity?: number
    readonly encode?: (event: OpenCodeEvent) => string
    readonly extensions?: ReadonlyArray<Extension>
  },
) {
  const capacity = options?.capacity ?? SubscriberCapacity
  const render = options?.encode ?? frame
  const subscribers = new Map<Queue.Queue<string, Error>, ReadonlySet<string> | undefined>()

  const fail = (error: Error) =>
    Effect.sync(() => {
      const current = Array.from(subscribers.keys())
      subscribers.clear()
      for (const subscriber of current) Queue.failCauseUnsafe(subscriber, Cause.fail(error))
    })

  const offer = (subscriber: Queue.Queue<string, Error>, encoded: string) => {
    if (Queue.offerUnsafe(subscriber, encoded)) return
    subscribers.delete(subscriber)
    Queue.failCauseUnsafe(subscriber, Cause.fail(new SubscriberOverflowError({ capacity })))
  }

  const publish = Effect.fnUntraced(function* (event: Event.Payload) {
    if (!isOpenCodeEvent(event)) return
    let encoded: string | undefined
    for (const [subscriber, types] of subscribers) {
      if (types && !types.has(event.type)) continue
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
      offer(subscriber, encoded)
    }
  })

  const unsubscribe = yield* observe(publish)
  yield* Effect.addFinalizer(() => unsubscribe)

  return Service.of({
    subscribe: (types) =>
      Effect.gen(function* () {
        const queue = yield* Effect.acquireRelease(
          Queue.dropping<string, Error>(capacity).pipe(
            Effect.tap((queue) =>
              Effect.sync(() => subscribers.set(queue, types?.length ? new Set(types) : undefined)),
            ),
          ),
          (queue) =>
            Effect.sync(() => subscribers.delete(queue)).pipe(Effect.andThen(Queue.shutdown(queue)), Effect.asVoid),
        )
        const id = crypto.randomUUID()
        // An extension never fails the stream: an event it cannot encode is dropped, and a failed `open` only loses
        // that extension's events for this stream.
        const send = (event: OpenCodeEvent) =>
          Effect.suspend(() => {
            if (!subscribers.has(queue)) return Effect.void
            return Effect.try(() => render(event)).pipe(
              Effect.flatMap((encoded) => Effect.sync(() => offer(queue, encoded))),
              Effect.catchCause((cause) =>
                Effect.logError("Failed to encode extension event", { type: event.type, cause }),
              ),
            )
          })
        const scope = yield* Scope.Scope
        yield* Effect.forEach(
          options?.extensions ?? [],
          (extension) =>
            Effect.gen(function* () {
              const child = yield* Scope.fork(scope)
              yield* extension.open(id, send).pipe(
                Scope.provide(child),
                Effect.catchCause((cause) =>
                  Effect.logError("Event stream extension failed", { cause }).pipe(
                    Effect.andThen(Scope.close(child, Exit.void)),
                  ),
                ),
              )
            }),
          { discard: true },
        )
        return { id, events: Stream.fromQueue(queue) }
      }),
  })
})

export const layer = <R>(...extensions: ReadonlyArray<Effect.Effect<Extension, never, R>>) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      return yield* make(bus.listen, { extensions: yield* Effect.all(extensions) })
    }),
  )
