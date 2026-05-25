import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect } from "effect"
import { tmpdir } from "../fixture/fixture"
import { Agent } from "../../src/agent/agent"
import { Plugin } from "../../src/plugin"
import { AppRuntime } from "../../src/effect/app-runtime"
import { InstanceStore } from "../../src/project/instance-store"

async function writePlugin(dir: string, name: string, label: string) {
  const root = path.join(dir, ".opencode")
  const plugin = path.join(root, "plugin")
  await fs.mkdir(plugin, { recursive: true })
  const file = path.join(plugin, `${name}.mjs`)

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
      `    cfg.agent.${name} = {`,
      `      name: ${JSON.stringify(label)},`,
      '      description: "Injected in test",',
      '      mode: "primary",',
      '      prompt: "Injected prompt",',
      "    }",
      "  },",
      "})",
    ].join("\n"),
  )
}

async function listAgents(directory: string) {
  return AppRuntime.runPromise(
    InstanceStore.Service.use((store) =>
      store.provide(
        { directory },
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const agent = yield* Agent.Service
          yield* plugin.init()
          return yield* agent.list()
        }),
      ),
    ),
  )
}

describe("plugin runtime config", () => {
  test("plugin config hook can inject runtime agents", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writePlugin(dir, "alpha", "Alpha Agent")
      },
    })

    const list = await listAgents(tmp.path)

    expect(list.some((item) => item.name === "Alpha Agent" && item.mode === "primary" && !item.hidden)).toBe(true)
  })

  test("project plugins remain isolated per instance", async () => {
    await using a = await tmpdir({
      init: async (dir) => {
        await writePlugin(dir, "alpha", "Alpha Agent")
      },
    })
    await using b = await tmpdir({
      init: async (dir) => {
        await writePlugin(dir, "beta", "Beta Agent")
      },
    })

    const [left, right] = await Promise.all([
      listAgents(a.path),
      listAgents(b.path),
    ])

    expect(left.some((item) => item.name === "Alpha Agent")).toBe(true)
    expect(left.some((item) => item.name === "Beta Agent")).toBe(false)
    expect(right.some((item) => item.name === "Beta Agent")).toBe(true)
    expect(right.some((item) => item.name === "Alpha Agent")).toBe(false)
  })
})
