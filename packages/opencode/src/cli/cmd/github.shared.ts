import type { SessionV1 } from "@opencode-ai/core/v1/session"

export { parseGitHubRemote } from "@/util/repository"

/**
 * Session metadata key tying a `github run` session to its GITHUB_RUN_ID, so a
 * retry on the same runner can find and resume that session. Single source of
 * truth for the key shared by the writer (session create) and reader (lookup).
 */
export const GITHUB_RUN_METADATA_KEY = "githubRunId"

export const GITHUB_RUN_RESUME_PROMPT =
  "The previous attempt in this session was interrupted before finishing. Continue the task to completion."

/**
 * Whether a resumed `github run` should send a short continuation nudge instead
 * of the full prompt. Only safe once the prior attempt recorded history: the
 * user prompt is persisted before the model call, so a transient mid-call
 * failure leaves it present. An attempt that died during setup before any
 * message was stored leaves an empty session and must receive the full prompt.
 */
export function shouldSendContinuation(input: { foundPrior: boolean; priorMessageCount: number }): boolean {
  return input.foundPrior && input.priorMessageCount > 0
}

export function githubRunPrompt<T>(input: {
  continuation: boolean
  message: string
  promptFiles: T[]
}): { message: string; promptFiles: T[] } {
  if (!input.continuation) return { message: input.message, promptFiles: input.promptFiles }
  return { message: GITHUB_RUN_RESUME_PROMPT, promptFiles: [] }
}

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
