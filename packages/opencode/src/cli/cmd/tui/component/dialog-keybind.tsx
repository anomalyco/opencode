import { Config } from "@/config/config"
import { useKeybind, type KeybindKey } from "@tui/context/keybind"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import * as fuzzysort from "fuzzysort"
import { createMemo, createSignal } from "solid-js"

const GROUPS = ["General", "Session", "Messages", "Model & Agent", "Input", "Terminal"] as const

function group(key: string): (typeof GROUPS)[number] {
  if (key.startsWith("input_") || key.startsWith("history_")) return "Input"
  if (key.startsWith("session_") || key.startsWith("stash_")) return "Session"
  if (key.startsWith("messages_")) return "Messages"
  if (key.startsWith("model_") || key.startsWith("agent_") || key.startsWith("variant_")) return "Model & Agent"
  if (key.startsWith("terminal_")) return "Terminal"
  return "General"
}

function options(print: (key: KeybindKey) => string) {
  return Object.entries(Config.Keybinds.shape)
    .filter(([key]) => key !== "leader")
    .map(([key, schema]) => ({
      title: schema.description ?? key,
      value: key,
      footer: print(key as KeybindKey) || "none",
      category: group(key),
    }))
}

export function DialogKeybind() {
  const keybind = useKeybind()
  const dialog = useDialog()
  const [query, setQuery] = createSignal("")
  const list = createMemo(() => {
    const rows = options((k) => keybind.print(k))
    const q = query().trim()
    if (!q) return rows
    return fuzzysort
      .go(q, rows, {
        keys: ["title", "footer", "value"],
        threshold: -10000,
      })
      .map((x) => x.obj)
  })

  return (
    <DialogSelect title="Keybinds" skipFilter options={list()} onFilter={setQuery} onSelect={() => dialog.clear()} />
  )
}
