import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Auth } from "../../src/auth"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
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

  it.live("supports storing and switching provider accounts", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set(
          Auth.accountStorageKey("openai", "work"),
          new Auth.Api({
            type: "api",
            key: "sk-work",
            _accountLabel: "Work",
            _accountId: "work",
          }),
        )
        yield* auth.set(
          Auth.accountStorageKey("openai", "personal"),
          new Auth.Api({
            type: "api",
            key: "sk-personal",
            _accountLabel: "Personal",
            _accountId: "personal",
          }),
        )

        const before = yield* auth.active("openai")
        expect(before?.accountKey).toBe("work")
        if (before?.info.type === "api") expect(before.info.key).toBe("sk-work")

        yield* auth.activate("openai", "personal")

        const after = yield* auth.active("openai")
        expect(after?.accountKey).toBe("personal")
        if (after?.info.type === "api") expect(after.info.key).toBe("sk-personal")

        const accounts = yield* auth.accounts("openai")
        expect(Object.keys(accounts).sort()).toEqual(["default", "personal", "work"])
      }),
    ),
  )

  it.live("remove on provider key deletes all provider accounts", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set(
          Auth.accountStorageKey("openai", "work"),
          new Auth.Api({
            type: "api",
            key: "sk-work",
            _accountId: "work",
          }),
        )
        yield* auth.set(
          Auth.accountStorageKey("openai", "personal"),
          new Auth.Api({
            type: "api",
            key: "sk-personal",
            _accountId: "personal",
          }),
        )

        yield* auth.remove("openai")

        expect(yield* auth.get("openai")).toBeUndefined()
        expect(yield* auth.accounts("openai")).toEqual({})
      }),
    ),
  )
})
