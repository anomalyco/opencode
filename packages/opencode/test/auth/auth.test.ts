import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Auth } from "../../src/auth"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Credential } from "@opencode-ai/core/credential"
import { IntegrationSchema } from "@opencode-ai/core/integration/schema"
import { testEffect } from "../lib/effect"

const node = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(Auth.defaultLayer, node))

describe("Auth", () => {
  it.instance("set normalizes trailing slashes in keys", () =>
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
  )

  it.instance("set cleans up pre-existing trailing-slash entry", () =>
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
  )

  it.instance("remove deletes both trailing-slash and normalized keys", () =>
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
  )

  it.instance("set and remove are no-ops on keys without trailing slashes", () =>
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
  )

  it.instance("set and remove synchronize with SQLite Credential.Service in real-time", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const credentials = yield* Credential.Service

      // 1. Verify that 'set' on Auth also creates the credential in SQLite
      yield* auth.set("anthropic-test", {
        type: "api",
        key: "sk-test-sqlite",
        metadata: { customField: "test" },
      })

      const list = yield* credentials.list(IntegrationSchema.ID.make("anthropic-test"))
      expect(list.length).toBe(1)
      expect(list[0].value.type).toBe("key")
      if (list[0].value.type === "key") {
        expect(list[0].value.key).toBe("sk-test-sqlite")
        expect(list[0].value.metadata?.customField).toBe("test")
      }

      // 2. Verify that 'remove' on Auth also deletes the credential from SQLite
      yield* auth.remove("anthropic-test")
      const listAfter = yield* credentials.list(IntegrationSchema.ID.make("anthropic-test"))
      expect(listAfter.length).toBe(0)
    }),
  )
})
