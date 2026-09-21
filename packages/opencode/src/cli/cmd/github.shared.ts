import type { SessionV1 } from "@opencode-ai/core/v1/session"

export { parseGitHubRemote } from "@/util/repository"

/**
 * Extracts displayable text from assistant response parts.
 * Returns null for non-text responses (signals summary needed).
 * Throws only for truly empty responses.
 */
export function extractResponseText(parts: SessionV1.Part[]): string | null {
  const textPart = parts.findLast((p) => p.type === "text")
  if (textPart) return textPart.text

  // Non-text parts (tools, reasoning, step-start/step-finish, etc.) - signal summary needed
  if (parts.length > 0) return null

  throw new Error("Failed to parse response: no parts returned")
}

/**
 * Reads the triggering instruction out of an event payload.
 *
 * Comment events carry it in `comment.body`. A submitted review is not a comment and has no
 * `comment` field at all, so its equivalent is `review.body` (which GitHub sends as null when the
 * review was submitted without text). Returns undefined only when the event has no body source at
 * all, so an empty body can be reported as a missing mention rather than as a malformed payload.
 */
export function resolveTriggerBody(eventName: string, payload: unknown): string | undefined {
  const source = payload as
    | { comment?: { body?: string | null } | null; review?: { body?: string | null } | null }
    | null
    | undefined
  const container = eventName === "pull_request_review" ? source?.review : source?.comment
  if (!container || typeof container !== "object") return undefined
  return (container.body ?? "").trim()
}

/**
 * Formats a PROMPT_TOO_LARGE error message with details about files in the prompt.
 * Content is base64 encoded, so we calculate original size by multiplying by 0.75.
 */
export function formatPromptTooLargeError(files: { filename: string; content: string }[]): string {
  const fileDetails =
    files.length > 0
      ? `\n\nFiles in prompt:\n${files.map((f) => `  - ${f.filename} (${((f.content.length * 0.75) / 1024).toFixed(0)} KB)`).join("\n")}`
      : ""
  return `PROMPT_TOO_LARGE: The prompt exceeds the model's context limit.${fileDetails}`
}
