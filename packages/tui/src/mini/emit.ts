/**
 * Render a finished run's findings as a plain-text context block that a
 * follow-up run can consume on stdin:
 *
 *   bolt run "audit the auth flow" --emit context | bolt run "fix the issues"
 *
 * The header line names the source session so chained runs stay traceable;
 * everything after it is the run's final text output verbatim.
 */
export function context(sessionID: string, texts: string[]) {
  const body = texts.join("\n\n").trim()
  const header = `[bolt run context session=${sessionID}]`
  if (!body) return header
  return `${header}\n\n${body}`
}
