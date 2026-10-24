import { matchKeybind, parseKeybind } from "@/shell/commands/command"
import { useSettings } from "@/settings/model"

export const PROMPT_KEYBINDS = {
  submit: {
    id: "prompt.submit",
    keybind: "enter,alt+enter",
    title: "command.prompt.submit",
  },
  newline: {
    id: "prompt.newline",
    keybind:
      "shift+enter,ctrl+shift+enter,meta+shift+enter,alt+shift+enter,ctrl+meta+shift+enter,ctrl+alt+shift+enter,meta+alt+shift+enter,ctrl+meta+alt+shift+enter",
    title: "command.prompt.newline",
  },
  alternate: {
    id: "prompt.submit.alternate",
    keybind: "mod+enter,ctrl+enter,meta+enter,ctrl+meta+enter,ctrl+alt+enter,meta+alt+enter,ctrl+meta+alt+enter",
    title: "command.prompt.submit.alternate",
  },
} as const

export function resolvePromptKeybinds(overrides: Partial<Record<keyof typeof PROMPT_KEYBINDS, string>>) {
  const taken = Object.values(overrides).flatMap((value) => (value === undefined ? [] : parseKeybind(value)))

  const effective = (id: keyof typeof PROMPT_KEYBINDS) => {
    const override = overrides[id]

    if (override !== undefined) return override

    // Explicit bindings own their chords; untouched defaults retain only the remaining variants.
    return (
      PROMPT_KEYBINDS[id].keybind
        .split(",")
        .filter((chord) =>
          parseKeybind(chord).every(
            (binding) =>
              !taken.some(
                (custom) =>
                  custom.key === binding.key &&
                  custom.ctrl === binding.ctrl &&
                  custom.meta === binding.meta &&
                  custom.shift === binding.shift &&
                  custom.alt === binding.alt,
              ),
          ),
        )
        .join(",") || "none"
    )
  }

  return { submit: effective("submit"), newline: effective("newline"), alternate: effective("alternate") }
}

export function matchPromptKeybind(
  id: keyof typeof PROMPT_KEYBINDS,
  overrides: Partial<Record<keyof typeof PROMPT_KEYBINDS, string>>,
  event: KeyboardEvent,
) {
  return matchKeybind(parseKeybind(resolvePromptKeybinds(overrides)[id]), event)
}

export function createPromptKeybinds() {
  const settings = useSettings()

  const overrides = () => ({
    submit: settings.keybinds.get(PROMPT_KEYBINDS.submit.id),
    newline: settings.keybinds.get(PROMPT_KEYBINDS.newline.id),
    alternate: settings.keybinds.get(PROMPT_KEYBINDS.alternate.id),
  })

  return {
    submit: (event: KeyboardEvent) => matchPromptKeybind("submit", overrides(), event),
    newline: (event: KeyboardEvent) => matchPromptKeybind("newline", overrides(), event),
    alternate: (event: KeyboardEvent) => matchPromptKeybind("alternate", overrides(), event),
    options: (titles: Parameters<typeof promptKeybindOptions>[0]) => promptKeybindOptions(titles, overrides()),
  }
}

export function promptKeybindOptions(
  titles: { submit: string; newline: string; alternate: string },
  overrides: Partial<Record<keyof typeof PROMPT_KEYBINDS, string>> = {},
) {
  const bindings = resolvePromptKeybinds(overrides)

  return [
    {
      id: PROMPT_KEYBINDS.alternate.id,
      title: titles.alternate,
      keybind: bindings.alternate,
      disabled: true,
    },
    {
      id: PROMPT_KEYBINDS.submit.id,
      title: titles.submit,
      keybind: bindings.submit,
      disabled: true,
    },
    {
      id: PROMPT_KEYBINDS.newline.id,
      title: titles.newline,
      keybind: bindings.newline,
      disabled: true,
    },
  ]
}
