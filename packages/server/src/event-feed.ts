export * as EventFeed from "./event-feed"

import { EventV2 } from "@opencode-ai/core/event"
import { isOpenCodeEvent, OpenCodeEvent, sessionIDOf } from "@opencode-ai/protocol/groups/event"
import { Cause, Context, Effect, Layer, Queue, Schema, Scope, Stream } from "effect"

export const SubscriberCapacity = 4_096

/** Core-published types that always pass interest filters (location and session). */
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

/** Omit or leave empty for the global public feed; set location/sessions to narrow delivery. */
export type Interest = {
  readonly location?: LocationInterest
  readonly sessions?: ReadonlyArray<string>
}

/** Content-free counters for leak detection — never includes event payloads. */
export type Diagnostics = {
  readonly active: number
  readonly opens: number
  readonly closes: number
  readonly serializedEvents: number
  readonly serializedBytes: number
  readonly overflows: number
}

export interface Interface {
  readonly subscribe: (interest?: Interest) => Effect.Effect<Stream.Stream<string, Error>, never, Scope.Scope>
  readonly diagnostics: () => Diagnostics
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/EventFeed") {}

const encode = Schema.encodeUnknownSync(OpenCodeEvent)

export function frame(event: OpenCodeEvent) {
  return `data: ${JSON.stringify(encode(event))}\n\n`
}

export function matchesInterest(event: EventV2.Payload, interest?: Interest): boolean {
  if (interest === undefined) return true
  if (GlobalEventTypes.has(event.type)) return true

  const location = interest.location
  if (location !== undefined) {
    const ref = event.location
    if (ref === undefined) return false
    if (ref.directory !== location.directory) return false
    if (location.workspace !== undefined && ref.workspaceID !== location.workspace) return false
  }

  const sessions = interest.sessions
  if (sessions !== undefined && sessions.length > 0) {
    const sessionID = sessionIDOf(event)
    if (sessionID !== undefined) return sessions.includes(sessionID)
  }

  return true
}

export function interestFromQuery(query: URLSearchParams): Interest | undefined {
  const directory = query.get("location[directory]") ?? undefined
  const workspace = query.get("location[workspace]") ?? undefined
  const sessions = query
    .getAll("session")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  // Workspace interest requires a directory; alone it is an invalid location scope.
  if (directory === undefined && workspace !== undefined) return undefined
  if (directory === undefined && sessions.length === 0) return undefined
  return {
    ...(directory !== undefined
      ? { location: { directory, ...(workspace !== undefined ? { workspace } : {}) } }
      : {}),
    ...(sessions.length > 0 ? { sessions } : {}),
  }
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
  let opens = 0
  let closes = 0
  let serializedEvents = 0
  let serializedBytes = 0
  let overflows = 0

  const diagnostics = (): Diagnostics => ({
    active: subscribers.size,
    opens,
    closes,
    serializedEvents,
    serializedBytes,
    overflows,
  })

  const fail = (error: Error) =>
    Effect.sync(() => {
      const current = Array.from(subscribers.values())
      subscribers.clear()
      for (const subscriber of current) Queue.failCauseUnsafe(subscriber.queue, Cause.fail(error))
    })

  const publish = Effect.fnUntraced(function* (event: EventV2.Payload) {
    if (!isOpenCodeEvent(event)) return
    if (subscribers.size === 0) return
    const targets = Array.from(subscribers.values()).filter((subscriber) =>
      matchesInterest(event, subscriber.interest),
    )
    if (targets.length === 0) return
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
    serializedEvents += 1
    serializedBytes += Buffer.byteLength(encoded, "utf-8")
    for (const subscriber of targets) {
      if (Queue.offerUnsafe(subscriber.queue, encoded)) continue
      overflows += 1
      subscribers.delete(subscriber.queue)
      Queue.failCauseUnsafe(subscriber.queue, Cause.fail(new SubscriberOverflowError({ capacity })))
    }
  })

  const unsubscribe = yield* observe(publish)
  yield* Effect.addFinalizer(() => unsubscribe)

  return Service.of({
    diagnostics,
    subscribe: (interest) =>
      Effect.acquireRelease(
        Queue.dropping<string, Error>(capacity).pipe(
          Effect.tap((queue) =>
            Effect.sync(() => {
              opens += 1
              subscribers.set(queue, { queue, interest })
            }),
          ),
        ),
        (queue) =>
          Effect.sync(() => {
            if (subscribers.delete(queue)) closes += 1
          }).pipe(Effect.andThen(Queue.shutdown(queue)), Effect.asVoid),
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
