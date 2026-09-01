import { describe, expect } from "bun:test"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { Model } from "@opencode-ai/core/model"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { OpencodePlugin } from "@opencode-ai/core/plugin/provider/opencode"
import { Provider } from "@opencode-ai/core/provider"
import { State } from "@opencode-ai/core/state"
import { Effect, Exit, Fiber, Schedule, Schema, Scope } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const providerID = Provider.ID.make("example")
const modelID = Model.ID.make("chat")
const hiddenID = Model.ID.make("hidden")
const placeholder = "{env:OPENCODE_CONSOLE_TOKEN}"
const headers = { Authorization: `Bearer ${placeholder}`, "x-org-id": "org-a" }
const variant = {
  apiKey: placeholder,
  headers,
  temperature: 0.2,
  reasoning: { effort: "high", budget: { tokens: 2048 } },
  response: { format: { type: "json", required: ["answer", "source"] } },
}

const addPlugin = Effect.fn(function* (set?: (key: string, value: Schema.Json) => Effect.Effect<void>) {
  const scope = yield* Effect.acquireRelease(Scope.make(), (scope, exit) => Scope.close(scope, exit))
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin, OpencodePlugin.id)
  yield* State.batch(
    OpencodePlugin.effect(set ? { ...host, storage: { ...host.storage, set } } : host).pipe(Scope.provide(scope)),
  )
  return { host, scope }
})

const serve = (fetch: (request: Request) => Response | Promise<Response>) =>
  Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch })),
    (server) => Effect.promise(() => server.stop(true)),
  )

const connect = Effect.fn(function* (server: string, key = "fixture-key") {
  const credentials = yield* Credential.Service
  return yield* credentials.create({
    integrationID: Integration.ID.make("opencode"),
    value: Credential.Key.make({ type: "key", key, metadata: { server, orgID: "org-a" } }),
  })
})

function eventually<A, E, R>(effect: Effect.Effect<A, E, R>, until: (value: A) => boolean) {
  return effect.pipe(Effect.repeat({ until, schedule: Schedule.spaced("10 millis") }), Effect.timeout("2 seconds"))
}

function inventory(origin: string, output = 1000, apiKey = placeholder) {
  return Response.json({
    config: {
      provider: {
        example: {
          name: "Example Console",
          npm: "@ai-sdk/openai-compatible",
          api: `${origin}/v1`,
          options: { apiKey, headers },
          models: {
            chat: {
              name: "Example Chat",
              family: "example-chat",
              release_date: "2026-01-02",
              tool_call: true,
              modalities: { input: ["text", "image"], output: ["text"] },
              cost: { input: 1, output: 2, cache_read: 0.1, cache_write: 0.2 },
              limit: { context: 10000, output },
              options: { apiKey: placeholder, temperature: 0.5 },
              variants: { careful: variant },
            },
            hidden: { name: "Hidden Chat" },
          },
        },
      },
    },
  })
}

