export * as EventFeed from "./event-feed"

import { EventV2 } from "@opencode-ai/core/event"
import { isOpenCodeEvent, OpenCodeEvent } from "@opencode-ai/protocol/groups/event"
import { Cause, Context, Effect, Layer, Queue, Schema, Scope, Stream } from "effect"

export const SubscriberCapacity = 4_096

/** Core-published types that always pass location interest filters. */
export const GlobalEventTypes = new Set<string>([
  "installation.updated",
  "installation.update-available",
  "global.disposed",
])

export class SubscriberOverflowError extends Schema.TaggedErrorClass<SubscriberOverflowError>()(
  "EventFeed.SubscriberOverflow",
  { capacity: Schema.Int },
) {}

export class EncodingError extends Schema.TaggedErrorClass<EncodingError>()("EventFeed.EncodingError", {
  eventID: EventV2.ID,
  eventType: Schema.String,
  cause: Schema.Defect(),
}) {}

export type Error = SubscriberOverflowError | EncodingError

export type LocationInterest = {
  readonly directory: string
  readonly workspace?: string
}

/** Omit or leave empty for the global public feed; set location to narrow delivery. */
export type Interest = {
  readonly location?: LocationInterest
}

export interface Interface {
  readonly subscribe: (interest?: Interest) => Effect.Effect<Stream.Stream<string, Error>, never, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/EventFeed") {}

const encode = Schema.encodeUnknownSync(OpenCodeEvent)

export function frame(event: OpenCodeEvent) {
  return `data: ${JSON.stringify(encode(event))}\n\n`
}

export function matchesInterest(event: EventV2.Payload, interest?: Interest): boolean {
  const location = interest?.location
  if (location === undefined) return true
  if (GlobalEventTypes.has(event.type)) return true
  const ref = event.location
  if (ref === undefined) return false
  if (ref.directory !== location.directory) return false
  if (location.workspace !== undefined && ref.workspaceID !== location.workspace) return false
  return true
}

export function interestFromQuery(query: URLSearchParams): Interest | undefined {
  const directory = query.get("location[directory]") ?? undefined
  const workspace = query.get("location[workspace]") ?? undefined
  if (directory === undefined && workspace === undefined) return undefined
  if (directory === undefined) return undefined
  return { location: { directory, ...(workspace !== undefined ? { workspace } : {}) } }
}

type Subscriber = {
  readonly queue: Queue.Queue<string, Error>
  readonly interest?: Interest
}

export const make = Effect.fn("EventFeed.make")(function* (
  observe: (subscriber: EventV2.Subscriber) => Effect.Effect<EventV2.Unsubscribe>,
  options?: { readonly capacity?: number; readonly encode?: (event: OpenCodeEvent) => string },
) {
  const capacity = options?.capacity ?? SubscriberCapacity
  const render = options?.encode ?? frame
  const subscribers = new Map<Queue.Queue<string, Error>, Subscriber>()

  const fail = (error: Error) =>
    Effect.sync(() => {
      const current = Array.from(subscribers.values())
      subscribers.clear()
      for (const subscriber of current) Queue.failCauseUnsafe(subscriber.queue, Cause.fail(error))
    })

  const publish = Effect.fnUntraced(function* (event: EventV2.Payload) {
    if (!isOpenCodeEvent(event)) return
    if (subscribers.size === 0) return
    let matched = false
    for (const subscriber of subscribers.values()) {
      if (matchesInterest(event, subscriber.interest)) {
        matched = true
        break
      }
    }
    if (!matched) return
    const encoded = yield* Effect.try({
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
    for (const subscriber of Array.from(subscribers.values())) {
      if (!matchesInterest(event, subscriber.interest)) continue
      if (Queue.offerUnsafe(subscriber.queue, encoded)) continue
      subscribers.delete(subscriber.queue)
      Queue.failCauseUnsafe(subscriber.queue, Cause.fail(new SubscriberOverflowError({ capacity })))
    }
  })

  const unsubscribe = yield* observe(publish)
  yield* Effect.addFinalizer(() => unsubscribe)

  return Service.of({
    subscribe: (interest) =>
      Effect.acquireRelease(
        Queue.dropping<string, Error>(capacity).pipe(
          Effect.tap((queue) =>
            Effect.sync(() => {
              subscribers.set(queue, { queue, interest })
            }),
          ),
        ),
        (queue) =>
          Effect.sync(() => subscribers.delete(queue)).pipe(Effect.andThen(Queue.shutdown(queue)), Effect.asVoid),
      ).pipe(Effect.map(Stream.fromQueue)),
  })
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    return yield* make(events.listen)
  }),
)
