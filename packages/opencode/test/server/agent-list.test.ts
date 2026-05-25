import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect } from "effect"
import { tmpdir } from "../fixture/fixture"
import { Agent } from "../../src/agent/agent"
import { Plugin } from "../../src/plugin"
import { AppRuntime } from "../../src/effect/app-runtime"
import { InstanceStore } from "../../src/project/instance-store"

async function writePlugin(dir: string) {
  const root = path.join(dir, ".opencode")
  const plugin = path.join(root, "plugin")
  await fs.mkdir(plugin, { recursive: true })
  const file = path.join(plugin, "alpha.mjs")

  await Bun.write(
    path.join(dir, "opencode.json"),
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      plugin: ["file://" + file],
    }),
  )

  await Bun.write(
    file,
    [
      "export default async () => ({",
      "  config: async (cfg) => {",
      "    cfg.agent ||= {}",
      '    cfg.agent.alpha = { name: "Alpha Agent", description: "Injected by plugin", mode: "primary", prompt: "Injected prompt" }',
      "  },",
      "})",
    ].join("\n"),
  )
}

describe("server agent list", () => {
  test("includes project plugin agents for the requested directory", async () => {
    await using tmp = await tmpdir({ init: writePlugin })

    const data = await AppRuntime.runPromise(
      InstanceStore.Service.use((store) =>
        store.provide(
          { directory: tmp.path },
          Effect.gen(function* () {
            const plugin = yield* Plugin.Service
            const agent = yield* Agent.Service
            yield* plugin.init()
            return yield* agent.list()
          }),
        ),
      ),
    )
    expect(data.some((item) => item.name === "Alpha Agent" && item.mode === "primary" && !item.hidden)).toBe(true)
  })
})
