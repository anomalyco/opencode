import path from "path"
import { describe, expect } from "bun:test"
import { Document, Event, Info } from "@opencode-ai/schema/config"
import { Agent } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { Command } from "@opencode-ai/core/command"
import { Config } from "@opencode-ai/core/config"
import { ConfigAgentPlugin } from "@opencode-ai/core/config/plugin/agent"
import { ConfigCommandPlugin } from "@opencode-ai/core/config/plugin/command"
import { ConfigProviderPlugin } from "@opencode-ai/core/config/plugin/provider"
import { ConfigReferencePlugin } from "@opencode-ai/core/config/plugin/reference"
import { ConfigSkillPlugin } from "@opencode-ai/core/config/plugin/skill"
import { Bus } from "@opencode-ai/core/bus"
import { Integration } from "@opencode-ai/core/integration"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Provider } from "@opencode-ai/core/provider"
import { Reference } from "@opencode-ai/core/reference"
import { Skill } from "@opencode-ai/core/skill"
import { ShellSelect } from "@opencode-ai/core/shell/select"
import { Global } from "@opencode-ai/util/global"
import { AppProcess } from "@opencode-ai/util/process"
import { Effect, Layer, Schema } from "effect"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

const it = testEffect(
  Layer.merge(PluginTestLayer, AppNodeBuilder.build(LayerNode.group([AppProcess.node, ShellSelect.node]))),
)
const decode = Schema.decodeUnknownSync(Info)
const document = path.join(import.meta.dir, "opencode.json")

describe("config plugin reloads", () => {
  it.live("reloads config-backed domains without reloading external plugins", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.Service
      const catalog = yield* Catalog.Service
      const commands = yield* Command.Service
      const integrations = yield* Integration.Service
      const bus = yield* Bus.Service
      const plugins = yield* Plugin.Service
      const references = yield* Reference.Service
      const skills = yield* Skill.Service
      const host = yield* PluginHost.make(plugins)
      const test = yield* Config.Test

      yield* ConfigAgentPlugin.Plugin.effect(host)
      yield* ConfigCommandPlugin.Plugin.effect(host)
      yield* ConfigSkillPlugin.Plugin.effect(host)
      yield* ConfigReferencePlugin.Plugin.effect(host)
      yield* ConfigProviderPlugin.Plugin.effect(host)

      expect((yield* agents.get(Agent.ID.make("first")))?.description).toBe("First agent")
      expect((yield* commands.get("first"))?.description).toBe("First command")
      expect(yield* integrations.get(Integration.ID.make("first"))).toBeDefined()
      expect((yield* skills.list()).some((skill) => skill.id === "first")).toBe(true)
      expect((yield* references.list()).map((reference) => reference.name)).toEqual(["first"])
      expect(yield* catalog.provider.get(Provider.ID.make("first"))).toBeDefined()

      yield* test.setEntries([config("second")])
      yield* Effect.yieldNow
      yield* bus.publish(Event.Updated, {})
      yield* waitUntil(
        Effect.gen(function* () {
          return (
            (yield* agents.get(Agent.ID.make("first"))) === undefined &&
            (yield* agents.get(Agent.ID.make("second")))?.description === "Second agent" &&
            (yield* commands.get("first")) === undefined &&
            (yield* commands.get("second"))?.description === "Second command" &&
            (yield* integrations.get(Integration.ID.make("first"))) === undefined &&
            (yield* integrations.get(Integration.ID.make("second"))) !== undefined &&
            (yield* references.list()).some((reference) => reference.name === "second") &&
            (yield* catalog.provider.get(Provider.ID.make("first"))) === undefined &&
            (yield* catalog.provider.get(Provider.ID.make("second"))) !== undefined
          )
        }),
      )

      expect((yield* skills.list()).some((skill) => skill.id === "first")).toBe(false)
      expect((yield* skills.list()).some((skill) => skill.id === "second")).toBe(true)
    }).pipe(
      Effect.provide(Config.testLayer([config("first")])),
      Effect.provideService(Global.Service, Global.Service.of(Global.make())),
    ),
  )
})

function config(name: string) {
  return new Document({
    type: "document",
    path: AbsolutePath.make(document),
    info: decode({
      agents: { [name]: { description: `${title(name)} agent`, mode: "subagent" } },
      commands: { [name]: { template: `${title(name)} command`, description: `${title(name)} command` } },
      skills: [path.join(import.meta.dir, "fixture", "skills", `${name}-source`)],
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
