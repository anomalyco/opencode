import { ensurePluginRuntime, provides } from "@Mackery6969/plugin/runtime"
import { Plugin, PluginContextProvider, usePlugin } from "@Mackery6969/plugin/tui"
import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure"

ensurePluginRuntime()
ensureRuntimePluginSupport({
  additional: {
    "@Mackery6969/plugin/tui": { Plugin, PluginContextProvider, usePlugin },
  },
  preserve: provides,
})
