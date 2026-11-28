import type { ParentProps } from "solid-js"
import { createAppKeymap, type AppKeymap } from "../../../../app/src/shell/commands/keymap"
import {
  formatKeybindParts,
  matchKeybind,
  parseKeybind,
  type CommandOption,
} from "../../../../app/src/shell/commands/command"

export {
  COMMAND_SEARCH_ID,
  DEFAULT_PALETTE_KEYBIND,
  commandPaletteOptions,
  formatKeybind,
  formatKeybindParts,
  keyFromKeyboardEvent,
  matchKeybind,
  parseKeybind,
  type CommandOption,
  type CommandSection,
  type CommandSource,
} from "../../../../app/src/shell/commands/command"

const keybinds: Record<string, string> = {
  "file.attach": "mod+u",
  "prompt.mode.shell": "mod+shift+x",
  "prompt.mode.normal": "mod+shift+e",
  "permissions.autoaccept": "mod+shift+a",
  "agent.cycle": "mod+.",
  "model.choose": "mod+m",
  "model.variant.cycle": "mod+shift+m",
  "session.background": "ctrl+b",
  "project.open": "mod+o",
}

export function CommandProvider(props: ParentProps) {
  return props.children
}

export function useCommand() {
  const options: CommandOption[] = []

  return {
    options,
    catalog: options,
    registerKeyLayer(layer: Parameters<AppKeymap["registerLayer"]>[0]) {
      const app = createAppKeymap({ blocked: () => false, editable: () => true })
      app.keymap.registerLayer(layer)
      return app.destroy
    },
    register() {
      return () => undefined
    },
    trigger() {},
    matches(id: string, event: KeyboardEvent) {
      return matchKeybind(parseKeybind(keybinds[id] ?? "none"), event)
    },
    keybind(id: string) {
      return keybinds[id]
    },
    keybindParts(id: string) {
      return formatKeybindParts(keybinds[id] ?? "none")
    },
  }
}
