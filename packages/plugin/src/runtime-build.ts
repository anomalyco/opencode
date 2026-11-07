import type { BunPlugin } from "bun"
import { discoverPluginRuntimeSpecifiers, pluginRuntimeLoaderCode } from "./runtime-modules.js"

/** Embed the same public SDK runtime map in CLI and compiled consumer builds. */
export function createPluginRuntimePlugin(): BunPlugin {
  const entries = discoverPluginRuntimeSpecifiers()
  const contents = [
    "export const resolveHostPackageRoots = () => []",
    "const modules = {",
    ...[...entries.keys()].map(
      (specifier) => `  ${JSON.stringify(specifier)}: ${pluginRuntimeLoaderCode(specifier, entries)},`,
    ),
    "}",
    "export const loadRuntimeModules = () => modules",
  ].join("\n")
  return {
    name: "opencode-plugin-runtime",
    setup(build) {
      build.onLoad({ filter: /plugin[/\\]src[/\\]runtime-modules\.ts$/ }, () => ({ contents, loader: "ts" }))
    },
  }
}
