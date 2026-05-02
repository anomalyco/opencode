import { afterEach, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await disposeAllInstances()
})

test("plugin-registered agents appear in Agent.list", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const pluginFile = path.join(dir, "plugin.ts")
      await Bun.write(
        pluginFile,
        [
          "export default async () => ({",
          "  config: async (cfg) => {",
          "    cfg.agent = cfg.agent ?? {}",
          "    cfg.agent.plugin_added = {",
          '      description: "Added by a plugin via the config hook",',
          '      mode: "subagent",',
          "    }",
          "  },",
          "})",
          "",
        ].join("\n"),
      )
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          plugin: [pathToFileURL(pluginFile).href],
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = await AppRuntime.runPromise(Agent.Service.use((svc) => svc.list()))
      const added = agents.find((agent) => agent.name === "plugin_added")
      expect(added?.description).toBe("Added by a plugin via the config hook")
      expect(added?.mode).toBe("subagent")
    },
  })
})
