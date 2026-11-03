// Where focus sits in the question dock when a key goes down: on an answer, on the custom answer's toggle, in the
// custom answer's text field, or anywhere else in the dock (progress, footer buttons).
export type QuestionKeyZone = "option" | "custom" | "input" | "other"

export type QuestionKeyIntent =
  | { type: "dismiss" }
  | { type: "advance" }
  | { type: "question"; step: 1 | -1 }
  | { type: "move"; step: 1 | -1 }
  | { type: "edge"; to: "first" | "last" }
  | { type: "number"; index: number }
  | { type: "activate" }
  | { type: "commit" }
  | { type: "type" }
  | { type: "swallow" }
  | { type: "none" }

type Key = Pick<
  KeyboardEvent,
  "key" | "keyCode" | "repeat" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "isComposing"
>

// Maps one keydown to what the dock should do. The arrows only move the highlight; Space marks the highlighted answer and
// Enter commits it and moves on. Answers act on key down, so Space never waits for its release.
export function questionKey(
  event: Key,
  context: { mac: boolean; zone: QuestionKeyZone; count: number },
): QuestionKeyIntent {
  // Enter and Escape during IME composition confirm or cancel the composition; Safari reports those as keyCode 229.
  if (event.isComposing || event.keyCode === 229) return { type: "none" }

  if (event.key === "Escape") return { type: "dismiss" }

  const back = context.mac
    ? event.metaKey && !event.ctrlKey && !event.altKey && event.key === "["
    : event.altKey && !event.ctrlKey && !event.metaKey && event.key === "ArrowLeft"

  if (back) return event.repeat ? { type: "none" } : { type: "question", step: -1 }

  if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key === "Enter")
    return event.repeat ? { type: "none" } : { type: "advance" }

  if (context.zone === "input" || event.metaKey || event.ctrlKey) return { type: "none" }

  const digit = /^[1-9]$/.test(event.key)

  // A printable key on the custom answer starts typing it; Option combinations are printable on macOS.
  if (context.zone === "custom" && !digit && event.key.length === 1 && event.key !== " ") return { type: "type" }

  if (event.altKey) return { type: "none" }

  if (digit) {
    const index = Number(event.key) - 1

    if (event.repeat || index >= context.count) return { type: "none" }

    return { type: "number", index }
  }

  if (event.shiftKey && event.key.startsWith("Arrow")) return { type: "none" }

  if (event.key === "ArrowLeft") return { type: "question", step: -1 }

  if (event.key === "ArrowRight") return { type: "question", step: 1 }

  if (context.zone === "other") return { type: "none" }

  if (event.key === "ArrowDown") return { type: "move", step: 1 }

  if (event.key === "ArrowUp") return { type: "move", step: -1 }

  if (event.key === "Home") return { type: "edge", to: "first" }

  if (event.key === "End") return { type: "edge", to: "last" }

  if (event.key === " ") return event.repeat ? { type: "swallow" } : { type: "activate" }

  if (event.key === "Enter" && !event.shiftKey) return event.repeat ? { type: "swallow" } : { type: "commit" }

  return { type: "none" }
}
