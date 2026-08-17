export type PromptInputV2Keybinds = {
  submit: (event: KeyboardEvent) => boolean
  newline: (event: KeyboardEvent) => boolean
}

export function resolvePromptInputV2KeyAction(
  event: KeyboardEvent,
  keybinds: PromptInputV2Keybinds,
  composing: boolean,
) {
  const bareEnter = event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
  const newline = keybinds.newline(event)
  if (composing && (!newline || event.key !== "Enter" || bareEnter)) return
  if (newline) return "newline" as const
  if (composing) return
  if (keybinds.submit(event)) return "submit" as const
}
