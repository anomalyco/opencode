import { Plugin, PluginContextProvider, usePlugin } from "@opencode/plugin/tui"
import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure"

ensureRuntimePluginSupport({
  additional: {
    "@opencode/plugin/tui": { Plugin, PluginContextProvider, usePlugin },
  },
})
