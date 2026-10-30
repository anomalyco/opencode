import { describe, expect } from "bun:test"
import { Document, Event, Info, type Entry } from "@opencode/schema/config"
import { ConfigPolicy } from "@opencode/schema/config/policy"
import { Permission } from "@opencode/schema/permission"
import { Config } from "@opencode/core/config"
import { Integration } from "@opencode/core/integration"
import { ConfigPolicyPlugin } from "@opencode/core/config/plugin/policy"
import { Bus } from "@opencode/core/bus"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import { Credential } from "@opencode/core/credential"
import { ConfigIntegration } from "@opencode/core/config/integration"
import { WebSearch } from "@opencode/core/websearch"
import { Effect, Schema } from "effect"
import { testEffect } from "../lib/effect"
import { organizationPolicy } from "../fixture/policy"
import { PluginTestLayer } from "../plugin/fixture"

const it = testEffect(PluginTestLayer)
const decode = Schema.decodeUnknownSync(Info)

const document = (...policies: ConfigPolicy.Info[]) => new Document({ type: "document", info: decode({ policies }) })
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

const integration = (
  action: "integration.connect" | "integration.use",
  effect: ConfigPolicy.Effect,
  resource: string,
): ConfigPolicy.Info => ({ action, resource, effect })

// The MDM policy that requires one Console organization, as an admin would deploy it.
const orgID = "org_01M3CAP8H43Z49CER6NT0Y3ZF1"
const lockdown = () =>
  document(
    integration("integration.connect", "deny", "*"),
    integration("integration.connect", "allow", "opencode"),
    integration("integration.use", "deny", "*"),
    integration("integration.use", "allow", `opencode#${orgID}`),
  )

const consoleCredential = (org: string) =>
  Credential.OAuth.make({
    type: "oauth",
    methodID: Integration.MethodID.make("device"),
    access: "access",
    refresh: "refresh",
    expires: Number.MAX_SAFE_INTEGER,
    metadata: { accountID: "acc_personal", orgID: org },
  })

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
      yield* addPlugin([organizationPolicy([tool("deny", "shell:*")], "Acme"), document(tool("allow", "shell:*"))])
      expect(yield* evaluate("shell", ["ls"])).toEqual({ effect: "deny", message: "Blocked by Acme's policy" })
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

  it.effect("lets organization provider statements override authored documents", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.openai, () => {})
        catalog.update(Provider.ID.anthropic, () => {})
        catalog.update(Provider.ID.opencode, () => {})
      })
      yield* addPlugin([
        organizationPolicy([provider("deny", "*"), provider("allow", "opencode")]),
        document(provider("allow", "anthropic")),
      ])

      expect(yield* catalog.get(Provider.ID.anthropic)).toBeUndefined()
      expect(yield* catalog.get(Provider.ID.openai)).toBeUndefined()
      expect(yield* catalog.get(Provider.ID.opencode)).toBeDefined()
    }),
  )

  it.effect("lets an organization allow restore a provider denied by the user", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      yield* catalog.transform((catalog) => catalog.update(Provider.ID.openai, () => {}))
      yield* addPlugin([organizationPolicy([provider("allow", "openai")]), document(provider("deny", "openai"))])

      expect(yield* catalog.get(Provider.ID.openai)).toBeDefined()
    }),
  )

  for (const input of [
    { organization: "Acme", message: "Blocked by Acme's policy" },
    { organization: undefined, message: "Blocked by your organization's policy" },
  ])
    it.effect(`names the organization when its permission statement decides: ${input.organization}`, () =>
      Effect.gen(function* () {
        yield* addPlugin([
          organizationPolicy([tool("deny", "shell:sudo *")], input.organization),
          document(tool("allow", "shell:*")),
        ])

        expect(yield* evaluate("shell", ["sudo ls"])).toEqual({ effect: "deny", message: input.message })
        expect((yield* evaluate("shell", ["ls"])).effect).toBe("allow")
      }),
    )

  it.live("rebuilds the catalog when the organization's policy changes", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const bus = yield* Bus.Service
      const test = yield* Config.Test
      const host = yield* PluginHost.make(yield* Plugin.Service)
      const opencode = Integration.ID.make("opencode")
      yield* catalog.transform((catalog) => catalog.update(Provider.ID.openai, () => {}))
      yield* ConfigPolicyPlugin.Plugin.effect(host)
      expect(yield* catalog.get(Provider.ID.openai)).toBeDefined()

      yield* test.integration?.(opencode, organizationPolicy([provider("deny", "openai")])) ?? Effect.void
      yield* bus.publish(Event.Updated, {})
      yield* waitUntil(catalog.get(Provider.ID.openai).pipe(Effect.map((provider) => provider === undefined)))

      yield* test.integration?.(opencode, undefined) ?? Effect.void
      yield* bus.publish(Event.Updated, {})
      yield* waitUntil(catalog.get(Provider.ID.openai).pipe(Effect.map((provider) => provider !== undefined)))
    }).pipe(Effect.provide(Config.testLayer())),
  )
})

