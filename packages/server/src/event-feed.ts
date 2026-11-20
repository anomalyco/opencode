export * as EventFeed from "./event-feed"

import { Bus } from "@opencode/core/bus"
import { ClientKV } from "@opencode/schema/client-kv"
import { Event } from "@opencode/schema/event"
import { isOpenCodeEvent, type OpenCodeEvent } from "@opencode/protocol/groups/event"
import { Cause, Clock, Context, Effect, Layer, Queue, Schema, Scope, Stream } from "effect"
import { ClientSpaceStore } from "./client-space-store"

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
  /**
   * With `spaces`, the stream starts with each space's snapshot or delta, then carries its later changes whatever
   * `types` says.
   */
  readonly subscribe: (
    types?: ReadonlyArray<string>,
    spaces?: ReadonlyArray<ClientSpaceStore.Request>,
  ) => Effect.Effect<Stream.Stream<string, Error>, never, Scope.Scope>
}

interface Filter {
  readonly types?: ReadonlySet<string>
  readonly spaces?: ReadonlyMap<ClientKV.Space, number>
}

interface Frame {
  readonly text: string
  readonly change?: ClientSpaceStore.Change["data"]
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
    readonly spaces?: ClientSpaceStore.Interface
  },
) {
  const capacity = options?.capacity ?? SubscriberCapacity
  const render = options?.encode ?? frame
  const subscribers = new Map<Queue.Queue<Frame, Error>, Filter>()

  const fail = (error: Error) =>
    Effect.sync(() => {
      const current = Array.from(subscribers.keys())
      subscribers.clear()
      for (const subscriber of current) Queue.failCauseUnsafe(subscriber, Cause.fail(error))
    })

  const send = Effect.fnUntraced(function* (
    event: OpenCodeEvent,
    accepts: (filter: Filter) => boolean,
    change?: ClientSpaceStore.Change["data"],
  ) {
    let encoded: Frame | undefined
    for (const [subscriber, filter] of subscribers) {
      if (!accepts(filter)) continue
      encoded ??= yield* Effect.try({
        try: () => ({ text: render(event), change }),
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
      if (Queue.offerUnsafe(subscriber, encoded)) continue
      subscribers.delete(subscriber)
      Queue.failCauseUnsafe(subscriber, Cause.fail(new SubscriberOverflowError({ capacity })))
    }
  })

  const unsubscribe = yield* observe((event) =>
    isOpenCodeEvent(event) ? send(event, (filter) => !filter.types || filter.types.has(event.type)) : Effect.void,
  )
  yield* Effect.addFinalizer(() => unsubscribe)
  if (options?.spaces) {
    const unlisten = yield* options.spaces.listen((change) =>
      send(change, (filter) => filter.spaces?.has(change.data.space) === true, change.data),
    )
    yield* Effect.addFinalizer(() => unlisten)
  }

  return Service.of({
    subscribe: (types, requests) =>
      Effect.gen(function* () {
        // The revision each subscribed space's initial state covers; changes at or below it are skipped when read.
        const revisions = new Map(requests?.map((request) => [request.space, 0]))
        const queue = yield* Effect.acquireRelease(
          Queue.dropping<Frame, Error>(capacity).pipe(
            Effect.tap((queue) =>
              Effect.sync(() =>
                subscribers.set(queue, {
                  types: types?.length ? new Set(types) : undefined,
                  spaces: revisions.size ? revisions : undefined,
                }),
              ),
            ),
          ),
          (queue) =>
            Effect.sync(() => subscribers.delete(queue)).pipe(Effect.andThen(Queue.shutdown(queue)), Effect.asVoid),
        )
        const live = Stream.fromQueue(queue).pipe(
          Stream.filter((frame) => !frame.change || frame.change.revision > (revisions.get(frame.change.space) ?? 0)),
          Stream.map((frame) => frame.text),
        )
        if (!options?.spaces || !requests?.length) return live
        // Read only after registering: a change committed meanwhile is then in the initial state, the queue or both,
        // and never missed. Writers do not wait for this.
        const initial = yield* options.spaces.read(requests)
        for (const item of initial) revisions.set(item.data.space, item.data.revision)
        const created = yield* Clock.currentTimeMillis
        return Stream.fromIterable(initial).pipe(
          Stream.map((item) => render({ id: Event.ID.create(), created, ...item })),
          Stream.concat(live),
        )
      }),
  })
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const spaces = yield* ClientSpaceStore.Service
    return yield* make(bus.listen, { spaces })
  }),
)
