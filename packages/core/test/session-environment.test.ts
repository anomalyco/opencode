import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Session } from "@opencode-ai/core/session"
import { SessionEnvironment } from "@opencode-ai/core/session/environment"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(SessionEnvironment.node))

describe("SessionEnvironment", () => {
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
