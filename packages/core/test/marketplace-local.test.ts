import path from "node:path"
import { expect } from "bun:test"
import { Clock, Effect, Layer, Result } from "effect"
import { MarketplaceLocal } from "@opencode/core/marketplace"
import { Database } from "@opencode/core/database/database"
import { AbsolutePath } from "@opencode/schema/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"
import { tmpdirScoped } from "./fixture/tmpdir"

const it = testEffect(LayerNode.compile(MarketplaceLocal.node))
const catalog = (system = "reviewed", id = "review") => ({
  schema: "opencode.marketplace/experimental",
  id: "team",
  name: "Team",
  items: [
    {
      id,
      name: "Review",
      kind: "agent",
      version: "1.0.0",
      install: { agents: { review: { system, mode: "subagent", description: "Review changes" } } },
    },
  ],
})

it.live("applies the captured agent snapshot once and leaves user files untouched", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const file = AbsolutePath.make(path.join(tmp.path, "marketplace.json"))
    const user = path.join(tmp.path, "opencode.jsonc")
    yield* Effect.promise(async () => {
      await Bun.write(file, JSON.stringify(catalog()))
      await Bun.write(user, '{ // user config\n "agents": {} }\n')
    })
    const marketplace = yield* MarketplaceLocal.Service
    expect(yield* marketplace.read).toEqual({ revision: 0, installed: {} })
    const plan = yield* marketplace.plan({ file, item: "review" })
    expect(plan.revision).toBe(0)
    Object.assign(plan.installed.agents.review, { system: "changed preview" })
    yield* Effect.promise(() => Bun.write(file, JSON.stringify(catalog("changed catalog"))))
    const state = yield* marketplace.install(plan.id)
    expect(state.revision).toBe(1)
    expect(state.installed[plan.key].agents.review.system).toBe("reviewed")
    expect(MarketplaceLocal.documents(state)[0]?.info.agents?.[`marketplace/${plan.key}/review`].system).toBe(
      "reviewed",
    )
    const replay = yield* Effect.flip(marketplace.install(plan.id))
    expect(replay.reason).toBe("plan")
    const removed = yield* marketplace.uninstall({ key: plan.key, revision: state.revision })
    expect(removed).toEqual({ revision: 2, installed: {} })
    expect(yield* marketplace.uninstall({ key: plan.key, revision: 2 })).toEqual(removed)
    expect(yield* Effect.promise(() => Bun.file(user).text())).toBe('{ // user config\n "agents": {} }\n')
  }),
)

it.live("rejects stale plans and removals while preserving the installed package", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const file = AbsolutePath.make(path.join(tmp.path, "marketplace.json"))
    yield* Effect.promise(() => Bun.write(file, JSON.stringify(catalog())))
    const marketplace = yield* MarketplaceLocal.Service
    const first = yield* marketplace.plan({ file, item: "review" })
    const second = yield* marketplace.plan({ file, item: "review" })
    const outcomes = yield* Effect.all(
      [first, second].map((plan) => marketplace.install(plan.id).pipe(Effect.result)),
      { concurrency: "unbounded" },
    )
    expect(outcomes.filter(Result.isSuccess)).toHaveLength(1)
    expect(outcomes.filter(Result.isFailure).map((outcome) => outcome.failure.reason)).toEqual(["revision"])
    const stale = yield* Effect.flip(marketplace.uninstall({ key: first.key, revision: 0 }))
    expect(stale.reason).toBe("revision")
    expect((yield* marketplace.read).revision).toBe(1)
  }),
)

it.live("expires a plan using the caller's clock without sleeping", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const file = AbsolutePath.make(path.join(tmp.path, "marketplace.json"))
    yield* Effect.promise(() => Bun.write(file, JSON.stringify(catalog())))
    const marketplace = yield* MarketplaceLocal.Service
    const plan = yield* marketplace.plan({ file, item: "review" })
    const clock = yield* Clock.Clock
    const error = yield* Effect.flip(marketplace.install(plan.id)).pipe(
      Effect.provideService(Clock.Clock, {
        currentTimeMillis: Effect.succeed(plan.expires),
        currentTimeMillisUnsafe: () => plan.expires,
        currentTimeNanos: clock.currentTimeNanos,
        currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
        monotonicTimeNanos: clock.monotonicTimeNanos,
        monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
        sleep: (duration) => clock.sleep(duration),
      }),
    )
    expect(error.reason).toBe("expired")
    expect(yield* marketplace.read).toEqual({ revision: 0, installed: {} })
  }),
)

