/**
 * Maps old hook names to new pipeline names.
 * Old names continue to work via adapter wrapping.
 */
export const LEGACY_HOOK_ALIASES: Record<string, string> = {
  "tool.execute.before": "pipeline.tool.before",
  "tool.execute.after": "pipeline.tool.after",
  "command.execute.before": "pipeline.command.before",
  "shell.env": "pipeline.shell.env",
  "chat.message": "pipeline.chat.message",
  "chat.params": "pipeline.chat.params",
  "chat.headers": "pipeline.chat.headers",
  "permission.ask": "pipeline.permission.ask",
  "tool.definition": "pipeline.tool.definition",
}

/**
 * Resolve a hook name, returning the canonical name.
 * If the name is a legacy alias, returns the new name.
 * If already canonical, returns as-is.
 */
export function resolveHookName(name: string): string {
  return LEGACY_HOOK_ALIASES[name] ?? name
}

/**
 * Get all registered hook names (old + new) for a given canonical name.
 * Used by Plugin.trigger to find hooks under either name.
 */
export function getAllHookNames(canonical: string): string[] {
  const legacy = Object.entries(LEGACY_HOOK_ALIASES)
    .filter(([, v]) => v === canonical)
    .map(([k]) => k)
  return [canonical, ...legacy]
}
