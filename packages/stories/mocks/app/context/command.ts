import { useLanguage } from "@/runtime/i18n/language"
import {
  DEFAULT_PALETTE_KEYBIND,
  formatKeybind,
  formatKeybindParts,
  matchKeybind,
  parseKeybind,
} from "../../../../app/src/shell/commands/command"

export { DEFAULT_PALETTE_KEYBIND, formatKeybind, formatKeybindParts, matchKeybind, parseKeybind }

const keybinds: Record<string, string> = {
  "file.attach": "mod+u",
  "prompt.mode.shell": "mod+shift+x",
  "prompt.mode.normal": "mod+shift+e",
  "permissions.autoaccept": "mod+shift+a",
  "agent.cycle": "mod+.",
  "model.choose": "mod+m",
  "model.variant.cycle": "mod+shift+m",
  "session.background": "ctrl+b",
}

export function useCommand() {
  const language = useLanguage()

  return {
    options: [],
    register() {
      return () => undefined
    },
    trigger() {},
    keybind(id: string) {
      return formatKeybind(keybinds[id] ?? "", language.t)
    },
    keybindParts(id: string) {
      return formatKeybindParts(keybinds[id] ?? "", language.t)
    },
  }
}
