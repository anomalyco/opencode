import { Plugin, PluginContextProvider, usePlugin } from "@opencode-ai/plugin/tui"
import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure"

export const additional = {
  "@opencode-ai/plugin/tui": { Plugin, PluginContextProvider, usePlugin },
}

ensureRuntimePluginSupport({ additional })
