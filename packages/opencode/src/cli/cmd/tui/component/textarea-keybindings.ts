import { createMemo } from "solid-js"
import type { KeyBinding } from "@opentui/core"
import { useKeybind } from "../context/keybind"
import { Keybind } from "@/util/keybind"

const TEXTAREA_ACTIONS = [
  "submit",
  "newline",
  "move-left",
  "move-right",
  "move-up",
  "move-down",
  "select-left",
  "select-right",
  "select-up",
  "select-down",
  "line-home",
  "line-end",
  "select-line-home",
  "select-line-end",
  "visual-line-home",
  "visual-line-end",
  "select-visual-line-home",
  "select-visual-line-end",
  "buffer-home",
  "buffer-end",
  "select-buffer-home",
  "select-buffer-end",
  "delete-line",
  "delete-to-line-end",
  "delete-to-line-start",
  "backspace",
  "delete",
  "undo",
  "redo",
  "word-forward",
  "word-backward",
  "select-word-forward",
  "select-word-backward",
  "delete-word-forward",
  "delete-word-backward",
] as const

function mapTextareaKeybindings(
  keybinds: Record<string, Keybind.Info[]>,
  action: (typeof TEXTAREA_ACTIONS)[number],
): KeyBinding[] {
  const configKey = `input_${action.replace(/-/g, "_")}`
  const bindings = keybinds[configKey]
  if (!bindings) return []
  const result: KeyBinding[] = []
  for (const binding of bindings) {
    result.push({
      name: binding.name,
      ctrl: binding.ctrl || undefined,
      meta: binding.meta || undefined,
      shift: binding.shift || undefined,
      super: binding.super || undefined,
      action,
    })
    // Terminals encode ctrl+_ as \x1F without modifier flags, so add a
    // raw binding so opentui's key matcher can recognise the sequence.
    if (binding.name === "_" && binding.ctrl) {
      result.push({ name: "\x1F", action })
    }
  }
  return result
}

export function useTextareaKeybindings() {
  const keybind = useKeybind()

  return createMemo(() => {
    const keybinds = keybind.all

    return [
      { name: "return", action: "submit" },
      { name: "return", meta: true, action: "newline" },
      ...TEXTAREA_ACTIONS.flatMap((action) => mapTextareaKeybindings(keybinds, action)),
    ] satisfies KeyBinding[]
  })
}
