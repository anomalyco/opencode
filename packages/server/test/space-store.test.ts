import { expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Context, Deferred, Effect, Fiber, Layer, Stream } from "effect"
import { it } from "../../core/test/lib/effect"
import { SpaceStore } from "../src/space-store"
import { EventFeed } from "../src/event-feed"

// One in-memory database shared by every `boot()`, each a fresh store, bus and feed as after a process restart.
// `hold(revision)` pauses the change with that revision after it commits and before the feed hears of it, so a test
// can line up competing writes and subscriptions behind it.
const setup = Effect.gen(function* () {
  const database = Context.get(yield* Layer.build(LayerNode.compile(Database.node)), Database.Service)
  const shared = Database.node.replace(Layer.succeed(Database.Service, database))
  const gates = new Map<number, { reached: Deferred.Deferred<void>; release: Deferred.Deferred<void> }>()
  const boot = Effect.fnUntraced(function* (wrap?: (store: SpaceStore.Interface) => SpaceStore.Interface) {
    const bus = Context.get(yield* Layer.build(LayerNode.compile(Bus.node, { replacements: [shared] })), Bus.Service)
    const store = Context.get(
      yield* Layer.build(LayerNode.compile(SpaceStore.node, { replacements: [shared] })),
      SpaceStore.Service,
    )
    // Registered before the feed, so it runs first.
    yield* store.listen((change) =>
      Effect.suspend(() => {
        const gate = gates.get(change.data.revision)
        if (!gate) return Effect.void
        gates.delete(change.data.revision)
        return Deferred.succeed(gate.reached, undefined).pipe(Effect.andThen(Deferred.await(gate.release)))
      }),
    )
    return { store, bus, feed: yield* EventFeed.make(bus.listen, { spaces: wrap ? wrap(store) : store }) }
  })
  const hold = Effect.fnUntraced(function* (revision: number) {
    const gate = { reached: yield* Deferred.make<void>(), release: yield* Deferred.make<void>() }
    gates.set(revision, gate)
    return gate
  })
  return { boot, hold }
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

const collect = (store: SpaceStore.Interface, requests: ReadonlyArray<SpaceStore.Request>) =>
  Stream.fromIterable(requests).pipe(
    Stream.flatMap((request) => store.read(request)),
    Stream.runCollect,
    Effect.map((items) => Array.from(items)),
  )

it.live("delivers concurrent writes to one space in revision order", () =>
  Effect.gen(function* () {
    const { boot } = yield* setup
    const { store, feed } = yield* boot()
    const live = yield* feed.subscribe(undefined, [{ space: "app" }])
    const writes = Array.from({ length: 20 }, (_, index) => index)

    yield* Effect.forEach(
      writes,
      (index) =>
        Effect.all([store.set("app", `k${index % 4}`, index), store.set(`space-${index % 3}`, "k", index)], {
          concurrency: "unbounded",
        }),
      { concurrency: "unbounded", discard: true },
    )

    const [snapshot, ...changes] = yield* take(live, writes.length + 1)
    expect(snapshot).toEqual({
      type: "experimental.kv.snapshot",
      data: { space: "app", epoch: store.epoch, revision: 0, entries: [] },
    })
    expect(changes.map((change) => change.data)).toEqual(
      writes.map((_, index) => expect.objectContaining({ space: "app", revision: index + 1 })),
    )
    // The last change of each key is the value read back.
    const last = new Map(changes.map((change) => [change.data.key, change.data.value]))
    const [state] = yield* collect(store, [{ space: "app" }])
    expect(new Map(state.data.entries.map((entry) => [entry.key, entry.value]))).toEqual(last)
  }),
)

it.live("a write held before delivery blocks neither subscribers, readers nor other spaces", () =>
  Effect.gen(function* () {
    const { boot, hold } = yield* setup
    const { store, feed } = yield* boot()
    yield* store.set("app", "k", "old")
    yield* store.set("app", "gone", 1)

    const pending = yield* hold(3)
    const write = yield* store.set("app", "k", "new").pipe(Effect.forkChild(now))
    yield* Deferred.await(pending.reached)
    // "new" (revision 3) is committed but not yet delivered, and the space's lock is held.
    const fresh = yield* feed.subscribe(undefined, [{ space: "app" }])
    const resumed = yield* feed.subscribe(undefined, [{ space: "app", epoch: store.epoch, since: 2 }])
    yield* store.set("other", "x", 1)
    const next = yield* store.set("app", "k", "newer").pipe(Effect.forkChild(now))
    yield* Deferred.succeed(pending.release, undefined)
    yield* Fiber.join(write)
    yield* Fiber.join(next)
    yield* store.remove("app", "k")

    // Both registered before "new" was delivered and read it in their initial state; it is not sent twice.
    const after = [
      { type: "experimental.kv.updated", data: { space: "app", key: "k", value: "newer", revision: 4 } },
      { type: "experimental.kv.deleted", data: { space: "app", key: "k", revision: 5 } },
    ]
    expect(yield* take(fresh, 3)).toEqual([
      {
        type: "experimental.kv.snapshot",
        data: {
          space: "app",
          epoch: store.epoch,
          revision: 3,
          entries: [
            { key: "gone", value: 1 },
            { key: "k", value: "new" },
          ],
        },
      },
      ...after,
    ])
    expect(yield* take(resumed, 3)).toEqual([
      {
        type: "experimental.kv.delta",
        data: { space: "app", epoch: store.epoch, revision: 3, entries: [{ key: "k", value: "new" }], deleted: [] },
      },
      ...after,
    ])
  }),
)

it.live("writes on either side of a subscription's read reach it exactly once", () =>
  Effect.gen(function* () {
    const { boot } = yield* setup
    const { store, feed } = yield* boot((store) => ({
      ...store,
      read: (request) =>
        Stream.unwrap(store.set("app", "k", "before read").pipe(Effect.as(store.read(request)))).pipe(
          Stream.concat(Stream.fromEffect(store.set("app", "k", "after read")).pipe(Stream.drain)),
        ),
    }))
    const live = yield* feed.subscribe(undefined, [{ space: "app" }])
    yield* store.set("app", "k", "later")

    expect(yield* take(live, 3)).toEqual([
      {
        type: "experimental.kv.snapshot",
        data: { space: "app", epoch: store.epoch, revision: 1, entries: [{ key: "k", value: "before read" }] },
      },
      { type: "experimental.kv.updated", data: { space: "app", key: "k", value: "after read", revision: 2 } },
      { type: "experimental.kv.updated", data: { space: "app", key: "k", value: "later", revision: 3 } },
    ])
  }),
)

it.live("catches each space up from its revision: final values and deletions, else a snapshot", () =>
  Effect.gen(function* () {
    const { boot } = yield* setup
    const { store } = yield* boot()
    yield* store.set("app", "kept", "v1")
    yield* store.set("app", "churn", 1)
    yield* store.set("app", "doomed", true)
    yield* store.set("other", "x", "y")

    // While the client is away: repeated updates, a delete, a delete repeated, and a delete then re-set.
    yield* store.set("app", "churn", 2)
    yield* store.set("app", "churn", 3)
    yield* store.remove("app", "doomed")
    yield* store.remove("app", "doomed")
    yield* store.remove("app", "never-set")
    yield* store.set("app", "back", "a")
    yield* store.remove("app", "back")
    yield* store.set("app", "back", "b")

    const epoch = store.epoch
    expect(
      yield* collect(store, [
        { space: "app", epoch, since: 3 },
        { space: "other", epoch, since: 1 },
        { space: "fresh" },
        { space: "ahead", epoch, since: 9 },
        { space: "zero", epoch, since: 0 },
        { space: "app", epoch, since: 9 },
        { space: "app", epoch: "another-database", since: 9 },
      ]),
    ).toEqual([
      {
        type: "experimental.kv.delta",
        data: {
          space: "app",
          epoch,
          revision: 9,
          entries: [
            { key: "churn", value: 3 },
            { key: "back", value: "b" },
          ],
          deleted: ["doomed"],
        },
      },
      { type: "experimental.kv.delta", data: { space: "other", epoch, revision: 1, entries: [], deleted: [] } },
      { type: "experimental.kv.snapshot", data: { space: "fresh", epoch, revision: 0, entries: [] } },
      { type: "experimental.kv.snapshot", data: { space: "ahead", epoch, revision: 0, entries: [] } },
      { type: "experimental.kv.delta", data: { space: "zero", epoch, revision: 0, entries: [], deleted: [] } },
      { type: "experimental.kv.delta", data: { space: "app", epoch, revision: 9, entries: [], deleted: [] } },
      {
        type: "experimental.kv.snapshot",
        data: {
          space: "app",
          epoch,
          revision: 9,
          entries: [
            { key: "kept", value: "v1" },
            { key: "churn", value: 3 },
            { key: "back", value: "b" },
          ],
        },
      },
    ])
  }),
)

it.live("a restarted store resumes revisions and catch-up from storage alone", () =>
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
    const live = yield* after.feed.subscribe(undefined, [{ space: "app", epoch: after.store.epoch, since: 1 }])
    yield* after.store.set("app", "k", "d")
    expect(yield* take(live, 2)).toEqual([
      {
        type: "experimental.kv.delta",
        data: {
          space: "app",
          epoch: after.store.epoch,
          revision: 4,
          entries: [{ key: "j", value: "c" }],
          deleted: ["k"],
        },
      },
      { type: "experimental.kv.updated", data: { space: "app", key: "k", value: "d", revision: 5 } },
    ])
  }),
)

