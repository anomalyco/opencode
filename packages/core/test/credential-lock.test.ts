import { expect } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/schema/integration"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(Credential.node))
const id = Credential.ID.make("cred_refresh")
const value = Credential.OAuth.make({
  type: "oauth",
  methodID: Integration.MethodID.make("oauth"),
  access: "new-access",
  refresh: "new-refresh",
  expires: Number.MAX_SAFE_INTEGER,
})

it.effect("shares failures but allows a later refresh", () =>
  Effect.gen(function* () {
    const credentials = yield* Credential.Service
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const error = new Error("token endpoint unavailable")
    let calls = 0
    const operation = Effect.gen(function* () {
      calls++
      yield* Deferred.succeed(entered, undefined)
      yield* Deferred.await(release)
      return yield* Effect.fail(error)
    })
    const first = yield* credentials.lock(id, operation).pipe(Effect.flip, Effect.forkScoped)
    yield* Deferred.await(entered)
    const second = yield* credentials.lock(id, operation).pipe(Effect.flip, Effect.forkScoped)
    yield* Effect.yieldNow
    yield* Deferred.succeed(release, undefined)
    expect(yield* Fiber.join(first)).toBe(error)
    expect(yield* Fiber.join(second)).toBe(error)
    expect(calls).toBe(1)
    expect(yield* credentials.lock(id, Effect.succeed(value))).toEqual(value)
  }),
)
