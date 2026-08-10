/**
 * Pure decision logic for the window close event.
 *
 * Tray mode (Windows/Linux only): closing the LAST window hides it to the
 * system tray so background work (agents, servers) keeps running; closing a
 * window while others remain open closes it normally. During a real quit
 * (tray "Quit", app menu quit, Cmd+Q, SIGTERM) every window closes normally.
 *
 * macOS is intentionally untouched: it keeps the native close-to-Dock
 * behavior (window closes, app stays in the Dock, `activate` restores it),
 * exactly as before this feature.
 *
 * Kept free of Electron imports so unit tests can cover every branch.
 */
export type CloseAction = "hide" | "close"

export function resolveCloseAction(input: {
  isQuitting: boolean
  /** Number of OTHER windows still open (excluding the one being closed). */
  otherWindows: number
  /** Process platform; darwin keeps its native close behavior. */
  platform: NodeJS.Platform
}): CloseAction {
  if (input.platform === "darwin") return "close"
  if (input.isQuitting) return "close"
  if (input.otherWindows > 0) return "close"
  return "hide"
}
