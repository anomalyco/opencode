import { describe, expect } from "bun:test"
import { Config as ConfigSchema } from "@opencode-ai/schema/config"
import { Catalog } from "@opencode-ai/core/catalog"
import { Config } from "@opencode-ai/core/config"
import { ConfigPolicyPlugin } from "@opencode-ai/core/config/plugin/policy"
import { Bus } from "@opencode-ai/core/bus"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { Provider } from "@opencode-ai/core/provider"
import { Effect, Schema, Stream } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

const it = testEffect(PluginTestLayer)
const decode = Schema.decodeUnknownSync(Config.Info)

const policies = (...items: { effect: "allow" | "deny"; resource: string }[]) =>
  new Config.Document({
    type: "document",
    info: decode({
      experimental: {
        policies: items.map((item) => ({ action: "provider.use", ...item })),
      },
    }),
  })

const addPlugin = Effect.fn(function* (entries: () => Config.Entry[]) {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* ConfigPolicyPlugin.Plugin.effect(host).pipe(
    Effect.provideService(
      Config.Service,
      Config.Service.of({ changes: () => Stream.empty, entries: () => Effect.sync(entries) }),
    ),
  )
})

describe("ConfigPolicyPlugin.Plugin", () => {
  it.effect("filters plugin-provided providers with ordered wildcard policies", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(Provider.ID.openai, () => {})
        catalog.provider.update(Provider.ID.anthropic, () => {})
        catalog.provider.update(Provider.ID.make("company-internal"), () => {})
      })
      yield* addPlugin(() => [
        policies(
          { effect: "deny", resource: "*" },
          { effect: "allow", resource: "anthropic" },
          { effect: "allow", resource: "company-*" },
        ),
      ])

      expect(yield* catalog.provider.get(Provider.ID.openai)).toBeUndefined()
      expect(yield* catalog.provider.get(Provider.ID.anthropic)).toBeDefined()
      expect(yield* catalog.provider.get(Provider.ID.make("company-internal"))).toBeDefined()
    }),
  )

  it.effect("prevents project policy from overriding user-global policy", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => catalog.provider.update(Provider.ID.openai, () => {}))
      yield* addPlugin(() => [
        policies({ effect: "deny", resource: "openai" }),
        policies({ effect: "allow", resource: "openai" }),
      ])

      expect(yield* catalog.provider.get(Provider.ID.openai)).toBeUndefined()
    }),
  )

  it.live("reloads changed policies", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const bus = yield* Bus.Service
      let entries: Config.Entry[] = [policies({ effect: "deny", resource: "openai" })]
      yield* catalog.transform((catalog) => catalog.provider.update(Provider.ID.openai, () => {}))
      yield* addPlugin(() => entries)
      expect(yield* catalog.provider.get(Provider.ID.openai)).toBeUndefined()

      entries = [policies({ effect: "allow", resource: "openai" })]
      yield* bus.publish(ConfigSchema.Event.Updated, {})
      yield* waitUntil(
        catalog.provider.get(Provider.ID.openai).pipe(Effect.map((provider) => provider !== undefined)),
      )
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
