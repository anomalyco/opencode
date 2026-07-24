import { RegistrationRejectedError, SdkHttpError, UnauthorizedError } from "@modelcontextprotocol/client"

/**
 * An HTTP 404 on an established session means the server discarded the
 * session (restart, expiry); the caller should reconnect and retry once.
 */
export function isStaleSession(error: unknown): boolean {
  return error instanceof SdkHttpError && error.status === 404
}

/** The server requires (re-)authorization before it will serve the request. */
export function isUnauthorized(error: unknown): boolean {
  return (
    error instanceof UnauthorizedError ||
    error instanceof RegistrationRejectedError ||
    (error instanceof SdkHttpError && error.status === 401)
  )
}

/**
 * The authorization server refused to register a client dynamically; the user
 * must supply a pre-registered clientId. Falls back to message matching for
 * servers that reject registration with a plain error.
 */
export function isRegistrationRejected(error: unknown): boolean {
  if (error instanceof RegistrationRejectedError) return true
  const message = String(error instanceof Error ? error.message : error)
  return message.includes("registration") || message.includes("client_id")
}

export * as McpError from "./errors"