it.live("sends kv events only to subscribers of their space and leaves other events alone", () =>
  Effect.gen(function* () {
    const { boot } = yield* setup
    const { store, feed, bus } = yield* boot()
    const app = yield* feed.subscribe([Agent.Event.Updated.type], [{ space: "app" }])
    const other = yield* feed.subscribe(undefined, [{ space: "other" }])
    const plain = yield* feed.subscribe()
    const seen: Array<string> = []
    yield* bus.listen((event) => Effect.sync(() => seen.push(event.type)))

    yield* store.set("app", "k", { n: 1 })
    yield* bus.publish(Agent.Event.Updated, {})

    expect(yield* take(app, 3)).toEqual([
      { type: "experimental.kv.snapshot", data: { space: "app", epoch: store.epoch, revision: 0, entries: [] } },
      { type: "experimental.kv.updated", data: { space: "app", key: "k", value: { n: 1 }, revision: 1 } },
      { type: "agent.updated", data: {} },
    ])
    expect(yield* take(other, 2)).toEqual([
      { type: "experimental.kv.snapshot", data: { space: "other", epoch: store.epoch, revision: 0, entries: [] } },
      { type: "agent.updated", data: {} },
    ])
    expect(yield* take(plain, 1)).toEqual([{ type: "agent.updated", data: {} }])
    // Changes never pass through the bus, which is where plugins listen.
    expect(seen).toEqual([Agent.Event.Updated.type])
  }),
)

