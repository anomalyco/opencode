import { describe, expect } from "bun:test"
import { Group } from "@opencode-ai/core/persistent-pty"
import { KV } from "@opencode-ai/core/kv"
import { Pty } from "@opencode-ai/schema/pty"
import { Session } from "@opencode-ai/schema/session"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Effect } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Group.node, KV.node])))

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
})
