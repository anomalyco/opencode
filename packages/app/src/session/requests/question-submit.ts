import type { QuestionSubmitKey } from "./question-keys"

// How the dock's Next and Submit buttons show and announce the submit key. Cmd/Ctrl+Enter submits either way.
export function questionSubmitShortcuts(submit: QuestionSubmitKey, mac: boolean, ctrl: string) {
  if (submit === "enter") return { label: "⏎", aria: "Enter Meta+Enter Control+Enter" }

  return { label: mac ? "⌘⏎" : `${ctrl}+⏎`, aria: "Meta+Enter Control+Enter" }
}

// Grows the custom answer's field to its lines, up to the height its styles cap it at, where it scrolls.
export function fitCustomAnswer(field: HTMLTextAreaElement) {
  field.style.height = "auto"
  field.style.height = `${field.scrollHeight}px`
}
