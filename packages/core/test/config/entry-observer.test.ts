import { describe, expect } from "bun:test"
import type { EventDomain } from "@opencode/plugin/effect/event"
import { Config } from "@opencode/core/config"
import { Document, Info, type Entry } from "@opencode/schema/config"
import { Event } from "@opencode/schema/event"
import { Deferred, Effect, PubSub, Stream } from "effect"
import { ConfigEntryObserver } from "../../src/config/plugin/entry-observer"
import { waitUntil } from "../lib/eventually"
import { it } from "../lib/effect"
import { host } from "../plugin/host"

describe("ConfigEntryObserver", () => {
  it.effect("reads the current config and reloads on updates", () =>
    Effect.gen(function* () {
      const state = { current: [document("first")] }
      const updates = yield* PubSub.unbounded<ReturnType<typeof updated>>()
      const reloaded = yield* Deferred.make<void>()
      const config = Config.Service.of({
        entries: () => Effect.sync(() => state.current),
        snapshot: () => state.current,
        changes: () => Stream.empty,
      })
      const event = host({ event: { subscribe: () => Stream.fromPubSub(updates) } }).event

      const loaded = yield* ConfigEntryObserver.observe(
        config,
        event,
        Deferred.succeed(reloaded, undefined).pipe(Effect.asVoid),
      )
      expect(Config.latest(loaded.entries, "shell")).toBe("first")

      // Visible before `config.updated` arrives, so a reload triggered another way already sees it.
      state.current = [document("later")]
      expect(Config.latest(loaded.entries, "shell")).toBe("later")
      expect(yield* Deferred.isDone(reloaded)).toBe(false)

      yield* PubSub.publish(updates, updated())
      yield* Deferred.await(reloaded)
    }),
  )

  // A fail-closed transform rethrows from every read until it recovers; later updates must still reload.
  it.live("keeps reloading after a reload fails", () =>
    Effect.gen(function* () {
      const config = Config.Service.of({
        entries: () => Effect.succeed([]),
        snapshot: () => [],
        changes: () => Stream.empty,
      })
      const observers = {
        observe: (event: EventDomain, reload: Effect.Effect<void>) =>
          ConfigEntryObserver.observe(config, event, reload),
        observeSources: (event: EventDomain, reload: Effect.Effect<void>) =>
          ConfigEntryObserver.observeSources({
            config,
            event,
            directories: [],
            load: () => Effect.succeed([]),
            reload,
          }),
      }
      for (const observe of Object.values(observers)) {
        const updates = yield* PubSub.unbounded<ReturnType<typeof updated>>()
        const calls = { count: 0 }
        yield* observe(
          host({ event: { subscribe: () => Stream.fromPubSub(updates) } }).event,
          Effect.suspend(() => (++calls.count === 1 ? Effect.die(new Error("transform failed")) : Effect.void)),
        )
        yield* PubSub.publish(updates, updated())
        yield* waitUntil(Effect.sync(() => calls.count === 1))
        yield* PubSub.publish(updates, updated())
        yield* waitUntil(Effect.sync(() => calls.count === 2))
      }
    }),
  )
})

function document(shell: string): Entry {
  return new Document({ type: "document", info: new Info({ shell }) })
}

function updated() {
  return { id: Event.ID.create(), created: Date.now(), type: "config.updated" as const, data: {} }
}
