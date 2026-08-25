import { describe, expect } from "bun:test"
import { Bus } from "@opencode-ai/core/bus"
import { KV } from "@opencode-ai/core/kv"
import { Group } from "@opencode-ai/core/persistent-pty"
import { Pty } from "@opencode-ai/schema/pty"
import { Session } from "@opencode-ai/schema/session"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Effect, Fiber, Stream } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Group.node, KV.node, Bus.node])))

describe("Group", () => {
  it.effect("persists each group in its own versioned KV entry", () =>
    Effect.gen(function* () {
      const groups = yield* Group.Service
      const kv = yield* KV.Service
      const id = Group.ID.make("grp_session_one")
      const created = yield* groups.create(id, [
        { type: "session", id: Session.ID.make("ses_one") },
        { type: "terminal", id: Pty.ID.make("pty_one") },
        { type: "terminal", id: Pty.ID.make("pty_one") },
      ])

      expect(yield* groups.get(id)).toEqual(created)
      expect(yield* kv.get(`group:v1:${id}`)).toEqual(created)
      expect(created.items).toHaveLength(2)

      yield* groups.removeItem(id, { type: "session", id: Session.ID.make("ses_one") })
      yield* groups.addItem(id, { type: "terminal", id: Pty.ID.make("pty_two") })
      expect((yield* groups.get(id))?.items).toEqual([
        { type: "terminal", id: Pty.ID.make("pty_one") },
        { type: "terminal", id: Pty.ID.make("pty_two") },
      ])

      yield* groups.remove(id)
      expect(yield* groups.get(id)).toBeUndefined()
      expect(yield* kv.get(`group:v1:${id}`)).toBeUndefined()
    }),
  )

  it.effect("creates caller-owned group IDs idempotently", () =>
    Effect.gen(function* () {
      const groups = yield* Group.Service
      const id = Group.ID.make("grp_session_one")
      const first = yield* groups.create(id, [{ type: "session", id: Session.ID.make("ses_one") }])
      const second = yield* groups.create(id, [{ type: "session", id: Session.ID.make("ses_other") }])

      expect(second).toEqual(first)
      expect(yield* groups.get(id)).toEqual(first)
    }),
  )

  it.effect("serializes concurrent mutations within one group", () =>
    Effect.gen(function* () {
      const groups = yield* Group.Service
      const id = Group.ID.make("grp_session_one")
      yield* groups.create(id)
      yield* Effect.all(
        Array.from({ length: 20 }, (_, index) =>
          groups.addItem(id, { type: "terminal", id: Pty.ID.make(`pty_${index}`) }),
        ),
        { concurrency: "unbounded" },
      )

      expect((yield* groups.get(id))?.items).toHaveLength(20)
    }),
  )

  it.effect("publishes every removed group item", () =>
    Effect.gen(function* () {
      const groups = yield* Group.Service
      const bus = yield* Bus.Service
      const session = { type: "session" as const, id: Session.ID.make("ses_one") }
      const terminal = { type: "terminal" as const, id: Pty.ID.make("pty_one") }
      const group = yield* groups.create(Group.ID.make("grp_session_one"), [session, terminal])
      const events = yield* bus
        .subscribe(Group.Event.ItemRemoved)
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* groups.removeItem(group.id, terminal)
      yield* groups.remove(group.id)

      expect(Array.from(yield* Fiber.join(events)).map((event) => event.data)).toEqual([
        { groupID: group.id, item: terminal },
        { groupID: group.id, item: session },
      ])
    }),
  )

  it.effect("publishes every added group item", () =>
    Effect.gen(function* () {
      const groups = yield* Group.Service
      const bus = yield* Bus.Service
      const session = { type: "session" as const, id: Session.ID.make("ses_one") }
      const terminal = { type: "terminal" as const, id: Pty.ID.make("pty_one") }
      const group = yield* groups.create(Group.ID.make("grp_session_one"), [session])
      const event = yield* bus.subscribe(Group.Event.ItemAdded).pipe(Stream.runHead, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* groups.addItem(group.id, terminal)

      expect((yield* Fiber.join(event)).valueOrUndefined?.data).toEqual({ groupID: group.id, item: terminal })
    }),
  )
})
