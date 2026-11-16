export type ComposerKeybinds = {
  submit: (event: KeyboardEvent) => boolean
  newline: (event: KeyboardEvent) => boolean
  alternate: (event: KeyboardEvent) => boolean
  first: (event: KeyboardEvent) => boolean
}

export function resolveComposerKeyAction(event: KeyboardEvent, keybinds: ComposerKeybinds, composing: boolean) {
  if (composing) return

  if (keybinds.newline(event)) return "newline" as const

  if (keybinds.submit(event)) return "submit" as const

  if (keybinds.alternate(event)) return "alternate" as const

  if (keybinds.first(event)) return "first" as const
}

export function handleComposerKeyDown(input: {
  event: KeyboardEvent
  keybinds?: ComposerKeybinds
  composing: boolean
  selectSuggestion: () => boolean
  handleController: () => boolean
  editFirst?: () => boolean
  insertNewline: () => void
  submit: (action: "submit" | "alternate" | "first") => void
}) {
  const submit = (action: "submit" | "alternate" | "first") => {
    input.event.preventDefault()
    input.event.stopPropagation()

    if (input.event.repeat || (input.event.key === "Enter" && input.selectSuggestion())) return
    input.submit(action)
  }

  const ime = input.event.isComposing || input.composing || input.event.keyCode === 229
  const action = input.keybinds ? resolveComposerKeyAction(input.event, input.keybinds, ime) : undefined

  if (action === "newline") {
    input.event.preventDefault()
    input.event.stopPropagation()

    if (input.event.key === "Enter" && input.selectSuggestion()) return
    input.insertNewline()

    return
  }

  if (ime) return

  if (action === "submit" || action === "alternate" || action === "first") return submit(action)

  if (input.handleController()) return
  const mod = input.event.metaKey || input.event.ctrlKey

  if (mod && input.event.key === "ArrowUp" && !input.event.shiftKey && !input.event.altKey) {
    if (input.editFirst?.()) input.event.preventDefault()

    return
  }

  if (input.keybinds && input.event.key === "Enter") {
    input.event.preventDefault()
    input.event.stopPropagation()

    return
  }

  if (!input.keybinds && input.event.key === "Enter" && !input.event.shiftKey)
    return submit(mod ? "alternate" : input.event.altKey ? "first" : "submit")
}
