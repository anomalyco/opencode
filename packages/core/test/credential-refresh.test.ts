import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/schema/integration"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(Credential.node))
const oauth = (access: string, refresh: string, expires: number) =>
  Credential.OAuth.make({ type: "oauth", methodID: Integration.MethodID.make("oauth"), access, refresh, expires })
const create = Effect.gen(function* () {
  const credentials = yield* Credential.Service
  const created = yield* credentials.create({
    integrationID: Integration.ID.make("test"),
    value: oauth("old-access", "old-refresh", 1),
  })
  return created.id
})
const always = () => true

describe("Credential.refresh", () => {
  it.effect("saves the refreshed value", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const id = yield* create
      const value = oauth("new-access", "new-refresh", Number.MAX_SAFE_INTEGER)
      expect(yield* credentials.refresh(id, { stale: always, refresh: () => Effect.succeed(value) })).toEqual(value)
      expect((yield* credentials.get(id))?.value).toEqual(value)
    }),
  )

  it.effect("returns the stored row when another caller already refreshed it", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const id = yield* create
      let calls = 0
      const result = yield* credentials.refresh(id, {
        stale: () => false,
        refresh: () => Effect.sync(() => calls++).pipe(Effect.as(oauth("new-access", "new-refresh", 2))),
      })
      expect(result?.access).toBe("old-access")
      expect(calls).toBe(0)
    }),
  )

  it.effect("keeps a row that changed while the refresh ran", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const id = yield* create
      const replaced = oauth("other-access", "other-refresh", 3)
      const result = yield* credentials.refresh(id, {
        stale: always,
        refresh: () =>
          credentials.update(id, { value: replaced }).pipe(Effect.as(oauth("new-access", "new-refresh", 2))),
      })
      expect(result).toEqual(replaced)
      expect((yield* credentials.get(id))?.value).toEqual(replaced)
    }),
  )

  it.effect("resolves undefined for a missing credential", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const result = yield* credentials.refresh(Credential.ID.make("cred_missing"), {
        stale: always,
        refresh: () => Effect.die("unreachable"),
      })
      expect(result).toBeUndefined()
    }),
  )

  it.effect("shares failures but allows a later refresh", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const id = yield* create
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const error = new Error("token endpoint unavailable")
      let calls = 0
      const failing = {
        stale: always,
        refresh: () =>
          Effect.gen(function* () {
            calls++
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
            return yield* Effect.fail(error)
          }),
      }
      const first = yield* credentials.refresh(id, failing).pipe(Effect.flip, Effect.forkScoped)
      yield* Deferred.await(entered)
      const second = yield* credentials.refresh(id, failing).pipe(Effect.flip, Effect.forkScoped)
      yield* Effect.yieldNow
      yield* Deferred.succeed(release, undefined)
      expect(yield* Fiber.join(first)).toBe(error)
      expect(yield* Fiber.join(second)).toBe(error)
      expect(calls).toBe(1)
      const value = oauth("new-access", "new-refresh", 2)
      expect(yield* credentials.refresh(id, { stale: always, refresh: () => Effect.succeed(value) })).toEqual(value)
    }),
  )
})

describe("Credential.expiring", () => {
  const now = 1_000_000_000
  test("is due within five minutes of expiry", () => {
    expect(Credential.expiring(oauth("a", "r", now + 4 * 60_000), now)).toBe(true)
    expect(Credential.expiring(oauth("a", "r", now + 6 * 60_000), now)).toBe(false)
  })
  test("never expires a token without a lifetime", () => {
    expect(Credential.expiring(oauth("a", "r", 0), now)).toBe(false)
  })
})
