import { spyOn } from "bun:test"
import path from "path"
import { TuiConfig } from "../../src/config/tui"

type PluginSpec = string | [string, Record<string, unknown>]

export function mockTuiRuntime(dir: string, plugin: PluginSpec[]) {
  process.env.OPENCODE_PLUGIN_META_FILE = path.join(dir, "plugin-meta.json")
  const meta = Object.fromEntries(
    plugin.map((item) => {
      const spec = Array.isArray(item) ? item[0] : item
      return [
        spec,
        {
          scope: "local" as const,
          source: path.join(dir, "tui.json"),
        },
      ]
    }),
  )
  const get = spyOn(TuiConfig, "get").mockResolvedValue({
    plugin,
    plugin_meta: meta,
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
