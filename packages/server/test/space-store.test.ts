import { expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { SpaceRows } from "@opencode/core/space"
import { SpaceTable } from "@opencode/core/space/sql"
import { LayerNode } from "@opencode/util/effect/layer-node"
import type { Space } from "@opencode/schema/space"
import { Context, Deferred, Effect, Fiber, Layer, Stream } from "effect"
import { it } from "../../core/test/lib/effect"
import { SpaceStore } from "../src/space-store"
import { EventFeed } from "../src/event-feed"

// One in-memory database shared by every `boot()`, each a fresh store, bus and feed as after a process restart.
// `hold(revision)` pauses the change with that revision after it commits and before streams hear of it, so a test
// can line up competing writes and subscriptions behind it.
const setup = Effect.gen(function* () {
  const database = Context.get(yield* Layer.build(LayerNode.compile(Database.node)), Database.Service)
  const shared = Database.node.replace(Layer.succeed(Database.Service, database))
  const gates = new Map<number, { reached: Deferred.Deferred<void>; release: Deferred.Deferred<void> }>()
  const boot = Effect.fnUntraced(function* () {
    const bus = Context.get(yield* Layer.build(LayerNode.compile(Bus.node, { replacements: [shared] })), Bus.Service)
    const store = Context.get(
      yield* Layer.build(LayerNode.compile(SpaceStore.node, { replacements: [shared] })),
      SpaceStore.Service,
    )
    yield* store.listen((change) =>
      Effect.suspend(() => {
        const gate = gates.get(change.data.revision)
        if (!gate) return Effect.void
        gates.delete(change.data.revision)
        return Deferred.succeed(gate.reached, undefined).pipe(Effect.andThen(Deferred.await(gate.release)))
      }),
    )
    const extension = yield* SpaceStore.extension.pipe(Effect.provideService(SpaceStore.Service, store))
    return { store, bus, feed: yield* EventFeed.make(bus.listen, { extensions: [extension] }) }
  })
  const hold = Effect.fnUntraced(function* (revision: number) {
    const gate = { reached: yield* Deferred.make<void>(), release: yield* Deferred.make<void>() }
    gates.set(revision, gate)
    return gate
  })
  return { boot, hold, db: database.db }
})

const take = (live: Stream.Stream<string, EventFeed.Error>, count: number) =>
  live.pipe(
    Stream.take(count),
    Stream.runCollect,
    Effect.map((frames) =>
      Array.from(frames, (frame) => {
        const event = JSON.parse(frame.slice("data: ".length))
        return { type: event.type, data: event.data }
      }),
    ),
  )

const now = { startImmediately: true } as const

// Every page of a sync from `cursor`, following `next`.
const syncAll = Effect.fnUntraced(function* (store: SpaceStore.Interface, space: string, cursor?: string) {
  const pages: Array<Space.Page> = []
  for (let next = cursor, first = true; first || next !== undefined; first = false) {
    const page = yield* store.sync(space, next)
    pages.push(page)
    next = page.next
  }
  return pages
})

// What a client holds after applying a sync page: a snapshot replaces everything, a delta changes and deletes keys.
const applyPage = (state: Map<string, string>, page: Space.Page) => {
  if (page.type === "snapshot") state.clear()
  for (const entry of page.entries) state.set(entry.key, entry.value)
  if (page.type === "delta") for (const key of page.deleted) state.delete(key)
  return state
}

// And after applying a stream event.
const applyEvent = (state: Map<string, string>, event: { readonly type: string; readonly data: any }) => {
  if (event.type === "experimental.space.updated") state.set(event.data.key, event.data.value)
  if (event.type === "experimental.space.deleted") state.delete(event.data.key)
  return state
}

const current = (store: SpaceStore.Interface, space: string) =>
  syncAll(store, space).pipe(Effect.map((pages) => pages.reduce(applyPage, new Map())))

const range = (count: number) => Array.from({ length: count }, (_, index) => index)

it.live("syncs a space in pages: live rows up to the starting head, then a delta of what changed meanwhile", () =>
  Effect.gen(function* () {
    const { boot } = yield* setup
    const { store } = yield* boot()
    const count = SpaceStore.BatchSize + 10
    yield* Effect.forEach(range(count), (index) => store.set("big", `k${index}`, String(index)), { discard: true })
    const epoch = store.epoch

    const first = yield* store.sync("big")
    expect([first.type, first.revision, first.entries.length, first.cursor, first.next]).toEqual([
      "snapshot",
      SpaceStore.BatchSize,
      SpaceStore.BatchSize,
      `${epoch}.${SpaceStore.BatchSize}`,
      `${epoch}.${SpaceStore.BatchSize}.${count}`,
    ])
    // Between pages: a delete and a rewrite of keys the first page held, and of keys the second would hold.
    yield* store.remove("big", "k0")
    yield* store.set("big", "k1", "new")
    yield* store.set("big", `k${SpaceStore.BatchSize + 5}`, "new")
    yield* store.remove("big", `k${SpaceStore.BatchSize + 6}`)

    const second = yield* store.sync("big", first.next)
    // The rest of the keys up to the starting head, without the two changed meanwhile, and no deletions.
    expect(second).toEqual({
      type: "delta",
      space: "big",
      epoch,
      revision: count,
      entries: range(10)
        .filter((index) => index !== 5 && index !== 6)
        .map((index) => ({ key: `k${SpaceStore.BatchSize + index}`, value: String(SpaceStore.BatchSize + index) })),
      deleted: [],
      cursor: `${epoch}.${count}`,
      next: `${epoch}.${count}`,
    })
    const third = yield* store.sync("big", second.next)
    expect(third).toEqual({
      type: "delta",
      space: "big",
      epoch,
      revision: count + 4,
      entries: [
        { key: "k1", value: "new" },
        { key: `k${SpaceStore.BatchSize + 5}`, value: "new" },
      ],
      deleted: ["k0", `k${SpaceStore.BatchSize + 6}`],
      cursor: `${epoch}.${count + 4}`,
    })

    // Every page's cursor resumes: what the pages up to it hold, then a sync from it, is the current state.
    const now = yield* current(store, "big")
    expect(now.has("k0")).toBe(false)
    const held = new Map<string, string>()
    for (const page of [first, second, third]) {
      applyPage(held, page)
      const resumed = yield* syncAll(store, "big", page.cursor)
      expect(resumed.map((item) => item.type)).not.toContain("snapshot")
      expect(resumed.reduce(applyPage, new Map(held))).toEqual(now)
    }
  }),
)

it.live("a snapshot reads no tombstones, and its last page reports the head it started from", () =>
  Effect.gen(function* () {
    const { boot } = yield* setup
    const { store } = yield* boot()
    yield* Effect.forEach(range(SpaceStore.BatchSize + 1), (index) => store.set("big", `k${index}`, String(index)), {
      discard: true,
    })
    yield* store.remove("big", "k0")
    const page = yield* store.sync("big")
    expect([page.type, page.revision, page.entries.length, page.next]).toEqual([
      "snapshot",
      SpaceStore.BatchSize + 2,
      SpaceStore.BatchSize,
      undefined,
    ])
    expect(page.entries.some((entry) => entry.key === "k0")).toBe(false)
  }),
)

it.live("syncs each space from its cursor: final values and deletions, else a snapshot", () =>
  Effect.gen(function* () {
    const { boot } = yield* setup
    const { store } = yield* boot()
    yield* store.set("app", "kept", "v1")
    yield* store.set("app", "churn", "1")
    yield* store.set("app", "doomed", "true")
    yield* store.set("other", "x", "y")

    // While the client is away: repeated updates, a delete, a delete repeated, and a delete then re-set.
    yield* store.set("app", "churn", "2")
    yield* store.set("app", "churn", "3")
    yield* store.remove("app", "doomed")
    yield* store.remove("app", "doomed")
    yield* store.remove("app", "never-set")
    yield* store.set("app", "back", "a")
    yield* store.remove("app", "back")
    yield* store.set("app", "back", "b")

    const epoch = store.epoch
    const page = (space: string, cursor?: string) => store.sync(space, cursor)
    expect(yield* page("app", `${epoch}.3`)).toEqual({
      type: "delta",
      space: "app",
      epoch,
      revision: 9,
      entries: [
        { key: "churn", value: "3" },
        { key: "back", value: "b" },
      ],
      deleted: ["doomed"],
      cursor: `${epoch}.9`,
    })
    const empty = (space: string, revision: number) => ({
      type: "delta" as const,
      space,
      epoch,
      revision,
      entries: [],
      deleted: [],
      cursor: `${epoch}.${revision}`,
    })
    expect(yield* page("other", `${epoch}.1`)).toEqual(empty("other", 1))
    expect(yield* page("zero", `${epoch}.0`)).toEqual(empty("zero", 0))
    expect(yield* page("app", `${epoch}.9`)).toEqual(empty("app", 9))
    const snapshot = { type: "snapshot" as const, epoch, revision: 0, entries: [], cursor: `${epoch}.0` }
    // No cursor, a revision this database never issued, another database's epoch, and one that does not parse.
    expect(yield* page("fresh")).toEqual({ ...snapshot, space: "fresh" })
    expect(yield* page("ahead", `${epoch}.9`)).toEqual({ ...snapshot, space: "ahead" })
    expect(yield* page("app", "another-database.9")).toEqual({
      ...snapshot,
      space: "app",
      revision: 9,
      cursor: `${epoch}.9`,
      entries: [
        { key: "kept", value: "v1" },
        { key: "churn", value: "3" },
        { key: "back", value: "b" },
      ],
    })
    expect((yield* page("app", `${epoch}.x`)).type).toBe("snapshot")
    expect((yield* page("app", `${epoch}.1.9.9`)).type).toBe("snapshot")
  }),
)

it.live("a cursor below the space's floor gets a snapshot and one at or above it a delta, after a restart too", () =>
  Effect.gen(function* () {
    const { boot, db } = yield* setup
    const before = yield* boot()
    yield* Effect.forEach(["a", "b", "c", "d"], (key) => before.store.set("app", key, key), { discard: true })
    // With a limit of 2, the third delete purges the first tombstone, at revision 5.
    yield* Effect.forEach(["a", "b", "c"], (key) => SpaceRows.remove(db, "app", key), { discard: true })
    yield* SpaceRows.purge(db, "app", 2)

    const { store } = yield* boot()
    const epoch = store.epoch
    // A delta from 4 could no longer report that a was deleted.
    expect(yield* store.sync("app", `${epoch}.4`)).toEqual({
      type: "snapshot",
      space: "app",
      epoch,
      revision: 7,
      entries: [{ key: "d", value: "d" }],
      cursor: `${epoch}.7`,
    })
    const delta = (deleted: Array<string>) => ({
      type: "delta" as const,
      space: "app",
      epoch,
      revision: 7,
      entries: [],
      deleted,
      cursor: `${epoch}.7`,
    })
    expect(yield* store.sync("app", `${epoch}.5`)).toEqual(delta(["b", "c"]))
    expect(yield* store.sync("app", `${epoch}.6`)).toEqual(delta(["c"]))
  }),
)

it.live("a delta page whose deletions were purged meanwhile comes back as a snapshot", () =>
  Effect.gen(function* () {
    const { boot, db } = yield* setup
    const { store } = yield* boot()
    // The client holds k0 to k9, at revision 10.
    yield* Effect.forEach(range(10), (index) => store.set("app", `k${index}`, String(index)), { discard: true })
    const held = new Map(range(10).map((index) => [`k${index}`, String(index)]))
    // Then come a full page of new keys and two tombstones.
    yield* Effect.forEach(range(SpaceStore.BatchSize), (index) => store.set("app", `u${index}`, String(index)), {
      discard: true,
    })
    yield* SpaceRows.remove(db, "app", "k0")
    yield* SpaceRows.remove(db, "app", "k1")

    const first = yield* store.sync("app", `${store.epoch}.10`)
    // Before the next page, a third delete purges k0's tombstone with a limit of 2.
    yield* SpaceRows.remove(db, "app", "k2")
    yield* SpaceRows.purge(db, "app", 2)
    const rest = yield* syncAll(store, "app", first.next)
    const pages = [first, ...rest]
    const head = SpaceStore.BatchSize + 13
    expect(pages.map((page) => [page.type, page.revision, page.entries.length])).toEqual([
      ["delta", SpaceStore.BatchSize + 10, SpaceStore.BatchSize],
      // k3 to k9, then the new keys, up to the head when the snapshot started.
      ["snapshot", SpaceStore.BatchSize + 3, SpaceStore.BatchSize],
      ["delta", head, 7],
    ])
    expect(pages.reduce(applyPage, held)).toEqual(yield* current(store, "app"))
    expect(held.has("k0")).toBe(false)
  }),
)

it.live("a restarted store resumes revisions and sync from storage alone", () =>
  Effect.gen(function* () {
    const { boot } = yield* setup
    const before = yield* boot()
    yield* before.store.set("app", "k", "a")
    yield* before.store.set("app", "k", "b")
    yield* before.store.remove("app", "k")

    // A new process over the same database. Its first write must not reuse a revision, even the tombstone's.
    const after = yield* boot()
    expect(after.store.epoch).toBe(before.store.epoch)
    yield* after.store.set("app", "j", "c")
    expect(yield* after.store.sync("app", `${after.store.epoch}.1`)).toEqual({
      type: "delta",
      space: "app",
      epoch: after.store.epoch,
      revision: 4,
      entries: [{ key: "j", value: "c" }],
      deleted: ["k"],
      cursor: `${after.store.epoch}.4`,
    })
  }),
)

it.live("a subscription sends the changes since its cursor once, then live changes of its spaces only", () =>
  Effect.gen(function* () {
    const { boot } = yield* setup
    const { store, feed, bus } = yield* boot()
    yield* store.set("app", "k", "1")
    yield* store.set("app", "gone", "x")
    yield* store.set("other", "x", "1")
    const synced = yield* store.sync("app")
    // After the sync and before the subscription.
    yield* store.set("app", "k", "2")
    yield* store.remove("app", "gone")

    const stream = yield* feed.subscribe([Agent.Event.Updated.type])
    const plain = yield* feed.subscribe()
    const seen: Array<string> = []
    yield* bus.listen((event) => Effect.sync(() => seen.push(event.type)))
    expect(yield* store.subscribe(stream.id, [{ space: "app", cursor: synced.cursor }])).toBe(true)
    yield* store.set("app", "k", "3")
    yield* store.set("other", "x", "2")
    yield* bus.publish(Agent.Event.Updated, {})

    // The changes since the cursor, one event per row in revision order, then the live ones.
    expect(yield* take(stream.events, 4)).toEqual([
      { type: "experimental.space.updated", data: { space: "app", key: "k", value: "2", revision: 3 } },
      { type: "experimental.space.deleted", data: { space: "app", key: "gone", revision: 4 } },
      { type: "experimental.space.updated", data: { space: "app", key: "k", value: "3", revision: 5 } },
      { type: "agent.updated", data: {} },
    ])
    expect(yield* take(plain.events, 1)).toEqual([{ type: "agent.updated", data: {} }])
    // Changes never pass through the bus, which is where plugins listen.
    expect(seen).toEqual([Agent.Event.Updated.type])
  }),
)

it.live("a write committed before the subscribe read and delivered after it reaches the stream once, in order", () =>
  Effect.gen(function* () {
    const { boot, hold } = yield* setup
    const { store, feed } = yield* boot()
    yield* store.set("app", "k", "1")
    const synced = yield* store.sync("app")
    const stream = yield* feed.subscribe()

    const pending = yield* hold(2)
    const write = yield* store.set("app", "k", "2").pipe(Effect.forkChild(now))
    yield* Deferred.await(pending.reached)
    // "2" is committed but not yet delivered, and the space's lock is held; neither sync, subscribe nor other spaces
    // wait for it.
    expect((yield* store.sync("app", synced.cursor)).revision).toBe(2)
    yield* store.set("other", "x", "1")
    expect(yield* store.subscribe(stream.id, [{ space: "app", cursor: synced.cursor }])).toBe(true)
    const next = yield* store.set("app", "k", "3").pipe(Effect.forkChild(now))
    yield* Deferred.succeed(pending.release, undefined)
    yield* Fiber.join(write)
    yield* Fiber.join(next)

    expect(yield* take(stream.events, 2)).toEqual([
      { type: "experimental.space.updated", data: { space: "app", key: "k", value: "2", revision: 2 } },
      { type: "experimental.space.updated", data: { space: "app", key: "k", value: "3", revision: 3 } },
    ])
  }),
)

it.live("concurrent writes reach a subscribed stream in revision order", () =>
  Effect.gen(function* () {
    const { boot } = yield* setup
    const { store, feed } = yield* boot()
    const stream = yield* feed.subscribe()
    yield* store.subscribe(stream.id, [{ space: "app", cursor: (yield* store.sync("app")).cursor }])
    const writes = range(20)
    yield* Effect.forEach(
      writes,
      (index) =>
        Effect.all(
          [store.set("app", `k${index % 4}`, String(index)), store.set(`space-${index % 3}`, "k", String(index))],
          { concurrency: "unbounded" },
        ),
      { concurrency: "unbounded", discard: true },
    )

    // Nothing changed since the cursor, so only the live changes arrive.
    const changes = yield* take(stream.events, writes.length)
    expect(changes.map((change) => change.data)).toEqual(
      writes.map((_, index) => expect.objectContaining({ space: "app", revision: index + 1 })),
    )
    // The last change of each key is the value synced.
    expect(changes.reduce(applyEvent, new Map())).toEqual(yield* current(store, "app"))
  }),
)

it.live("a subscription sends resync instead of changes that do not fit one batch or a cursor it cannot use", () =>
  Effect.gen(function* () {
    const { boot, db } = yield* setup
    const { store, feed } = yield* boot()
    const epoch = store.epoch
    yield* Effect.forEach(range(SpaceStore.BatchSize + 1), (index) => store.set("big", `k${index}`, String(index)), {
      discard: true,
    })
    yield* Effect.forEach(["a", "b", "c"], (key) => store.set("purged", key, key), { discard: true })
    yield* Effect.forEach(["a", "b", "c"], (key) => SpaceRows.remove(db, "purged", key), { discard: true })
    yield* SpaceRows.purge(db, "purged", 2)
    yield* Effect.forEach(range(SpaceStore.BatchSize), (index) => store.set("full", `k${index}`, String(index)), {
      discard: true,
    })

    const stream = yield* feed.subscribe()
    yield* store.subscribe(stream.id, [
      { space: "big", cursor: `${epoch}.0` },
      // Below the floor, from another database, a revision never issued, a snapshot's continuation.
      { space: "purged", cursor: `${epoch}.3` },
      { space: "elsewhere", cursor: "another-database.0" },
      { space: "ahead", cursor: `${epoch}.9` },
      { space: "partial", cursor: `${epoch}.0.5` },
      // Exactly one batch still fits.
      { space: "full", cursor: `${epoch}.0` },
    ])
    yield* store.set("big", "after", "true")
    const events = yield* take(stream.events, 5 + SpaceStore.BatchSize + 1)
    expect(events.slice(0, 5)).toEqual(
      ["big", "purged", "elsewhere", "ahead", "partial"].map((space) => ({
        type: "experimental.space.resync",
        data: { space },
      })),
    )
    expect(events.slice(5, -1)).toEqual(
      range(SpaceStore.BatchSize).map((index) => ({
        type: "experimental.space.updated",
        data: { space: "full", key: `k${index}`, value: String(index), revision: index + 1 },
      })),
    )
    // Live changes still follow a resync.
    expect(events.at(-1)).toEqual({
      type: "experimental.space.updated",
      data: { space: "big", key: "after", value: "true", revision: SpaceStore.BatchSize + 2 },
    })
  }),
)

it.live("subscribe needs an open stream, and a stream leaves the store when it closes", () =>
  Effect.gen(function* () {
    const { boot } = yield* setup
    const { store, feed } = yield* boot()
    const cursor = `${store.epoch}.0`
    expect(yield* store.subscribe("not-a-stream", [{ space: "app", cursor }])).toBe(false)
    const id = yield* Effect.scoped(
      Effect.gen(function* () {
        const stream = yield* feed.subscribe()
        expect(yield* store.subscribe(stream.id, [{ space: "app", cursor }])).toBe(true)
        return stream.id
      }),
    )
    expect(yield* store.subscribe(id, [{ space: "app", cursor }])).toBe(false)
    // Writes to a space a closed stream subscribed to go nowhere.
    yield* store.set("app", "k", "1")
  }),
)

it.live("subscribing a space again on the same stream replaces its subscription", () =>
  Effect.gen(function* () {
    const { boot } = yield* setup
    const { store, feed } = yield* boot()
    const cursor = (yield* store.sync("app")).cursor
    const stream = yield* feed.subscribe()
    yield* store.subscribe(stream.id, [{ space: "app", cursor }])
    yield* store.set("app", "k", "1")
    yield* store.subscribe(stream.id, [{ space: "app", cursor }])
    yield* store.set("app", "k", "2")

    const updated = (value: string, revision: number) => ({
      type: "experimental.space.updated",
      data: { space: "app", key: "k", value, revision },
    })
    expect(yield* take(stream.events, 3)).toEqual([
      updated("1", 1),
      // The second subscription's catch-up from the same cursor, then the next change once, not once per subscription.
      updated("1", 1),
      updated("2", 2),
    ])
  }),
)

// A stream the test attaches itself, whose first event pauses until released, so a subscribe can be stopped in the
// middle of its catch-up.
const pausedStream = Effect.fnUntraced(function* (store: SpaceStore.Interface, id: string) {
  const reached = yield* Deferred.make<void>()
  const release = yield* Deferred.make<void>()
  const sent: Array<{ readonly type: string; readonly data: unknown }> = []
  let paused = false
  yield* store.attach(id, (event) =>
    Effect.gen(function* () {
      if (!paused) {
        paused = true
        yield* Deferred.succeed(reached, undefined)
        yield* Deferred.await(release)
      }
      sent.push({ type: event.type, data: event.data })
    }),
  )
  return { reached, release, sent }
})

it.live("of two overlapping subscribes of one space on a stream, only the newer one sends", () =>
  Effect.gen(function* () {
    const { boot } = yield* setup
    const { store } = yield* boot()
    const cursor = `${store.epoch}.0`
    const updated = (space: string, key: string, value: string, revision: number) => ({
      type: "experimental.space.updated",
      data: { space, key, value, revision },
    })
    yield* store.set("other", "x", "1")
    yield* store.set("app", "a", "1")

    // The older subscribe pauses on its first space, before it reads app's changes; the newer one replaces its app.
    const first = yield* pausedStream(store, "first")
    const older = yield* store
      .subscribe("first", [
        { space: "other", cursor },
        { space: "app", cursor },
      ])
      .pipe(Effect.forkChild(now))
    yield* Deferred.await(first.reached)
    yield* store.set("app", "b", "2")
    expect(yield* store.subscribe("first", [{ space: "app", cursor }])).toBe(true)
    yield* Deferred.succeed(first.release, undefined)
    yield* Fiber.join(older)
    yield* store.set("app", "c", "3")
    expect(first.sent.filter((event) => (event.data as { space: string }).space === "app")).toEqual([
      updated("app", "a", "1", 1),
      updated("app", "b", "2", 2),
      updated("app", "c", "3", 3),
    ])

    // The older subscribe pauses on its first event in app; once replaced, it sends nothing more.
    const second = yield* pausedStream(store, "second")
    const paused = yield* store.subscribe("second", [{ space: "app", cursor }]).pipe(Effect.forkChild(now))
    yield* Deferred.await(second.reached)
    expect(yield* store.subscribe("second", [{ space: "app", cursor }])).toBe(true)
    yield* Deferred.succeed(second.release, undefined)
    yield* Fiber.join(paused)
    yield* store.set("app", "d", "4")
    expect(second.sent).toEqual([
      // The newer catch-up, then the one event the older was already sending, then the next change once.
      updated("app", "a", "1", 1),
      updated("app", "b", "2", 2),
      updated("app", "c", "3", 3),
      updated("app", "a", "1", 1),
      updated("app", "d", "4", 4),
    ])
  }),
)

it.live("unsubscribing stops a space's events, also mid catch-up, while other spaces keep flowing", () =>
  Effect.gen(function* () {
    const { boot } = yield* setup
    const { store, feed } = yield* boot()
    const cursor = `${store.epoch}.0`
    const updated = (space: string, key: string, value: string, revision: number) => ({
      type: "experimental.space.updated",
      data: { space, key, value, revision },
    })
    const stream = yield* feed.subscribe()
    yield* store.subscribe(stream.id, [
      { space: "app", cursor },
      { space: "other", cursor },
    ])
    yield* store.set("app", "a", "1")
    expect(yield* store.unsubscribe(stream.id, ["app"])).toBe(true)
    yield* store.set("app", "b", "2")
    yield* store.set("other", "x", "1")
    expect(yield* take(stream.events, 2)).toEqual([updated("app", "a", "1", 1), updated("other", "x", "1", 1)])
    // A space the stream does not follow is fine; a stream that is not open is not.
    expect(yield* store.unsubscribe(stream.id, ["never"])).toBe(true)
    expect(yield* store.unsubscribe("not-a-stream", ["app"])).toBe(false)

    // A catch-up paused on its first event sends nothing more once unsubscribed.
    const paused = yield* pausedStream(store, "paused")
    const subscribing = yield* store.subscribe("paused", [{ space: "app", cursor }]).pipe(Effect.forkChild(now))
    yield* Deferred.await(paused.reached)
    expect(yield* store.unsubscribe("paused", ["app"])).toBe(true)
    yield* Deferred.succeed(paused.release, undefined)
    yield* Fiber.join(subscribing)
    yield* store.set("app", "c", "3")
    // Only the event it was already sending.
    expect(paused.sent).toEqual([updated("app", "a", "1", 1)])
  }),
)

it.live("a client that syncs while writes go on, then subscribes, ends with exactly the current state", () =>
  Effect.gen(function* () {
    const { boot } = yield* setup
    const { store, feed } = yield* boot()
    yield* Effect.forEach(range(SpaceStore.BatchSize + 5), (index) => store.set("app", `k${index}`, String(index)), {
      discard: true,
    })
    const stream = yield* feed.subscribe()

    // Writes between every page, and between the last page and the subscription.
    const state = new Map<string, string>()
    let page = yield* store.sync("app")
    applyPage(state, page)
    for (let round = 0; page.next !== undefined; round++) {
      yield* store.set("app", `k${round}`, `during ${round}`)
      yield* store.remove("app", `k${SpaceStore.BatchSize + round}`)
      page = yield* store.sync("app", page.next)
      applyPage(state, page)
    }
    yield* store.set("app", "k1", "before subscribe")
    yield* store.remove("app", "k2")
    yield* store.subscribe(stream.id, [{ space: "app", cursor: page.cursor }])
    yield* store.set("app", "k3", "live")
    yield* store.remove("app", "k4")

    const events = yield* take(stream.events, 4)
    expect(events.map((event) => event.type)).toEqual([
      "experimental.space.updated",
      "experimental.space.deleted",
      "experimental.space.updated",
      "experimental.space.deleted",
    ])
    expect(events.reduce(applyEvent, state)).toEqual(yield* current(store, "app"))
  }),
)

it.live("checks a space's tombstones on its first delete after a start, then on every 64th that makes one", () =>
  Effect.gen(function* () {
    const { boot, db } = yield* setup
    const limit = SpaceRows.TombstoneLimit
    const interval = SpaceStore.PurgeInterval
    // As a previous process left them: 5 tombstones past the limit.
    const rows = range(limit + 5).map((index) => ({ space: "app", key: `t${index}`, value: null, revision: index + 1 }))
    for (let start = 0; start < rows.length; start += 1000)
      yield* db
        .insert(SpaceTable)
        .values(rows.slice(start, start + 1000))
        .run()
    const tombstones = SpaceRows.changes(db, "app", 0).pipe(
      Effect.map((rows) => rows.filter((row) => row.value === null).length),
    )
    const floor = SpaceRows.floor(db, "app")

    const { store } = yield* boot()
    yield* Effect.forEach(range(interval + 2), (index) => store.set("app", `k${index}`, String(index)), {
      discard: true,
    })
    yield* store.remove("app", "missing")
    // Neither writes nor deletes that make no tombstone check.
    expect([yield* tombstones, yield* floor]).toEqual([limit + 5, 0])
    yield* store.remove("app", "k0")
    expect([yield* tombstones, yield* floor]).toEqual([limit, 6])

    yield* Effect.forEach(
      range(interval - 1),
      (index) =>
        Effect.all([
          store.remove("app", `k${index + 1}`),
          store.remove("app", `k${index + 1}`),
          store.remove("app", "missing"),
          store.set("app", "written", String(index)),
        ]),
      { discard: true },
    )
    // At most `interval - 1` past the limit between checks.
    expect([yield* tombstones, yield* floor]).toEqual([limit + interval - 1, 6])
    yield* store.remove("app", `k${interval}`)
    expect([yield* tombstones, yield* floor]).toEqual([limit, 6 + interval])

    // A restarted store checks on the first delete again.
    const restarted = yield* boot()
    yield* restarted.store.remove("app", `k${interval + 1}`)
    expect([yield* tombstones, yield* floor]).toEqual([limit, 7 + interval])
  }),
)
