export const workspaceOpenState = (expanded: Record<string, boolean>, directory: string, local: boolean) =>
  expanded[directory] ?? local

/**
 * Whether to show the "New Session" item in the sidebar workspace.
 *
 * Only shows when sessions have loaded (not loading) and none exist yet.
 * Once a session exists, users are locked to that single session.
 */
export const shouldShowNewSession = (loading: boolean, sessionCount: number) =>
  !loading && sessionCount === 0

/**
 * Whether the workspace has existing sessions (used to hide
 * the "+" new session button in the workspace actions).
 */
export const hasExistingSessions = (sessionCount: number) =>
  sessionCount > 0
