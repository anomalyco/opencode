import { beforeEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import type { Hooks } from "@opencode-ai/plugin"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Auth } from "../../src/auth"
import { Plugin } from "../../src/plugin"
import { ProviderAuth } from "../../src/provider/auth"
import { testEffect } from "../lib/effect"

const capturedAuth = new Map<string, Auth.Info>()
beforeEach(() => capturedAuth.clear())

const fakeAuthLayer = Layer.succeed(
  Auth.Service,
  Auth.Service.of({
    get: () => Effect.succeed(undefined),
    all: () => Effect.succeed(Object.fromEntries(capturedAuth)),
    set: (key, info) => Effect.sync(() => { capturedAuth.set(key, info) }),
    remove: (key) => Effect.sync(() => { capturedAuth.delete(key) }),
  }),
)

const ssoHook: Hooks = {
  auth: {
    provider: "test-sso-provider",
    methods: [
      {
        type: "oauth",
        label: "SSO Test",
        async authorize() {
          return {
            url: "https://example.snowflakecomputing.com/sso",
            instructions: "Complete login in browser",
            method: "auto" as const,
            async callback() {
              return {
                type: "success" as const,
                key: "session-tok",
                metadata: {
                  _auth_type: "snowflake-session",
                  account: "myorg-myaccount",
                  master_token: "master-tok",
                  session_expires: "1700000000000",
                  master_expires: "1700014400000",
                },
              }
            },
          }
        },
      },
    ],
  },
}

const apiHook: Hooks = {
  auth: {
    provider: "test-api-provider",
    methods: [
      {
        type: "oauth",
        label: "API Test",
        async authorize() {
          return {
            url: "https://example.com",
            instructions: "Authorize",
            method: "auto" as const,
            async callback() {
              return { type: "success" as const, key: "my-api-key" }
            },
          }
        },
      },
    ],
  },
}

const fakePluginLayer = Layer.succeed(
  Plugin.Service,
  Plugin.Service.of({
    list: () => Effect.succeed([ssoHook, apiHook]),
    trigger: ((_name, _input, output) => Effect.succeed(output)) as Plugin.Interface["trigger"],
    init: () => Effect.void,
  }),
)

const it = testEffect(ProviderAuth.layer.pipe(Layer.provide(Layer.merge(fakeAuthLayer, fakePluginLayer))))

describe("ProviderAuth.callback", () => {
  it.instance(
    "persists snowflake-session credential when _auth_type sentinel is in metadata",
    Effect.gen(function* () {
      const svc = yield* ProviderAuth.Service
      const pid = ProviderV2.ID.make("test-sso-provider")
      yield* svc.authorize({ providerID: pid, method: 0 })
      yield* svc.callback({ providerID: pid, method: 0 })
      const stored = capturedAuth.get(pid)
      expect(stored).toBeDefined()
      expect(stored!.type).toBe("snowflake-session")
      if (stored!.type === "snowflake-session") {
        expect(stored!.account).toBe("myorg-myaccount")
        expect(stored!.session_token).toBe("session-tok")
        expect(stored!.master_token).toBe("master-tok")
        // session_expires and master_expires must be numbers, not strings
        expect(typeof stored!.session_expires).toBe("number")
        expect(typeof stored!.master_expires).toBe("number")
        expect(stored!.session_expires).toBe(1700000000000)
        expect(stored!.master_expires).toBe(1700014400000)
      }
    }),
  )

  it.instance(
    "persists plain api credential when no _auth_type sentinel in metadata",
    Effect.gen(function* () {
      const svc = yield* ProviderAuth.Service
      const pid = ProviderV2.ID.make("test-api-provider")
      yield* svc.authorize({ providerID: pid, method: 0 })
      yield* svc.callback({ providerID: pid, method: 0 })
      const stored = capturedAuth.get(pid)
      expect(stored).toBeDefined()
      expect(stored!.type).toBe("api")
      if (stored!.type === "api") {
        expect(stored!.key).toBe("my-api-key")
      }
    }),
  )
})
