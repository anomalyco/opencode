import { matchKeybind, parseKeybind } from "@/shell/commands/command"
import { useSettings } from "@/settings/model"

export const PROMPT_KEYBINDS = {
  submit: {
    id: "prompt.submit",
    keybind: "enter",
    title: "command.prompt.submit",
  },
  newline: {
    id: "prompt.newline",
    keybind: "shift+enter",
    title: "command.prompt.newline",
  },
} as const

export function matchPromptKeybind(
  id: keyof typeof PROMPT_KEYBINDS,
  overrides: Partial<Record<keyof typeof PROMPT_KEYBINDS, string>>,
  event: KeyboardEvent,
) {
  const override = overrides[id]
  if (override !== undefined) return matchKeybind(parseKeybind(override), event)
  const other = id === "submit" ? overrides.newline : overrides.submit
  if (other !== undefined && matchKeybind(parseKeybind(other), event)) return false
  if (event.key !== "Enter") return false
  return id === "submit" ? !event.shiftKey && !event.ctrlKey && !event.metaKey : event.shiftKey
}

export function createPromptKeybinds() {
  const settings = useSettings()
  const overrides = () => ({
    submit: settings.keybinds.get(PROMPT_KEYBINDS.submit.id),
    newline: settings.keybinds.get(PROMPT_KEYBINDS.newline.id),
  })

  return {
    submit: (event: KeyboardEvent) => matchPromptKeybind("submit", overrides(), event),
    newline: (event: KeyboardEvent) => matchPromptKeybind("newline", overrides(), event),
  }
}

export function promptKeybindOptions(titles: { submit: string; newline: string }) {
  return [
    {
      id: PROMPT_KEYBINDS.submit.id,
      title: titles.submit,
      keybind: PROMPT_KEYBINDS.submit.keybind,
      disabled: true,
    },
    {
      id: PROMPT_KEYBINDS.newline.id,
      title: titles.newline,
      keybind: PROMPT_KEYBINDS.newline.keybind,
      disabled: true,
    },
  ]
}
