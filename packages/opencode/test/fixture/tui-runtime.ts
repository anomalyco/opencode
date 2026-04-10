import { spyOn } from "bun:test"
import path from "path"
import { TuiConfig } from "../../src/config/tui"

type PluginSpec = string | [string, Record<string, unknown>]

export function mockTuiRuntime(dir: string, plugin: PluginSpec[]) {
  process.env.OPENCODE_PLUGIN_META_FILE = path.join(dir, "plugin-meta.json")
  const plugin_origins = plugin.map((spec) => ({
    spec,
    scope: "local" as const,
    source: path.join(dir, "tui.json"),
  }))
  const get = spyOn(TuiConfig, "get").mockResolvedValue({
    plugin,
    plugin_origins,
  })
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => dir)

  return () => {
    cwd.mockRestore()
    get.mockRestore()
    wait.mockRestore()
    delete process.env.OPENCODE_PLUGIN_META_FILE
  }
}
