import { describe, expect } from "bun:test"
import { Document, Event, Info, type Entry } from "@opencode/schema/config"
import { ConfigPolicy } from "@opencode/schema/config/policy"
import { Permission } from "@opencode/schema/permission"
import { Config } from "@opencode/core/config"
import { ConfigPolicyPlugin } from "@opencode/core/config/plugin/policy"
import { Bus } from "@opencode/core/bus"
import { Integration } from "@opencode/core/integration"
import { ManagedPolicy } from "@opencode/core/managed-policy"
import { ModelsDev } from "@opencode/core/models-dev"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { ModelsDevPlugin } from "@opencode/core/plugin/models-dev"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import { State } from "@opencode/core/state"
import { Effect, Schema } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

const it = testEffect(PluginTestLayer)
const decode = Schema.decodeUnknownSync(Info)

const document = (...policies: ConfigPolicy.Info[]) =>
  new Document({ type: "document", info: decode({ experimental: { policies } }) })
const provider = (effect: ConfigPolicy.Effect, resource: string): ConfigPolicy.Info => ({
  action: "provider.use",
  resource,
  effect,
})
const tool = (effect: ConfigPolicy.Effect, resource: string): ConfigPolicy.Info => ({
  action: "tool.use",
  resource,
  effect,
})
// Two catalog providers, so a denied one has to leave the integration registry while the other stays.
const snapshot = [
  {
    info: { id: Provider.ID.openai, name: "OpenAI", activation: "auto", package: "@opencode/ai/providers/openai" },
    environment: ["OPENAI_API_KEY"],
    models: [],
  },
  {
    info: {
      id: Provider.ID.anthropic,
      name: "Anthropic",
      activation: "auto",
      package: "@opencode/ai/providers/anthropic",
    },
    environment: ["ANTHROPIC_API_KEY"],
    models: [],
  },
] satisfies readonly ModelsDev.Snapshot[]

const addPlugin = Effect.fn(function* (entries: Entry[]) {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* ConfigPolicyPlugin.Plugin.effect(host).pipe(Effect.provide(Config.testLayer(entries)))
})

const evaluate = Effect.fn(function* (action: string, resources: string[], effect: Permission.Effect = "allow") {
  const hooks = yield* PluginHooks.Service
  const event = yield* hooks.trigger("permission", "evaluate", {
    sessionID: Session.ID.make("ses_policy"),
    action,
    resources,
    effect,
  })
  return { effect: event.effect, message: event.message }
})

