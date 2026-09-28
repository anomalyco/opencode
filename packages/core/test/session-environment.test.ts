import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Session } from "@opencode/core/session"
import { SessionEnvironment } from "@opencode/core/session/environment"
import { KV } from "@opencode/core/kv"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([SessionEnvironment.node, KV.node])))

describe("SessionEnvironment", () => {
  it.effect("waits for each client binding after restart without persisting its values", () =>
    Effect.gen(function* () {
      const original = yield* SessionEnvironment.Service
      const kv = yield* KV.Service
      const first = Session.ID.make("ses_environment_restart_first")
      const second = Session.ID.make("ses_environment_restart_second")
      yield* original.set(first, { PASEO_AGENT_ID: "first", PASEO_AGENT_CWD: "/same", SECRET: "private" })
      yield* original.set(second, { PASEO_AGENT_ID: "second", PASEO_AGENT_CWD: "/same" })
      expect(yield* kv.scan({ prefix: "session.environment/" })).toEqual({
        entries: [
          { key: `session.environment/${first}`, value: true },
          { key: `session.environment/${second}`, value: true },
        ],
      })

      const restarted = yield* SessionEnvironment.make
      const resolved = yield* Deferred.make<void>()
      const waiting = yield* restarted.resolve(first).pipe(
        Effect.tap(() => Deferred.succeed(resolved, undefined)),
        Effect.forkScoped,
      )
      yield* restarted.set(second, { PASEO_AGENT_ID: "second", PASEO_AGENT_CWD: "/same" })
      expect(yield* Deferred.isDone(resolved)).toBe(false)
      expect(yield* restarted.resolve(second)).toEqual({ PASEO_AGENT_ID: "second", PASEO_AGENT_CWD: "/same" })
      yield* restarted.set(first, { PASEO_AGENT_ID: "first", PASEO_AGENT_CWD: "/same" })
      expect(yield* Fiber.join(waiting)).toEqual({ PASEO_AGENT_ID: "first", PASEO_AGENT_CWD: "/same" })
      yield* restarted.clear(first)
      expect(yield* kv.get(`session.environment/${first}`)).toBeUndefined()
      expect(yield* restarted.resolve(first)).toBeUndefined()
    }),
  )

  it.effect("stores replacement snapshots by session", () =>
    Effect.gen(function* () {
      const environments = yield* SessionEnvironment.Service
      const first = Session.ID.make("ses_environment_first")
      const second = Session.ID.make("ses_environment_second")

      yield* environments.set(first, { TOOLCHAIN: "first", PATH: "/first/bin" })
      yield* environments.set(second, { TOOLCHAIN: "second" })
      yield* environments.set(first, { TOOLCHAIN: "updated" })

      expect(yield* environments.get(first)).toEqual({ TOOLCHAIN: "updated" })
      expect(yield* environments.get(second)).toEqual({ TOOLCHAIN: "second" })

      yield* environments.clear(first)

      expect(yield* environments.get(first)).toBeUndefined()
      expect(yield* environments.get(second)).toEqual({ TOOLCHAIN: "second" })
    }),
  )
})
