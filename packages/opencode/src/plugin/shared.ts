import { BunProc } from "@/bun"
import { isRecord } from "@/util/record"

// Old npm package names for plugins that are now built-in
export const DEPRECATED_PLUGIN_PACKAGES = ["opencode-openai-codex-auth", "opencode-copilot-auth"]

export function isDeprecatedPlugin(spec: string) {
  return DEPRECATED_PLUGIN_PACKAGES.some((pkg) => spec.includes(pkg))
}

export function parsePluginSpecifier(spec: string) {
  const lastAt = spec.lastIndexOf("@")
  const pkg = lastAt > 0 ? spec.substring(0, lastAt) : spec
  const version = lastAt > 0 ? spec.substring(lastAt + 1) : "latest"
  return { pkg, version }
}

export async function resolvePluginTarget(spec: string, parsed = parsePluginSpecifier(spec)) {
  if (spec.startsWith("file://")) return spec
  return BunProc.install(parsed.pkg, parsed.version)
}

export function getDefaultPlugin(mod: Record<string, unknown>) {
  // A single default object keeps v1 detection explicit and avoids scanning exports.
  const value = mod.default
  if (!isRecord(value)) return
  const server = "server" in value ? value.server : undefined
  const tui = "tui" in value ? value.tui : undefined
  if (server !== undefined && typeof server !== "function") return
  if (tui !== undefined && typeof tui !== "function") return
  if (server === undefined && tui === undefined) return
  return value
}
