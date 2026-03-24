import { BunProc } from "@/bun"

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

export function uniqueModuleEntries(mod: Record<string, unknown>) {
  const seen = new Set<unknown>()
  const entries: [string, unknown][] = []

  for (const [name, entry] of Object.entries(mod)) {
    if (seen.has(entry)) continue
    seen.add(entry)
    entries.push([name, entry])
  }

  return entries
}
