import { describe, expect, test } from "bun:test"
import PluginManager from "../../src/feature-plugins/system/plugins"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createTuiPluginApi } from "../fixture/tui-plugin"

async function commands() {
  const layers: { commands?: { name: string; slashName?: string; slashAliases?: string[] }[] }[] = []
  await PluginManager.tui(
    createTuiPluginApi({
      keymap: {
        registerLayer(layer: (typeof layers)[number]) {
          layers.push(layer)
          return () => {}
        },
      } as unknown as TuiPluginApi["keymap"],
    }),
    undefined,
    {} as never,
  )
  return layers.flatMap((layer) => layer.commands ?? [])
}

describe("feature-plugins.plugin-manager", () => {
  test("plugins.list is reachable as /plugins with a /plugin alias", async () => {
    const list = (await commands()).find((command) => command.name === "plugins.list")

    expect(list?.slashName).toBe("plugins")
    expect(list?.slashAliases).toEqual(["plugin"])
  })

  test("plugins.install is reachable as /plugin-install", async () => {
    const install = (await commands()).find((command) => command.name === "plugins.install")

    expect(install?.slashName).toBe("plugin-install")
    expect(install?.slashAliases).toBeUndefined()
  })

  test("every plugin manager command stays in the palette namespace", async () => {
    const list = await commands()

    expect(list.length).toBeGreaterThan(0)
    expect(list.every((command) => "slashName" in command)).toBe(true)
  })
})
