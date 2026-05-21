import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import type { Agent } from "@opencode-ai/sdk/v2"

/**
 * Sort comparator for agents by category.
 *
 * Ordering:
 * 1. Categorized agents, ordered alphabetically by category
 * 2. Uncategorized agents last
 */
function sortAgentByCategory(a: Agent, b: Agent) {
  const aCat = a.category ?? ""
  const bCat = b.category ?? ""

  // Uncategorized agents sink to the bottom.
  if (!a.category && b.category) return 1
  if (a.category && !b.category) return -1
  if (!a.category && !b.category) return 0

  // Alphabetical by category. Each built-in agent is its own
  // category group (build, explore, general, plan, etc.).
  return aCat.localeCompare(bCat)
}

/** Maps an agent to a dialog-select option with a display category. */
function mapAgentToDialogOptions(agent: Agent): DialogSelectOption<string> {
  return {
    value: agent.name,
    title: agent.name,
    category: agent.category
      ? agent.category[0].toUpperCase() + agent.category.slice(1)
      : "Uncategorized",
    description: agent.description ?? "native",
  }
}

export function DialogAgent() {
  const local = useLocal()
  const dialog = useDialog()

  const options = createMemo(() =>
    local.agent.list().slice().sort(sortAgentByCategory).map(mapAgentToDialogOptions),
  )

  return (
    <DialogSelect
      title="Select agent"
      current={local.agent.current()?.name}
      options={options()}
      onSelect={(option) => {
        local.agent.set(option.value)
        dialog.clear()
      }}
    />
  )
}
