export * as SpaceStore from "./space-store"

import { Space } from "@opencode/core/space"
import { Database } from "@opencode/core/database/database"
import { KeyedMutex } from "@opencode/core/effect/keyed-mutex"
import { Space as SpaceSchema } from "@opencode/schema/space"
import { Event } from "@opencode/schema/event"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Clock, Context, Effect, Layer } from "effect"

export interface Request {
  readonly space: SpaceSchema.Name
  /** The last revision the client applied; a delta is sent only when this server issued it. */
  readonly since?: number
}

export type Initial =
  | {
      readonly type: typeof SpaceSchema.Event.Snapshot.type
      readonly data: typeof SpaceSchema.Event.Snapshot.data.Type
    }
  | { readonly type: typeof SpaceSchema.Event.Delta.type; readonly data: typeof SpaceSchema.Event.Delta.data.Type }

export type Change = typeof SpaceSchema.Event.Updated.Type | typeof SpaceSchema.Event.Deleted.Type
export type Listener = (change: Change) => Effect.Effect<void>

export interface Interface {
  readonly set: (space: SpaceSchema.Name, key: SpaceSchema.Key, value: SpaceSchema.Value) => Effect.Effect<void>
  readonly remove: (space: SpaceSchema.Name, key: SpaceSchema.Key) => Effect.Effect<void>
  /** Each space's state as a delta since `since` when this server issued that revision, else as a snapshot. */
  readonly read: (requests: ReadonlyArray<Request>) => Effect.Effect<ReadonlyArray<Initial>>
  /**
   * Runs `listener` with every change before its write returns, in revision order within a space. Changes never go
   * through the bus, so plugins do not see them; only the event feed listens.
   */
  readonly listen: (listener: Listener) => Effect.Effect<Effect.Effect<void>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/SpaceStore") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const listeners = new Array<Listener>()
    // Held per space from the commit until listeners have the change, so they get each space in revision order.
    // Reads and other spaces never wait on it.
    const locks = KeyedMutex.makeUnsafe<SpaceSchema.Name>()

    const commit = (space: SpaceSchema.Name, write: Effect.Effect<Change["data"] | undefined>) =>
      locks.withLock(space)(
        // A dropped request must not commit a change that listeners never hear about.
        Effect.uninterruptible(
          Effect.gen(function* () {
            const data = yield* write
            if (!data) return
            const change = {
              id: Event.ID.create(),
              created: yield* Clock.currentTimeMillis,
              ...("value" in data
                ? { type: SpaceSchema.Event.Updated.type, data }
                : { type: SpaceSchema.Event.Deleted.type, data }),
            }
            yield* Effect.forEach(listeners, (listener) => listener(change), { discard: true })
          }),
        ),
      )

    return Service.of({
      set: Effect.fn("SpaceStore.set")(function* (space, key, value) {
        yield* commit(
          space,
          Space.set(db, space, key, value).pipe(Effect.map((revision) => ({ space, key, value, revision }))),
        )
      }),
      remove: Effect.fn("SpaceStore.remove")(function* (space, key) {
        yield* commit(
          space,
          Space.remove(db, space, key).pipe(
            Effect.map((revision) => (revision === undefined ? undefined : { space, key, revision })),
          ),
        )
      }),
      // Each space's rows come from one statement, a consistent view whose newest revision is the state's revision.
      // Between the head check and that statement the space can only move ahead, which keeps the delta valid.
      read: Effect.fn("SpaceStore.read")(function* (requests) {
        return yield* Effect.forEach(requests, (request) =>
          Effect.gen(function* () {
            const since =
              request.since !== undefined && request.since <= (yield* Space.head(db, request.space))
                ? request.since
                : undefined
            const rows = yield* Space.changes(db, request.space, since ?? 0)
            const revision = rows.reduce((max, row) => Math.max(max, row.revision), since ?? 0)
            const entries = rows.flatMap((row) => (row.value === null ? [] : [{ key: row.key, value: row.value }]))
            if (since === undefined)
              return {
                type: SpaceSchema.Event.Snapshot.type,
                data: { space: request.space, revision, entries },
              } satisfies Initial
            return {
              type: SpaceSchema.Event.Delta.type,
              data: {
                space: request.space,
                revision,
                entries,
                deleted: rows.flatMap((row) => (row.value === null ? [row.key] : [])),
              },
            } satisfies Initial
          }),
        )
      }),
      listen: (listener) =>
        Effect.sync(() => {
          listeners.push(listener)
          return Effect.sync(() => {
            const index = listeners.indexOf(listener)
            if (index >= 0) listeners.splice(index, 1)
          })
        }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
