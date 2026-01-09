const CONTINUE_ANYWHERE_RE =
  /\b(continue|resume|proceed|keep going|next step)\b|(?:\u043f\u0440\u043e\u0434\u043e\u043b\u0436|\u0434\u0430\u043b\u044c\u0448\u0435)/i

const CONTINUE_START_RE =
  /^\s*(?:\u0434\u0430\u0432\u0430\u0439\s+)?(?:\u043f\u0440\u043e\u0434\u043e\u043b\u0436\w*|\u0434\u0430\u043b\u044c\u0448\u0435)\b/i

const CONTINUE_START_EN_RE = /^\s*(?:continue|resume|proceed|keep going|next step)\b/i

const TODO_KEYWORDS_RE =
  /\b(todo|todos|todo list|task list|tasks)\b|(?:\u0442\u0443\u0434\u0443|\u0437\u0430\u0434\u0430\u0447\w*|\u0441\u043f\u0438\u0441\u043e\u043a\s+\u0437\u0430\u0434\u0430\u0447)/i

export function hasTodoKeywords(text: string) {
  return TODO_KEYWORDS_RE.test(text)
}

export function isTodoContinuationRequest(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return false

  const lines = trimmed.split(/\r?\n/)
  const firstLine = lines.find((line) => line.trim().length > 0) ?? ""

  // Require an explicit reference to todos/tasks to avoid treating generic "continue" as "continue the todo list".
  const hasTodos = hasTodoKeywords(trimmed)
  const startsWithContinue = CONTINUE_START_RE.test(firstLine) || CONTINUE_START_EN_RE.test(firstLine)

  if (startsWithContinue && hasTodos) {
    return true
  }

  // Avoid false positives when users paste logs / transcripts containing words like "continue"/"продолжим"
  // somewhere in a long message.
  const isShort = trimmed.length <= 80 && lines.length <= 3
  if (!isShort) return false

  return hasTodos && CONTINUE_ANYWHERE_RE.test(trimmed)
}
