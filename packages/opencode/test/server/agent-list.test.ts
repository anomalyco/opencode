import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Server } from "../../src/server/server"

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

    const app = Server.createApp({})
    const res = await app.request("http://localhost/agent?directory=" + encodeURIComponent(tmp.path))
    expect(res.status).toBe(200)

    const data = (await res.json()) as Array<{ name: string; mode: string; hidden?: boolean }>
    expect(data.some((item) => item.name === "Alpha Agent" && item.mode === "primary" && !item.hidden)).toBe(true)
  })
})
