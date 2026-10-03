import { plugin } from "bun"

// Loose plugin files have no node_modules, so Bun cannot find the SDK the host
// already bundles. Serve the host's own copy so plugins and OpenCode share one
// module identity, matching the Node executable's module hooks. The TUI shims
// `@opencode/plugin/tui` separately with the OpenTUI runtime modules it needs.
const modules: Record<string, () => Promise<object>> = {
  "@opencode/plugin": () => import("./promise/index.js"),
  "@opencode/plugin/promise/plugin": () => import("./promise/plugin.js"),
  "@opencode/plugin/promise/tool": () => import("./promise/tool.js"),
  "@opencode/plugin/effect": () => import("./effect/index.js"),
  "@opencode/plugin/effect/plugin": () => import("./effect/plugin.js"),
  "@opencode/plugin/effect/tool": () => import("./effect/tool.js"),
}

let installed = false

export function ensureRuntimeModules() {
  if (installed) return
  installed = true
  plugin({
    name: "opencode-plugin-runtime",
    setup(build) {
      Object.entries(modules).forEach(([specifier, load]) => {
        build.module(specifier, async () => ({ exports: { ...(await load()) }, loader: "object" }))
      })
    },
  })
}