describe("integration policy", () => {
  it.live("requires one Console organization through MDM policy alone", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const credentials = yield* Credential.Service
      const websearch = yield* WebSearch.Service
      const host = yield* PluginHost.make(yield* Plugin.Service)
      const search = (id: string) => ({
        id: WebSearch.ID.make(id),
        name: id,
        execute: () => Effect.succeed([]),
      })
      yield* catalog.transform((catalog) => {
        // The signed-out free tier enables OpenCode without any connection.
        catalog.update(Provider.ID.opencode, (provider) => {
          provider.activation = "enabled"
        })
        // An env API key: Anthropic's integration with no account.
        catalog.update(Provider.ID.anthropic, (provider) => {
          provider.activation = "enabled"
        })
        // A provider authored in opencode.json.
        catalog.update(Provider.ID.make("my-llm"), (provider) => {
          provider.activation = "enabled"
        })
        // A provider the Console organization supplies.
        catalog.update(Provider.ID.make("acme-gateway"), (provider) => {
          provider.integrationID = Integration.ID.make("opencode")
        })
      })
      yield* websearch.transform((editor) => {
        editor.add(search("opencode"))
        editor.add(search("exa"))
      })
      yield* ConfigPolicyPlugin.Plugin.effect(host)
      const available = () =>
        catalog.all().pipe(Effect.map((providers) => providers.map((item): string => item.id).toSorted()))
      const searches = () =>
        websearch.providers().pipe(Effect.map((providers) => providers.map((item): string => item.id).toSorted()))

      // Signed out: everything, including the free tier, is denied.
      expect(yield* available()).toEqual([])
      expect(yield* searches()).toEqual([])

      // A personal Console account is a different account of the same integration.
      const personal = yield* credentials.create({
        integrationID: Integration.ID.make("opencode"),
        value: consoleCredential("org_personal"),
      })
      expect(yield* available()).toEqual([])

      // Only the required organization's connection works, and with it everything that organization supplies.
      yield* credentials.create({ integrationID: Integration.ID.make("opencode"), value: consoleCredential(orgID) })
      yield* eventually(available().pipe(Effect.map((ids) => ids.length > 0)))
      expect(yield* available()).toEqual(["acme-gateway", "opencode"])
      expect(yield* searches()).toEqual(["opencode"])

      // Switching back to the personal account revokes it again.
      yield* credentials.activate(personal.id)
      yield* eventually(available().pipe(Effect.map((ids) => ids.length === 0)))
      expect(yield* searches()).toEqual([])
    }).pipe(Effect.provide(Config.testLayer([lockdown()]))),
  )

  it.effect("keeps an integration's account out of a bare-ID allow", () =>
    Effect.gen(function* () {
      const catalog = yield* Provider.Service
      const credentials = yield* Credential.Service
      yield* credentials.create({
        integrationID: Integration.ID.make("opencode"),
        value: consoleCredential("org_other"),
      })
      yield* catalog.transform((catalog) => {
        catalog.update(Provider.ID.opencode, () => {})
        catalog.update(Provider.ID.anthropic, () => {})
      })
      yield* addPlugin([
        document(
          integration("integration.use", "deny", "*"),
          integration("integration.use", "allow", "anthropic"),
          integration("integration.use", "allow", "opencode"),
        ),
      ])
      expect(yield* catalog.get(Provider.ID.anthropic)).toBeDefined()
      // `opencode` names only account-less use; a connected account needs `opencode#*` or its own ID.
      expect(yield* catalog.get(Provider.ID.opencode)).toBeUndefined()
    }),
  )

  for (const effect of ["allow", "deny"] as const)
    it.effect(`decides a well-known origin's providers by the origin: ${effect}`, () =>
      Effect.gen(function* () {
        const catalog = yield* Provider.Service
        const origin = Integration.ID.make("https://ai.acme.com")
        yield* catalog.transform((catalog) => {
          catalog.update(Provider.ID.make("acme-gateway"), (provider) => {
            provider.activation = "enabled"
          })
          catalog.update(Provider.ID.make("my-llm"), (provider) => {
            provider.activation = "enabled"
          })
        })
        yield* addPlugin([
          document(
            integration("integration.use", "deny", "*"),
            integration("integration.use", effect, "https://ai.acme.com"),
          ),
          new ConfigIntegration.WellKnownDocument({
            type: "document",
            integrationID: origin,
            info: decode({
              providers: { "acme-gateway": { package: "@opencode/ai/providers/openai-compatible", models: {} } },
            }),
          }),
          new Document({
            type: "document",
            info: decode({
              providers: { "my-llm": { package: "@opencode/ai/providers/openai-compatible", models: {} } },
            }),
          }),
        ])
        expect(yield* catalog.get(Provider.ID.make("acme-gateway"))).toEqual(
          effect === "allow" ? expect.anything() : undefined,
        )
        expect(yield* catalog.get(Provider.ID.make("my-llm"))).toBeUndefined()
      }),
    )

  it.effect("converts legacy statements in Console config before enforcement sees them", () =>
    Effect.sync(() => {
      const remote = Schema.decodeUnknownSync(ConfigIntegration.Remote)({
        policies: [
          { action: "integration.use", resource: "mcp:*", effect: "deny" },
          { action: "integration.use", resource: "skill:deploy", effect: "deny" },
          { action: "future.action", resource: "*", effect: "deny" },
        ],
      })
      expect(remote.policies).toEqual([
        { action: "mcp.use", resource: "*", effect: "deny" },
        { action: "skill.use", resource: "deploy", effect: "deny" },
      ])
    }),
  )
})

const eventually = Effect.fnUntraced(function* (condition: Effect.Effect<boolean>) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (yield* condition) return
    yield* Effect.sleep("10 millis")
  }
  return yield* Effect.die("Timed out waiting for policy reload")
})

const waitUntil = Effect.fnUntraced(function* (condition: Effect.Effect<boolean>) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (yield* condition) return
    yield* Effect.sleep("10 millis")
  }
  return yield* Effect.die("Timed out waiting for policy reload")
})
