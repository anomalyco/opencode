import { createMemo } from "solid-js"
import { matchKeybind, parseKeybind, useCommand } from "@/shell/commands/command"
import { chordStrokes, keymapKey } from "@/shell/commands/keymap"
import { useSettings } from "@/settings/model"

export const PROMPT_KEYBINDS = {
  submit: {
    id: "prompt.submit",
    keybind: "enter",
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
  first: {
    id: "prompt.submit.first",
    keybind: "alt+enter",
    title: "session.queue.first",
  },
} as const

export function resolvePromptKeybinds(overrides: Partial<Record<keyof typeof PROMPT_KEYBINDS, string>>) {
  const taken = Object.values(overrides).flatMap(
    (value) => value?.split(",").flatMap((combo) => parseKeybind(chordStrokes(combo)[0] ?? "")) ?? [],
  )

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

  return {
    submit: effective("submit"),
    newline: effective("newline"),
    alternate: effective("alternate"),
    first: effective("first"),
  }
}

export function promptKeyMatcher(config: string) {
  const strokes = parseKeybind(config)

  return (event: KeyboardEvent) => matchKeybind(strokes, event)
}

export function createPromptKeybinds() {
  const settings = useSettings()
  const command = useCommand()

  const overrides = () => ({
    submit: settings.keybinds.get(PROMPT_KEYBINDS.submit.id),
    newline: settings.keybinds.get(PROMPT_KEYBINDS.newline.id),
    alternate: settings.keybinds.get(PROMPT_KEYBINDS.alternate.id),
    first: settings.keybinds.get(PROMPT_KEYBINDS.first.id),
  })

  const effective = createMemo(() => resolvePromptKeybinds(overrides()))

  const matcher = (action: keyof typeof PROMPT_KEYBINDS) => {
    const match = createMemo(() => promptKeyMatcher(effective()[action]))

    return (event: KeyboardEvent) => match()(event)
  }

  return {
    submit: matcher("submit"),
    newline: matcher("newline"),
    alternate: matcher("alternate"),
    first: matcher("first"),
    sequences(
      target: HTMLElement,
      touch: boolean,
      run: (event: KeyboardEvent, action: keyof typeof PROMPT_KEYBINDS) => void,
    ) {
      const actions = ["submit", "newline", "alternate", "first"] as const
      const configs = effective()

      const bindings = actions.flatMap((action) =>
        configs[action].split(",").flatMap((combo) => {
          const strokes = chordStrokes(combo)

          if (strokes.length < 2) return []

          // A soft keyboard's Return always edits the draft, even when a sequence includes it.
          if (
            touch &&
            strokes.some((stroke) => parseKeybind(stroke).some((kb) => kb.key === "enter" && !kb.ctrl && !kb.meta))
          )
            return []

          return [{ key: keymapKey(combo), cmd: PROMPT_KEYBINDS[action].id }]
        }),
      )

      if (!bindings.length) return

      return command.registerKeyLayer({
        target,
        priority: 1,
        bindings,
        commands: actions.map((action) => ({
          name: PROMPT_KEYBINDS[action].id,
          run: ({ event }) => {
            if (event.originalEvent) run(event.originalEvent, action)
          },
        })),
      })
    },
    options: (titles: Parameters<typeof promptKeybindOptions>[0]) => promptKeybindOptions(titles, overrides()),
  }
}

export function promptKeybindOptions(
  titles: { submit: string; newline: string; alternate: string; first: string },
  overrides: Partial<Record<keyof typeof PROMPT_KEYBINDS, string>> = {},
) {
  const bindings = resolvePromptKeybinds(overrides)

  return [
    {
      id: PROMPT_KEYBINDS.first.id,
      title: titles.first,
      keybind: bindings.first,
      disabled: true,
    },
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
