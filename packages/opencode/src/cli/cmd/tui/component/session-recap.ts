import type { Message, Part, SessionStatus, Todo } from "@opencode-ai/sdk/v2"

export type SessionMessageWithParts = {
  info: Message
  parts: Part[]
}

export type SessionRecap = {
  done: string
  blocked: string
  next: string
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function firstNonEmptyLine(value: string) {
  const line = value
    .split("\n")
    .map((item) => item.trim())
    .find((item) => !!item && !item.startsWith("#"))
  return line ? compactWhitespace(line) : ""
}

function clip(value: string, max = 160) {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}...`
}

function summarizeText(value: string, max = 160) {
  const line = firstNonEmptyLine(value)
  if (!line) return ""
  return clip(line, max)
}

function extractSection(value: string, heading: string) {
  const lines = value.split("\n")
  const headingLine = `## ${heading}`.toLowerCase()
  let start = -1

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().toLowerCase() === headingLine) {
      start = i + 1
      break
    }
  }

  if (start === -1) return ""

  const body: string[] = []
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim().startsWith("## ")) break
    body.push(line)
  }

  return summarizeText(body.join("\n"))
}

function latestAssistantSummaryText(messages: SessionMessageWithParts[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const item = messages[i]
    if (!item || item.info.role !== "assistant" || item.info.summary !== true) continue
    for (let j = item.parts.length - 1; j >= 0; j--) {
      const part = item.parts[j]
      if (!part || part.type !== "text" || part.synthetic || part.ignored) continue
      const text =
        extractSection(part.text, "Accomplished") ||
        extractSection(part.text, "Discoveries") ||
        summarizeText(part.text)
      if (text) return text
    }
  }
  return ""
}

function latestFallbackDone(messages: SessionMessageWithParts[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const item = messages[i]
    if (!item) continue

    if (item.info.role === "assistant") {
      if (!item.info.time.completed || item.info.error) continue
      for (let j = item.parts.length - 1; j >= 0; j--) {
        const part = item.parts[j]
        if (!part || part.type !== "text" || part.synthetic || part.ignored) continue
        const text = summarizeText(part.text)
        if (text) return text
      }
      continue
    }

    const summary =
      typeof item.info.summary === "object" && item.info.summary ? summarizeText(item.info.summary.body ?? "") : ""
    if (summary) return summary
  }
  return ""
}

function deriveBlocked(status: SessionStatus | undefined, messages: SessionMessageWithParts[]) {
  if (status?.type === "busy") return "Session is currently running."
  if (status?.type === "retry") {
    const message = summarizeText(status.message ?? "")
    return message ? `Retrying: ${message}` : `Retrying (attempt ${status.attempt}).`
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const item = messages[i]
    if (!item || item.info.role !== "assistant" || !item.info.error) continue
    const error = item.info.error as { message?: string; data?: { message?: string }; name?: string }
    const message = summarizeText(error.message ?? error.data?.message ?? error.name ?? "")
    if (message) return message
    return "Session encountered an error."
  }

  return "None."
}

function deriveNext(todos: Todo[]) {
  const next = todos.find((todo) => todo.status === "in_progress" || todo.status === "pending")
  if (next?.content) return summarizeText(next.content)
  return "No pending tasks."
}

export function deriveSessionRecap(input: {
  messages: SessionMessageWithParts[]
  todos: Todo[]
  status?: SessionStatus
}): SessionRecap {
  const done = latestAssistantSummaryText(input.messages) || latestFallbackDone(input.messages) || "No recap yet."
  return {
    done,
    blocked: deriveBlocked(input.status, input.messages),
    next: deriveNext(input.todos),
  }
}
