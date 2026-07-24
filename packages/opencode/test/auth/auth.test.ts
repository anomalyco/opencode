import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { Effect } from "effect"
import { Auth } from "../../src/auth"
import { AuthCredentialBridge } from "../../src/auth/credential-bridge"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Auth.node))
const bridgeIt = testEffect(
  LayerNode.compile(LayerNode.group([AuthCredentialBridge.node, Auth.node, Credential.node])),
)

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
})

describe("AuthCredentialBridge", () => {
  bridgeIt.instance("mirrors legacy OpenAI OAuth credentials for V2 sessions", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const bridge = yield* AuthCredentialBridge.Service
      const credentials = yield* Credential.Service
      yield* auth.set("openai", {
        type: "oauth",
        access: "access",
        refresh: "refresh",
        expires: Date.now() + 60_000,
        accountId: "account-123",
      })
      yield* bridge.sync()

      expect(yield* credentials.list(Integration.ID.make("openai"))).toMatchObject([
        {
          integrationID: "openai",
          label: "legacy auth.json",
          value: {
            type: "oauth",
            methodID: "chatgpt-browser",
            access: "access",
            refresh: "refresh",
            metadata: { accountID: "account-123" },
          },
        },
      ])

      const stored = (yield* credentials.list(Integration.ID.make("openai")))[0]
      yield* credentials.update(stored!.id, {
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          access: "v2-refreshed-access",
          refresh: "v2-refreshed-refresh",
          expires: Date.now() + 120_000,
          metadata: { accountID: "account-123" },
        }),
      })
      yield* bridge.sync()
      expect((yield* credentials.list(Integration.ID.make("openai")))[0]?.value).toMatchObject({
        access: "v2-refreshed-access",
        refresh: "v2-refreshed-refresh",
      })

      yield* auth.remove("openai")
      yield* bridge.sync()
      expect(yield* credentials.list(Integration.ID.make("openai"))).toEqual([])
    }),
  )

  bridgeIt.instance("does not replace credentials created through the V2 integration flow", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const bridge = yield* AuthCredentialBridge.Service
      const credentials = yield* Credential.Service
      yield* credentials.create({
        integrationID: Integration.ID.make("acme"),
        label: "explicit",
        value: Credential.Key.make({ type: "key", key: "v2-secret" }),
      })
      yield* auth.set("acme", { type: "api", key: "legacy-secret" })
      yield* bridge.sync()

      expect(yield* credentials.list(Integration.ID.make("acme"))).toMatchObject([
        {
          label: "explicit",
          value: { type: "key", key: "v2-secret" },
        },
      ])

      yield* auth.remove("acme")
    }),
  )
})