describe("OpencodePlugin inventory cache", () => {
  it.live("restores metadata and nested variants before HTTP completes, then replays catalog policy", () =>
    Effect.gen(function* () {
      const gate = { enabled: false }
      const requested = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const paths: string[] = []
      const server = yield* serve(async (request) => {
        paths.push(new URL(request.url).pathname)
        if (!gate.enabled) return inventory(new URL(request.url).origin)
        requested.resolve()
        await release.promise
        if (new URL(request.url).pathname === "/auth/device/token")
          return Response.json({ access_token: "rotated-access", refresh_token: "rotated-refresh", expires_in: 3600 })
        if (request.headers.get("authorization") !== "Bearer rotated-access")
          return new Response("Expired credential", { status: 401 })
        return inventory(new URL(request.url).origin, 2000)
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
      const credentials = yield* Credential.Service
      const account = yield* credentials.create({
        integrationID: Integration.ID.make("opencode"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("device"),
          access: "fixture-access-token",
          refresh: "fixture-refresh-token",
          expires: Date.now() + 3_600_000,
          metadata: { server: server.url.origin, accountID: "account-a", orgID: "org-a" },
        }),
      })
      const catalog = yield* Catalog.Service
      const first = yield* addPlugin()
      const saved = yield* first.host.storage.scan({ prefix: "" })
      expect(saved.entries).toHaveLength(1)
      expect(JSON.stringify(saved)).toContain(placeholder)
      expect(JSON.stringify(saved)).not.toContain("fixture-access-token")
      expect(JSON.stringify(saved)).not.toContain("fixture-refresh-token")

      yield* Scope.close(first.scope, Exit.void)
      expect(yield* catalog.model.available()).toEqual([])
      if (account.value.type !== "oauth") return yield* Effect.die("Expected OAuth credential")
      yield* credentials.update(account.id, { value: Credential.OAuth.make({ ...account.value, expires: 0 }) })
      gate.enabled = true
      const persisted = Promise.withResolvers<Schema.Json>()
      yield* addPlugin((_key, value) => Effect.sync(() => persisted.resolve(value))).pipe(Effect.timeout("2 seconds"))
      yield* Effect.promise(() => requested.promise).pipe(Effect.timeout("2 seconds"))
      expect(paths.at(-1)).toBe("/auth/device/token")

      expect(yield* catalog.provider.get(providerID)).toMatchObject({
        name: "Example Console",
        integrationID: "opencode",
        package: Provider.aisdk("@ai-sdk/openai-compatible"),
        settings: { baseURL: `${server.url.origin}/v1` },
        headers,
      })
      const cached = yield* catalog.model.get(providerID, modelID)
      expect(cached).toMatchObject({
        name: "Example Chat",
        family: "example-chat",
        time: { released: Date.parse("2026-01-02") },
        capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
        cost: [{ input: 1, output: 2, cache: { read: 0.1, write: 0.2 } }],
        limit: { context: 10000, output: 1000 },
        settings: { temperature: 0.5 },
      })
      expect(cached?.variants).toEqual([
        {
          id: Model.VariantID.make("careful"),
          headers,
          settings: { temperature: 0.2, reasoning: variant.reasoning, response: variant.response },
        },
      ])
      expect((yield* catalog.model.available()).map((model) => model.id)).toContain(modelID)

      yield* catalog.transform((draft) => {
        draft.model.remove(providerID, hiddenID)
        draft.model.update(providerID, modelID, (model) => {
          model.name = "Policy Chat"
          const reasoning = model.variants?.find((variant) => variant.id === "careful")?.settings?.reasoning
          if (typeof reasoning !== "object" || reasoning === null || !("effort" in reasoning))
            throw new Error("Expected reasoning options")
          reasoning.effort = "low"
        })
      })
      release.resolve()
      yield* eventually(catalog.model.get(providerID, modelID), (model) => model?.limit.output === 2000)
      expect((yield* catalog.model.get(providerID, modelID))?.name).toBe("Policy Chat")
      expect(yield* catalog.model.get(providerID, hiddenID)).toBeUndefined()
      expect((yield* catalog.model.available()).map((model) => model.id)).toEqual([modelID])
      expect(
        Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(yield* Effect.promise(() => persisted.promise)),
      ).toMatchObject({
        example: {
          models: { chat: { limit: { output: 2000 }, variants: { careful: { reasoning: { effort: "high" } } } } },
        },
      })
    }),
  )

  it.live("isolates accounts, restores the previous cache offline, and cancels obsolete workers", () =>
    Effect.gen(function* () {
      const gate = { enabled: false }
      const release = Promise.withResolvers<void>()
      const requests: { authorization: string | null; aborted: boolean }[] = []
      const server = yield* serve(async (request) => {
        const entry = { authorization: request.headers.get("authorization"), aborted: false }
        requests.push(entry)
        request.signal.addEventListener("abort", () => (entry.aborted = true), { once: true })
        if (gate.enabled) await release.promise
        return inventory(new URL(request.url).origin)
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
      const credentials = yield* Credential.Service
      const catalog = yield* Catalog.Service
      const account = yield* connect(server.url.origin, "fixture-account-a")
      const first = yield* addPlugin()
      expect(JSON.stringify(yield* first.host.storage.scan({ prefix: "" }))).not.toContain("fixture-account-a")
      yield* Scope.close(first.scope, Exit.void)
      gate.enabled = true
      const second = yield* addPlugin().pipe(Effect.timeout("2 seconds"))
      yield* eventually(
        Effect.sync(() => requests.length),
        (count) => count === 2,
      )
      expect((yield* catalog.model.get(providerID, modelID))?.name).toBe("Example Chat")

      yield* connect(server.url.origin, "fixture-account-b")
      yield* eventually(
        Effect.sync(() => requests.length),
        (count) => count === 3,
      )
      yield* eventually(
        Effect.sync(() => requests[1]?.aborted),
        Boolean,
      )
      yield* eventually(catalog.model.available(), (models) => models.length === 0)
      expect(yield* catalog.model.get(providerID, modelID)).toBeUndefined()

      yield* credentials.activate(account.id)
      yield* eventually(catalog.model.get(providerID, modelID), (model) => model?.name === "Example Chat")
      yield* eventually(
        Effect.sync(() => requests.length),
        (count) => count === 4,
      )
      yield* eventually(
        Effect.sync(() => requests[2]?.aborted),
        Boolean,
      )
      expect(requests.map((request) => request.authorization)).toEqual([
        "Bearer fixture-account-a",
        "Bearer fixture-account-a",
        "Bearer fixture-account-b",
        "Bearer fixture-account-a",
      ])

      yield* Scope.close(second.scope, Exit.void).pipe(Effect.timeout("2 seconds"))
      yield* eventually(
        Effect.sync(() => requests[3]?.aborted),
        Boolean,
      )
      expect(yield* catalog.model.available()).toEqual([])
    }),
  )

  it.live("publishes fresh inventory even when cache persistence dies", () =>
    Effect.gen(function* () {
      const server = yield* serve((request) => inventory(new URL(request.url).origin))
      yield* connect(server.url.origin)
      const writes: string[] = []
      const instance = yield* addPlugin(() =>
        Effect.sync(() => writes.push("attempted")).pipe(Effect.andThen(Effect.die(new Error("Cache write failed")))),
      )
      const catalog = yield* Catalog.Service

      expect(writes).toEqual(["attempted"])
      expect((yield* catalog.model.get(providerID, modelID))?.name).toBe("Example Chat")
      expect((yield* catalog.model.available()).map((model) => model.id)).toContain(modelID)
      expect((yield* instance.host.storage.scan({ prefix: "" })).entries).toEqual([])
    }),
  )

  it.live("ignores malformed cached data and replaces it with a fresh response", () =>
    Effect.gen(function* () {
      const gate = { enabled: false }
      const requested = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const server = yield* serve(async (request) => {
        if (!gate.enabled) return inventory(new URL(request.url).origin)
        requested.resolve()
        await release.promise
        return inventory(new URL(request.url).origin, 2000)
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => release.resolve()))
      yield* connect(server.url.origin)
      const first = yield* addPlugin()
      const saved = yield* first.host.storage.scan({ prefix: "" })
      expect(saved.entries).toHaveLength(1)
      const entry = saved.entries[0]
      if (!entry) return yield* Effect.die("Expected cached inventory")
      yield* Scope.close(first.scope, Exit.void)
      yield* first.host.storage.set(entry.key, "malformed cache")
      gate.enabled = true
      const loading = yield* addPlugin().pipe(Effect.forkScoped({ startImmediately: true }))
      yield* Effect.promise(() => requested.promise).pipe(Effect.timeout("2 seconds"))
      const catalog = yield* Catalog.Service
      expect(yield* catalog.model.available()).toEqual([])

      release.resolve()
      const second = yield* Fiber.join(loading).pipe(Effect.timeout("2 seconds"))
      expect((yield* catalog.model.get(providerID, modelID))?.limit.output).toBe(2000)
      const replaced = yield* second.host.storage.scan({ prefix: "" })
      expect(replaced.entries).toHaveLength(1)
      expect(replaced.entries[0]?.value).not.toBe("malformed cache")
    }),
  )

  it.live("uses literal-credential config live without persisting its inventory", () =>
    Effect.gen(function* () {
      const server = yield* serve((request) => inventory(new URL(request.url).origin, 1000, "fixture-literal-key"))
      yield* connect(server.url.origin)
      const instance = yield* addPlugin()
      const catalog = yield* Catalog.Service

      expect((yield* catalog.model.get(providerID, modelID))?.name).toBe("Example Chat")
      expect((yield* catalog.model.available()).map((model) => model.id)).toContain(modelID)
      expect((yield* instance.host.storage.scan({ prefix: "" })).entries).toEqual([])
    }),
  )
})
