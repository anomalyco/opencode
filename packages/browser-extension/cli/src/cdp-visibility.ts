/**
 * Per-client CDP target visibility.
 *
 * Each OpenCode Browser session's sandbox connects as its own CDP client and
 * identifies itself with a OpenCode Browser session id. Tabs created for a
 * session are owned by that session. Without scoping, every client is told
 * about every tab, so concurrently connected clients attach to and
 * double-initialize each other's pages, which makes
 * `newPage`/`setContent`/`evaluate` hang non-deterministically.
 *
 * Visibility rule:
 * - Session-owned targets are visible only to that session's clients.
 * - User toolbar-attached targets stay visible to every client, so
 *   `--target-url` recovery keeps working.
 * - Relay-created targets without a OpenCode Browser session id belong to raw
 *   `connectOverCDP` clients. They are visible to raw clients and to a session
 *   client that does not already own a target, so explicit `--target-url`
 *   adoption can still find existing attached pages. Once a session has its own
 *   sandbox target, it must not attach to raw-client pages, or Playwright
 *   double-initializes the page on Chrome's single debugger attachment and
 *   `locator.evaluate` can wedge.
 *
 * Two simultaneous raw clients can still interfere with each other's tabs;
 * OpenCode Browser sessions are the isolated, supported path.
 */
export function canClientSeeTarget(options: {
  readonly clientSessionId: string | undefined
  readonly targetOwnerSessionId: string | undefined
  readonly targetOwner: "relay" | "user"
  readonly clientHasOwnedTarget: boolean
}): boolean {
  if (options.targetOwnerSessionId === undefined) {
    return options.targetOwner === "user" || options.clientSessionId === undefined || !options.clientHasOwnedTarget
  }
  return options.clientSessionId === options.targetOwnerSessionId
}
