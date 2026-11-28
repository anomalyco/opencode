type Key = Pick<
  KeyboardEvent,
  "key" | "keyCode" | "repeat" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "isComposing"
>

// The key that moves the dock on, or submits it on the last question: Enter, or Cmd/Ctrl+Enter.
export type QuestionSubmitKey = "enter" | "mod+enter"

// What an Enter does in the question dock: `submit` moves on, `select` picks the highlighted answer, or in the custom
// answer starts a new line. Cmd/Ctrl+Enter always submits. With Enter submitting, Shift+Enter selects; with
// Cmd/Ctrl+Enter submitting, Enter selects with or without Shift.
export function questionEnter(event: Key, submit: QuestionSubmitKey): "submit" | "select" | undefined {
  if (event.key !== "Enter" || event.isComposing || event.keyCode === 229 || event.altKey) return

  if (event.metaKey || event.ctrlKey) return "submit"

  if (submit === "mod+enter") return "select"

  return event.shiftKey ? "select" : "submit"
}
