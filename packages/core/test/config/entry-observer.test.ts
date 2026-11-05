import { describe, expect } from "bun:test"
import { Config } from "@opencode/core/config"
import { Document, Info, type Entry } from "@opencode/schema/config"
import { Event } from "@opencode/schema/event"
import { Deferred, Effect, PubSub, Stream } from "effect"
import { ConfigEntryObserver } from "../../src/config/plugin/entry-observer"
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
})

function document(shell: string): Entry {
  return new Document({ type: "document", info: new Info({ shell }) })
}

function updated() {
  return { id: Event.ID.create(), created: Date.now(), type: "config.updated" as const, data: {} }
}
