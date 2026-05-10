import { spyOn } from "bun:test"
import path from "path"
import type { KeyEvent, Renderable } from "@opentui/core"
import { resolveBindingSections, type BindingSectionsConfig } from "@opentui/keymap/extras"
import { TuiConfig } from "../../src/cli/cmd/tui/config/tui"
import { LegacyKeymapTransform } from "../../src/cli/cmd/tui/config/legacy-keymap-transform"
import { ConfigKeybinds } from "../../src/config/keybinds"
import {
  KeymapConfig,
  KeymapSectionNames,
  keymapBindingDefaults,
  type KeymapConfigInput,
  type KeymapSection,
} from "../../src/cli/cmd/tui/config/tui-schema"

type PluginSpec = string | [string, Record<string, unknown>]
type ResolvedInput = Omit<TuiConfig.Resolved, "keybinds" | "keymap"> & {
  keybinds?: TuiConfig.Resolved["keybinds"]
  keymap?: TuiConfig.Resolved["keymap"]
}

export function createTuiResolvedKeymap(input: KeymapConfigInput): TuiConfig.Resolved["keymap"] {
  const config = KeymapConfig.parse(input)
  return {
    leader: !config.leader || config.leader === "none" ? "ctrl+x" : config.leader,
    leader_timeout: config.leader_timeout,
    ...resolveBindingSections<Renderable, KeyEvent, BindingSectionsConfig<Renderable, KeyEvent>, KeymapSection>(
      config.sections,
      {
        sections: KeymapSectionNames,
        bindingDefaults: keymapBindingDefaults,
      },
    ),
  }
}

export function createTuiResolvedConfig(input: ResolvedInput = {}): TuiConfig.Resolved {
  const keybinds = input.keybinds ?? ConfigKeybinds.Keybinds.parse({})
  return {
    ...input,
    keybinds,
    keymap: input.keymap ?? createTuiResolvedKeymap(LegacyKeymapTransform.create(input.keybinds ?? {})),
  }
}

export function mockTuiRuntime(dir: string, plugin: PluginSpec[], opts?: { plugin_enabled?: Record<string, boolean> }) {
  process.env.OPENCODE_PLUGIN_META_FILE = path.join(dir, "plugin-meta.json")
  const plugin_origins = plugin.map((spec) => ({
    spec,
    scope: "local" as const,
    source: path.join(dir, "tui.json"),
  }))
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => dir)

  const config = createTuiResolvedConfig({
    plugin,
    plugin_origins,
    ...(opts?.plugin_enabled && { plugin_enabled: opts.plugin_enabled }),
  })

  return {
    config,
    restore: () => {
      cwd.mockRestore()
      wait.mockRestore()
      delete process.env.OPENCODE_PLUGIN_META_FILE
    },
  }
}
