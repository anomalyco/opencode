export * as EventFeed from "./event-feed"

import { Bus } from "@opencode/core/bus"
import { Event } from "@opencode/schema/event"
import { isOpenCodeEvent, type OpenCodeEvent } from "@opencode/protocol/groups/event"
import { Cause, Context, Effect, Layer, Queue, Schema, Scope, Stream } from "effect"

export const SubscriberCapacity = 4_096
export const SubscriberByteCapacity = 16 * 1024 * 1024

export class SubscriberOverflowError extends Schema.TaggedError<SubscriberOverflowError>()(
  "EventFeed.SubscriberOverflow",
  {
    capacity: Schema.Int,
    maxBytes: Schema.Int,
    bytes: Schema.Int,
    reason: Schema.Literals(["frames", "bytes"]),
  },
) {}

export class EncodingError extends Schema.TaggedError<EncodingError>()("EventFeed.EncodingError", {
  eventID: Event.ID,
  eventType: Schema.String,
  cause: Schema.Defect(),
}) {}

export type Error = SubscriberOverflowError | EncodingError

export interface Interface {
  readonly subscribe: (types?: ReadonlyArray<string>) => Effect.Effect<Stream.Stream<string, Error>, never, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/EventFeed") {}

export function frame(event: OpenCodeEvent) {
  return `data: ${JSON.stringify(event)}\n\n`
}

export const make = Effect.fn("EventFeed.make")(function* (
  observe: (subscriber: Bus.Subscriber) => Effect.Effect<Bus.Unsubscribe>,
  options?: {
    readonly capacity?: number
    readonly maxBytes?: number
    readonly encode?: (event: OpenCodeEvent) => string
  },
) {
  const capacity = options?.capacity ?? SubscriberCapacity
  const maxBytes = options?.maxBytes ?? SubscriberByteCapacity
  const render = options?.encode ?? frame
  type Frame = { readonly text: string; readonly bytes: number }
  type Subscriber = {
    readonly queue: Queue.Queue<Frame, Error>
    readonly types: ReadonlySet<string> | undefined
    bytes: number
  }
  const subscribers = new Map<Queue.Queue<Frame, Error>, Subscriber>()

  const fail = (error: Error) =>
    Effect.sync(() => {
      const current = Array.from(subscribers.keys())
      subscribers.clear()
      for (const subscriber of current) Queue.failCauseUnsafe(subscriber, Cause.fail(error))
    })

  const overflow = (subscriber: Subscriber, reason: SubscriberOverflowError["reason"]) =>
    Effect.sync(() => {
      if (!subscribers.delete(subscriber.queue)) return
      Queue.failCauseUnsafe(
        subscriber.queue,
        Cause.fail(
          new SubscriberOverflowError({
            capacity,
            maxBytes,
            bytes: subscriber.bytes,
            reason,
          }),
        ),
      )
    })

  const publish = Effect.fnUntraced(function* (event: Event.Payload) {
    if (!isOpenCodeEvent(event)) return
    let encoded: string | undefined
    let bytes: number | undefined
    for (const subscriber of subscribers.values()) {
      if (subscriber.types && !subscriber.types.has(event.type)) continue
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
      bytes ??= Buffer.byteLength(encoded)
      if (subscriber.bytes + bytes > maxBytes) {
        yield* overflow(subscriber, "bytes")
        continue
      }
      if (!Queue.offerUnsafe(subscriber.queue, { text: encoded, bytes })) {
        yield* overflow(subscriber, "frames")
        continue
      }
      subscriber.bytes += bytes
    }
  })

  const unsubscribe = yield* observe(publish)
  yield* Effect.addFinalizer(() => unsubscribe)

  return Service.of({
    subscribe: (types) =>
      Effect.acquireRelease(
        Queue.dropping<Frame, Error>(capacity).pipe(
          Effect.tap((queue) =>
            Effect.sync(() => {
              subscribers.set(queue, { queue, types: types?.length ? new Set(types) : undefined, bytes: 0 })
            }),
          ),
        ),
        (queue) =>
          Effect.sync(() => subscribers.delete(queue)).pipe(Effect.andThen(Queue.shutdown(queue)), Effect.asVoid),
      ).pipe(
        Effect.map((queue) =>
          Stream.fromQueue(queue).pipe(
            Stream.mapEffect((frame) =>
              Effect.sync(() => {
                const subscriber = subscribers.get(queue)
                if (subscriber) subscriber.bytes -= frame.bytes
                return frame.text
              }),
            ),
          ),
        ),
      ),
  })
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    return yield* make(bus.listen)
  }),
)
