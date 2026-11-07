import { ensurePluginRuntime, provides } from "@opencode/plugin/runtime"
import { Plugin, PluginContextProvider, usePlugin } from "@opencode/plugin/tui"
import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure"

// Native transitive imports can bypass OpenTUI's entrypoint prescan. Capture
// host namespaces first so physical plugin peers cannot create another owner.
ensurePluginRuntime({
  "@opentui/core": await import("@opentui/core"),
  "@opentui/core/testing": () => import("@opentui/core/testing"),
  "@opentui/solid": await import("@opentui/solid"),
  "@opentui/solid/components": await import("@opentui/solid/components"),
  "@opentui/solid/jsx-runtime": await import("@opentui/solid/jsx-runtime"),
  "@opentui/solid/jsx-dev-runtime": await import("@opentui/solid/jsx-dev-runtime"),
  "solid-js": await import("solid-js"),
  "solid-js/store": await import("solid-js/store"),
})
ensureRuntimePluginSupport({
  additional: {
    "@opencode/plugin/tui": { Plugin, PluginContextProvider, usePlugin },
  },
  preserve: provides,
})