it.live("keeps same-named agents in distinct package namespaces across updates", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const file = AbsolutePath.make(path.join(tmp.path, "marketplace.json"))
    const marketplace = yield* MarketplaceLocal.Service
    yield* Effect.promise(() => Bun.write(file, JSON.stringify(catalog())))
    const first = yield* marketplace.plan({ file, item: "review" })
    yield* marketplace.install(first.id)
    yield* Effect.promise(() => Bun.write(file, JSON.stringify(catalog("another package", "another"))))
    const second = yield* marketplace.plan({ file, item: "another" })
    yield* marketplace.install(second.id)
    yield* Effect.promise(() => Bun.write(file, JSON.stringify(catalog("updated"))))
    const update = yield* marketplace.plan({ file, item: "review" })
    expect(update.key).toBe(first.key)
    const state = yield* marketplace.install(update.id)
    expect(Object.keys(state.installed).sort()).toEqual([first.key, second.key].sort())
    expect(state.installed[first.key].agents.review.system).toBe("updated")
    expect(state.installed[second.key].agents.review.system).toBe("another package")
    const projected = MarketplaceLocal.documents(state).flatMap((document) => Object.keys(document.info.agents ?? {}))
    expect(projected.sort()).toEqual([`marketplace/${first.key}/review`, `marketplace/${second.key}/review`].sort())
    expect(state.revision).toBe(3)
  }),
)

it.live("rejects unsupported catalog shapes before changing durable state", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const file = AbsolutePath.make(path.join(tmp.path, "marketplace.json"))
    const marketplace = yield* MarketplaceLocal.Service
    const valid = catalog()
    const invalid = [
      "{",
      JSON.stringify({ ...valid, schema: "opencode.marketplace/v1" }),
      JSON.stringify({ ...valid, items: [...valid.items, ...valid.items] }),
      JSON.stringify({ ...valid, items: [{ ...valid.items[0], kind: "plugin" }] }),
      JSON.stringify({
        ...valid,
        items: [{ ...valid.items[0], install: { agents: { review: { prompt: "V1 config" } } } }],
      }),
      JSON.stringify({ ...valid, items: [{ ...valid.items[0], install: { agents: {} } }] }),
    ]
    for (const text of invalid) {
      yield* Effect.promise(() => Bun.write(file, text))
      expect((yield* Effect.flip(marketplace.plan({ file, item: "review" }))).reason).toBe("catalog")
    }
    yield* Effect.promise(() => Bun.write(file, JSON.stringify(valid)))
    expect((yield* Effect.flip(marketplace.plan({ file, item: "missing" }))).reason).toBe("item")
    expect(
      (yield* Effect.flip(
        marketplace.plan({ file: AbsolutePath.make("https://example.test/catalog.json"), item: "review" }),
      )).reason,
    ).toBe("catalog")
    yield* Effect.promise(() => Bun.write(file, " ".repeat(2 * 1024 * 1024 + 1)))
    expect((yield* Effect.flip(marketplace.plan({ file, item: "review" }))).reason).toBe("catalog")
    expect(yield* marketplace.read).toEqual({ revision: 0, installed: {} })
  }),
)

it.live("persists installed state across service recreation without persisting pending plans", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const file = AbsolutePath.make(path.join(tmp.path, "marketplace.json"))
    yield* Effect.promise(() => Bun.write(file, JSON.stringify(catalog())))
    const layer = LayerNode.compile(MarketplaceLocal.node, {
      replacements: [Database.node.replace(Database.configured({ path: path.join(tmp.path, "marketplace.db") }))],
    })
    const previous = yield* Effect.gen(function* () {
      const marketplace = yield* MarketplaceLocal.Service
      const plan = yield* marketplace.plan({ file, item: "review" })
      const state = yield* marketplace.install(plan.id)
      const pending = yield* marketplace.plan({ file, item: "review" })
      return { state, pending }
    }).pipe(Effect.provide(Layer.fresh(layer)))
    yield* Effect.gen(function* () {
      const marketplace = yield* MarketplaceLocal.Service
      expect(yield* marketplace.read).toEqual(previous.state)
      expect((yield* Effect.flip(marketplace.install(previous.pending.id))).reason).toBe("plan")
    }).pipe(Effect.provide(Layer.fresh(layer)))
  }),
)
