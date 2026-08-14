import { describe, expect } from "bun:test"
import { Group } from "@opencode-ai/core/persistent-pty"
import { Bus } from "@opencode-ai/core/bus"
import { KV } from "@opencode-ai/core/kv"
import { Pty } from "@opencode-ai/schema/pty"
import { Session } from "@opencode-ai/schema/session"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Effect, Fiber, Stream } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Group.node, KV.node, Bus.node])))

describe("Group", () => {
  it.effect("persists ordered groups in one versioned KV document", () =>
    Effect.gen(function* () {
      const groups = yield* Group.Service
      const kv = yield* KV.Service
      const created = yield* groups.create([
        { type: "session", id: Session.ID.make("ses_one") },
        { type: "terminal", id: Pty.ID.make("pty_one") },
      ])

      expect(yield* groups.get(created.id)).toEqual(created)
      expect(yield* groups.list()).toEqual([created])
      expect(yield* kv.get("group:v1")).toEqual([created])

      const updated = Group.Info.make({
        id: created.id,
        items: [{ type: "terminal", id: Pty.ID.make("pty_two") }],
      })
      yield* groups.set(updated)
      expect(yield* groups.list()).toEqual([updated])

      yield* groups.remove(created.id)
      expect(yield* groups.get(created.id)).toBeUndefined()
      expect(yield* kv.get("group:v1")).toEqual([])
    }),
  )

  it.effect("serializes concurrent document mutations", () =>
    Effect.gen(function* () {
      const groups = yield* Group.Service
      yield* Effect.all(
        Array.from({ length: 20 }, (_, index) =>
          groups.create([{ type: "session", id: Session.ID.make(`ses_${index}`) }]),
        ),
        { concurrency: "unbounded" },
      )

      expect(yield* groups.list()).toHaveLength(20)
    }),
  )

  it.effect("publishes every removed group item", () =>
    Effect.gen(function* () {
      const groups = yield* Group.Service
      const bus = yield* Bus.Service
      const session = { type: "session" as const, id: Session.ID.make("ses_one") }
      const terminal = { type: "terminal" as const, id: Pty.ID.make("pty_one") }
      const group = yield* groups.create([session, terminal])
      const events = yield* bus
        .subscribe(Group.Event.ItemRemoved)
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* groups.set(Group.Info.make({ id: group.id, items: [session] }))
      yield* groups.remove(group.id)

      expect(Array.from(yield* Fiber.join(events)).map((event) => event.data)).toEqual([
        { groupID: group.id, item: terminal },
        { groupID: group.id, item: session },
      ])
    }),
  )
})
