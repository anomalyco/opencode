import { expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import path from "path"
import { pathToFileURL } from "url"
import { Agent } from "../../src/agent/agent"
import { InstanceRef } from "../../src/effect/instance-ref"
import { InstanceLayer } from "../../src/project/instance-layer"
import { InstanceStore } from "../../src/project/instance-store"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const pluginAgent = {
  name: "plugin_added",
  description: "Added by a plugin via the config hook",
  mode: "subagent",
} as const

const it = testEffect(Layer.mergeAll(Agent.defaultLayer, InstanceLayer.layer, CrossSpawnSpawner.defaultLayer))

it.live("plugin-registered agents appear in Agent.list", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const pluginFile = path.join(dir, "plugin.ts")

    yield* Effect.promise(async () => {
      await Promise.all([
        Bun.write(
          pluginFile,
          [
            "export default async () => ({",
            "  config: async (cfg) => {",
            "    cfg.agent = cfg.agent ?? {}",
            `    cfg.agent[${JSON.stringify(pluginAgent.name)}] = {`,
            `      description: ${JSON.stringify(pluginAgent.description)},`,
            `      mode: ${JSON.stringify(pluginAgent.mode)},`,
            "    }",
            "  },",
            "})",
            "",
          ].join("\n"),
        ),
        Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            plugin: [pathToFileURL(pluginFile).href],
          }),
        ),
      ])
    })

    const agents = yield* InstanceStore.Service.use((store) =>
      Effect.gen(function* () {
        const ctx = yield* store.load({ directory: dir })
        yield* Effect.addFinalizer(() => store.dispose(ctx).pipe(Effect.ignore))
        return yield* Agent.Service.use((svc) => svc.list()).pipe(Effect.provideService(InstanceRef, ctx))
      }),
    )
    const added = agents.find((agent) => agent.name === pluginAgent.name)

    expect(added?.description).toBe(pluginAgent.description)
    expect(added?.mode).toBe(pluginAgent.mode)
  }),
)
