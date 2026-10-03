import type { SessionV1 } from "@opencode-ai/core/v1/session"

export { parseGitHubRemote } from "@/util/repository"

/** Formats a model-generated summary for repositories with conventional commit hooks. */
export function commitSubject(summary: string) {
  const line =
    summary
      .trim()
      .split(/\r?\n/, 1)[0]
      ?.trim()
      .replace(/[.!?]+$/, "")
      .trim() ?? ""
  const match = line.match(
    /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([a-z0-9-]+\))?(!)?:\s+(.+)$/i,
  )
  const scope = match?.[2]?.toLowerCase() ?? ""
  const prefix = `${match?.[1]?.toLowerCase() ?? "chore"}${scope.length <= 30 ? scope : ""}${match?.[3] ?? ""}: `
  const value = (match?.[4] ?? line) || "apply opencode changes"
  const subject = `${value.charAt(0).toLowerCase()}${value.slice(1)}`
  return `${prefix}${subject
    .slice(0, 72 - prefix.length)
    .trimEnd()
    .replace(/[.!?]+$/, "")}`
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
