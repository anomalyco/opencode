import { createMemo } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useKeybind } from "@tui/context/keybind"
import type { KeybindsConfig } from "@opencode-ai/sdk/v2"
import { zodToJsonSchema } from "zod-to-json-schema"
import { Config } from "@/config/config"

// Dynamically extract keybinding descriptions from the config schema
// This ensures descriptions stay in sync with the schema definitions
function getKeybindDescriptions(): Record<string, string> {
  const jsonSchema = zodToJsonSchema(Config.Keybinds) as any
  const descriptions: Record<string, string> = {}

  for (const [key, schema] of Object.entries(jsonSchema.properties || {})) {
    descriptions[key] = (schema as any).description || key
  }

  return descriptions
}

const KEYBIND_DESCRIPTIONS = getKeybindDescriptions()

export function DialogKeybindings() {
  const keybind = useKeybind()
  const dialog = useDialog()

  // Get all keybindings and map them to options
  const options = createMemo(() =>
    Object.keys(keybind.all)
      .filter((key) => key !== "leader") // Exclude the leader key itself
      .map((key) => {
        const typedKey = key as keyof KeybindsConfig
        return {
          title: KEYBIND_DESCRIPTIONS[typedKey] || key,
          value: key,
          footer: keybind.print(typedKey),
        }
      })
      .sort((a, b) => a.title.localeCompare(b.title)), // Sort alphabetically by title
  )

  return (
    <DialogSelect
      title="Keybindings"
      options={options()}
      onSelect={() => dialog.clear()}
    />
  )
}
