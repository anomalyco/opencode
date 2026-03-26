// packages/opencode/src/workflow/registry.ts
// Built-in alias registry — maps short names to canonical GitHub URLs.
// User config (opencode.json) only stores installed paths, never alias mappings.

export const REGISTRY: Record<string, string> = {
  "gsd": "https://github.com/CobuilderLabs/gsd-workflow",
  "ralph-loop": "https://github.com/CobuilderLabs/ralph-loop-workflow",
  "gstack": "https://github.com/CobuilderLabs/gstack-workflow",
}

/**
 * Given a source string (alias or full URL), return the canonical URL to clone.
 * Throws if the alias is not found and the source does not look like a URL.
 */
export function resolveSource(source: string): string {
  if (source in REGISTRY) return REGISTRY[source]!
  if (source.startsWith("https://") || source.startsWith("http://") || source.startsWith("git@")) {
    return source
  }
  throw new Error(
    `Unknown workflow alias "${source}". Use a full GitHub URL or one of: ${Object.keys(REGISTRY).join(", ")}`,
  )
}
