export function extractDirectory(result: string | string[] | null): string | null {
  if (Array.isArray(result)) return result[0] ?? null
  return result
}

/**
 * Builds a shell prefix that writes the token to ~/.config/laterapi/token.
 * Returns empty string if token is empty (no-op).
 */
export function buildTokenPersistCommand(token: string): string {
  if (!token) return ""
  return "mkdir -p ~/.config/laterapi && printf '%s' \"$LATERAPI_KEY\" > ~/.config/laterapi/token && chmod 600 ~/.config/laterapi/token && "
}

/**
 * Wraps a command and its args into a shell invocation with an optional prefix.
 */
export function buildShellCommand(command: string, args: string[], prefix: string): { command: string; args: string[] } {
  const cmd = [command, ...args].join(" ")
  return { command: "sh", args: ["-c", prefix + cmd] }
}
