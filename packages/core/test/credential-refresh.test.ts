import { expect } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import { Credential } from "@opencode/schema/credential"
import { Integration } from "@opencode/schema/integration"
import { CredentialRefresh } from "@opencode/core/credential/refresh"
import { testEffect } from "./lib/effect"

const it = testEffect(CredentialRefresh.layer)
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
    const refreshes = yield* CredentialRefresh.Service
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
    const first = yield* refreshes.run(id, operation).pipe(Effect.flip, Effect.forkScoped)
    yield* Deferred.await(entered)
    const second = yield* refreshes.run(id, operation).pipe(Effect.flip, Effect.forkScoped)
    yield* Effect.yieldNow
    yield* Deferred.succeed(release, undefined)
    expect(yield* Fiber.join(first)).toBe(error)
    expect(yield* Fiber.join(second)).toBe(error)
    expect(calls).toBe(1)
    expect(yield* refreshes.run(id, Effect.succeed(value))).toEqual(value)
  }),
)

it.effect("refreshes different credentials independently", () =>
  Effect.gen(function* () {
    const refreshes = yield* CredentialRefresh.Service
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const first = yield* refreshes
      .run(id, Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as(value)))
      .pipe(Effect.forkScoped)
    yield* Deferred.await(entered)
    expect(yield* refreshes.run(Credential.ID.make("cred_other"), Effect.succeed(value))).toEqual(value)
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(first)
  }),
)
