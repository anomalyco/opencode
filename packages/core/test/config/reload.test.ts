import path from "path"
import { describe, expect } from "bun:test"
import { Config as ConfigSchema } from "@opencode-ai/schema/config"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { CommandV2 } from "@opencode-ai/core/command"
import { Config } from "@opencode-ai/core/config"
import { ConfigAgentPlugin } from "@opencode-ai/core/config/plugin/agent"
import { ConfigCommandPlugin } from "@opencode-ai/core/config/plugin/command"
import { ConfigProviderPlugin } from "@opencode-ai/core/config/plugin/provider"
import { ConfigReferencePlugin } from "@opencode-ai/core/config/plugin/reference"
import { ConfigSkillPlugin } from "@opencode-ai/core/config/plugin/skill"
import { EventV2 } from "@opencode-ai/core/event"
import { Global } from "@opencode-ai/core/global"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Reference } from "@opencode-ai/core/reference"
import { SkillV2 } from "@opencode-ai/core/skill"
import { Effect, Schema } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

const it = testEffect(PluginTestLayer)
const decode = Schema.decodeUnknownSync(Config.Info)
const document = path.join(import.meta.dir, "opencode.json")

describe("config plugin reloads", () => {
  it.live("reloads config-backed domains without reloading external plugins", () =>
    Effect.gen(function* () {
      const agents = yield* AgentV2.Service
      const catalog = yield* Catalog.Service
      const commands = yield* CommandV2.Service
      const events = yield* EventV2.Service
      const plugins = yield* PluginV2.Service
      const references = yield* Reference.Service
      const skills = yield* SkillV2.Service
      const host = yield* PluginHost.make(plugins)
      let entries: Config.Entry[] = [config("first")]
      const service = Config.Service.of({ entries: () => Effect.sync(() => entries) })
      const setup = <R>(effect: Effect.Effect<void, never, R>) =>
        effect.pipe(Effect.provideService(Config.Service, service))

      yield* setup(ConfigAgentPlugin.Plugin.effect(host))
      yield* setup(ConfigCommandPlugin.Plugin.effect(host))
      yield* setup(ConfigSkillPlugin.Plugin.effect(host))
      yield* setup(ConfigReferencePlugin.Plugin.effect(host))
      yield* setup(ConfigProviderPlugin.Plugin.effect(host))

      expect((yield* agents.get(AgentV2.ID.make("first")))?.description).toBe("First agent")
      expect((yield* commands.get("first"))?.description).toBe("First command")
      expect(
        (yield* skills.sources()).some((source) => source.type === "directory" && source.path === "/skills/first"),
      ).toBe(true)
      expect((yield* references.list()).map((reference) => reference.name)).toEqual(["first"])
      expect(yield* catalog.provider.get(ProviderV2.ID.make("first"))).toBeDefined()

      entries = [config("second")]
      yield* events.publish(ConfigSchema.Event.Updated, {})
      yield* waitUntil(
        Effect.gen(function* () {
          return (
            (yield* agents.get(AgentV2.ID.make("first"))) === undefined &&
            (yield* agents.get(AgentV2.ID.make("second")))?.description === "Second agent" &&
            (yield* commands.get("first")) === undefined &&
            (yield* commands.get("second"))?.description === "Second command" &&
            (yield* references.list()).some((reference) => reference.name === "second") &&
            (yield* catalog.provider.get(ProviderV2.ID.make("first"))) === undefined &&
            (yield* catalog.provider.get(ProviderV2.ID.make("second"))) !== undefined
          )
        }),
      )

      expect(
        (yield* skills.sources()).some((source) => source.type === "directory" && source.path === "/skills/first"),
      ).toBe(false)
      expect(
        (yield* skills.sources()).some((source) => source.type === "directory" && source.path === "/skills/second"),
      ).toBe(true)
    }).pipe(Effect.provideService(Global.Service, Global.Service.of(Global.make()))),
  )
})

function config(name: string) {
  return new Config.Document({
    type: "document",
    path: document,
    info: decode({
      agents: { [name]: { description: `${title(name)} agent`, mode: "subagent" } },
      commands: { [name]: { template: `${title(name)} command`, description: `${title(name)} command` } },
      skills: [`/skills/${name}`],
      references: { [name]: `/references/${name}` },
      providers: { [name]: { models: { chat: { name: `${title(name)} model` } } } },
    }),
  })
}

function title(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

const waitUntil = Effect.fnUntraced(function* (condition: Effect.Effect<boolean>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (yield* condition) return
    yield* Effect.sleep("10 millis")
  }
  return yield* Effect.die("Timed out waiting for config plugin reloads")
})
