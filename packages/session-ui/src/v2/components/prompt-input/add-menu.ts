import type { PromptInputV2Suggestion } from "./types"

// Visible slash commands for the "+" add menu. The controller already carries
// the full command list, so this only normalizes it for display: keep command
// entries, drop duplicates by id, preserve input order.
export function visibleAddMenuCommands(commands: readonly PromptInputV2Suggestion[]) {
  const seen = new Set<string>()
  return commands.filter((item) => {
    if (item.kind !== "command") return false
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}
