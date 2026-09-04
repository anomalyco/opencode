import { Plugin, PluginContextProvider, usePlugin } from "@opencode-ai/plugin/tui"
import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure"

ensureRuntimePluginSupport({
  additional: {
    "@opencode-ai/plugin/tui": { Plugin, PluginContextProvider, usePlugin },
  },
})
