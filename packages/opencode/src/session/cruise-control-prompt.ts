export type PromptMessage = {
  info: { role: string; id?: string }
  parts: readonly {
    type: string
    text?: string
    synthetic?: boolean
    ignored?: boolean
    tool?: string
    state?: {
      status?: string
      input?: Record<string, unknown>
      output?: string
      error?: string
    }
  }[]
}

/** One entry in the classifier-visible session projection. */
export type SessionViewEntry =
  | { type: "user"; text: string }
  | { type: "tool_call"; tool: string; input: Record<string, unknown> }

/** Max entries kept from the end of the session (most recent). */
const MAX_SESSION_ENTRIES = 40
/** Cap serialized tool args so write/edit bodies cannot blow the classifier context. */
const MAX_TOOL_INPUT_CHARS = 2000

/** Extract only explicit text from the latest user turn, excluding host-generated context. */
export function currentUserPrompt(messages: readonly PromptMessage[]): string | undefined {
  const current = messages.findLast((message) => message.info.role === "user")
  if (!current) return undefined
  return messageExplicitText(current)
}

function messageExplicitText(message: PromptMessage): string | undefined {
  const text = message.parts
    .filter((part) => part.type === "text" && part.synthetic !== true && part.ignored !== true)
    .map((part) => part.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n")
  return text || undefined
}

function truncateToolInput(input: Record<string, unknown>): Record<string, unknown> {
  const raw = JSON.stringify(input)
  if (raw.length <= MAX_TOOL_INPUT_CHARS) return input
  return { _truncated: `${raw.slice(0, MAX_TOOL_INPUT_CHARS)}...` }
}

/**
 * Project session history for cruise_control.
 *
 * Visible: user messages (explicit text) and tool calls (name + input/args).
 * Hidden: assistant text responses, reasoning/thinking, and tool results/output.
 */
export function cruiseControlSessionView(messages: readonly PromptMessage[]): SessionViewEntry[] {
  const entries: SessionViewEntry[] = []

  for (const message of messages) {
    if (message.info.role === "user") {
      const text = messageExplicitText(message)
      if (text) entries.push({ type: "user", text })
      continue
    }

    if (message.info.role !== "assistant") continue

    for (const part of message.parts) {
      if (part.type !== "tool") continue
      const tool = part.tool?.trim()
      if (!tool) continue
      const input = part.state?.input
      entries.push({
        type: "tool_call",
        tool,
        input: input && typeof input === "object" && !Array.isArray(input) ? truncateToolInput(input) : {},
      })
    }
  }

  if (entries.length <= MAX_SESSION_ENTRIES) return entries
  return entries.slice(-MAX_SESSION_ENTRIES)
}

const SHORT_AFFIRMATION =
  /^(?:ok(?:ay)?|yes|yep|yeah|yup|sure|go ahead|proceed|do it|please do|approved?|affirmative|sounds good|that works|go for it|👍|✅)(?:[.!]?)$/i

const PERMISSION_ASK =
  /\b(?:may i|shall i|can i|should i|would you like me to|do you want me to|want me to|permission to|allow me to|is it ok(?:ay)?|is that ok(?:ay)?|okay to|ok to)\b/i

export function isShortAffirmation(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 40) return false
  return SHORT_AFFIRMATION.test(trimmed)
}

export function looksLikePermissionAsk(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (PERMISSION_ASK.test(trimmed)) return true
  return /\?/.test(trimmed) && /\b(?:run|execute|reset|delete|push|drop|truncate|install|deploy)\b/i.test(trimmed)
}

/**
 * Host-only enrichment for short affirmations after an assistant permission ask.
 * Must not be sent to the classifier LLM (assistant replies are not classifier-visible).
 */
export function cruiseControlUserPrompt(messages: readonly PromptMessage[]): string | undefined {
  const currentText = currentUserPrompt(messages)
  if (!currentText) return undefined
  if (!isShortAffirmation(currentText)) return currentText

  const userIndex = messages.findLastIndex((message) => message.info.role === "user")
  if (userIndex <= 0) return currentText

  const priorAssistant = messages
    .slice(0, userIndex)
    .findLast((message) => message.info.role === "assistant")
  if (!priorAssistant) return currentText

  const assistantText = messageExplicitText(priorAssistant)
  if (!assistantText || !looksLikePermissionAsk(assistantText)) return currentText

  return [
    "<conversation_context>",
    "<prior_assistant_reply>",
    assistantText,
    "</prior_assistant_reply>",
    "<current_user_reply>",
    currentText,
    "</current_user_reply>",
    "</conversation_context>",
  ].join("\n")
}

const CONVERSATION_CONTEXT =
  /<conversation_context>\s*<prior_assistant_reply>\s*([\s\S]*?)\s*<\/prior_assistant_reply>\s*<current_user_reply>\s*([\s\S]*?)\s*<\/current_user_reply>\s*<\/conversation_context>/i

function pendingActionMentioned(
  assistantReply: string,
  patterns: readonly string[],
  metadata?: Record<string, unknown>,
): boolean {
  const haystack = assistantReply.toLowerCase()
  for (const pattern of patterns) {
    const normalized = pattern.trim().toLowerCase()
    if (normalized && normalized !== "*" && haystack.includes(normalized)) return true
  }
  const command = metadata?.command
  if (typeof command === "string") {
    const normalized = command.trim().toLowerCase()
    if (normalized && haystack.includes(normalized)) return true
  }
  return false
}

/**
 * True when the user gave a short approval that clearly responds to the assistant's
 * permission ask for the pending action described in patterns/metadata.
 * Uses host-only enriched prompt text; not classifier-visible session data.
 */
export function explicitApprovalIntent(
  userPrompt: string | undefined,
  patterns: readonly string[],
  metadata?: Record<string, unknown>,
): boolean {
  if (!userPrompt) return false
  const match = userPrompt.match(CONVERSATION_CONTEXT)
  if (!match) return false
  const assistantReply = match[1]?.trim() ?? ""
  const userReply = match[2]?.trim() ?? ""
  if (!assistantReply || !isShortAffirmation(userReply)) return false
  return pendingActionMentioned(assistantReply, patterns, metadata)
}
