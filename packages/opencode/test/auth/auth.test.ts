import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Auth } from "../../src/auth"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const node = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(Auth.defaultLayer, node))

describe("Auth", () => {
  it.live("set normalizes trailing slashes in keys", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("https://example.com/", {
          type: "wellknown",
          key: "TOKEN",
          token: "abc",
        })
        const data = yield* auth.all()
        expect(data["https://example.com"]).toBeDefined()
        expect(data["https://example.com/"]).toBeUndefined()
      }),
    ),
  )

  it.live("set cleans up pre-existing trailing-slash entry", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("https://example.com/", {
          type: "wellknown",
          key: "TOKEN",
          token: "old",
        })
        yield* auth.set("https://example.com", {
          type: "wellknown",
          key: "TOKEN",
          token: "new",
        })
        const data = yield* auth.all()
        const keys = Object.keys(data).filter((key) => key.includes("example.com"))
        expect(keys).toEqual(["https://example.com"])
        const entry = data["https://example.com"]!
        expect(entry.type).toBe("wellknown")
        if (entry.type === "wellknown") expect(entry.token).toBe("new")
      }),
    ),
  )

  it.live("remove deletes both trailing-slash and normalized keys", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("https://example.com", {
          type: "wellknown",
          key: "TOKEN",
          token: "abc",
        })
        yield* auth.remove("https://example.com/")
        const data = yield* auth.all()
        expect(data["https://example.com"]).toBeUndefined()
        expect(data["https://example.com/"]).toBeUndefined()
      }),
    ),
  )

  it.live("set and remove are no-ops on keys without trailing slashes", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("anthropic", {
          type: "api",
          key: "sk-test",
        })
        const data = yield* auth.all()
        expect(data["anthropic"]).toBeDefined()
        yield* auth.remove("anthropic")
        const after = yield* auth.all()
        expect(after["anthropic"]).toBeUndefined()
      }),
    ),
  )

  it.live("set creates multiple OAuth records and keeps the newest active", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("multi-test", {
          type: "oauth",
          refresh: "refresh-1",
          access: "access-1",
          expires: Date.now() + 60_000,
        })
        yield* auth.set("multi-test", {
          type: "oauth",
          refresh: "refresh-2",
          access: "access-2",
          expires: Date.now() + 60_000,
        })

        const usage = yield* Effect.promise(() => Auth.OAuthPool.getUsage("multi-test"))
        expect(usage.map((account) => account.label)).toEqual(["default", "Account 2"])
        expect(usage.find((account) => account.isActive)?.label).toBe("Account 2")

        const current = yield* auth.get("multi-test")
        expect(current?.type).toBe("oauth")
        if (current?.type === "oauth") expect(current.refresh).toBe("refresh-2")
      }),
    ),
  )

  it.live("OAuthPool.setActive switches the active record", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("switch-test", {
          type: "oauth",
          refresh: "refresh-1",
          access: "access-1",
          expires: Date.now() + 60_000,
        })
        yield* auth.set("switch-test", {
          type: "oauth",
          refresh: "refresh-2",
          access: "access-2",
          expires: Date.now() + 60_000,
        })

        const usage = yield* Effect.promise(() => Auth.OAuthPool.getUsage("switch-test"))
        const first = usage.find((account) => account.label === "default")!
        const success = yield* Effect.promise(() => Auth.OAuthPool.setActive("switch-test", "default", first.id))
        const current = yield* auth.get("switch-test")

        expect(success).toBe(true)
        expect(current?.type).toBe("oauth")
        if (current?.type === "oauth") expect(current.refresh).toBe("refresh-1")
      }),
    ),
  )

  it.live("OAuthPool.removeRecord removes the provider after the final account", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("remove-record-test", {
          type: "oauth",
          refresh: "refresh-1",
          access: "access-1",
          expires: Date.now() + 60_000,
        })

        const usage = yield* Effect.promise(() => Auth.OAuthPool.getUsage("remove-record-test"))
        const result = yield* Effect.promise(() => Auth.OAuthPool.removeRecord("remove-record-test", usage[0]!.id))
        const current = yield* auth.get("remove-record-test")

        expect(result).toEqual({ removed: true, remaining: 0 })
        expect(current).toBeUndefined()
      }),
    ),
  )
})