it.live("sends a large space in batches, each covering every change up to its revision", () =>
  Effect.gen(function* () {
    const { boot } = yield* setup
    const { store, feed } = yield* boot()
    const count = SpaceStore.BatchSize * 2 + 1
    yield* Effect.forEach(
      Array.from({ length: count }, (_, index) => index),
      (index) => store.set("big", `k${index}`, index),
      {
        discard: true,
      },
    )
    yield* store.remove("big", "k0")

    const live = yield* feed.subscribe(undefined, [{ space: "big" }])
    yield* store.set("big", "after", true)
    const [first, second, third, change] = yield* take(live, 4)
    expect(
      [first, second, third].map((batch) => [batch?.type, batch?.data.revision, batch?.data.entries.length]),
    ).toEqual([
      ["experimental.kv.snapshot", SpaceStore.BatchSize + 1, SpaceStore.BatchSize],
      ["experimental.kv.delta", SpaceStore.BatchSize * 2 + 1, SpaceStore.BatchSize],
      ["experimental.kv.delta", count + 1, 0],
    ])
    // k0 became a tombstone after the first batch's revisions, so the last batch reports the deletion.
    expect(third?.data.deleted).toEqual(["k0"])
    expect(change).toEqual({
      type: "experimental.kv.updated",
      data: { space: "big", key: "after", value: true, revision: count + 2 },
    })
  }),
)
