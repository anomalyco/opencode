import { spyOn } from "bun:test"
import path from "path"
import { TuiConfig } from "../../src/cli/cmd/tui/config/tui"

type PluginSpec = string | [string, Record<string, unknown>]

export function mockTuiRuntime(dir: string, plugin: PluginSpec[], opts?: { plugin_enabled?: Record<string, boolean> }) {
  process.env.OPENCODE_PLUGIN_META_FILE = path.join(dir, "plugin-meta.json")
  const plugin_origins = plugin.map((spec) => ({
    spec,
    scope: "local" as const,
    source: path.join(dir, "tui.json"),
  }))
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => dir)

  const config: TuiConfig.Info = {
    plugin,
    plugin_origins,
    ...(opts?.plugin_enabled && { plugin_enabled: opts.plugin_enabled }),
  }

  return {
    config,
    restore: () => {
      cwd.mockRestore()
      wait.mockRestore()
      delete process.env.OPENCODE_PLUGIN_META_FILE
    },
  }
}
