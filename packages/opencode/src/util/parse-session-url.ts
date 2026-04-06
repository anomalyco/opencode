/**
 * Parses a session URL or base URL and extracts the base URL and optional session ID
 *
 * Supports formats:
 * - http://localhost:4096 -> { baseUrl: "http://localhost:4096", sessionId: undefined }
 * - http://localhost:4096/ses_123 -> { baseUrl: "http://localhost:4096", sessionId: "ses_123" }
 * - http://localhost:4096/ses_123/session/ses_123 -> { baseUrl: "http://localhost:4096", sessionId: "ses_123" }
 */
export function parseSessionUrl(url: string): { baseUrl: string; sessionId?: string } {
  const sessionMatch = url.match(/^(https?:\/\/[^\/]+)\/(ses_[a-zA-Z0-9]+)/)

  if (sessionMatch) {
    return {
      baseUrl: sessionMatch[1],
      sessionId: sessionMatch[2],
    }
  }

  // No session ID, just return the base URL
  return {
    baseUrl: url.replace(/\/$/, ""), // Remove trailing slash
    sessionId: undefined,
  }
}
