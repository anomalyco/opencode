import { formatKeySequence, useKeymapSelector } from "@opencode-ai/tui/keymap"
import type { Accessor } from "solid-js"
import { useTuiConfig } from "./context/tui-config"

export * from "@opencode-ai/tui/keymap"

export function useCommandShortcut(command: string): Accessor<string> {
  const config = useTuiConfig()
  return useKeymapSelector((keymap) =>
    formatKeySequence(
      keymap.getCommandBindings({ visibility: "registered", commands: [command] }).get(command)?.[0]?.sequence,
      config,
    ),
  )
}
