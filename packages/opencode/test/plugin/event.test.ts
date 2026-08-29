import { afterAll, afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../fixture/fixture"

const disableDefault = process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS
process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = "1"

const { Plugin } = await import("../../src/plugin/index")
const { Bus } = await import("../../src/bus")
const { Instance } = await import("../../src/project/instance")

afterEach(async () => {
  await Instance.disposeAll()
})

afterAll(() => {
  if (disableDefault === undefined) {
    delete process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS
    return
  }
  process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = disableDefault
})

async function project(source: string) {
  return tmpdir({
    init: async (dir) => {
      const file = path.join(dir, "plugin.ts")
      await Bun.write(file, source)
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify(
          {
            $schema: "https://opencode.ai/config.json",
            plugin: [pathToFileURL(file).href],
          },
          null,
          2,
        ),
      )
    },
  })
}

describe("plugin.event", () => {
  test("emits custom bus events reachable via subscribeAll", async () => {
    await using tmp = await project(
      [
        "export default async (input) => ({",
        "  config() {",
        '    input.event.emit("plugin.demo.tick", { n: 1 })',
        "  },",
        "})",
        "",
      ].join("\n"),
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const received: Array<{ type: string; properties: unknown }> = []
        const off = Bus.subscribeAll((evt) => {
          received.push(evt)
        })
        await Plugin.init()
        await Bun.sleep(10)
        off()
        expect(received).toContainEqual({ type: "plugin.demo.tick", properties: { n: 1 } })
      },
    })
  })
})
