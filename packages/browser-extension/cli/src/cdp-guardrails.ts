/**
 * Relay-level CDP guardrails.
 *
 * The relay refuses a small set of CDP methods that would destroy the user's
 * real browser state (OpenCode Browser drives the user's own browser, with
 * their real logins). Read-only sessions additionally refuse input-dispatching
 * methods so "go look at X" tasks cannot click or type.
 *
 * Pure module: given a method and session context, return a rejection message
 * or null. The relay turns a rejection into a normal CDP error response for
 * that command id, so the calling script fails loudly without breaking the
 * connection.
 */

const alwaysBlocked = new Map<string, string>([
  ["Network.clearBrowserCookies", "it would log the user out of every site in their browser"],
  ["Network.clearBrowserCache", "it would clear the user's entire browser cache"],
  ["Storage.clearCookies", "it would log the user out of every site in their browser"],
  ["Browser.close", "it would close the user's browser"],
])

const readOnlyBlockedPrefixes = ["Input."] as const

export type GuardContext = {
  readonly method: string
  readonly readOnly: boolean
  readonly sessionId?: string | undefined
}

/**
 * Returns a human-readable rejection message when the method must be blocked,
 * or null when the command may be forwarded to the browser.
 */
export function guardCdpMethod(context: GuardContext): string | null {
  const reason = alwaysBlocked.get(context.method)
  if (reason) {
    return `OpenCode Browser blocked ${context.method}: ${reason}. This command is always blocked by the relay.`
  }
  if (context.readOnly && readOnlyBlockedPrefixes.some((prefix) => context.method.startsWith(prefix))) {
    const session = context.sessionId ? `Session ${context.sessionId}` : "This session"
    return `${session} is read-only: ${context.method} is blocked. Use a session created without --read-only to interact with pages.`
  }
  return null
}
