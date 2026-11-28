import { expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { SpaceRows } from "@opencode/core/space"
import { SpaceTable } from "@opencode/core/space/sql"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Space } from "@opencode/schema/space"
import { Context, Deferred, Effect, Fiber, Layer, Stream } from "effect"
import { recordedSql } from "../../core/test/fixture/recorded-sql"
import { it } from "../../core/test/lib/effect"
import { SpaceStore } from "../src/space-store"
import { EventFeed } from "../src/event-feed"

// One in-memory database shared by every `boot()`, each a fresh store, bus and feed as after a process restart, with
// the statements it runs. `hold(revision)` pauses the change with that revision after it commits and before streams
// hear of it, so a test can line up competing writes and subscriptions behind it.
const setup = Effect.gen(function* () {
  const recorded = recordedSql()
  const database = Context.get(
    yield* Layer.build(LayerNode.compile(Database.configuredClient(recorded.layer))),
    Database.Service,
  )
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
  return { boot, hold, db: database.db, statements: recorded.statements }
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

// Writes the changes to one space, and returns its head.
const write = (store: SpaceStore.Interface, space: string, changes: ReadonlyArray<Omit<Space.Change, "space">>) =>
  store.write(changes.map((change) => ({ space, ...change }))).pipe(Effect.map((heads) => heads[0]))

// The page of a sync of one space alone, which always gets one.
const syncOne = (store: SpaceStore.Interface, space: string, cursor?: string) =>
  store
    .sync([cursor === undefined ? { space } : { space, cursor }])
    .pipe(Effect.flatMap(([page]) => (page ? Effect.succeed(page) : Effect.die(new Error("No page")))))

// Every page of a sync from `cursor`, following `next`.
const syncAll = Effect.fnUntraced(function* (store: SpaceStore.Interface, space: string, cursor?: string) {
  const pages: Array<Space.Page> = []
  for (let next = cursor, first = true; first || next !== undefined; first = false) {
    const page = yield* syncOne(store, space, next)
    pages.push(page)
    next = page.next
  }
  return pages
})

// A client applying sync pages as the API describes: a delta's entries and deletions at once, a snapshot's entries at
// once, and the keys none of a snapshot's pages held removed after its last one, the page without `next` or the one
// before a delta.
const follower = (state = new Map<string, string>()) => {
  let snapshot: Set<string> | undefined
  const finish = () => {
    if (snapshot) for (const key of state.keys()) if (!snapshot.has(key)) state.delete(key)
    snapshot = undefined
  }
  return {
    state,
    apply: (page: Space.Page) => {
      if (page.type === "delta") finish()
      for (const entry of page.entries) state.set(entry.key, entry.value)
      if (page.type === "delta") for (const key of page.deleted) state.delete(key)
      if (page.type === "snapshot") {
        snapshot ??= new Set()
        for (const entry of page.entries) snapshot.add(entry.key)
      }
      if (page.next === undefined) finish()
      return state
    },
  }
}

const applyPages = (pages: ReadonlyArray<Space.Page>, state?: Map<string, string>) => {
  const client = follower(state)
  for (const page of pages) client.apply(page)
  return client.state
}

// And after applying a stream event.
const applyEvent = (state: Map<string, string>, event: { readonly type: string; readonly data: any }) => {
  if (event.type === "experimental.space.updated") state.set(event.data.key, event.data.value)
  if (event.type === "experimental.space.deleted") state.delete(event.data.key)
  return state
}

const current = (store: SpaceStore.Interface, space: string) =>
  syncAll(store, space).pipe(Effect.map((pages) => applyPages(pages)))

const range = (count: number) => Array.from({ length: count }, (_, index) => index)

it.live("syncs a space in pages: live rows up to the starting head, then a delta of what changed meanwhile", () =>
  Effect.gen(function* () {
    const { boot } = yield* setup
    const { store } = yield* boot()
    const count = SpaceStore.BatchSize + 10
    yield* write(
      store,
      "big",
      range(count).map((index) => ({ key: `k${index}`, value: String(index) })),
    )
    const epoch = store.epoch

    const first = yield* syncOne(store, "big")
    expect([first.type, first.revision, first.entries.length, first.cursor, first.next]).toEqual([
      "snapshot",
      SpaceStore.BatchSize,
      SpaceStore.BatchSize,
      `${epoch}.${SpaceStore.BatchSize}`,
      `${epoch}.${SpaceStore.BatchSize}.${count}`,
    ])
    // Between pages: a delete and a rewrite of keys the first page held, and of keys the second would hold.
    yield* write(store, "big", [{ key: "k0", value: null }])
    yield* write(store, "big", [{ key: "k1", value: "new" }])
    yield* write(store, "big", [{ key: `k${SpaceStore.BatchSize + 5}`, value: "new" }])
    yield* write(store, "big", [{ key: `k${SpaceStore.BatchSize + 6}`, value: null }])

    const second = yield* syncOne(store, "big", first.next)
    // The rest of the keys up to the starting head, without the two changed meanwhile.
    expect(second).toEqual({
      type: "snapshot",
      space: "big",
      epoch,
      revision: count,
      entries: range(10)
        .filter((index) => index !== 5 && index !== 6)
        .map((index) => ({ key: `k${SpaceStore.BatchSize + index}`, value: String(SpaceStore.BatchSize + index) })),
      cursor: `${epoch}.${count}`,
      next: `${epoch}.${count}`,
    })
    const third = yield* syncOne(store, "big", second.next)
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
    const held = follower()
    for (const page of [first, second, third]) {
      held.apply(page)
      const resumed = yield* syncAll(store, "big", page.cursor)
      expect(resumed.map((item) => item.type)).not.toContain("snapshot")
      expect(applyPages(resumed, new Map(held.state))).toEqual(now)
    }
  }),
)

it.live("a snapshot reads no tombstones, and its last page reports the head it started from", () =>
  Effect.gen(function* () {
    const { boot } = yield* setup
    const { store } = yield* boot()
    yield* write(
      store,
      "big",
      range(SpaceStore.BatchSize + 1).map((index) => ({ key: `k${index}`, value: String(index) })),
    )
    yield* write(store, "big", [{ key: "k0", value: null }])
    const page = yield* syncOne(store, "big")
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
    yield* write(store, "app", [{ key: "kept", value: "v1" }])
    yield* write(store, "app", [{ key: "churn", value: "1" }])
    yield* write(store, "app", [{ key: "doomed", value: "true" }])
    yield* write(store, "other", [{ key: "x", value: "y" }])

    // While the client is away: repeated updates, a delete, a delete repeated, and a delete then re-set.
    yield* write(store, "app", [{ key: "churn", value: "2" }])
    yield* write(store, "app", [{ key: "churn", value: "3" }])
    yield* write(store, "app", [{ key: "doomed", value: null }])
    yield* write(store, "app", [{ key: "doomed", value: null }])
    yield* write(store, "app", [{ key: "never-set", value: null }])
    yield* write(store, "app", [{ key: "back", value: "a" }])
    yield* write(store, "app", [{ key: "back", value: null }])
    yield* write(store, "app", [{ key: "back", value: "b" }])

    const epoch = store.epoch
    const page = (space: string, cursor?: string) => syncOne(store, space, cursor)
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
    yield* write(
      before.store,
      "app",
      ["a", "b", "c", "d"].map((key) => ({ key, value: key })),
    )
    // With a limit of 2, the third delete purges the first tombstone, at revision 5.
    yield* Effect.forEach(["a", "b", "c"], (key) => SpaceRows.remove(db, "app", key), { discard: true })
    yield* SpaceRows.purge(db, "app", 2)

    const { store } = yield* boot()
    const epoch = store.epoch
    // A delta from 4 could no longer report that a was deleted.
    expect(yield* syncOne(store, "app", `${epoch}.4`)).toEqual({
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
    expect(yield* syncOne(store, "app", `${epoch}.5`)).toEqual(delta(["b", "c"]))
    expect(yield* syncOne(store, "app", `${epoch}.6`)).toEqual(delta(["c"]))
  }),
)

it.live("a delta page whose deletions were purged meanwhile comes back as a snapshot", () =>
  Effect.gen(function* () {
    const { boot, db } = yield* setup
    const { store } = yield* boot()
    // The client holds k0 to k9, at revision 10.
    yield* write(
      store,
      "app",
      range(10).map((index) => ({ key: `k${index}`, value: String(index) })),
    )
    const held = new Map(range(10).map((index) => [`k${index}`, String(index)]))
    // Then come a full page of new keys and two tombstones.
    yield* write(
      store,
      "app",
      range(SpaceStore.BatchSize).map((index) => ({ key: `u${index}`, value: String(index) })),
    )
    yield* SpaceRows.remove(db, "app", "k0")
    yield* SpaceRows.remove(db, "app", "k1")

    const first = yield* syncOne(store, "app", `${store.epoch}.10`)
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
      ["snapshot", head, 7],
    ])
    expect(applyPages(pages, held)).toEqual(yield* current(store, "app"))
    expect(held.has("k0")).toBe(false)
  }),
)

it.live("a restarted store resumes revisions and sync from storage alone", () =>
  Effect.gen(function* () {
    const { boot } = yield* setup
    const before = yield* boot()
    yield* write(before.store, "app", [{ key: "k", value: "a" }])
    yield* write(before.store, "app", [{ key: "k", value: "b" }])
    yield* write(before.store, "app", [{ key: "k", value: null }])

    // A new process over the same database. Its first write must not reuse a revision, even the tombstone's.
    const after = yield* boot()
    expect(after.store.epoch).toBe(before.store.epoch)
    yield* write(after.store, "app", [{ key: "j", value: "c" }])
    expect(yield* syncOne(after.store, "app", `${after.store.epoch}.1`)).toEqual({
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
    yield* write(store, "app", [{ key: "k", value: "1" }])
    yield* write(store, "app", [{ key: "gone", value: "x" }])
    yield* write(store, "other", [{ key: "x", value: "1" }])
    const synced = yield* syncOne(store, "app")
    // After the sync and before the subscription.
    yield* write(store, "app", [{ key: "k", value: "2" }])
    yield* write(store, "app", [{ key: "gone", value: null }])

    const stream = yield* feed.subscribe([Agent.Event.Updated.type])
    const plain = yield* feed.subscribe()
    const seen: Array<string> = []
    yield* bus.listen((event) => Effect.sync(() => seen.push(event.type)))
    expect(yield* store.subscribe(stream.id, [{ space: "app", cursor: synced.cursor }])).toBe(true)
    yield* write(store, "app", [{ key: "k", value: "3" }])
    yield* write(store, "other", [{ key: "x", value: "2" }])
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

it.live(
  "a write commits all its changes across spaces at once, each at its space's next revision, then sends each",
  () =>
    Effect.gen(function* () {
      const { boot, hold } = yield* setup
      const { store, feed } = yield* boot()
      const epoch = store.epoch
      const stream = yield* feed.subscribe()
      yield* store.subscribe(stream.id, [
        { space: "app", cursor: `${epoch}.0` },
        { space: "other", cursor: `${epoch}.0` },
      ])
      const updated = (key: string, value: string, revision: number, space = "app") => ({
        type: "experimental.space.updated",
        data: { space, key, value, revision },
      })
      const deleted = (key: string, revision: number, space = "app") => ({
        type: "experimental.space.deleted",
        data: { space, key, revision },
      })

      // The most changes a write takes: sets, then deletes of the same keys.
      const half = Space.MaxChanges / 2
      expect(
        yield* write(
          store,
          "app",
          range(Space.MaxChanges).map((index) => ({
            key: `k${index % half}`,
            value: index < half ? `${index}` : null,
          })),
        ),
      ).toEqual({ space: "app", revision: Space.MaxChanges, cursor: `${epoch}.${Space.MaxChanges}` })
      expect(yield* take(stream.events, Space.MaxChanges)).toEqual([
        ...range(half).map((index) => updated(`k${index}`, `${index}`, index + 1)),
        ...range(half).map((index) => deleted(`k${index}`, half + index + 1)),
      ])

      // Held after its first change reaches listeners: by then every change in every space is committed. A delete of an
      // unset key, or of one already deleted, takes no revision and sends nothing; a key changed twice gets both.
      const head = Space.MaxChanges
      const pending = yield* hold(head + 1)
      const held = yield* store
        .write([
          { space: "app", key: "a", value: "1" },
          { space: "other", key: "x", value: "1" },
          { space: "app", key: "never", value: null },
          { space: "app", key: "a", value: "2" },
          { space: "other", key: "x", value: null },
          { space: "app", key: "b", value: "1" },
          { space: "idle", key: "never", value: null },
          { space: "app", key: "b", value: null },
          { space: "app", key: "b", value: null },
        ])
        .pipe(Effect.forkChild(now))
      yield* Deferred.await(pending.reached)
      expect(yield* current(store, "app")).toEqual(new Map([["a", "2"]]))
      expect((yield* syncOne(store, "other")).revision).toBe(2)
      yield* Deferred.succeed(pending.release, undefined)
      // Each space's head after the write, in the order the spaces first appear, also when its changes change nothing.
      expect(yield* Fiber.join(held)).toEqual([
        { space: "app", revision: head + 4, cursor: `${epoch}.${head + 4}` },
        { space: "other", revision: 2, cursor: `${epoch}.2` },
        { space: "idle", revision: 0, cursor: `${epoch}.0` },
      ])
      expect(yield* write(store, "app", [{ key: "never", value: null }])).toEqual({
        space: "app",
        revision: head + 4,
        cursor: `${epoch}.${head + 4}`,
      })
      yield* write(store, "app", [{ key: "c", value: "1" }])
      // In request order, so each space's in revision order.
      expect(yield* take(stream.events, 7)).toEqual([
        updated("a", "1", head + 1),
        updated("x", "1", 1, "other"),
        updated("a", "2", head + 2),
        deleted("x", 2, "other"),
        updated("b", "1", head + 3),
        deleted("b", head + 4),
        updated("c", "1", head + 5),
      ])
    }),
)

it.live("writes sharing spaces take their locks in one order, so crossing writes never wait on each other", () =>
  Effect.gen(function* () {
    const { boot, hold } = yield* setup
    const { store } = yield* boot()
    yield* write(store, "b", [{ key: "k", value: "0" }])
    // The first write holds b's lock. The second wants b and then a, the third a and then b: taking them in request
    // order, the second would hold b waiting for a while the third held a waiting for b.
    const pending = yield* hold(2)
    const first = yield* write(store, "b", [{ key: "k", value: "1" }]).pipe(Effect.forkChild(now))
    yield* Deferred.await(pending.reached)
    const second = yield* store
      .write([
        { space: "b", key: "k", value: "2" },
        { space: "a", key: "k", value: "2" },
      ])
      .pipe(Effect.forkChild(now))
    const third = yield* store
      .write([
        { space: "a", key: "k", value: "3" },
        { space: "b", key: "k", value: "3" },
      ])
      .pipe(Effect.forkChild(now))
    yield* Deferred.succeed(pending.release, undefined)
    const epoch = store.epoch
    expect(
      yield* Effect.all([Fiber.join(first), Fiber.join(second), Fiber.join(third)]).pipe(Effect.timeout("2 seconds")),
    ).toEqual([
      { space: "b", revision: 2, cursor: `${epoch}.2` },
      [
        { space: "b", revision: 3, cursor: `${epoch}.3` },
        { space: "a", revision: 1, cursor: `${epoch}.1` },
      ],
      [
        { space: "a", revision: 2, cursor: `${epoch}.2` },
        { space: "b", revision: 4, cursor: `${epoch}.4` },
      ],
    ])
  }),
)

it.live("a write committed before the subscribe read and delivered after it reaches the stream once, in order", () =>
  Effect.gen(function* () {
    const { boot, hold } = yield* setup
    const { store, feed } = yield* boot()
    yield* write(store, "app", [{ key: "k", value: "1" }])
    const synced = yield* syncOne(store, "app")
    const stream = yield* feed.subscribe()

    const pending = yield* hold(2)
    const written = yield* write(store, "app", [{ key: "k", value: "2" }]).pipe(Effect.forkChild(now))
    yield* Deferred.await(pending.reached)
    // "2" is committed but not yet delivered, and the space's lock is held; neither sync, subscribe nor other spaces
    // wait for it.
    expect((yield* syncOne(store, "app", synced.cursor)).revision).toBe(2)
    yield* write(store, "other", [{ key: "x", value: "1" }])
    expect(yield* store.subscribe(stream.id, [{ space: "app", cursor: synced.cursor }])).toBe(true)
    const next = yield* write(store, "app", [{ key: "k", value: "3" }]).pipe(Effect.forkChild(now))
    yield* Deferred.succeed(pending.release, undefined)
    yield* Fiber.join(written)
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
    yield* store.subscribe(stream.id, [{ space: "app", cursor: (yield* syncOne(store, "app")).cursor }])
    const writes = range(20)
    yield* Effect.forEach(
      writes,
      (index) =>
        Effect.all(
          [
            write(store, "app", [{ key: `k${index % 4}`, value: String(index) }]),
            write(store, `space-${index % 3}`, [{ key: "k", value: String(index) }]),
          ],
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

it.live(
  "a subscribe's catch-ups share one batch: what does not fit, all after it and unusable cursors get resync",
  () =>
    Effect.gen(function* () {
      const { boot, db, statements } = yield* setup
      const { store, feed } = yield* boot()
      const epoch = store.epoch
      const fill = (space: string, count: number) =>
        write(
          store,
          space,
          range(count).map((index) => ({ key: `k${index}`, value: String(index) })),
        )
      yield* fill("big", SpaceStore.BatchSize + 1)
      yield* fill("purged", 3)
      yield* Effect.forEach(["k0", "k1", "k2"], (key) => SpaceRows.remove(db, "purged", key), { discard: true })
      yield* SpaceRows.purge(db, "purged", 2)
      yield* fill("small", 10)
      yield* fill("rest", SpaceStore.BatchSize - 10)
      yield* fill("later", 1)
      const resync = (space: string) => ({ type: "experimental.space.resync", data: { space } })
      const updated = (space: string, count: number) =>
        range(count).map((index) => ({
          type: "experimental.space.updated",
          data: { space, key: `k${index}`, value: String(index), revision: index + 1 },
        }))

      // Below the floor, from another database, a revision never issued and a snapshot's continuation cost nothing;
      // small and rest fill the batch exactly, so later is not read at all.
      const first = yield* feed.subscribe()
      statements.length = 0
      yield* store.subscribe(
        first.id,
        ["purged", "elsewhere", "ahead", "partial", "small", "rest", "later"].map((space) => ({
          space,
          cursor:
            { purged: `${epoch}.3`, elsewhere: "another-database.0", ahead: `${epoch}.9`, partial: `${epoch}.0.5` }[
              space
            ] ?? `${epoch}.0`,
        })),
      )
      // One statement for each cursor that parses as a delta: purged, ahead, small and rest.
      expect(statements).toHaveLength(4)
      yield* write(store, "later", [{ key: "after", value: "true" }])
      expect(yield* take(first.events, 4 + SpaceStore.BatchSize + 2)).toEqual([
        ...["purged", "elsewhere", "ahead", "partial"].map(resync),
        ...updated("small", 10),
        ...updated("rest", SpaceStore.BatchSize - 10),
        resync("later"),
        // Live changes still follow a resync.
        { type: "experimental.space.updated", data: { space: "later", key: "after", value: "true", revision: 2 } },
      ])

      // Big does not fit and uses up the batch, so small, which would, is not read either.
      const second = yield* feed.subscribe()
      statements.length = 0
      yield* store.subscribe(second.id, [
        { space: "big", cursor: `${epoch}.0` },
        { space: "small", cursor: `${epoch}.0` },
      ])
      expect(statements).toHaveLength(1)
      expect(yield* take(second.events, 2)).toEqual([resync("big"), resync("small")])
    }),
)

it.live("syncs several spaces in one request: in order, from one batch of rows, and unread once it is used up", () =>
  Effect.gen(function* () {
    const { boot, statements } = yield* setup
    const { store } = yield* boot()
    const epoch = store.epoch
    const fill = (space: string, count: number) =>
      write(
        store,
        space,
        range(count).map((index) => ({ key: `k${index}`, value: String(index) })),
      )
    yield* fill("a", 300)
    yield* fill("b", 300)
    yield* fill("c", 5)
    const snapshot = (space: string, from: number, to: number, revision: number, next?: string) => ({
      type: "snapshot" as const,
      space,
      epoch,
      revision,
      entries: range(to - from).map((index) => ({ key: `k${from + index}`, value: String(from + index) })),
      cursor: `${epoch}.${revision}`,
      ...(next === undefined ? {} : { next }),
    })

    // An empty space is a snapshot of nothing and costs no rows; b gets what a leaves, and c gets no page.
    statements.length = 0
    const pages = yield* store.sync([{ space: "empty" }, { space: "a" }, { space: "b" }, { space: "c" }])
    expect(statements).toHaveLength(3)
    expect(pages).toEqual([
      snapshot("empty", 0, 0, 0),
      snapshot("a", 0, 300, 300),
      snapshot("b", 0, 200, 200, `${epoch}.200.300`),
    ])

    // The client sends b's `next` and c without a cursor again, and both fit.
    yield* write(store, "b", [{ key: "k0", value: "new" }])
    yield* write(store, "c", [{ key: "k9", value: "9" }])
    const rest = yield* store.sync([{ space: "b", cursor: `${epoch}.200.300` }, { space: "c" }])
    expect(rest).toEqual([
      // The rest of b up to its starting head, then a delta of what changed meanwhile.
      snapshot("b", 200, 300, 300, `${epoch}.300`),
      { ...snapshot("c", 0, 5, 6), entries: [...snapshot("c", 0, 5, 6).entries, { key: "k9", value: "9" }] },
    ])
    const delta = yield* store.sync([{ space: "b", cursor: `${epoch}.300` }])
    expect(delta).toEqual([
      {
        type: "delta",
        space: "b",
        epoch,
        revision: 301,
        entries: [{ key: "k0", value: "new" }],
        deleted: [],
        cursor: `${epoch}.301`,
      },
    ])
    expect(applyPages([pages[2], rest[0], delta[0]].filter((page) => page !== undefined))).toEqual(
      yield* current(store, "b"),
    )
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
    yield* write(store, "app", [{ key: "k", value: "1" }])
  }),
)

it.live("subscribing a space again on the same stream replaces its subscription", () =>
  Effect.gen(function* () {
    const { boot } = yield* setup
    const { store, feed } = yield* boot()
    const cursor = (yield* syncOne(store, "app")).cursor
    const stream = yield* feed.subscribe()
    yield* store.subscribe(stream.id, [{ space: "app", cursor }])
    yield* write(store, "app", [{ key: "k", value: "1" }])
    yield* store.subscribe(stream.id, [{ space: "app", cursor }])
    yield* write(store, "app", [{ key: "k", value: "2" }])

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
    yield* write(store, "other", [{ key: "x", value: "1" }])
    yield* write(store, "app", [{ key: "a", value: "1" }])

    // The older subscribe pauses on its first space, before it reads app's changes; the newer one replaces its app.
    const first = yield* pausedStream(store, "first")
    const older = yield* store
      .subscribe("first", [
        { space: "other", cursor },
        { space: "app", cursor },
      ])
      .pipe(Effect.forkChild(now))
    yield* Deferred.await(first.reached)
    yield* write(store, "app", [{ key: "b", value: "2" }])
    expect(yield* store.subscribe("first", [{ space: "app", cursor }])).toBe(true)
    yield* Deferred.succeed(first.release, undefined)
    yield* Fiber.join(older)
    yield* write(store, "app", [{ key: "c", value: "3" }])
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
    yield* write(store, "app", [{ key: "d", value: "4" }])
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
    yield* write(store, "app", [{ key: "a", value: "1" }])
    expect(yield* store.unsubscribe(stream.id, ["app"])).toBe(true)
    yield* write(store, "app", [{ key: "b", value: "2" }])
    yield* write(store, "other", [{ key: "x", value: "1" }])
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
    yield* write(store, "app", [{ key: "c", value: "3" }])
    // Only the event it was already sending.
    expect(paused.sent).toEqual([updated("app", "a", "1", 1)])
  }),
)

it.live("a client that syncs while writes go on, then subscribes, ends with exactly the current state", () =>
  Effect.gen(function* () {
    const { boot } = yield* setup
    const { store, feed } = yield* boot()
    yield* write(
      store,
      "app",
      range(SpaceStore.BatchSize + 5).map((index) => ({ key: `k${index}`, value: String(index) })),
    )
    const stream = yield* feed.subscribe()

    // Writes between every page, and between the last page and the subscription. The client still holds a key from
    // before, which the snapshot drops after its last page.
    const client = follower(new Map([["stale", "x"]]))
    let page = yield* syncOne(store, "app")
    client.apply(page)
    expect(client.state.get("stale")).toBe("x")
    for (let round = 0; page.next !== undefined; round++) {
      yield* write(store, "app", [{ key: `k${round}`, value: `during ${round}` }])
      yield* write(store, "app", [{ key: `k${SpaceStore.BatchSize + round}`, value: null }])
      page = yield* syncOne(store, "app", page.next)
      client.apply(page)
    }
    expect(client.state.has("stale")).toBe(false)
    yield* write(store, "app", [{ key: "k1", value: "before subscribe" }])
    yield* write(store, "app", [{ key: "k2", value: null }])
    yield* store.subscribe(stream.id, [{ space: "app", cursor: page.cursor }])
    yield* write(store, "app", [{ key: "k3", value: "live" }])
    yield* write(store, "app", [{ key: "k4", value: null }])

    const events = yield* take(stream.events, 4)
    expect(events.map((event) => event.type)).toEqual([
      "experimental.space.updated",
      "experimental.space.deleted",
      "experimental.space.updated",
      "experimental.space.deleted",
    ])
    expect(events.reduce(applyEvent, client.state)).toEqual(yield* current(store, "app"))
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
    const tombstones = db
      .select({ value: SpaceTable.value })
      .from(SpaceTable)
      .all()
      .pipe(Effect.map((rows) => rows.filter((row) => row.value === null).length))
    const floor = SpaceRows.floor(db, "app")

    const { store } = yield* boot()
    yield* write(
      store,
      "app",
      range(interval + 2).map((index) => ({ key: `k${index}`, value: String(index) })),
    )
    yield* write(store, "app", [{ key: "missing", value: null }])
    // Neither writes nor deletes that make no tombstone check.
    expect([yield* tombstones, yield* floor]).toEqual([limit + 5, 0])
    yield* write(store, "app", [{ key: "k0", value: null }])
    expect([yield* tombstones, yield* floor]).toEqual([limit, 6])

    yield* Effect.forEach(
      range(interval - 1),
      (index) =>
        write(store, "app", [
          { key: `k${index + 1}`, value: null },
          { key: `k${index + 1}`, value: null },
          { key: "missing", value: null },
          { key: "written", value: String(index) },
        ]),
      { discard: true },
    )
    // At most `interval - 1` past the limit between checks.
    expect([yield* tombstones, yield* floor]).toEqual([limit + interval - 1, 6])
    yield* write(store, "app", [{ key: `k${interval}`, value: null }])
    expect([yield* tombstones, yield* floor]).toEqual([limit, 6 + interval])

    // A restarted store checks on the first delete again.
    const restarted = yield* boot()
    yield* write(restarted.store, "app", [{ key: `k${interval + 1}`, value: null }])
    expect([yield* tombstones, yield* floor]).toEqual([limit, 7 + interval])

    // A write that makes `interval` tombstones counts each of them, and checks once after it.
    yield* write(restarted.store, "app", [
      ...range(interval).map((index) => ({ key: `n${index}`, value: "1" })),
      ...range(interval).map((index) => ({ key: `n${index}`, value: null })),
    ])
    expect(yield* tombstones).toBe(limit)
  }),
)