describe("ConfigPolicyPlugin.Plugin", () => {
  it.effect("preserves last-match precedence for tool.use without granting approvals", () =>
    Effect.gen(function* () {
      yield* addPlugin([
        document(tool("deny", "shell:*"), tool("allow", "shell:git *"), tool("deny", "shell:git push *")),
      ])
      expect((yield* evaluate("shell", ["git status"], "ask")).effect).toBe("ask")
      expect((yield* evaluate("shell", ["git push origin main"])).effect).toBe("deny")
      expect((yield* evaluate("shell", ["ls"])).effect).toBe("deny")
      expect((yield* evaluate("edit", ["notes.md"])).effect).toBe("allow")
    }),
  )

  it.effect("organization tool.use policy overrides authored policy", () =>
    Effect.gen(function* () {
      const managed = yield* ManagedPolicy.Service
      yield* managed.set({ statements: [tool("deny", "shell:*")], organization: "Acme" })
      yield* addPlugin([document(tool("allow", "shell:*"))])
      expect(yield* evaluate("shell", ["ls"])).toEqual({ effect: "deny", message: "Blocked by Acme's policy" })
      yield* managed.set({ statements: [tool("allow", "shell:*")] })
      expect((yield* evaluate("shell", ["ls"], "ask")).effect).toBe("ask")
    }),
  )

  it.effect("filters plugin-provided providers with ordered wildcard policies", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.openai, () => {})
        catalog.update(Provider.ID.anthropic, () => {})
        catalog.update(Provider.ID.make("company-internal"), () => {})
      })
      yield* addPlugin([
        document(provider("deny", "*"), provider("allow", "anthropic"), provider("allow", "company-*")),
      ])

      expect(yield* catalog.get(Provider.ID.openai)).toBeUndefined()
      expect(yield* catalog.get(Provider.ID.anthropic)).toBeDefined()
      expect(yield* catalog.get(Provider.ID.make("company-internal"))).toBeDefined()
    }),
  )

  it.effect("removes a denied provider's integration and keeps integrations no provider owns", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const integrations = yield* Integration.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.openai, () => {})
        catalog.update(Provider.ID.anthropic, () => {})
      })
      yield* integrations.transform((editor) => {
        editor.update(Integration.ID.make("openai"), (ref) => Integration.markProvider(ref, "openai"))
        editor.update(Integration.ID.make("anthropic"), (ref) => Integration.markProvider(ref, "anthropic"))
        // A remote MCP server registers an OAuth integration that no provider owns.
        editor.update(Integration.ID.make("mcp_0123456789abcdef"), () => {})
      })
      yield* addPlugin([document(provider("deny", "*"), provider("allow", "anthropic"))])

      const ids = (yield* integrations.list()).map((integration) => integration.id)
      expect(ids).not.toContain(Integration.ID.make("openai"))
      expect(ids).toContain(Integration.ID.make("anthropic"))
      expect(ids).toContain(Integration.ID.make("mcp_0123456789abcdef"))
    }),
  )

  it.effect("removes a denied provider's integration when the catalogs fold in one batch", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const integrations = yield* Integration.Service
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin)
      // Activation batches every registration, so both catalogs fold together and the integration
      // catalog is rebuilt before the provider catalog. The integration must still be removed here.
      yield* State.batch(
        Effect.gen(function* () {
          yield* ModelsDevPlugin.effect(host).pipe(
            Effect.provideService(
              ModelsDev.Service,
              ModelsDev.Service.of({ get: () => Effect.succeed(snapshot), refresh: () => Effect.void }),
            ),
          )
          yield* ConfigPolicyPlugin.Plugin.effect(host).pipe(
            Effect.provide(Config.testLayer([document(provider("deny", "*"), provider("allow", "anthropic"))])),
          )
        }),
      )

      expect((yield* catalog.all()).map((entry) => entry.id)).toEqual([Provider.ID.anthropic])
      expect((yield* integrations.list()).map((integration) => integration.id)).toEqual([Integration.ID.make("anthropic")])
    }),
  )

  it.effect("restores an allowed provider integration after the policy changes", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const integrations = yield* Integration.Service
      const managed = yield* ManagedPolicy.Service
      yield* catalog.transform((catalog) => catalog.update(Provider.ID.openai, () => {}))
      yield* integrations.transform((editor) =>
        editor.update(Integration.ID.make("openai"), (ref) => Integration.markProvider(ref, "openai")),
      )
      yield* addPlugin([])
      expect((yield* integrations.list()).map((integration) => integration.id)).toContain(
        Integration.ID.make("openai"),
      )

      yield* managed.set({ statements: [provider("deny", "openai")] })
      yield* integrations.reload()
      expect((yield* integrations.list()).map((integration) => integration.id)).not.toContain(
        Integration.ID.make("openai"),
      )

      yield* managed.set({ statements: [provider("allow", "openai")] })
      yield* integrations.reload()
      expect((yield* integrations.list()).map((integration) => integration.id)).toContain(
        Integration.ID.make("openai"),
      )
    }),
  )

  it.live("reloads the integration registry when policies change", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const integrations = yield* Integration.Service
      const bus = yield* Bus.Service
      const test = yield* Config.Test
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin)
      const openai = Integration.ID.make("openai")
      yield* catalog.transform((catalog) => catalog.update(Provider.ID.openai, () => {}))
      yield* integrations.transform((editor) =>
        editor.update(openai, (ref) => Integration.markProvider(ref, "openai")),
      )
      yield* ConfigPolicyPlugin.Plugin.effect(host)
      expect((yield* integrations.list()).map((integration) => integration.id)).not.toContain(openai)

      yield* test.setEntries([])
      yield* bus.publish(Event.Updated, {})
      yield* waitUntil(
        integrations.list().pipe(Effect.map((list) => list.some((integration) => integration.id === openai))),
      )
    }).pipe(Effect.provide(Config.testLayer([document(provider("deny", "openai"))]))),
  )

  it.effect("prevents project policy from overriding user-global policy", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      yield* catalog.transform((catalog) => catalog.update(Provider.ID.openai, () => {}))
      yield* addPlugin([document(provider("deny", "openai")), document(provider("allow", "openai"))])

      expect(yield* catalog.get(Provider.ID.openai)).toBeUndefined()
    }),
  )

  it.live("reloads changed policies", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const bus = yield* Bus.Service
      const test = yield* Config.Test
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin)
      yield* catalog.transform((catalog) => catalog.update(Provider.ID.openai, () => {}))
      yield* ConfigPolicyPlugin.Plugin.effect(host)
      expect(yield* catalog.get(Provider.ID.openai)).toBeUndefined()

      yield* test.setEntries([document(provider("allow", "openai"))])
      yield* bus.publish(Event.Updated, {})
      yield* waitUntil(catalog.get(Provider.ID.openai).pipe(Effect.map((provider) => provider !== undefined)))
    }).pipe(Effect.provide(Config.testLayer([document(provider("deny", "openai"))]))),
  )

  it.effect("denies permissions matched as action:resource", () =>
    Effect.gen(function* () {
      yield* addPlugin([document(tool("deny", "shell:git push *"))])

      expect(yield* evaluate("shell", ["git push"])).toEqual({
        effect: "deny",
        message: "Blocked by configuration policy",
      })
      expect(yield* evaluate("shell", ["git push origin main"])).toEqual({
        effect: "deny",
        message: "Blocked by configuration policy",
      })
      // Compound commands check several resources; any denied resource denies the operation.
      expect((yield* evaluate("shell", ["git status", "git push"])).effect).toBe("deny")
      expect(yield* evaluate("shell", ["git status"])).toEqual({ effect: "allow", message: undefined })
      expect(yield* evaluate("edit", ["git push"])).toEqual({ effect: "allow", message: undefined })
    }),
  )

  it.effect("turns an ask into a deny but never grants", () =>
    Effect.gen(function* () {
      yield* addPlugin([document(tool("deny", "webfetch:*"), tool("allow", "shell:*"))])

      expect((yield* evaluate("webfetch", ["https://example.com"], "ask")).effect).toBe("deny")
      expect((yield* evaluate("shell", ["ls"], "ask")).effect).toBe("ask")
    }),
  )

  it.effect("lets a later allow lift an earlier broad deny", () =>
    Effect.gen(function* () {
      yield* addPlugin([document(tool("deny", "shell:*"), tool("allow", "shell:git status *"))])

      expect((yield* evaluate("shell", ["git status --short"])).effect).toBe("allow")
      expect((yield* evaluate("shell", ["rm -rf /"])).effect).toBe("deny")
    }),
  )

  it.effect("denies every permission with a bare wildcard", () =>
    Effect.gen(function* () {
      yield* addPlugin([document(tool("deny", "*"))])

      expect((yield* evaluate("question", ["*"])).effect).toBe("deny")
      expect((yield* evaluate("read", ["/tmp/notes.txt"])).effect).toBe("deny")
      expect((yield* evaluate("github_delete_repository", ["*"])).effect).toBe("deny")
    }),
  )

  it.effect("evaluates organization provider statements after every authored document", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const managed = yield* ManagedPolicy.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.openai, () => {})
        catalog.update(Provider.ID.anthropic, () => {})
        catalog.update(Provider.ID.opencode, () => {})
      })
      yield* managed.set({ statements: [provider("deny", "*"), provider("allow", "opencode")] })
      yield* addPlugin([document(provider("allow", "anthropic"))])

      expect(yield* catalog.get(Provider.ID.anthropic)).toBeUndefined()
      expect(yield* catalog.get(Provider.ID.openai)).toBeUndefined()
      expect(yield* catalog.get(Provider.ID.opencode)).toBeDefined()
    }),
  )

  it.effect("lets an organization allow restore a provider denied by the user", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const managed = yield* ManagedPolicy.Service
      yield* catalog.transform((catalog) => catalog.update(Provider.ID.openai, () => {}))
      yield* managed.set({ statements: [provider("allow", "openai")] })
      yield* addPlugin([document(provider("deny", "openai"))])

      expect(yield* catalog.get(Provider.ID.openai)).toBeDefined()
    }),
  )

  it.effect("names the organization when its permission statement decides", () =>
    Effect.gen(function* () {
      const managed = yield* ManagedPolicy.Service
      yield* managed.set({ statements: [tool("deny", "shell:sudo *")], organization: "Acme" })
      yield* addPlugin([document(tool("allow", "shell:*"))])

      expect(yield* evaluate("shell", ["sudo ls"])).toEqual({ effect: "deny", message: "Blocked by Acme's policy" })
      expect((yield* evaluate("shell", ["ls"])).effect).toBe("allow")

      yield* managed.set({ statements: [tool("deny", "shell:sudo *")] })
      expect(yield* evaluate("shell", ["sudo ls"])).toEqual({
        effect: "deny",
        message: "Blocked by your organization's policy",
      })
    }),
  )

  it.effect("rebuilds the catalog from replaced organization statements", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const managed = yield* ManagedPolicy.Service
      yield* catalog.transform((catalog) => catalog.update(Provider.ID.openai, () => {}))
      yield* addPlugin([])
      expect(yield* catalog.get(Provider.ID.openai)).toBeDefined()

      yield* managed.set({ statements: [provider("deny", "openai")] })
      yield* catalog.reload()
      expect(yield* catalog.get(Provider.ID.openai)).toBeUndefined()

      yield* managed.set({ statements: [] })
      yield* catalog.reload()
      expect(yield* catalog.get(Provider.ID.openai)).toBeDefined()
    }),
  )
})

const waitUntil = Effect.fnUntraced(function* (condition: Effect.Effect<boolean>) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (yield* condition) return
    yield* Effect.sleep("10 millis")
  }
  return yield* Effect.die("Timed out waiting for policy reload")
})
