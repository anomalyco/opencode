import { expect } from "bun:test"
import { Npm } from "@opencode-ai/core/npm"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect, Layer, Option } from "effect"
import path from "path"
import { pathToFileURL } from "url"
import { Account } from "../../src/account/account"
import { Agent } from "../../src/agent/agent"
import { Auth } from "../../src/auth"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { Env } from "../../src/env"
import { Plugin } from "../../src/plugin"
import { Skill } from "../../src/skill"
import { ProviderTest } from "../fake/provider"
import { testEffect } from "../lib/effect"
import { PLUGIN_AGENT } from "../fixture/agent-plugin.constants"

// `it.instance` skips InstanceBootstrap so FileWatcher / LSP / MCP don't spin
// up — those services hang during scope teardown on Windows and aren't needed
// to verify plugin → config hook → Agent.list.
const pluginUrl = pathToFileURL(path.join(import.meta.dir, "..", "fixture", "agent-plugin.ts")).href

const emptyAccount = Layer.mock(Account.Service)({
  active: () => Effect.succeed(Option.none()),
  activeOrg: () => Effect.succeed(Option.none()),
})

const emptyAuth = Layer.mock(Auth.Service)({
  all: () => Effect.succeed({}),
})

const emptySkill = Layer.mock(Skill.Service)({
  dirs: () => Effect.succeed([]),
})

const noopNpm = Layer.mock(Npm.Service)({
  install: () => Effect.void,
})

const provider = ProviderTest.fake()
const configLayer = Config.layer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Env.defaultLayer),
  Layer.provide(emptyAuth),
  Layer.provide(emptyAccount),
  Layer.provide(noopNpm),
)
const pluginLayer = Plugin.layer.pipe(Layer.provide(Bus.layer), Layer.provide(configLayer))
const agentLayer = Agent.layer.pipe(
  Layer.provide(configLayer),
  Layer.provide(emptyAuth),
  Layer.provide(emptySkill),
  Layer.provide(provider.layer),
  Layer.provide(pluginLayer),
)

const it = testEffect(Layer.mergeAll(agentLayer, pluginLayer))

it.instance(
  "plugin-registered agents appear in Agent.list",
  () =>
    Effect.gen(function* () {
      yield* Plugin.Service.use((p) => p.init())
      const agents = yield* Agent.Service.use((svc) => svc.list())
      const added = agents.find((agent) => agent.name === PLUGIN_AGENT.name)
      expect(added?.description).toBe(PLUGIN_AGENT.description)
      expect(added?.mode).toBe(PLUGIN_AGENT.mode)
    }),
  { config: { plugin: [pluginUrl] } },
)
