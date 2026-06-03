// Models behind OpenAI-compatible servers (vLLM, llama.cpp) sometimes emit a
// tool call as plain text: the model drifts from its tool-call format (e.g.
// `<function_bash>` instead of `<function=bash>`), the server's parser fails
// to match, and the block streams back as content. The turn finishes with
// reason "stop" and no tool calls, which would halt the session loop
// mid-task. `detect` anchors on the end of the text, so prose that mentions
// these tags mid-text does not fire. A message that ends with example
// tool-call XML is an accepted false positive; it costs one extra
// round-trip, capped at MAX_ATTEMPTS.
// See https://github.com/anomalyco/opencode/issues/24316

// Conservative on purpose: a leak cut off before any closing tag (a bare
// `<function_x>` block mid-argument) means the stream was truncated, a
// "length" finish rather than a parser miss. Matching bare openers would
// fire on prose like "pass it via `<parameter=filePath>`". Both captured
// real leaks end in a closing tag even when the server ate the opening
// `<tool_call>`.
const OPENING = /<tool_call>|<function[=_][\w.-]+>|<parameter=[\w.-]+>/
const CLOSING_TAIL = /<\/(tool_call|function|parameter)>$/

export const MAX_ATTEMPTS = 2
export const MARKER = "toolCallLeakRecovery"

export const NUDGE =
  "Your previous message wrote a tool call as plain text, so it was NOT executed. " +
  "Do not write tool-call XML or JSON inside message text. " +
  "Re-issue the intended call now through the tool-calling mechanism with valid syntax."

export function detect(text: string): boolean {
  const trimmed = text.trimEnd()
  if (!OPENING.test(trimmed)) return false
  if (CLOSING_TAIL.test(trimmed)) return true
  const open = trimmed.lastIndexOf("<tool_call>")
  return open !== -1 && !trimmed.includes("</tool_call>", open)
}

interface PartLike {
  type: string
  synthetic?: boolean
  metadata?: Record<string, any>
}

interface MessageLike {
  info: { role: string }
  parts: ReadonlyArray<PartLike>
}

export function isNudge(part: PartLike): boolean {
  return part.type === "text" && part.synthetic === true && part.metadata?.[MARKER] === true
}

// Recovery attempts since the last real user prompt, derived from history so
// the cap survives restarts. Walks backward: each trailing user message made
// up entirely of nudge parts counts as one attempt. Any other user message
// (real text, file attachments, or no text at all) stops the walk; real user
// input resets the budget.
export function countAttempts(msgs: ReadonlyArray<MessageLike>): number {
  let count = 0
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i]
    if (msg.info.role !== "user") continue
    const texts = msg.parts.filter((p) => p.type === "text")
    if (texts.length > 0 && texts.every(isNudge)) {
      count++
      continue
    }
    break
  }
  return count
}

export * as ToolCallLeak from "./tool-call-leak"
