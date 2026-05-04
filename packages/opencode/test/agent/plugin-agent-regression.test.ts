import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { pathToFileURL } from "url"
import { Agent } from "../../src/agent/agent"
import { Plugin } from "../../src/plugin"
import { testEffect } from "../lib/effect"
import { PLUGIN_AGENT } from "../fixture/agent-plugin.constants"

// The plugin lives in test/fixture/ as a stable file rather than being written
// into a per-test tmpdir. Combined with `it.instance` (which uses the noop
// InstanceBootstrap), this skips FileWatcher / LSP / MCP / etc. — the actual
// source of Windows teardown flakiness — while still exercising the production
// code path that matters: plugin load → config hook → agent registration →
// Agent.list.
const pluginUrl = pathToFileURL(path.join(import.meta.dir, "..", "fixture", "agent-plugin.ts")).href

const it = testEffect(Layer.mergeAll(Agent.defaultLayer, Plugin.defaultLayer))

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
