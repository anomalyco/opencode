// Slash command alias definitions.
//
// Provides mappings from well-known slash command aliases (e.g. Claude Code's
// `/clear`) to their securecode primary names (e.g. `/new`). This lets users
// who switch from Claude Code or Codex keep using familiar commands.
//
// TUI already has slashAliases on keymap commands. Direct mode (run) uses a
// different path — it parses slash commands via `parseSlashCommand` which only
// checks the SDK catalog. This module bridges the gap by providing a local
// resolver.

// Maps alias → primary command name for direct mode resolution.
const aliasMap: Readonly<Record<string, string>> = {
  // session.new aliases (Claude Code / Codex)
  clear: "new",
  reset: "new",
  // session.list aliases (Claude Code / Codex)
  resume: "sessions",
  continue: "sessions",
  // session.exit aliases
  quit: "exit",
  q: "exit",
  // agent.list aliases (Codex uses singular)
  agent: "agents",
}

/**
 * Resolve an alias to its primary command name.
 * Returns the resolved name if the input is a known alias, or `undefined` if
 * it's not an alias (caller should then match against primary command names).
 */
export function resolveSlashAlias(name: string): string | undefined {
  return aliasMap[name]
}

/**
 * Primary command name → its known aliases.
 * Returns an empty array if the command has no aliases.
 */
export function getSlashAliases(primary: string): string[] {
  const reversed: string[] = []
  for (const [alias, target] of Object.entries(aliasMap)) {
    if (target === primary) {
      reversed.push(alias)
    }
  }
  return reversed
}

/**
 * All alias entries as [alias, primary] pairs.
 * Used by the autocomplete to render alias options in the slash menu.
 */
export function getAllSlashAliases(): ReadonlyArray<readonly [alias: string, primary: string]> {
  return Object.entries(aliasMap)
}
