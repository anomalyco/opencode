import { expect } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { SessionContextLimit } from "@opencode/core/session/context-limit"
import { SessionSchema } from "@opencode/core/session/schema"
import { KV } from "@opencode/core/kv"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([SessionContextLimit.node, KV.node])))
it.effect("context limits persist per session and can return to model defaults", () =>
  Effect.gen(function* () {
    const limits = yield* SessionContextLimit.Service
    const kv = yield* KV.Service
    const id = SessionSchema.ID.create()
    expect(yield* limits.get(id)).toBeNull()
    yield* limits.set(id, 1_000_000)
    expect(yield* kv.get(`session.context-limit.${id}`)).toBe(1_000_000)
    expect(yield* limits.get(id)).toBe(1_000_000)
    expect(yield* limits.get(SessionSchema.ID.create())).toBeNull()
    yield* limits.set(id, null)
    expect(yield* kv.get(`session.context-limit.${id}`)).toBeUndefined()
  }),
)
